import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(`${process.env.DSH_TEST_NODE_MODULES}/package.json`);
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const failures = [];
const results = [];
const command_requests = [];
const prompt_requests = [];
try {
    let url;
    for (let attempt = 0; !url && attempt < 100; attempt++) {
        const log = await readFile(process.env.DSH_VERIFY_LOG, "utf8");
        url = /dsh web: (http[^\s]+)/.exec(log)?.[1];
        if (!url) await new Promise(done => setTimeout(done, 200));
    }
    assert.ok(url, "Verification host must start.");
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.route("**/api/commands/execute", async route => {
        const rpc = route.request().postDataJSON();
        command_requests.push(rpc.payload.args);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ type: "server-response", rpcId: rpc.rpcId, result: { ok: true, value: { commandId: "verification-command", result: { kind: "success", text: "Verification only; model was not called." } } } }) });
    });
    await page.route("**/api/session/prompt", async route => {
        const rpc = route.request().postDataJSON();
        prompt_requests.push(rpc.payload.args.request);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ type: "server-response", rpcId: rpc.rpcId, result: { ok: true, value: { accepted: true } } }) });
    });
    page.on("pageerror", error => failures.push(error.message));
    page.on("response", async response => {
        if (response.url().includes("/plugins/dsh-productivity/") && response.status() >= 400) {
            const value = await response.json();
            failures.push(`API ${response.status()} ${new URL(response.url()).pathname} ${value.code || value.error}`);
        }
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".ep-fate-home").waitFor({ timeout: 25000 });
    if (await page.locator(".ep_boot").count()) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "续章 · 最近对话", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("dsh.sessions.current") || "{}").sessionId);
    const selected_id = await page.evaluate(() => JSON.parse(localStorage.getItem("dsh.sessions.current")).sessionId);
    const composer = page.locator(".uV2eYG_input").first();
    await composer.waitFor();
    await composer.fill("保留原输入草稿（测试）");
    await page.getByRole("button", { name: "打开效率中心", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "效率中心", exact: true });
    await dialog.waitFor();
    await page.getByRole("searchbox", { name: "搜索对话全文" }).fill("文件");
    await page.waitForFunction(() => /已找到|没有匹配/.test(document.querySelector(".dp-status")?.textContent || "") || document.querySelector(".dp-status")?.dataset.error === "true", null, { timeout: 60000 });
    assert.equal(await page.locator(".dp-status[data-error=true]").count(), 0);
    if (await page.getByRole("button", { name: "查看匹配", exact: true }).count()) {
        await page.getByRole("button", { name: "查看匹配", exact: true }).first().click();
        await page.locator(".dp-match-details details").first().waitFor();
    }
    results.push("原生会话中文全文搜索、匹配摘录");
    console.log("PASS: literal search and matched events.");
    await page.getByRole("combobox", { name: "搜索方式" }).selectOption("indexed");
    await page.waitForFunction(() => /已找到|没有匹配/.test(document.querySelector(".dp-status")?.textContent || "") || document.querySelector(".dp-status")?.dataset.error === "true", null, { timeout: 60000 });
    assert.equal(await page.locator(".dp-status[data-error=true]").count(), 0, JSON.stringify(failures) + await page.locator(".dp-status").textContent());
    results.push("原生索引关闭时回退逐字搜索");
    await page.getByRole("button", { name: "检查点", exact: true }).click();
    await page.getByRole("button", { name: "创建检查点", exact: true }).waitFor();
    assert.equal(await page.locator(".dp-status[data-error=true]").count(), 0);
    results.push("工作区检查点列表与覆盖范围（只读）");
    await page.getByRole("button", { name: "上下文", exact: true }).click();
    await page.getByRole("button", { name: "恢复全部轮次", exact: true }).waitFor();
    assert.ok(await page.locator(".dp-turn").count());
    assert.ok(await page.locator(".dp-turn input:disabled").count(), "Most recent turn remains protected.");
    await page.getByRole("button", { name: "压缩上下文…", exact: true }).click();
    await page.getByRole("button", { name: "执行压缩", exact: true }).waitFor();
    await page.getByRole("button", { name: "执行压缩", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".dp-status")?.textContent.includes("压缩命令已执行") || document.querySelector(".dp-status")?.dataset.error === "true");
    assert.equal(await page.locator(".dp-status[data-error=true]").count(), 0);
    assert.equal(command_requests.length, 1, "Native compact RPC must be invoked once.");
    assert.equal(command_requests[0].line, "/compact");
    assert.equal(command_requests[0].agentId, selected_id);
    results.push("实际点击压缩，经原生会话引用发送 compact RPC（拦截网络、未调用模型）");
    await page.getByRole("button", { name: "生成 MD 总结", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(prompt_requests.length, 1);
    assert.equal(prompt_requests[0].sessionId, selected_id);
    assert.equal(prompt_requests[0].mode, "queue");
    assert.ok(prompt_requests[0].content[0].text.includes("UTF-8 Markdown"));
    results.push("MD 总结按钮发送创建 Markdown 文件指令（拦截网络、未调用模型）");
    await page.getByRole("button", { name: "打开效率中心", exact: true }).click();
    await page.getByRole("button", { name: "清理文件", exact: true }).click();
    const cleanup = page.getByRole("textbox", { name: "清理指令", exact: true });
    await cleanup.waitFor();
    assert.ok((await cleanup.inputValue()).includes("保留源代码、最终成品"));
    assert.equal(prompt_requests.length, 1, "Opening cleanup must not send anything.");
    await cleanup.fill("验证清理指令发送，不执行真实清理。");
    await page.getByRole("button", { name: "发送清理指令给 DeepSeek", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(prompt_requests.length, 2);
    assert.equal(prompt_requests[1].sessionId, selected_id);
    assert.equal(prompt_requests[1].mode, "queue");
    assert.deepEqual(prompt_requests[1].content, [{ type: "text", text: "验证清理指令发送，不执行真实清理。" }]);
    assert.equal(await composer.innerText(), "保留原输入草稿（测试）");
    results.push("清理指令发送至当前会话并排队、保留草稿（拦截网络、未执行清理）");
    await page.getByRole("button", { name: "打开效率中心", exact: true }).click();
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    await page.keyboard.press("Control+Shift+f");
    await dialog.waitFor();
    await page.setViewportSize({ width: 480, height: 850 });
    await page.waitForTimeout(200);
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false);
    results.push("快捷键、键盘退出、窄屏无横向溢出");
    assert.deepEqual(failures, []);
    await mkdir(new URL("../docs/verification/", import.meta.url), { recursive: true });
    const report = { passed: true, results, failures };
    await writeFile(new URL("../docs/verification/installed-results.json", import.meta.url), JSON.stringify(report, null, 4));
    console.log(JSON.stringify(report, null, 4));
} finally { await browser.close(); }
