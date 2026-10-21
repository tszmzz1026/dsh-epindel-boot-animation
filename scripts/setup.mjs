import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function ensure_runtime() {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || major === 23 || major === 22 && minor < 19) throw new Error("Use Node.js 22.19+ (22.x) or 24+.");
}

export function verify_assets() { return 0; }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    ensure_runtime();
    for (const name of ["dsh-glass-theme", "dsh-productivity"]) {
        if (existsSync(new URL(`../packages/${name}/scripts/build.mjs`, import.meta.url))) await import(`../packages/${name}/scripts/build.mjs`);
    }
    const { verify_suite } = await import("./verify-suite.mjs");
    await verify_suite();
    console.log("Ready: code-only package verified; no external runtime dependencies or media.");
}
