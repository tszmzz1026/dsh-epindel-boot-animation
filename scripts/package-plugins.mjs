import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { verify_suite } from "./verify-suite.mjs";
import { copy_tree } from "./install-suite.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
await verify_suite();
const lock = JSON.parse(readFileSync(join(ROOT, "suite-lock.json"), "utf8"));
const output = resolve(process.argv[2] || join(ROOT, "dist", "plugin-packages", lock.version));
mkdirSync(output, { recursive: true });
const results = [];
for (const name of ["dsh-glass-aurum", "dsh-productivity"]) {
    const source = join(ROOT, "packages", name);
    const stage = join(ROOT, ".work", `plugin-pack-${name}-${Date.now()}`);
    const target = join(stage, "package");
    mkdirSync(target, { recursive: true });
    for (const path of ["src", "lib", "package.json", "cordis.patch.yml", "README.md", "LICENSE"]) {
        if (existsSync(join(source, path))) copy_tree(join(source, path), join(target, path));
    }
    const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    const filename = `${name}-${manifest.version}.tgz`;
    if (existsSync(join(output, filename))) throw new Error(`Refusing to overwrite ${filename}.`);
    const packed = spawnSync("tar", ["-czf", join(output, filename), "-C", stage, "package"], { encoding: "utf8", windowsHide: true });
    if (packed.status !== 0) throw new Error(`Cannot package ${name}: ${packed.error?.message || packed.stderr}`);
    const bytes = readFileSync(join(output, filename));
    results.push({ name, filename, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
}
writeFileSync(join(output, "SHA256SUMS-plugins.txt"), `${results.map(row => `${row.sha256}  ${row.filename}`).join("\n")}\n`, { flag: "wx" });
console.log(JSON.stringify(results, null, 4));
