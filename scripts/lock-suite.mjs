import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const files = {};
async function visit(path) {
    for (const entry of (await readdir(new URL(path, root), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (["tests", "scripts", "node_modules", "screenshots.json"].includes(entry.name) || entry.isSymbolicLink()) continue;
        const name = `${path}${entry.name}`;
        if (entry.isDirectory()) await visit(`${name}/`);
        else files[name] = createHash("sha256").update(await readFile(new URL(name, root))).digest("hex");
    }
}
await visit("packages/");
for (const name of ["scripts/install-suite.mjs", "scripts/desktop-generations.mjs", "scripts/setup.mjs", "scripts/bundles.mjs", "scripts/verify-suite.mjs", "scripts/manage-suite.ps1", "package.json", "LICENSE", "install-desktop.cmd", "uninstall-desktop.cmd", "install-beauty.cmd", "install-extensions.cmd", "uninstall-beauty.cmd", "uninstall-extensions.cmd"]) files[name] = createHash("sha256").update(await readFile(new URL(name, root))).digest("hex");
await writeFile(new URL("suite-lock.json", root), `${JSON.stringify({ version: "2.1.0", compatibility: { kernel: "0.2.0-rc.2", desktop: "0.12.0" }, packages: { "dsh-glass-aurum": "1.1.0", "dsh-productivity": "1.3.1" }, files }, null, 4)}\n`);
console.log(`Locked ${Object.keys(files).length} code-only files.`);
