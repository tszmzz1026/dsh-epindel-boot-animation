import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensure_runtime, verify_assets } from "./setup.mjs";
import { verify_suite } from "./verify-suite.mjs";
import { select_bundle } from "./bundles.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BEGIN = "# BEGIN DSH GLASS SUITE";
const END = "# END DSH GLASS SUITE";
const EMPTY_ARRAY = "# DSH GLASS SUITE EMPTY ARRAY PLACEHOLDER";
const PATCH = `${BEGIN}\n- id: ui-theme\n  config:\n    preference: dark\n${END}\n`;

function json(path) { return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")); }

function atomic_write(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, value, { mode: 0o600 });
    renameSync(temporary, path);
}

export function strip_patch(raw, remove_separator = false) {
    const starts = raw.split(BEGIN).length - 1;
    const ends = raw.split(END).length - 1;
    if (starts !== ends || starts > 1) throw new Error("Suite patch markers are incomplete. Restore the patch from its backup first.");
    if (!starts) return raw;
    const pattern = /^# BEGIN DSH GLASS SUITE\r?\n[\s\S]*?^# END DSH GLASS SUITE(?:\r?\n)?/m;
    if (!pattern.test(raw)) throw new Error("Suite patch markers have an invalid layout.");
    const match = pattern.exec(raw);
    let cleaned = raw.replace(pattern, "");
    if (remove_separator && match.index + match[0].length === raw.length && cleaned.endsWith("\n")) cleaned = cleaned.slice(0, -1);
    return cleaned;
}

