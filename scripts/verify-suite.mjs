import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function verify_suite(root = new URL("../", import.meta.url)) {
    const lock = JSON.parse(await readFile(new URL("suite-lock.json", root), "utf8"));
    for (const [path, expected] of Object.entries(lock.files)) {
        if (path.startsWith("/") || path.split("/").includes("..") || path.includes("\\")) throw new Error("Invalid suite manifest path.");
        const bytes = await readFile(new URL(path, root));
        if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`Suite checksum mismatch: ${path}`);
    }
    return { version: lock.version, files: Object.keys(lock.files).length, packages: lock.packages };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    console.log(JSON.stringify(await verify_suite(), null, 4));
}
