import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { after, before, test } from "node:test";
import { ROUTE, route } from "../src/host.js";

let home;
const previous_home = process.env.DSH_HOME;

before(() => {
    home = mkdtempSync(join(tmpdir(), "dsh-aurum-wallpaper-"));
    process.env.DSH_HOME = home;
});

after(() => {
    if (previous_home === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous_home;
    rmSync(home, { recursive: true, force: true });
});

function request({ method = "GET", url = ROUTE, headers = {}, body = [] } = {}) {
    const chunks = Array.isArray(body) ? body : [body];
    return {
        method,
        url,
        headers: { host: "127.0.0.1:43219", ...headers },
        async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) yield Buffer.from(chunk);
        },
    };
}

function response() {
    const captured = { status: 0, headers: {}, chunks: [] };
    const stream = new Writable({
        write(chunk, _encoding, callback) {
            captured.chunks.push(Buffer.from(chunk));
            callback();
        },
    });
    stream.writeHead = (status, headers) => {
        captured.status = status;
        Object.assign(captured.headers, headers || {});
    };
    stream.result = () => ({ ...captured, body: Buffer.concat(captured.chunks) });
    return stream;
}

async function call(options) {
    const res = response();
    const finished = new Promise(resolve => res.on("finish", resolve));
    await route(request(options), res);
    await Promise.race([finished, new Promise(resolve => setTimeout(resolve, 400))]);
    return res.result();
}

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

test("wallpaper route starts empty", async () => {
    const meta = await call({ url: `${ROUTE}?meta=1` });
    assert.equal(meta.status, 200);
    assert.equal(JSON.parse(meta.body.toString("utf8")).exists, false);
    const media = await call({});
    assert.equal(media.status, 404);
});

