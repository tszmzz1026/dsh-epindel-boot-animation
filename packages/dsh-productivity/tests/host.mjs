import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { create_productivity, PREFIX } from "../src/host.js";
import { summary_prompt } from "../src/summary.js";

test("routes, context policy persists and actually filters model requests, automatic tool snapshot", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "dsh-productivity-test-"));
    const root = join(temporary, "workspace");
    const storage = join(temporary, "storage");
    await mkdir(root);
    const message = id => ({ id, role: "user", content: [{ type: "text", text: id }] });
    const old_message = message("old-message");
    const new_message = message("new-message");
    const events = [{ type: "user/message", data: old_message }, { type: "turn/start", data: { turn: 1 } }, { type: "turn/end", data: { turn: 1 } }, { type: "user/message", data: new_message }, { type: "turn/start", data: { turn: 2 } }, { type: "turn/end", data: { turn: 2 } }];
    const header = { id: "session", cwd: root };
    let running = false;
    let leases = 0;
    const ctx = {
        agents: { get: () => ({ status: running ? "running" : "idle" }) },
        sessionQuery: {
            readSession: async id => { assert.equal(id, "session"); return { session: header, events }; },
            listSessions: async () => [{ header }],
            readSurface: async () => ({ session: header, events }),
            observeSession: async () => { leases++; return { events, projections: { values: {} }, [Symbol.dispose]: () => leases-- }; },
        },
    };
    const service = create_productivity(ctx, storage);
    const server = createServer(service.route);
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, body, headers = {}) => fetch(`${origin}${PREFIX}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-dsh-productivity": "1", ...headers }, body: JSON.stringify(body) });
    try {
        assert.equal((await request("context?session_id=session")).status, 200);
        assert.equal(leases, 0);
        const cleanup = await (await request("cleanup?session_id=session")).json();
        assert.equal(cleanup.cwd, root);
        assert.ok(cleanup.prompt.includes(JSON.stringify(root)));
        assert.ok(cleanup.prompt.includes("本会话操作记录"));
        assert.ok(cleanup.prompt.includes("保留源代码、最终成品"));
        assert.equal((await service.checkpoints.list(root)).items.length, 0);
        const summary = await (await request("summary?session_id=session")).json();
        assert.ok(summary.prompt.includes(JSON.stringify(root)));
        assert.ok(summary.prompt.includes("UTF-8 Markdown"));
        assert.ok(summary.prompt.includes("禁止覆盖原有文件"));
        assert.ok(summary_prompt(null).includes("不要写入其他目录"));
        assert.equal((await request("context", { session_id: "session", excluded: [1] }, { origin: "https://example.org" })).status, 403);
        assert.equal((await request("context", { session_id: "session", excluded: [1] }, { "x-dsh-productivity": "0" })).status, 403);
        running = true;
        assert.equal((await request("context", { session_id: "session", excluded: [1] })).status, 409);
        running = false;
        const update = await request("context", { session_id: "session", excluded: [1, 2] });
        assert.deepEqual((await update.json()).excluded, [1]);
        const agent = { session: { id: "session", header, log: events } };
        let read_dispatched = false;
        await service.before_tool({ agent, name: "read_file" }, async () => { read_dispatched = true; });
        assert.equal(read_dispatched, true);
        assert.equal((await service.checkpoints.list(root)).items.length, 0);
        const decision = { kind: "continue", messages: [old_message, new_message] };
        const result = await service.before_step({ agent, signal: new AbortController().signal }, async () => decision);
        assert.deepEqual(result.messages.filter(message => message.source?.kind !== "dsh-productivity-assistant"), [new_message]);
        assert.equal(result.messages.filter(message => message.source?.kind === "dsh-productivity-assistant").length, 1);
        assert.equal(result.messages.at(-1), new_message);
        const repeated = await service.before_step({ agent, signal: new AbortController().signal }, async () => result);
        assert.equal(repeated.messages.filter(message => message.source?.kind === "dsh-productivity-assistant").length, 1);
        const reloaded = create_productivity(ctx, storage);
        assert.deepEqual(await reloaded.policies.get("session"), [1]);
        await writeFile(join(root, "source.txt"), "before");
        await service.before_tool({ agent, name: "file_write", signal: new AbortController().signal }, async () => writeFile(join(root, "source.txt"), "after"));
        const checkpoints = await (await request("checkpoints?session_id=session")).json();
        assert.equal(checkpoints.items.length, 1);
        const preview = await (await request("checkpoints/preview", { session_id: "session", id: checkpoints.items[0].id })).json();
        assert.match(preview.changes[0].diff, /\+before/);
        const restore = await request("checkpoints/restore", { session_id: "session", id: preview.id, fingerprint: preview.fingerprint });
        assert.equal(restore.status, 200);
        assert.equal(await readFile(join(root, "source.txt"), "utf8"), "before");
        await service.policies.set("session", []);
        assert.deepEqual((await service.before_step({ agent, signal: new AbortController().signal }, async () => decision)).messages.filter(message => message.source?.kind !== "dsh-productivity-assistant"), decision.messages);
        const assistant = await (await request("assistant")).json();
        assert.ok(assistant.documents.memory.path.endsWith("Memory.md"));
        assert.equal((await request("assistant/changes", { kind: "main.set", session_id: "session", revision: assistant.revision }, { origin: "https://example.org" })).status, 403);
        assert.equal((await request("assistant/changes", { kind: "main.set", session_id: "session", revision: assistant.revision })).status, 200);
        assert.equal((await request("assistant/reminders", { day: "2026-10-21" })).status, 200);
    } finally {
        await new Promise(done => server.close(done));
        assert.ok(resolve(temporary).startsWith(`${resolve(tmpdir())}${sep}`));
        await rm(temporary, { recursive: true, force: true });
    }
});
