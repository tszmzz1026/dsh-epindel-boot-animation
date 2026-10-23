import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { install_suite, verify_identity } from "../scripts/install-suite.mjs";

test("source identity rejects repository lookalikes", () => {
    const scratch = mkdtempSync(join(tmpdir(), "dsh-identity-"));
    const name = "dsh-glass-aurum";
    const directory = join(scratch, "packages", name);
    mkdirSync(directory, { recursive: true });
    try {
        for (const url of ["https://example.com/tszmzz1026/dsh-epindel-boot-animation", "git+https://github.com/tszmzz1026/dsh-epindel-boot-animation-fake.git"]) {
            writeFileSync(join(directory, "package.json"), JSON.stringify({ name, repository: { url, directory: `packages/${name}` } }));
            assert.throws(() => verify_identity(scratch, name), /repository|identity/i);
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

test("conflict replacement backs up original files before its first mutation", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "dsh-conflict-backup-"));
    const profile_path = join(scratch, "profiles", "web");
    mkdirSync(profile_path, { recursive: true });
    const original = JSON.stringify({ dependencies: { "dsh-glass-aurum": "9.0.0" }, dsh: { profile: { bundles: ["dsh-glass-aurum"] } } });
    writeFileSync(join(profile_path, "package.json"), original);
    writeFileSync(join(profile_path, "cordis.patch.yml"), "[]\n");
    try {
        await assert.rejects(install_suite({ bundle: "beauty", replace_conflict: true }, {
            runtime: { home: scratch, profile: "web", profile_path }, skip_verify: true,
            execute: async (_, action) => {
                assert.equal(action, "remove");
                const backups = join(scratch, "extensions", "glass-suite", "backups");
                assert.ok(existsSync(backups), "backup must precede plugin removal");
                const entries = readdirSync(backups);
                assert.equal(entries.length, 1);
                assert.equal(readFileSync(join(backups, entries[0], "package.json"), "utf8"), original);
                throw new Error("simulated CLI failure");
            },
        }), /simulated CLI failure/);
        assert.equal(readFileSync(join(profile_path, "package.json"), "utf8"), original);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

test("clean bundles install and uninstall independently with profile bytes preserved", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "dsh-clean-suite-"));
    const profile_path = join(scratch, "profiles", "web");
    mkdirSync(profile_path, { recursive: true });
    const manifest_path = join(profile_path, "package.json");
    const patch_path = join(profile_path, "cordis.patch.yml");
    const original = "# existing settings\r\n[]\r\n";
    writeFileSync(manifest_path, JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
    writeFileSync(patch_path, original);
    const manifest = () => JSON.parse(readFileSync(manifest_path, "utf8"));
    const execute = async (_, action, spec) => {
        const data = manifest();
        const name = action === "remove" ? spec : JSON.parse(readFileSync(join(spec.slice(5), "package.json"), "utf8")).name;
        if (action === "add") { data.dependencies[name] = spec; if (!data.dsh.profile.bundles.includes(name)) data.dsh.profile.bundles.push(name); }
        else { delete data.dependencies[name]; data.dsh.profile.bundles = data.dsh.profile.bundles.filter(item => item !== name); }
        writeFileSync(manifest_path, JSON.stringify(data));
    };
    const run = options => install_suite(options, { runtime: { home: scratch, profile: "web", profile_path }, execute, skip_verify: true });
    try {
        const installed = await run({ bundle: "extensions" });
        assert.deepEqual(Object.keys(manifest().dependencies), ["dsh-productivity"]);
        assert.equal(readFileSync(patch_path, "utf8"), original);
        assert.equal(existsSync(join(installed.stage, "assets")), false);
        await run({ bundle: "beauty" });
        assert.deepEqual(Object.keys(manifest().dependencies).sort(), ["dsh-glass-aurum", "dsh-productivity"]);
        assert.ok(readFileSync(patch_path, "utf8").includes("preference: dark"));
        await run({ bundle: "beauty", uninstall: true });
        assert.equal(readFileSync(patch_path, "utf8"), original);
        assert.ok(manifest().dependencies["dsh-productivity"]);
        await run({ uninstall: true });
        assert.deepEqual(manifest().dependencies, {});
        assert.equal(readFileSync(patch_path, "utf8"), original);
    } finally {
        assert.ok(resolve(scratch).startsWith(`${resolve(tmpdir())}${sep}dsh-clean-suite-`));
        rmSync(scratch, { recursive: true, force: true });
    }
});
