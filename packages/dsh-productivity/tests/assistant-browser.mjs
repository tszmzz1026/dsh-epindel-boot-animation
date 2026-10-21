import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { create_productivity } from "../src/host.js";
import { memory_tool, tasks_tool } from "../src/assistant.js";

const require = createRequire(process.env.DSH_TEST_NODE_MODULES ? `${process.env.DSH_TEST_NODE_MODULES}/package.json` : import.meta.url);
const { chromium } = require("playwright");
const root = await mkdtemp(join(tmpdir(), "dsh-assistant-browser-"));
const source = `${await readFile(new URL("../src/assistant-client.js", import.meta.url), "utf8")}\n${(await readFile(new URL("../src/client.js", import.meta.url), "utf8")).replace("const STYLE_TEXT = \"\";", `const STYLE_TEXT = ${JSON.stringify(await readFile(new URL("../src/style.css", import.meta.url), "utf8"))};`)}`;
const ctx = { agents: { get: () => ({ status: "idle" }) }, sessionQuery: { readSession: async id => ({ session: { id, cwd: root } }) } };
const service = create_productivity(ctx, join(root, "storage"));
const server = createServer((req, res) => {
    if (req.url.startsWith("/plugins/")) return service.route(req, res);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><head></head><body><aside><button class=fixture_newSession><span class=fixture_newSessionContent><span>新对话</span></span></button><nav class=fixture_panelList><button>工作台</button><button>插件</button></nav><footer></footer></aside><textarea id=draft>保留当前草稿</textarea><div class=ep_boot>原开屏动画</div></body></html>");
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
try {
    const context = await browser.newContext({ viewport: { width: 1300, height: 1000 }, timezoneId: "Asia/Shanghai" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    async function mount() {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(() => {
            window.test_selection = "session-a";
            window.test_catalog = { "session-a": { title: "已有对话", cwd: "C:/fixture" } };
            window.test_prompts = [];
            const listeners = new Set();
            const sessions = {
                list: { getSnapshot: () => ({ ids: Object.keys(window.test_catalog), byId: window.test_catalog }) },
                async create(options) { const id = `side-${Object.keys(window.test_catalog).length}`; window.test_catalog[id] = { title: "新会话", cwd: options.cwd }; return id; },
                async using(id, options, operation) { return operation({ binding: { session: { prompt: async (content, mode) => { window.test_prompts.push({ id, content, mode }); return { ok: true }; } } } }); },
            };
            const react = { createElement(tag, attrs = {}, ...children) { const element = document.createElement(tag); for (const [key, value] of Object.entries(attrs)) { if (key === "onClick") element.onclick = value; else element.setAttribute(key === "className" ? "class" : key, value); } element.append(...children.filter(value => value !== null)); return element; } };
            const services = { sessions, uiWorkspace: { selection: { getSnapshot: () => ({ sessionId: window.test_selection }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } }, openSession: id => { window.test_selection = id; for (const listener of listeners) listener(); } }, slots: { inject: (_, callback) => callback(), register: (_, component) => { const element = component({ wide: true }); document.querySelector("footer").append(element); return () => element.remove(); } } };
            window.require = () => react; window.exports = {};
            window.test_owner = { get: key => services[key], effect: effect => { window.test_dispose = effect(); return window.test_dispose; } };
        });
        await page.addScriptTag({ content: source });
        await page.evaluate(() => window.exports.apply({ inject: (_, callback) => callback(window.test_owner) }));
    }
    async function settled() { await page.waitForFunction(() => !document.querySelector(".dp-status")?.textContent.includes("正在处理")); assert.equal(await page.locator(".dp-status[data-error=true]").count(), 0, await page.locator(".dp-status").textContent()); }
    await mount();
    await page.waitForFunction(() => document.querySelector(".fixture_newSession").nextElementSibling?.classList.contains("dp-chat-links"));
    assert.equal(await page.locator(".fixture_panelList > :last-child").getAttribute("aria-label"), "目标待办");
    assert.equal(await page.getByRole("status", { name: "每日计划提醒" }).count(), 0);
    await page.evaluate(() => document.querySelector(".ep_boot").remove());
    await page.getByRole("button", { name: "稍后", exact: true }).click();
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    assert.equal(await page.getByRole("status", { name: "每日计划提醒" }).count(), 0);
    console.log("PASS: requested sidebar placement; daily reminder waits for original intro and does not repeat on tray/focus.");

    await page.getByRole("button", { name: "主聊", exact: true }).click();
    await page.getByRole("button", { name: "设为主聊", exact: true }).click();
    await settled();
    assert.equal((await service.assistant.snapshot()).main_session, "session-a");
    await page.getByRole("textbox", { name: "旁聊名称", exact: true }).fill("学习计划");
    await page.getByRole("button", { name: "新建旁聊", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".dp-dialog").open);
    assert.equal((await service.assistant.snapshot()).sides[0].label, "学习计划");
    await page.getByRole("button", { name: "主聊", exact: true }).click();
    await page.waitForFunction(() => window.test_selection === "session-a");
    assert.equal(await page.locator(".dp-dialog[open]").count(), 0);
    assert.equal(await page.getByRole("button", { name: "学习计划", exact: true }).count(), 1);
    console.log("PASS: native main/side chat creation, persisted grouping and direct sidebar navigation.");

    await page.getByRole("button", { name: "打开效率中心", exact: true }).click();
    await page.getByRole("button", { name: "长期记忆", exact: true }).click();
    await page.getByRole("textbox", { name: "记忆标题", exact: true }).fill("配色偏好");
    await page.getByRole("textbox", { name: "记忆内容", exact: true }).fill("我喜欢金紫配色 <script>不执行</script>");
    await page.getByRole("button", { name: "添加记忆", exact: true }).click();
    await settled();
    assert.equal((await service.assistant.snapshot()).memories.length, 1);
    assert.equal(await page.locator(".dp-content script").count(), 0);
    await page.getByRole("checkbox", { name: "对话中主动记忆", exact: true }).uncheck();
    await settled();
    const disabled = await service.assistant.snapshot();
    await assert.rejects(() => memory_tool(service.assistant).execute({ action: "remember", mode: "automatic", evidence: "请用简洁中文", revision: disabled.revision, item: { title: "回复方式", text: "简洁中文" } }, { agent: { session: { id: "session-a", header: { cwd: root }, log: [] } } }), /关闭/);
    await page.getByRole("button", { name: "刷新助理数据", exact: true }).click();
    await settled();
    assert.ok((await page.getByLabel("模型工具保存状态", { exact: true }).textContent()).includes("长期记忆 · 保存被拒绝"));
    await page.getByRole("checkbox", { name: "对话中主动记忆", exact: true }).check();
    await settled();
    await page.getByRole("combobox", { name: "记忆文档", exact: true }).selectOption("identity");
    await page.getByRole("textbox", { name: "记忆文档内容", exact: true }).fill("# 名称\nDSH 助手");
    await page.getByRole("button", { name: "保存记忆文档", exact: true }).click();
    await settled();
    assert.match((await service.assistant.snapshot()).documents.identity.text, /DSH 助手/);
    console.log("PASS: editable native-style Markdown identity and long-term memories; text cannot execute markup.");

    await page.getByRole("button", { name: "目标待办", exact: true }).last().click();
    await page.getByRole("textbox", { name: "任务标题", exact: true }).fill("完成今日数学练习");
    await page.getByRole("checkbox", { name: "加入今日计划", exact: true }).check();
    await page.getByRole("button", { name: "添加目标或待办", exact: true }).click();
    await settled();
    await page.getByRole("checkbox", { name: "完成：完成今日数学练习", exact: true }).check();
    await settled();
    assert.equal((await service.assistant.snapshot()).tasks[0].done, true);
    await page.getByRole("button", { name: "今日计划", exact: true }).click();
    await page.getByRole("textbox", { name: "今日计划", exact: true }).fill("数学练习 45 分钟");
    await page.getByRole("textbox", { name: "今日复盘", exact: true }).fill("练习已完成，明天复习错题。");
    await page.getByRole("button", { name: "保存今日计划与复盘", exact: true }).click();
    await settled();
    const state = await service.assistant.snapshot();
    assert.equal(Object.values(state.days)[0].review, "练习已完成，明天复习错题。");
    const quote = "数学练习已经完成，明天复习错题";
    await tasks_tool(service.assistant).execute({ action: "day", mode: "automatic", evidence: quote, revision: state.revision, day: Object.keys(state.days)[0], item: { entry_kind: "review", text: "数学练习已完成；明天复习错题" } }, { agent: { session: { id: "session-a", header: { cwd: root }, log: [{ type: "user/message", data: { content: [{ type: "text", text: quote }] } }] } }, signal: new AbortController().signal });
    await page.getByRole("button", { name: "刷新助理数据", exact: true }).click();
    await settled();
    assert.equal(await page.getByRole("textbox", { name: "今日计划", exact: true }).inputValue(), "数学练习 45 分钟");
    assert.equal(await page.getByRole("textbox", { name: "今日复盘", exact: true }).inputValue(), "练习已完成，明天复习错题。");
    assert.ok(await page.getByLabel("对话自动整理记录", { exact: true }).textContent().then(text => text.includes("明天复习错题")));
    await page.getByRole("checkbox", { name: "对话中自动完善今日计划", exact: true }).uncheck();
    await settled();
    assert.equal((await service.assistant.snapshot()).settings.auto_plan, false);
    await page.getByRole("button", { name: "请 DeepSeek 帮我复盘", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".dp-dialog").open);
    assert.equal((await page.evaluate(() => window.test_prompts))[0].mode, "queue");
    assert.equal(await page.locator("#draft").inputValue(), "保留当前草稿");
    console.log("PASS: goal/task completion, persisted daily review and queued AI request keep the existing input draft.");
    await page.getByRole("button", { name: "打开效率中心", exact: true }).click();
    await page.getByRole("button", { name: "补整理当前对话", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".dp-dialog").open);
    const repair = (await page.evaluate(() => window.test_prompts)).at(-1);
    assert.equal(repair.mode, "queue");
    assert.ok(repair.content[0].text.includes("实际") || repair.content[0].text.includes("写入成功"));

    await page.route("**/plugins/dsh-productivity/assistant", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...state, assistant_api_version: undefined }) }));
    await page.getByRole("button", { name: "打开效率中心", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".dp-status")?.textContent.includes("后台仍是旧版本"));
    await page.unroute("**/plugins/dsh-productivity/assistant");
    await page.route("**/plugins/dsh-productivity/assistant", route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "接口不存在。" }) }));
    await page.getByRole("button", { name: "今日计划", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".dp-status")?.textContent.includes("完整退出 DSH（包括托盘）"));
    await page.unroute("**/plugins/dsh-productivity/assistant");
    await page.getByRole("button", { name: "关闭效率中心", exact: true }).click();
    console.log("PASS: automatic plan entries preserve handwritten content, independent switches persist, stale backends show restart guidance.");

    await page.evaluate(() => document.querySelector(".fixture_newSessionContent > span").remove());
    await page.waitForFunction(() => document.querySelector(".dp-chat-links").dataset.collapsed === "true");
    assert.equal(await page.locator(".dp-side-rows").isVisible(), false);
    await page.evaluate(() => window.test_dispose());
    assert.equal(await page.locator(".dp-dialog,.dp-chat-links,.dp-goals-link,.dp-daily-reminder").count(), 0);
    assert.deepEqual(errors, []);
    await mount();
    await page.evaluate(() => document.querySelector(".ep_boot").remove());
    await page.waitForTimeout(2200);
    assert.equal(await page.getByRole("status", { name: "每日计划提醒" }).count(), 0);
    console.log("PASS: collapsed sidebar, disposal and daily reminder deduplication across reloads.");
} finally {
    await browser.close(); await new Promise(done => server.close(done));
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}dsh-assistant-browser-`));
    await rm(root, { recursive: true, force: true });
}
