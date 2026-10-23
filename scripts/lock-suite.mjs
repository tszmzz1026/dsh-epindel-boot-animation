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
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const packages = {};
for (const name of ["dsh-glass-aurum", "dsh-productivity"]) {
    const plugin = JSON.parse(await readFile(new URL(`packages/${name}/package.json`, root), "utf8"));
    packages[name] = plugin.version;
}
await writeFile(new URL("suite-lock.json", root), `${JSON.stringify({ version: manifest.version, compatibility: { kernel: "0.2.0-rc.2", desktop: "0.12.0" }, packages, files }, null, 4)}\n`);
console.log(`Locked ${Object.keys(files).length} code-only files.`);
