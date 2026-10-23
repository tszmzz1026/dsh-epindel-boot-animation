import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(`${process.env.DSH_TEST_NODE_MODULES}/package.json`);
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
    const page = await browser.newPage();
    await page.route("http://avatar.test/", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<div id="root"><input class="ep-avatar-file" type="file"><span class="ep-avatar-status"></span><button data-avatar="upload">上传头像</button><button data-avatar="remove">恢复默认头像</button></div>` }));
    await page.goto("http://avatar.test/");
    await page.addScriptTag({ content: await readFile(new URL("../src/avatar.js", import.meta.url), "utf8") + '\nwindow.release_avatar = create_avatar_editor(document.querySelector("#root"));' });
    const fixture = Buffer.from(await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 400; canvas.height = 200;
        const context = canvas.getContext("2d");
        context.fillStyle = "red"; context.fillRect(0, 0, 200, 200);
        context.fillStyle = "blue"; context.fillRect(200, 0, 200, 200);
        return canvas.toDataURL("image/png").split(",")[1];
    }), "base64");
    const upload = () => page.locator(".ep-avatar-file").setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: fixture });
    await upload();
    await page.getByRole("dialog", { name: "裁切头像" }).waitFor();
    await page.getByRole("slider", { name: "头像水平位置" }).fill("0");
    await page.getByRole("button", { name: "使用此头像" }).click();
    const saved = await page.evaluate(() => localStorage.getItem("dsh.glass-avatar.v1"));
    assert.ok(saved.startsWith("data:image/png;base64,"));
    const sample = await page.evaluate(async value => {
        const image = new Image(); image.src = value; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, pixel: [...context.getImageData(128, 128, 1, 1).data] };
    }, saved);
    assert.deepEqual(sample, { width: 256, height: 256, pixel: [255, 0, 0, 255] });
    await upload();
    await page.getByRole("slider", { name: "头像缩放" }).fill("2");
    await page.getByRole("slider", { name: "头像水平位置" }).fill("100");
    await page.getByRole("button", { name: "取消裁切" }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem("dsh.glass-avatar.v1")), saved);
    await page.evaluate(() => { window.release_avatar(); window.release_avatar = create_avatar_editor(document.querySelector("#root")); });
    assert.equal(await page.locator("body").getAttribute("data-glass-custom-avatar"), "true");
    await page.locator(".ep-avatar-file").setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
    await page.getByText("请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片。", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("dsh.glass-avatar.v1")), saved);
    await page.getByRole("button", { name: "恢复默认头像" }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem("dsh.glass-avatar.v1")), null);
    assert.equal(await page.locator("body").getAttribute("data-glass-custom-avatar"), "false");
    console.log("PASS: accurate crop pixels, local persistence, cancel, invalid upload, restore default.");
} finally {
    await browser.close();
}
