import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(`${process.env.DSH_TEST_NODE_MODULES}/package.json`);
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
    const page = await browser.newPage();
    await page.route("http://wallpaper.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="ambient"></div><section></section>' }));
    await page.goto("http://wallpaper.test/");
    await page.addScriptTag({ content: `
        window.calls = [];
        window.delete_ok = false;
        window.play_count = 0;
        window.pause_count = 0;
        HTMLMediaElement.prototype.play = function() { window.play_count++; return Promise.resolve(); };
        HTMLMediaElement.prototype.pause = function() { window.pause_count++; };
        window.fetch = async (url, options = {}) => {
            window.calls.push(options.method || "GET");
            if (!options.method) return new Promise(resolve => { window.finish_restore = () => resolve(Response.json({ exists: true, type: "image/png", name: "old.png", updated: 1 })); });
            if (options.method === "DELETE") return Response.json({ ok: window.delete_ok, exists: false }, { status: window.delete_ok ? 200 : 500 });
            await new Promise(resolve => { window.finish_upload = resolve; });
            return Response.json({ ok: true, exists: true, type: "video/mp4", name: "new.mp4", updated: 2 });
        };
    ` });
    await page.addScriptTag({ content: await readFile(new URL("../src/wallpaper.js", import.meta.url), "utf8") + `
        window.wallpaper = create_wallpaper(document.querySelector("#ambient"));
        window.wallpaper.bind_panel(document.querySelector("section"), () => {});
    ` });
    await page.locator(".ep-wallpaper-file").setInputFiles({ name: "new.mp4", mimeType: "video/mp4", buffer: Buffer.from("test video") });
    assert.equal(await page.getByRole("button", { name: "导入图片/视频", exact: true }).isDisabled(), true);
    await page.evaluate(() => window.finish_upload());
    await page.getByText("壁纸已保存到本机。", { exact: true }).waitFor();
    await page.evaluate(() => window.finish_restore());
    assert.equal(await page.evaluate(() => window.wallpaper.get_meta().name), "new.mp4");

    await page.getByRole("button", { name: "清除", exact: true }).click();
    await page.getByText("清除失败，请稍后重试。", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.wallpaper.get_meta().name), "new.mp4");
    assert.equal(await page.locator("#ambient video").count(), 1);

    await page.evaluate(() => {
        window.play_count = 0;
        window.pause_count = 0;
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.evaluate(() => window.pause_count), 1);
    await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.evaluate(() => window.play_count), 1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => window.pause_count >= 2);

    await page.evaluate(() => { window.delete_ok = true; });
    await page.getByRole("button", { name: "清除", exact: true }).click();
    await page.getByText("壁纸已清除，已恢复主题默认背景。", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.wallpaper.get_meta()), null);
    await page.evaluate(() => window.wallpaper.dispose());
    assert.equal(await page.locator(".ep-wallpaper-media").count(), 0);
    console.log("PASS: stale restore, upload locking, failed clear preserves media, background/reduced-motion pause, successful clear and disposal.");
} finally {
    await browser.close();
}
