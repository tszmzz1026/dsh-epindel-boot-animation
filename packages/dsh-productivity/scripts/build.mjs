import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/client.js", root), "utf8");
const assistant = await readFile(new URL("src/assistant-client.js", root), "utf8");
const css = await readFile(new URL("src/style.css", root), "utf8");
await mkdir(new URL("lib/", root), { recursive: true });
await writeFile(new URL("lib/client.js", root), `window.__ModuleLoader__.load({ id: "dsh-productivity", factory: (require) => {\nconst module = { exports: {} }; const exports = module.exports;\n${assistant}\n${source.replace("const STYLE_TEXT = \"\";", `const STYLE_TEXT = ${JSON.stringify(css)};`)}\nreturn module.exports;\n} });\n`);
console.log("Built dsh-productivity.");
