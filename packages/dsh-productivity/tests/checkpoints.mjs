import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Checkpoints } from "../src/checkpoints.js";

test("file rollback, stale preview, safety backup, binary, busy guard and coverage", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "dsh-checkpoint-test-"));
    const root = join(temporary, "workspace");
    await mkdir(root);
    let running = false;
    const checkpoints = new Checkpoints(join(temporary, "storage"), { busy: async () => running, max_file_bytes: 64, max_checkpoints: 3 });
    try {
        await writeFile(join(root, "one.txt"), "original\nline\n");
        await writeFile(join(root, "two.bin"), Buffer.from([0, 1, 2]));
        await writeFile(join(root, ".env"), "SECRET=not-captured");
        await writeFile(join(root, "large.bin"), Buffer.alloc(65));
        const first = await checkpoints.capture(root, "first", "test");
        assert.equal(first.files, 2);
        assert.ok(first.skipped.includes(".env"));
        assert.ok(first.skipped.includes("large.bin"));
        assert.equal((await checkpoints.capture(root, "auto", "test", true)).unchanged, true);
        await writeFile(join(root, "large.bin"), "now small but originally excluded");
        await writeFile(join(root, "one.txt"), "changed\nline\n");
        await unlink(join(root, "two.bin"));
        await mkdir(join(root, "nested"));
        await writeFile(join(root, "nested", "new.txt"), "new");
        const preview = await checkpoints.preview(root, first.id);
        assert.equal(preview.total, 3);
        assert.match(preview.changes.find(item => item.path === "one.txt").diff, /-changed/);
        running = true;
        await assert.rejects(checkpoints.restore(root, first.id, preview.fingerprint, "test"), /任务正在运行/);
        running = false;
        await writeFile(join(root, "one.txt"), "changed-again");
        await assert.rejects(checkpoints.restore(root, first.id, preview.fingerprint, "test"), /重新预览/);
        const fresh = await checkpoints.preview(root, first.id);
        const result = await checkpoints.restore(root, first.id, fresh.fingerprint, "test");
        assert.equal(result.restored, 3);
        assert.equal(await readFile(join(root, "one.txt"), "utf8"), "original\nline\n");
        assert.deepEqual(await readFile(join(root, "two.bin")), Buffer.from([0, 1, 2]));
        await assert.rejects(readFile(join(root, "nested", "new.txt")), { code: "ENOENT" });
        assert.equal(await readFile(join(root, ".env"), "utf8"), "SECRET=not-captured");
        assert.equal(await readFile(join(root, "large.bin"), "utf8"), "now small but originally excluded");
        const undo = await checkpoints.preview(root, result.safety_id);
        await checkpoints.restore(root, result.safety_id, undo.fingerprint, "test");
        assert.equal(await readFile(join(root, "one.txt"), "utf8"), "changed-again");
        assert.equal(await readFile(join(root, "nested", "new.txt"), "utf8"), "new");
        await assert.rejects(checkpoints.safe_path(root, "../outside.txt"), /无效路径/);
        await assert.rejects(checkpoints.safe_path(root, "nested\\escape.txt"), /无效路径/);
        const outside = join(temporary, "outside");
        await mkdir(outside);
        await writeFile(join(outside, "secret.txt"), "outside");
        await symlink(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
        await assert.rejects(checkpoints.safe_path(root, "link/secret.txt"), /经过链接/);
        const safe = await checkpoints.capture(root, "link excluded", "test");
        assert.ok(safe.skipped.includes("link"));
        assert.ok((await checkpoints.list(root)).items.length <= 3);
        const limited = new Checkpoints(join(temporary, "limited"), { max_files: 1 });
        await assert.rejects(limited.capture(root, "large", "test"), /超过 1 个文件/);
    } finally {
        assert.ok(resolve(temporary).startsWith(`${resolve(tmpdir())}${sep}`));
        await rm(temporary, { recursive: true, force: true });
    }
});

test("partial restore is rolled back if a task starts mid-restore", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "dsh-checkpoint-test-"));
    const root = join(temporary, "workspace");
    await mkdir(root);
    let checks = 0;
    let interrupt = false;
    const checkpoints = new Checkpoints(join(temporary, "storage"), { busy: async () => interrupt && ++checks >= 3 });
    try {
        for (const name of ["a.txt", "b.txt"]) await writeFile(join(root, name), "original");
        const first = await checkpoints.capture(root, "first", "test");
        for (const name of ["a.txt", "b.txt"]) await writeFile(join(root, name), "changed");
        const preview = await checkpoints.preview(root, first.id);
        interrupt = true;
        await assert.rejects(checkpoints.restore(root, first.id, preview.fingerprint, "test"), /已恢复 1\/1/);
        for (const name of ["a.txt", "b.txt"]) assert.equal(await readFile(join(root, name), "utf8"), "changed");
    } finally {
        assert.ok(resolve(temporary).startsWith(`${resolve(tmpdir())}${sep}`));
        await rm(temporary, { recursive: true, force: true });
    }
});
