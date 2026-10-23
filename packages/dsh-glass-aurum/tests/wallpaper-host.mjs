import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
    assert.ok(existsSync(join(home, "plugin-data", "dsh-glass-aurum", "wallpaper.bin")));

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