function finish_patch_removal(raw, state) {
    let cleaned = strip_patch(raw, state.added_separator);
    if (state.empty_array_line && cleaned.includes(EMPTY_ARRAY)) {
        const substantive = cleaned.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#"));
        cleaned = cleaned.replace(/^# DSH GLASS SUITE EMPTY ARRAY PLACEHOLDER(\r?\n|$)/m, (_, ending) => substantive.length ? "" : `${state.empty_array_line}${ending}`);
    }
    return cleaned;
}

export function parse_options(args) {
    const options = {};
    for (let index = 0; index < args.length; index++) {
        const key = args[index];
        if (key === "--uninstall" || key === "--check") options[key.slice(2)] = true;
        else if (["--bundle", "--home", "--profile", "--desktop-exe", "--dsh-command"].includes(key) && args[index + 1] && !args[index + 1].startsWith("--")) options[key.slice(2).replaceAll("-", "_")] = args[++index];
        else throw new Error(`Unknown or incomplete option: ${key}`);
    }
    return options;
}

export function detect_environment(options = {}) {
    const desktop_exe = options.desktop_exe || process.env.DSH_DESKTOP_EXE || (process.platform === "win32" && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "DSH Desktop", "DSH Desktop.exe") : "");
    const desktop_available = desktop_exe && existsSync(desktop_exe);
    const desktop_home = process.env.APPDATA ? join(process.env.APPDATA, "dsh-desktop", "harness") : "";
    const home = resolve(options.home || process.env.DSH_HOME || (desktop_available && desktop_home && existsSync(join(desktop_home, "profiles")) ? desktop_home : join(homedir(), ".dsh")));
    const requested_profile = options.profile || process.env.DSH_PROFILE;
    const profile = requested_profile || ["web", "desktop"].find(name => existsSync(join(home, "profiles", name, "package.json")));
    if (!profile || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profile)) throw new Error("No DSH profile found. Launch DSH once, or pass --home PATH --profile NAME.");
    const profile_path = join(home, "profiles", profile);
    if (!existsSync(join(profile_path, "package.json"))) throw new Error(`DSH profile does not exist: ${profile_path}`);
    let command;
    let prefix;
    const environment = { ...process.env, DSH_HOME: home };
    if (options.dsh_command) {
        command = options.dsh_command;
        prefix = [];
    } else if (desktop_available) {
        const resources = join(dirname(desktop_exe), "resources");
        const helper = join(resources, "harness-node-entry.mjs");
        if (!existsSync(helper) || !existsSync(join(resources, "app.asar"))) throw new Error("Desktop resources were not found. Pass --desktop-exe with the correct DSH Desktop.exe.");
        command = desktop_exe;
        prefix = [helper, join(resources, "app.asar", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")];
        environment.ELECTRON_RUN_AS_NODE = "1";
        environment.DSH_DESKTOP_PNPM_ENTRY = join(resources, "app.asar", "node_modules", "pnpm", "bin", "pnpm.cjs");
        const runner = join(home, ".desktop-bin", "pnpm-runner.mjs");
        if (existsSync(runner)) environment.DSH_DESKTOP_PNPM_RUNNER = runner;
        else delete environment.DSH_DESKTOP_PNPM_RUNNER;
    } else {
        command = "dsh";
        prefix = [];
    }
    return { home, profile, profile_path, command, prefix, environment };
}

function execute_cli(runtime, action, spec) {
    const result = spawnSync(runtime.command, [...runtime.prefix, "plugin", "--profile", runtime.profile, action, spec], { env: runtime.environment, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw new Error(`Cannot start DSH CLI: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`DSH plugin ${action} failed for ${spec}. ${result.stderr || "See the configuration backup and retry."}`);
}

function execute_generation(runtime, action, argument, expected = "", restore = "") {
    const resources = dirname(runtime.prefix[0]);
    const result = spawnSync(runtime.command, [join(ROOT, "scripts", "desktop-generations.mjs"), resources, runtime.home, action, argument, expected, restore], { env: runtime.environment, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Desktop generation operation failed: ${result.stderr || result.error?.message || "Unknown error"}`);
    const value = /^DSH_SUITE_GENERATION_RESULT=(.*)$/m.exec(result.stdout)?.[1];
    if (!value) throw new Error("Desktop generation operation did not return its installation record.");
    return JSON.parse(value);
}

function package_sources(root) {
    return Object.fromEntries(["dsh-glass-theme", "dsh-productivity"].map(name => [name, join(root, "packages", name)]));
}

function stage_runtime(source, destination, packages) {
    for (const name of packages) {
        const target = join(destination, "packages", name);
        mkdirSync(target, { recursive: true });
        for (const item of ["src", "lib", "package.json", "cordis.patch.yml", "README.md", "LICENSE"]) {
            const path = join(source, "packages", name, item);
            if (existsSync(path)) cpSync(path, join(target, item), { recursive: true, dereference: false });
        }
    }
}

export async function install_suite(options = {}, dependencies = {}) {
    const source = dependencies.source || ROOT;
    const bundle = select_bundle(source, options.bundle);
    const packages = bundle.packages;
    const manages_beauty = packages.includes("dsh-glass-theme");
    const runtime = dependencies.runtime || detect_environment(options);
    const execute = dependencies.execute || execute_cli;
    const manifest_path = join(runtime.profile_path, "package.json");
    const patch_path = join(runtime.profile_path, "cordis.patch.yml");
    const extension_root = join(runtime.home, "extensions", "glass-suite");
    const state_path = join(extension_root, `install-state-${runtime.profile}.json`);
    const state = existsSync(state_path) ? json(state_path) : null;
    const raw_patch = existsSync(patch_path) ? readFileSync(patch_path, "utf8") : "";
    strip_patch(raw_patch);
    if (options.uninstall) {
        if (!state) return { changed: false, message: "No suite installation record exists; nothing was changed." };
        const remaining = { ...state.installed };
        for (const name of [...packages].reverse()) {
            if (!Object.hasOwn(remaining, name)) continue;
            const current = json(manifest_path);
            delete remaining[name];
            if (!dependencies.execute && runtime.profile === "web" && current.dsh?.desktop?.generationProjection?.plugins?.[name]) {
                execute_generation(runtime, "remove", name, state.installed[name], state.previous[name]?.generation || "");
                continue;
            }
            if (current.dependencies?.[name] !== state.installed[name]) continue;
            const previous = state.previous[name];
            if (previous.spec) await execute(runtime, "add", /^(?:link:|file:|https?:|git|github:|\/|[A-Za-z]:|\.{1,2}\/)/.test(previous.spec) ? previous.spec : `${name}@${previous.spec}`);
            else await execute(runtime, "remove", name);
            const updated = json(manifest_path);
            if (updated.dsh?.profile?.bundles && !previous.bundle) updated.dsh.profile.bundles = updated.dsh.profile.bundles.filter(item => item !== name);
            atomic_write(manifest_path, `${JSON.stringify(updated, null, 2)}\n`);
        }
        if (manages_beauty && state.installed["dsh-glass-theme"]) {
            const latest_patch = existsSync(patch_path) ? readFileSync(patch_path, "utf8") : "";
            atomic_write(patch_path, finish_patch_removal(latest_patch, state));
        }
        const next = { ...state, installed: remaining, uninstalled: Object.keys(remaining).length === 0 };
        for (const name of packages) delete next.previous[name];
        if (manages_beauty) { delete next.empty_array_line; next.added_separator = false; }
        atomic_write(state_path, JSON.stringify(next, null, 4));
        return { changed: true, bundle: bundle.name, message: "Selected bundle uninstalled; other bundles, session data, checkpoints and backups were kept." };
    }
    if (!dependencies.skip_verify) {
        ensure_runtime();
        verify_assets();
        await verify_suite();
    }
    const manifest = json(manifest_path);
    if (options.check) return { changed: false, home: runtime.home, profile: runtime.profile, bundle: bundle.name, packages, message: "Runtime, assets and profile checks passed. No profile files were changed." };
    const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const backup = join(extension_root, "backups", `${runtime.profile}-${stamp}`);
    mkdirSync(backup, { recursive: true });
    for (const name of ["package.json", "cordis.patch.yml", "pnpm-lock.yaml"]) {
        const path = join(runtime.profile_path, name);
        if (existsSync(path)) cpSync(path, join(backup, name));
    }
    const next = state && !state.uninstalled ? state : {
        previous: {},
        installed: {},
    };
    for (const name of packages) if (!Object.hasOwn(next.installed, name)) next.previous[name] = { spec: manifest.dependencies?.[name] || null, bundle: manifest.dsh?.profile?.bundles?.includes(name) || false, generation: manifest.dsh?.desktop?.generationProjection?.plugins?.[name]?.generationId || null };
    if (manages_beauty && !next.installed["dsh-glass-theme"]) next.added_separator = Boolean(raw_patch && !raw_patch.endsWith("\n"));
    const stage = join(extension_root, "versions", `${bundle.name}-${stamp}`);
    stage_runtime(source, stage, packages);
    next.backup = backup;
    next.stage = stage;
    next.uninstalled = false;
    atomic_write(state_path, JSON.stringify(next, null, 4));
    for (const name of packages) {
        const path = package_sources(stage)[name];
        const spec = `link:${path.replaceAll("\\", "/")}`;
        if (!dependencies.execute && runtime.profile === "web" && manifest.dsh?.desktop?.generationProjection?.version === 1) {
            const installed = execute_generation(runtime, "add", path);
            next.installed[name] = `generation:${installed.generation}`;
            atomic_write(state_path, JSON.stringify(next, null, 4));
            continue;
        }
        await execute(runtime, "add", spec);
        const updated = json(manifest_path);
        if (updated.dependencies?.[name] !== spec || !updated.dsh?.profile?.bundles?.includes(name)) throw new Error(`DSH did not register ${name}. Backup: ${backup}`);
        next.installed[name] = spec;
        atomic_write(state_path, JSON.stringify(next, null, 4));
    }
    if (manages_beauty) {
        const latest = existsSync(patch_path) ? readFileSync(patch_path, "utf8") : "";
        let cleaned = strip_patch(latest, next.added_separator);
        const empty_array = /^([ \t]*\[[ \t]*\][ \t]*(?:#[^\r\n]*)?)(\r?\n|$)/m.exec(cleaned);
        if (empty_array) {
            next.empty_array_line = empty_array[1];
            cleaned = cleaned.replace(empty_array[0], `${EMPTY_ARRAY}${empty_array[2]}`);
        }
        atomic_write(patch_path, `${cleaned}${cleaned && !cleaned.endsWith("\n") ? "\n" : ""}${PATCH}`);
    }
    atomic_write(state_path, JSON.stringify(next, null, 4));
    return { changed: true, home: runtime.home, profile: runtime.profile, bundle: bundle.name, packages, backup, stage, message: "Selected bundle installed. After current tasks finish, fully quit DSH from the tray and launch it again. Do not only minimize it." };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    try { console.log(JSON.stringify(await install_suite(parse_options(process.argv.slice(2))), null, 4)); }
    catch (error) { console.error(`Installation stopped: ${error.message}`); process.exitCode = 1; }
}