test("wallpaper upload, read, range and delete", async () => {
    const uploaded = await call({
        method: "POST",
        headers: { "content-type": "image/png", "x-glass-type": "image/png", "x-glass-name": encodeURIComponent("示例 壁纸.png") },
        body: [png.subarray(0, 8), png.subarray(8)],
    });
    assert.equal(uploaded.status, 200);
    const payload = JSON.parse(uploaded.body.toString("utf8"));
    assert.equal(payload.ok, true);
    assert.equal(payload.type, "image/png");
    assert.equal(payload.name, "示例 壁纸.png");
    assert.ok(readdirSync(join(home, "plugin-data", "dsh-glass-aurum")).some(name => name.endsWith(".bin")));

    const meta = await call({ url: `${ROUTE}?meta=1` });
    assert.equal(JSON.parse(meta.body.toString("utf8")).exists, true);

    const full = await call({});
    assert.equal(full.status, 200);
    assert.equal(full.headers["Content-Type"], "image/png");
    assert.deepEqual(full.body, png);

    const ranged = await call({ headers: { range: "bytes=0-3" } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers["Content-Range"], `bytes 0-3/${png.length}`);
    assert.deepEqual(ranged.body, png.subarray(0, 4));

    const cleared = await call({ method: "DELETE" });
    assert.equal(JSON.parse(cleared.body.toString("utf8")).exists, false);
    const after_delete = await call({ url: `${ROUTE}?meta=1` });
    assert.equal(JSON.parse(after_delete.body.toString("utf8")).exists, false);
});

test("wallpaper rejects unsupported types, oversized bodies and cross-origin writes", async () => {
    const rejected = await call({ method: "POST", headers: { "x-glass-type": "text/html" }, body: [Buffer.from("<html>")] });
    assert.equal(rejected.status, 415);

    const empty = await call({ method: "POST", headers: { "x-glass-type": "image/png" } });
    assert.equal(empty.status, 400);

    const foreign = await call({
        method: "POST",
        headers: { "x-glass-type": "image/png", origin: "https://example.com" },
        body: [png],
    });
    assert.equal(foreign.status, 403);
    const meta = await call({ url: `${ROUTE}?meta=1` });
    assert.equal(JSON.parse(meta.body.toString("utf8")).exists, false);
});

test("failed and concurrent uploads preserve the last complete wallpaper", async () => {
    await call({ method: "POST", headers: { "content-type": "image/png" }, body: png });
    const broken = request({ method: "POST", headers: { "content-type": "video/mp4" } });
    broken[Symbol.asyncIterator] = async function* () {
        yield Buffer.from("partial video");
        throw Object.assign(new Error("upload interrupted"), { code: "ECONNRESET" });
    };
    const rejected = response();
    await route(broken, rejected);
    assert.equal(rejected.result().status, 400);
    assert.deepEqual((await call({})).body, png);
    assert.equal(JSON.parse((await call({ url: `${ROUTE}?meta=1` })).body).type, "image/png");

    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    const pending = request({ method: "POST", headers: { "content-type": "image/png" } });
    pending[Symbol.asyncIterator] = async function* () { started(); await gate; yield png; };
    const upload = route(pending, response());
    await ready;
    try {
        assert.equal((await call({ method: "DELETE" })).status, 409);
        assert.equal((await call({ method: "POST", headers: { "content-type": "image/png" }, body: png })).status, 409);
        assert.deepEqual((await call({})).body, png);
    } finally {
        release();
        await upload;
    }
    assert.equal(readdirSync(join(home, "plugin-data", "dsh-glass-aurum")).some(name => /\.(part|tmp)$/.test(name)), false);
    await call({ method: "DELETE" });
});

test("video ranges handle suffix, open end, empty and unsafe ranges", async () => {
    await call({ method: "POST", headers: { "content-type": "video/mp4" }, body: png });
    assert.deepEqual((await call({ headers: { range: "bytes=-4" } })).body, png.subarray(-4));
    assert.deepEqual((await call({ headers: { range: "bytes=8-" } })).body, png.subarray(8));
    for (const range of ["bytes=-0", "bytes=1-0", "bytes=999-", "bytes=0-9007199254740992", "bytes=0-1,3-4"]) {
        const result = await call({ headers: { range } });
        assert.equal(result.status, 416, range);
        assert.equal(result.headers["Content-Range"], `bytes */${png.length}`);
    }
    const oversized = await call({ method: "POST", headers: { "content-type": "image/png", "content-length": String(512 * 1024 * 1024 + 1) } });
    assert.equal(oversized.status, 413);
    await call({ method: "DELETE" });
});

test("upload writes each chunk to disk before requesting the next chunk", async () => {
    const directory = join(home, "plugin-data", "dsh-glass-aurum");
    const streaming = request({ method: "POST", headers: { "content-type": "image/png" } });
    streaming[Symbol.asyncIterator] = async function* () {
        yield png.subarray(0, 8);
        const staged = readdirSync(directory).find(name => name.endsWith(".part"));
        assert.ok(staged, "upload must stream into a staged file");
        assert.equal(statSync(join(directory, staged)).size, 8);
        yield png.subarray(8);
    };
    const res = response();
    await route(streaming, res);
    assert.equal(res.result().status, 200);
    assert.deepEqual((await call({})).body, png);
    await call({ method: "DELETE" });
});

test("legacy wallpaper files remain readable and migrate after replacement", async () => {
    const directory = join(home, "plugin-data", "dsh-glass-aurum");
    writeFileSync(join(directory, "wallpaper.bin"), png);
    writeFileSync(join(directory, "wallpaper.json"), JSON.stringify({ name: "legacy.png", type: "image/png", updated: 1 }));
    assert.deepEqual((await call({})).body, png);
    const uploaded = await call({ method: "POST", headers: { "content-type": "image/png" }, body: png });
    assert.equal(uploaded.status, 200);
    assert.equal(existsSync(join(directory, "wallpaper.bin")), false);
    assert.deepEqual((await call({})).body, png);
    await call({ method: "DELETE" });
});
