import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const media_path = () => join(data_root(), "wallpaper.bin");
const meta_path = () => join(data_root(), "wallpaper.json");

function read_meta() {
    try {
        const value = JSON.parse(readFileSync(meta_path(), "utf8"));
        if (!value || typeof value !== "object" || !TYPES.has(value.type)) return null;
        return {
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
    writeFileSync(temporary, JSON.stringify(meta, null, 2));
    renameSync(temporary, meta_path());
}

function clear_wallpaper() {
    for (const path of [media_path(), meta_path()]) {
        try { rmSync(path, { force: true }); } catch { /* already gone */ }
    }
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
    const exists = Boolean(meta) && existsSync(media_path());
    if (!exists) return { exists: false };
    return { exists: true, name: meta.name, type: meta.type, size: statSync(media_path()).size, updated: meta.updated };
}

function stream_media(req, res, meta) {
    const size = statSync(media_path()).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
    const headers = {
        "Content-Type": meta.type,
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
    };
    if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
            res.writeHead(416, { "Content-Range": `bytes */${size}` });
            res.end();
            return;
        }
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        createReadStream(media_path(), { start, end }).pipe(res);
        return;
    }
    res.writeHead(200, { ...headers, "Content-Length": size });
    createReadStream(media_path()).pipe(res);
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
    const chunks = [];
    let bytes = 0;
    try {
        for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) throw Object.assign(new Error("too-large"), { code: "too-large" });
            chunks.push(chunk);
        }
        if (!bytes) throw Object.assign(new Error("empty"), { code: "empty" });
        writeFileSync(temporary, Buffer.concat(chunks));
        renameSync(temporary, media_path());
    } catch (error) {
        try { rmSync(temporary, { force: true }); } catch { /* nothing staged */ }
        send_json(res, error.code === "too-large" ? 413 : 400, { ok: false, error: error.code || "write-failed" });
        return;
    }
    const meta = { name, type, updated: Date.now() };
    write_meta(meta);
    send_json(res, 200, { ok: true, ...descriptor(meta) });
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
        if (!meta || !existsSync(media_path())) {
            send_json(res, 404, { exists: false });
            return;
        }
        stream_media(req, res, meta);
        return;
    }
    if (req.method === "POST") {
        return receive_media(req, res);
    }
    if (req.method === "DELETE") {
        clear_wallpaper();
        send_json(res, 200, { ok: true, exists: false });
        return;
    }
    send_json(res, 405, { ok: false, error: "method-not-allowed" });
}

export function apply(ctx) {
    if (!ctx?.webServer) return;
    ctx.effect(() => ctx.webServer.register({ kind: "exact", path: ROUTE, handler: route }));
}
