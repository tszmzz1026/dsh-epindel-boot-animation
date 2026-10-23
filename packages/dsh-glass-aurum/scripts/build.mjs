import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/client.js", root), "utf8");
const enhancements = await readFile(new URL("src/enhancements.js", root), "utf8");
const avatar = await readFile(new URL("src/avatar.js", root), "utf8");
const wallpaper = await readFile(new URL("src/wallpaper.js", root), "utf8");
const css = await readFile(new URL("src/theme.css", root), "utf8");
await mkdir(new URL("lib/", root), { recursive: true });
await writeFile(new URL("lib/client.js", root),
    `window.__ModuleLoader__.load({ id: "dsh-glass-aurum", factory: (require) => {\n`
    + `const module = { exports: {} }; const exports = module.exports;\n`
    + enhancements + "\n" + avatar + "\n" + wallpaper + "\n"
    + source.replace("const STYLE_TEXT = \"\";", `const STYLE_TEXT = ${JSON.stringify(css)};`)
    + "\nreturn module.exports;\n} });\n");
console.log("Built dsh-glass-aurum client.");
