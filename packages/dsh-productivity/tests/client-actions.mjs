import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cleanup_prompt } from "../src/cleanup.js";
import { summary_prompt } from "../src/summary.js";

const require = createRequire(process.env.DSH_TEST_NODE_MODULES ? `${process.env.DSH_TEST_NODE_MODULES}/package.json` : import.meta.url);
const { chromium } = require("playwright");
const source = `${await readFile(new URL("../src/assistant-client.js", import.meta.url), "utf8")}\n${await readFile(new URL("../src/client.js", import.meta.url), "utf8")}`;
const server = createServer((req, res) => {
    if (req.url?.startsWith("/plugins/dsh-productivity/context")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ turns: [], excluded: [], running: false }));
    } else if (req.url?.startsWith("/plugins/dsh-productivity/cleanup")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ cwd: "C:\\fixture\\workspace", prompt: cleanup_prompt("C:\\fixture\\workspace"), running: false }));
    } else if (req.url?.startsWith("/plugins/dsh-productivity/summary")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ prompt: summary_prompt("C:\\fixture\\workspace") }));
    } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><html><head></head><body><aside></aside><textarea id=draft>existing draft</textarea></body></html>");
    }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => {
        window.test_calls = [];
        window.test_retains = 0;
        window.test_releases = 0;
        window.test_selection = "session-a";
        const catalog = { getSnapshot: () => ({ byId: { "session-a": { title: "A" }, "session-b": { title: "B" } } }) };
        const sessions = {
            list: catalog,
            async using(id, options, operation) {
                window.test_retains++;
                try {
                    if (window.test_delay) await new Promise(resolve => { window.test_ready = resolve; });
                    return await operation({ binding: { session: {
                        command: async line => { window.test_calls.push({ id, line }); return window.test_failure ? { ok: false, error: { message: "compact-test-error" } } : { ok: true, value: { matched: true } }; },
                        prompt: async (content, mode) => { window.test_calls.push({ id, content, mode }); return { ok: true, value: { accepted: true } }; },
                    } } });
                } finally { window.test_releases++; }
            },
        };
        const react = { createElement(tag, attrs = {}, ...children) {
            const element = document.createElement(tag);
            for (const [key, value] of Object.entries(attrs)) {
                if (key === "onClick") element.onclick = value;
                else element.setAttribute(key === "className" ? "class" : key, value);
            }
            element.append(...children.filter(value => value !== null));
            return element;
        } };
        const services = {
            sessions,
            uiWorkspace: { selection: { getSnapshot: () => ({ sessionId: window.test_selection }), subscribe: () => () => {} } },
            slots: { inject: (_, callback) => callback(), register: (_, component) => { const element = component({ wide: true }); document.querySelector("aside").append(element); return () => element.remove(); } },
        };
        window.require = () => react;
        window.exports = {};
        window.test_owner = { get: key => services[key], effect: effect => effect() };
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.exports.apply({ inject: (_, callback) => callback(window.test_owner) }));
    await page.getByRole("button", { name: "打开效率中心", exact: true }).click();
    await page.getByRole("button", { name: "上下文", exact: true }).click();
    await page.getByRole("button", { name: "压缩上下文…", exact: true }).click();
    await page.getByRole("button", { name: "执行压缩", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".dp-status")?.textContent !== "正在处理…");
    assert.deepEqual(await page.evaluate(() => window.test_calls), [{ id: "session-a", line: "/compact" }], await page.locator(".dp-status").textContent());
    assert.equal(await page.evaluate(() => window.test_retains), 1);
    assert.equal(await page.evaluate(() => window.test_releases), 1);
    console.log("PASS: compact button uses retained session binding and releases it.");
    await page.getByRole("button", { name: "压缩上下文…", exact: true }).click();
    await page.evaluate(() => { window.test_failure = true; });
    await page.getByRole("button", { name: "执行压缩", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".dp-status")?.textContent === "compact-test-error");
    assert.equal(await page.evaluate(() => window.test_retains), await page.evaluate(() => window.test_releases));
    await page.evaluate(() => { window.test_failure = false; window.test_delay = true; });
    await page.getByRole("button", { name: "执行压缩", exact: true }).click();
    await page.waitForFunction(() => typeof window.test_ready === "function");
    await page.evaluate(() => { window.test_selection = "session-b"; window.test_ready(); });
    await page.waitForFunction(() => document.querySelector(".dp-status")?.textContent.includes("本次操作未发送"));
    assert.equal(await page.evaluate(() => window.test_calls.length), 2, "Selection change must prevent dispatch to another session.");
    assert.equal(await page.evaluate(() => window.test_retains), await page.evaluate(() => window.test_releases));
    await page.evaluate(() => { window.test_selection = "session-a"; window.test_delay = false; });
    await page.getByRole("button", { name: "生成 MD 总结", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".dp-dialog").open);
    const summary_calls = await page.evaluate(() => window.test_calls);
    assert.equal(summary_calls.length, 3);
    assert.equal(summary_calls[2].id, "session-a");
    assert.equal(summary_calls[2].mode, "queue");
    assert.ok(summary_calls[2].content[0].text.includes("UTF-8 Markdown"));
    assert.ok(summary_calls[2].content[0].text.includes("禁止覆盖原有文件"));
    await page.getByRole("button", { name: "打开效率中心", exact: true }).click();
    await page.getByRole("button", { name: "清理文件", exact: true }).click();
    const prompt = page.getByRole("textbox", { name: "清理指令", exact: true });
    await prompt.waitFor();
    assert.ok((await prompt.inputValue()).includes("fixture"));
    assert.equal(await page.evaluate(() => window.test_calls.length), 3, "Opening cleanup must never send a prompt.");
    await prompt.fill("");
    await page.getByRole("button", { name: "发送清理指令给 DeepSeek", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".dp-status")?.textContent === "清理指令不能为空。");
    await prompt.fill("只清理本会话已经不用的临时文件，保留成品。");
    await page.getByRole("button", { name: "发送清理指令给 DeepSeek", exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => !document.querySelector(".dp-dialog").open);
    const calls = await page.evaluate(() => window.test_calls);
    assert.equal(calls.length, 4, "Repeated click dispatches only once.");
    assert.deepEqual(calls[3], { id: "session-a", content: [{ type: "text", text: "只清理本会话已经不用的临时文件，保留成品。" }], mode: "queue" });
    assert.equal(await page.locator("#draft").inputValue(), "existing draft");
    assert.equal(await page.evaluate(() => window.test_retains), await page.evaluate(() => window.test_releases));
    console.log("PASS: failure cleanup, session switch guard, MD summary, cleanup opt-in, queue, duplicate guard, draft retained.");
} finally {
    await browser.close();
    await new Promise(done => server.close(done));
}
