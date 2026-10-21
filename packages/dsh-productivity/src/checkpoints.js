import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomic_write, read_json, serial_queue } from "./storage.js";

const OMIT_DIRECTORIES = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".cache", "dist", "build", "target", ".next"]);
const PRIVATE_FILE = /^(?:\.env(?:\..*)?|id_(?:rsa|ed25519|ecdsa)(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9-]{36}$/;
const sha = value => createHash("sha256").update(value).digest("hex");
const exists = async path => { try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };

export class CheckpointError extends Error {
    constructor(message, status = 409) { super(message); this.status = status; }
}

export class Checkpoints {
    constructor(storage, options = {}) {
        this.storage = resolve(storage);
        this.queue = serial_queue();
        this.busy = options.busy || (async () => false);
        this.max_files = options.max_files ?? 4000;
        this.max_file_bytes = options.max_file_bytes ?? 4 * 1024 * 1024;
        this.max_total_bytes = options.max_total_bytes ?? 96 * 1024 * 1024;
        this.max_checkpoints = options.max_checkpoints ?? 40;
    }

    async root_path(cwd) {
        if (typeof cwd !== "string" || !isAbsolute(cwd)) throw new CheckpointError("此会话没有可用的本地工作区。", 400);
        const root = await realpath(cwd);
        if (!(await lstat(root)).isDirectory()) throw new CheckpointError("工作区目录不可用。", 400);
        return root;
    }

    directory(root) { return join(this.storage, sha(process.platform === "win32" ? root.toLowerCase() : root)); }

    async safe_path(root, name) {
        if (typeof name !== "string" || name.includes("\\") || name.includes(":" ) || name.includes("\0") || name.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part))) throw new CheckpointError("检查点包含无效路径。", 400);
        const target = resolve(root, ...name.split("/"));
        const rel = relative(root, target);
        if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new CheckpointError("路径超出工作区。", 400);
        const root_now = await realpath(root);
        if (root_now !== root) throw new CheckpointError("工作区位置已改变。");
        let ancestor = root;
        const parts = name.split("/");
        for (let index = 0; index < parts.length; index++) {
            ancestor = join(ancestor, parts[index]);
            const info = await exists(ancestor);
            if (info?.isSymbolicLink() || (info && index < parts.length - 1 && !info.isDirectory())) throw new CheckpointError(`路径经过链接或非目录：${name}`);
            if (info && index === parts.length - 1 && !info.isFile()) throw new CheckpointError(`目标不是普通文件：${name}`);
        }
        return target;
    }

    async scan(root) {
        const entries = {};
        const skipped = [];
        const blobs = new Map();
        let total_bytes = 0;
        let file_count = 0;
        const walk = async (directory, prefix = "") => {
            for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
                const name = prefix ? `${prefix}/${item.name}` : item.name;
                const path = join(directory, item.name);
                if (path === this.storage || path.startsWith(`${this.storage}${sep}`) || item.isSymbolicLink() || OMIT_DIRECTORIES.has(item.name) || PRIVATE_FILE.test(item.name)) { skipped.push(name); continue; }
                if (item.isDirectory()) { await walk(path, name); continue; }
                if (!item.isFile()) { skipped.push(name); continue; }
                if (++file_count > this.max_files) throw new CheckpointError(`工作区超过 ${this.max_files} 个文件，请缩小工作区后创建检查点。`, 413);
                const safe = await this.safe_path(root, name);
                const before = await lstat(safe);
                if (before.size > this.max_file_bytes) { skipped.push(name); continue; }
                if (total_bytes + before.size > this.max_total_bytes) throw new CheckpointError("工作区快照超过容量上限，请缩小工作区。", 413);
                const buffer = await readFile(safe);
                const after = await lstat(safe);
                if (after.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || buffer.length !== before.size) throw new CheckpointError(`扫描时文件发生变化，请重试：${name}`);
                const hash = sha(buffer);
                entries[name] = { hash, size: buffer.length };
                blobs.set(hash, buffer);
                total_bytes += buffer.length;
            }
        };
        await walk(root);
        return { entries, skipped, blobs, total_bytes, digest: sha(JSON.stringify(entries)) };
    }

    async list(cwd) {
        const root = await this.root_path(cwd);
        const directory = this.directory(root);
        const index = await read_json(join(directory, "index.json"), []);
        return { root, items: index, limits: { files: this.max_files, file_bytes: this.max_file_bytes, total_bytes: this.max_total_bytes }, omitted: [...OMIT_DIRECTORIES, ".env*", "*.pem / *.key", "链接和超过大小限制的文件"] };
    }

    async save(root, tree, label, session_id, deduplicate = false) {
        const directory = this.directory(root);
        const index = await read_json(join(directory, "index.json"), []);
        if (deduplicate && index[0]?.digest === tree.digest) return { ...index[0], unchanged: true };
        await mkdir(join(directory, "blobs"), { recursive: true });
        for (const [hash, buffer] of tree.blobs) {
            const path = join(directory, "blobs", hash);
            if (!(await exists(path))) await atomic_write(path, buffer);
        }
        const manifest = { id: randomUUID(), created_at: new Date().toISOString(), label: label.slice(0, 100), session_id, digest: tree.digest, files: Object.keys(tree.entries).length, bytes: tree.total_bytes, skipped: tree.skipped, entries: tree.entries };
        await atomic_write(join(directory, `${manifest.id}.json`), JSON.stringify(manifest));
        const { entries, ...metadata } = manifest;
        const next = [metadata, ...index].slice(0, this.max_checkpoints);
        await atomic_write(join(directory, "index.json"), JSON.stringify(next));
        const retained = new Set();
        for (const item of next) {
            if (!ID.test(item.id)) throw new CheckpointError("检查点索引无效。", 400);
            const record = item.id === manifest.id ? manifest : await read_json(join(directory, `${item.id}.json`), null);
            if (!record?.entries) throw new CheckpointError("检查点索引内容不完整。", 400);
            for (const entry of Object.values(record.entries)) {
                if (!HASH.test(entry.hash)) throw new CheckpointError("检查点文件校验值无效。", 400);
                retained.add(entry.hash);
            }
        }
        for (const hash of await readdir(join(directory, "blobs"))) {
            if (HASH.test(hash) && !retained.has(hash)) await unlink(join(directory, "blobs", hash));
        }
        for (const old of index.slice(this.max_checkpoints - 1)) {
            if (ID.test(old.id)) await unlink(join(directory, `${old.id}.json`)).catch(error => { if (error.code !== "ENOENT") throw error; });
        }
        return metadata;
    }

    async manifest(root, id) {
        if (!ID.test(id || "")) throw new CheckpointError("检查点编号无效。", 400);
        const record = await read_json(join(this.directory(root), `${id}.json`), null);
        if (!record || record.id !== id) throw new CheckpointError("检查点不存在或已超过保留数量。", 404);
        for (const [name, entry] of Object.entries(record.entries)) {
            await this.safe_path(root, name);
            if (!HASH.test(entry.hash)) throw new CheckpointError("检查点内容校验失败。", 400);
        }
        return record;
    }

    async capture(cwd, label, session_id, automatic = false) {
        const root = await this.root_path(cwd);
        return this.queue(root, async () => {
            if (!automatic && await this.busy(root)) throw new CheckpointError("工作区有任务正在运行，完成后再创建手动检查点。");
            return this.save(root, await this.scan(root), label, session_id, automatic);
        });
    }

    differences(current, target) {
        return [...new Set([...Object.keys(current.entries), ...Object.keys(target.entries)])].sort().filter(path => !target.skipped.some(skipped => path === skipped || path.startsWith(`${skipped}/`)) && current.entries[path]?.hash !== target.entries[path]?.hash).map(path => ({ path, kind: !target.entries[path] ? "added" : !current.entries[path] ? "deleted" : "modified", before: current.entries[path], after: target.entries[path] }));
    }

    async blob(root, entry) {
        if (!HASH.test(entry.hash)) throw new CheckpointError("文件校验值无效。", 400);
        const buffer = await readFile(join(this.directory(root), "blobs", entry.hash));
        if (sha(buffer) !== entry.hash) throw new CheckpointError("检查点文件内容损坏。");
        return buffer;
    }

    async preview(cwd, id) {
        const root = await this.root_path(cwd);
        return this.queue(root, async () => {
            const current = await this.scan(root);
            const target = await this.manifest(root, id);
            const changes = this.differences(current, target);
            const details = [];
            for (const change of changes.slice(0, 100)) {
                const before = change.before ? current.blobs.get(change.before.hash) : Buffer.alloc(0);
                const after = change.after ? await this.blob(root, change.after) : Buffer.alloc(0);
                const binary = [before, after].some(buffer => buffer.includes(0) || buffer.subarray(0, 60000).toString("utf8").includes("\ufffd"));
                let diff = "二进制文件";
                if (!binary) {
                    const old_lines = before.toString("utf8").split("\n");
                    const new_lines = after.toString("utf8").split("\n");
                    let prefix = 0;
                    while (prefix < old_lines.length && prefix < new_lines.length && old_lines[prefix] === new_lines[prefix]) prefix++;
                    let suffix = 0;
                    while (suffix < old_lines.length - prefix && suffix < new_lines.length - prefix && old_lines.at(-1 - suffix) === new_lines.at(-1 - suffix)) suffix++;
                    const removed = old_lines.slice(prefix, old_lines.length - suffix);
                    const inserted = new_lines.slice(prefix, new_lines.length - suffix);
                    diff = `@@ -${prefix + 1},${removed.length} +${prefix + 1},${inserted.length} @@\n${removed.slice(0, 80).map(line => `-${line}`).join("\n")}\n${inserted.slice(0, 80).map(line => `+${line}`).join("\n")}`;
                    if (removed.length > 80 || inserted.length > 80) diff += "\n… 差异显示已截断，回退使用完整文件。";
                    diff = diff.slice(0, 16000);
                }
                details.push({ path: change.path, kind: change.kind, diff });
            }
            return { id, fingerprint: current.digest, total: changes.length, changes: details, truncated: changes.length > details.length, skipped: [...new Set([...current.skipped, ...target.skipped])], label: target.label };
        });
    }

    async restore(cwd, id, fingerprint, session_id) {
        const root = await this.root_path(cwd);
        return this.queue(root, async () => {
            if (await this.busy(root)) throw new CheckpointError("工作区有任务正在运行，完成后再回退文件。");
            const current = await this.scan(root);
            if (current.digest !== fingerprint) throw new CheckpointError("文件已变化，请重新预览差异。");
            const target = await this.manifest(root, id);
            const changes = this.differences(current, target);
            if (!changes.length) return { restored: 0 };
            const buffers = new Map();
            for (const change of changes) {
                if (current.skipped.some(path => path === change.path || change.path.startsWith(`${path}/`))) throw new CheckpointError(`回退路径当前被排除：${change.path}`);
                await this.safe_path(root, change.path);
                if (change.after) buffers.set(change.path, await this.blob(root, change.after));
            }
            const safety = await this.save(root, current, "回退前备份", session_id);
            const journal_path = join(this.directory(root), "restore-journal.json");
            await atomic_write(journal_path, JSON.stringify({ target: id, safety: safety.id, paths: changes.map(item => item.path), started_at: new Date().toISOString() }));
            const applied = [];
            try {
                for (const change of changes) {
                    if (await this.busy(root)) throw new CheckpointError("回退期间工作区开始运行任务。");
                    const path = await this.safe_path(root, change.path);
                    const info = await exists(path);
                    if ((info ? sha(await readFile(path)) : undefined) !== change.before?.hash) throw new CheckpointError(`文件在回退期间变化：${change.path}`);
                    if (change.after) { await mkdir(dirname(path), { recursive: true }); await this.safe_path(root, change.path); await atomic_write(path, buffers.get(change.path)); }
                    else await unlink(path);
                    applied.push(change);
                }
                await unlink(journal_path);
                return { restored: applied.length, safety_id: safety.id };
            } catch (error) {
                let recovered = 0;
                for (const change of applied.reverse()) {
                    try {
                        const path = await this.safe_path(root, change.path);
                        const info = await exists(path);
                        if ((info ? sha(await readFile(path)) : undefined) !== change.after?.hash) continue;
                        if (change.before) await atomic_write(path, current.blobs.get(change.before.hash));
                        else await unlink(path);
                        recovered++;
                    } catch {}
                }
                if (recovered === applied.length) await unlink(journal_path);
                throw new CheckpointError(`回退未完成，已恢复 ${recovered}/${applied.length} 个改动；安全备份 ${safety.id}。${error.message}`);
            }
        });
    }
}
