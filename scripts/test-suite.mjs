import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verify_suite } from "./verify-suite.mjs";

await verify_suite();
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.execPath, ["--test", "tests/install-suite.mjs", "packages/dsh-productivity/tests/checkpoints.mjs", "packages/dsh-productivity/tests/context.mjs", "packages/dsh-productivity/tests/host.mjs", "packages/dsh-productivity/tests/assistant.mjs"], { cwd: root, stdio: "inherit", windowsHide: true });
if (result.status !== 0) throw new Error("Suite tests failed.");
console.log("PASS: code-only suite, persistence, context and checkpoints.");
