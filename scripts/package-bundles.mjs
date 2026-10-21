import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { BUNDLES } from "./bundles.mjs";
import { verify_suite } from "./verify-suite.mjs";
const ROOT = new URL("../", import.meta.url);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function zip_archive(files, prefix) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        const name = Buffer.from(`${prefix}/${path}`, "utf8");
        const method = /\.(mp4|png)$/.test(path) ? 0 : 8;
        const compressed = method ? deflateRawSync(bytes) : bytes;
        if (offset + compressed.length > 0xffffffff || bytes.length > 0xffffffff) throw new Error("ZIP32 size limit exceeded.");
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0x5c21, 12);
        local.writeUInt32LE(crc32(bytes), 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(bytes.length, 22);
        local.writeUInt16LE(name.length, 26);
        locals.push(local, name, compressed);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        local.copy(central, 6, 4, 30);
        central.writeUInt16LE(20, 4);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + compressed.length;
    }
    if (files.size > 65535) throw new Error("ZIP32 entry limit exceeded.");
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.size, 8);
    end.writeUInt16LE(files.size, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

await verify_suite();
const lock = JSON.parse(await readFile(new URL("suite-lock.json", ROOT), "utf8"));
const output = resolve(process.argv[2] || fileURLToPath(new URL(`dist/releases/${lock.version}/`, ROOT)));
await mkdir(output, { recursive: true });
const results = [];
for (const [bundle, definition] of Object.entries(BUNDLES)) {
    const files = new Map();
    for (const path of Object.keys(lock.files)) {
        if (path.startsWith("packages/") && !definition.packages.some(name => path.startsWith(`packages/${name}/`))) continue;
        if (path.endsWith("-beauty.cmd") && bundle === "extensions" || path.endsWith("-extensions.cmd") && bundle === "beauty") continue;
        files.set(path, await readFile(new URL(path, ROOT)));
    }
    files.set("README.md", await readFile(new URL("README.md", ROOT)));
    files.set("README.en.md", await readFile(new URL("README.en.md", ROOT)));
    for (const name of ["overview", "memory", "tasks", "daily-plan", "avatar-settings"]) {
        const path = `docs/${name}.png`;
        files.set(path, await readFile(new URL(path, ROOT)));
    }
    files.set("bundle.json", Buffer.from(JSON.stringify({ bundle, version: lock.version, packages: definition.packages }, null, 4) + "\n"));
    const packages = Object.fromEntries(definition.packages.map(name => [name, lock.packages[name]]));
    const checksums = Object.fromEntries([...files].map(([path, bytes]) => [path, sha256(bytes)]));
    files.set("suite-lock.json", Buffer.from(JSON.stringify({ version: lock.version, bundle, compatibility: lock.compatibility, packages, files: checksums }, null, 4) + "\n"));
    const name = `dsh-${bundle}-v${lock.version}.zip`;
    const bytes = zip_archive(files, name.slice(0, -4));
    await writeFile(resolve(output, name), bytes, { flag: "wx" });
    results.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
}
await writeFile(resolve(output, "SHA256SUMS.txt"), results.map(row => `${row.sha256}  ${row.name}`).join("\n") + "\n", { flag: "wx" });
console.log(JSON.stringify(results, null, 4));
