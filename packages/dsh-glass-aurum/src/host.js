import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const name = "dsh-glass-aurum";
export const inject = ["webServer"];

// The wallpaper binary lives on disk (not in browser storage) so it survives
// cache eviction and can be streamed with Range requests for video seeking.
export const ROUTE = "/plugins/dsh-glass-aurum/wallpaper";
const MAX_BYTES = 512 * 1024 * 1024;
const TYPES = new Set([
    "image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/bmp",
    "video/mp4", "video/webm", "video/quicktime", "video/ogg",
]);

function data_root() {
    return join(process.env.DSH_HOME || join(homedir(), ".dsh"), "plugin-data", "dsh-glass-aurum");
}

const mutations = new Set();
const media_path = meta => join(data_root(), meta?.file || "wallpaper.bin");
const meta_path = () => join(data_root(), "wallpaper.json");

function read_meta() {
    try {
        const value = JSON.parse(readFileSync(meta_path(), "utf8"));
        if (!value || typeof value !== "object" || !TYPES.has(value.type)) return null;
        return {
            file: typeof value.file === "string" && /^wallpaper-[a-f0-9-]{36}\.bin$/.test(value.file) ? value.file : null,
            name: typeof value.name === "string" ? value.name.slice(0, 160) : "",
            type: value.type,
            updated: Number.isFinite(value.updated) ? value.updated : 0,
        };
    } catch {
        return null;
    }
}

function write_meta(meta) {
    mkdirSync(data_root(), { recursive: true });
    const temporary = `${meta_path()}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, JSON.stringify(meta, null, 2), { mode: 0o600 });
        renameSync(temporary, meta_path());
    }
    finally { rmSync(temporary, { force: true }); }
}

function remove_media(path) {
    try { rmSync(path, { force: true }); } catch { /* an active reader may still own the file */ }
}

function clear_wallpaper() {
    const meta = read_meta();
    rmSync(meta_path(), { force: true });
    remove_media(media_path(meta));
}

function send_json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
}

function same_origin(req) {
    const origin = req.headers.origin;
    if (!origin || origin === "null") return true;
    try {
        const source = new URL(origin);
        return source.protocol === "dsh-desktop:" || source.host === req.headers.host;
    } catch {
        return false;
    }
}

function descriptor(meta) {
    const exists = Boolean(meta) && existsSync(media_path(meta));
    if (!exists) return { exists: false };
    return { exists: true, name: meta.name, type: meta.type, size: statSync(media_path(meta)).size, updated: meta.updated };
}

function stream_media(req, res, meta) {
    const size = statSync(media_path(meta)).size;
    const raw_range = String(req.headers.range || "").trim();
    const range = /^bytes=(\d*)-(\d*)$/.exec(raw_range);
    const headers = {
        "Content-Type": meta.type,
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
    };
    let start = 0;
    let end = size - 1;
    if (raw_range) {
        const first = range?.[1] ? Number(range[1]) : null;
        const last = range?.[2] ? Number(range[2]) : null;
        const safe = number => number === null || Number.isSafeInteger(number);
        if (range && (range[1] || range[2]) && safe(first) && safe(last)) {
            start = first === null ? Math.max(0, size - last) : first;
            end = first !== null && last !== null ? Math.min(last, size - 1) : size - 1;
        } else start = size;
        if (start > end || start >= size) {
            res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
            res.end();
            return;
        }
    }
    const fd = openSync(media_path(meta), "r");
    const stream = createReadStream(media_path(meta), { fd, start, end });
    stream.on("error", () => res.destroy());
    res.once("close", () => stream.destroy());
    res.writeHead(raw_range ? 206 : 200, {
        ...headers,
        ...(raw_range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
        "Content-Length": end - start + 1,
    });
    stream.pipe(res);
}

async function receive_media(req, res) {
    const type = String(req.headers["x-glass-type"] || req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!TYPES.has(type)) {
        send_json(res, 415, { ok: false, error: "unsupported-type" });
        return;
    }
    const declared = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
        send_json(res, 413, { ok: false, error: "too-large" });
        return;
    }
    let name = "";
    try { name = decodeURIComponent(String(req.headers["x-glass-name"] || "")).slice(0, 160); } catch { name = ""; }
    mkdirSync(data_root(), { recursive: true });
    const temporary = `${media_path()}.${randomUUID()}.part`;
    const previous = read_meta();
    const meta = { file: `wallpaper-${randomUUID()}.bin`, name, type, updated: Date.now() };
    const destination = media_path(meta);
    let bytes = 0;
    let handle;
    let committed = false;
    try {
        handle = await open(temporary, "wx", 0o600);
        for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) throw Object.assign(new Error("too-large"), { code: "too-large" });
            await handle.writeFile(chunk);
        }
        if (!bytes) throw Object.assign(new Error("empty"), { code: "empty" });
        await handle.sync();
        await handle.close();
        handle = null;
        renameSync(temporary, destination);
        write_meta(meta);
        committed = true;
        remove_media(media_path(previous));
        send_json(res, 200, { ok: true, ...descriptor(meta) });
    } catch (error) {
        const code = ["too-large", "empty", "ECONNRESET", "ABORT_ERR"].includes(error.code) ? error.code : "write-failed";
        send_json(res, code === "too-large" ? 413 : code === "write-failed" ? 500 : 400, { ok: false, error: code });
    } finally {
        if (handle) await handle.close();
        remove_media(temporary);
        if (!committed) remove_media(destination);
    }
}

async function mutate(req, res) {
    const root = data_root();
    if (mutations.has(root)) {
        send_json(res, 409, { ok: false, error: "busy" });
        return;
    }
    mutations.add(root);
    try {
        if (req.method === "POST") await receive_media(req, res);
        else {
            clear_wallpaper();
            send_json(res, 200, { ok: true, exists: false });
        }
    } catch {
        if (!res.headersSent) send_json(res, 500, { ok: false, error: "write-failed" });
    } finally {
        mutations.delete(root);
    }
}

export function route(req, res) {
    if (!same_origin(req)) {
        send_json(res, 403, { ok: false, error: "cross-origin request rejected" });
        return;
    }
    const url = new URL(String(req.url || ROUTE), "http://localhost");
    const meta = read_meta();
    if (req.method === "GET" || req.method === "HEAD") {
        if (url.searchParams.get("meta") === "1" || req.method === "HEAD") {
            send_json(res, 200, descriptor(meta));
            return;
        }
        if (!meta || !existsSync(media_path(meta))) {
            send_json(res, 404, { exists: false });
            return;
        }
        stream_media(req, res, meta);
        return;
    }
    if (req.method === "POST" || req.method === "DELETE") return mutate(req, res);
    send_json(res, 405, { ok: false, error: "method-not-allowed" });
}

export function apply(ctx) {
    if (!ctx?.webServer) return;
    ctx.effect(() => ctx.webServer.register({ kind: "exact", path: ROUTE, handler: route }));
}
