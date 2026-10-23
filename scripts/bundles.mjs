import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BUNDLES = {
    beauty: { title: "原创主题", packages: ["dsh-glass-aurum"] },
    extensions: { title: "效率扩展", packages: ["dsh-productivity"] },
    full: { title: "完整无素材版", packages: ["dsh-glass-aurum", "dsh-productivity"] },
};

export function select_bundle(root, requested) {
    const path = join(root, "bundle.json");
    const distributed = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).bundle : "full";
    const name = requested || distributed;
    if (!Object.hasOwn(BUNDLES, name) || !Object.hasOwn(BUNDLES, distributed)) throw new Error("Unknown bundle. Choose beauty, extensions or full.");
    if (BUNDLES[name].packages.some(item => !BUNDLES[distributed].packages.includes(item))) throw new Error(`This ${distributed} package does not include ${name}.`);
    return { name, ...BUNDLES[name] };
}
