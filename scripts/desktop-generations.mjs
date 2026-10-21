import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [resources, home, action, argument, expected, restore] = process.argv.slice(2);
const require = createRequire(join(resources, "app.asar", "package.json"));
const load = name => import(pathToFileURL(require.resolve(`dsh-desktop-market-installer/generations/${name}`)).href);
const registry = await load("registry");
const projection = await load("projection");
const installer = await load("installer");
const result = await registry.withRegistryLock(home, async () => {
    const desired = await registry.readDesired(home);
    const generations = await registry.listGenerations(home);
    const active = name => generations.find(item => desired.includes(item.id) && item.pluginName === name);
    if (action === "add") {
        const manifest = JSON.parse(readFileSync(join(argument, "package.json"), "utf8"));
        const previous = active(manifest.name);
        const installed = await installer.installGeneration({
            dshHome: home,
            pluginSpec: `file:${argument}`,
            sourceSpec: `link:${argument.replaceAll("\\", "/")}`,
            sourceDirectory: argument,
            expectedPluginName: manifest.name,
            expectedVersion: manifest.version,
            nodeExecutablePath: process.execPath,
            pnpmEntryPath: join(resources, "app.asar", "node_modules", "pnpm", "bin", "pnpm.cjs"),
            environment: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        });
        if (!installed.ok || !installed.generation) throw new Error(installed.detail || "Cannot stage plugin generation.");
        const checks = await installer.verifyGenerationPeers(home, installed.generation);
        if (!checks.ok) throw new Error(`Plugin peer validation failed: ${checks.problems.join("; ")}`);
        const kept = desired.filter(id => !generations.some(item => item.id === id && item.pluginName === manifest.name));
        try {
            await registry.writeDesired(home, [...kept, installed.generation.id]);
            await projection.publishInstalledGeneration(home, manifest.name, "web", { allowRealDirectory: true, syncBundles: true });
        } catch (error) {
            await registry.writeDesired(home, desired);
            await projection.projectGenerations(home);
            throw error;
        }
        return { generation: installed.generation.id, previous_generation: previous?.id || null };
    }
    if (action !== "remove") throw new Error("Unknown generation action.");
    const current = active(argument);
    if (!current || expected !== `generation:${current.id}` && expected !== current.sourceSpec) return { changed: false };
    const kept = desired.filter(id => id !== current.id);
    if (restore) {
        const previous = generations.find(item => item.id === restore && item.pluginName === argument);
        if (!previous) throw new Error("Original plugin generation is unavailable; installation was retained.");
        kept.push(previous.id);
    }
    try {
        await registry.writeDesired(home, kept);
        await projection.projectGenerations(home);
    } catch (error) {
        await registry.writeDesired(home, desired);
        await projection.projectGenerations(home);
        throw error;
    }
    return { changed: true };
});
console.log(`DSH_SUITE_GENERATION_RESULT=${JSON.stringify(result)}`);
