import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export function serial_queue() {
    const pending = new Map();
    return async (key, operation) => {
        const previous = pending.get(key) || Promise.resolve();
        const current = previous.catch(() => {}).then(operation);
        pending.set(key, current);
        try { return await current; }
        finally { if (pending.get(key) === current) pending.delete(key); }
    };
}

export async function read_json(path, fallback) {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

export async function atomic_write(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
    } finally {
        await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
}
