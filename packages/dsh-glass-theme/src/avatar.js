function create_avatar_editor(root) {
    const STORAGE_KEY = "dsh.glass-avatar.v1";
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const input = root.querySelector(".ep-avatar-file");
    const status = root.querySelector(".ep-avatar-status");
    const crop = document.createElement("dialog");
    crop.className = "ep-avatar-crop";
    crop.setAttribute("aria-label", "裁切头像");
    crop.innerHTML = `
        <h2>裁切头像</h2><p>拖动图片，或使用滑块调整；圆形区域为最终效果。</p>
        <canvas width="256" height="256" aria-label="头像裁切预览"></canvas>
        <label>缩放<input type="range" min="1" max="4" step="0.01" value="1" data-crop="zoom" aria-label="头像缩放"></label>
        <label>水平位置<input type="range" min="0" max="100" step="0.1" value="50" data-crop="x" aria-label="头像水平位置"></label>
        <label>垂直位置<input type="range" min="0" max="100" step="0.1" value="50" data-crop="y" aria-label="头像垂直位置"></label>
        <div class="ep-avatar-actions"><button type="button" data-avatar="cancel">取消裁切</button><button type="button" data-avatar="save">使用此头像</button></div>`;
    root.appendChild(crop);
    const canvas = crop.querySelector("canvas");
    const context = canvas.getContext("2d");
    let bitmap = null;
    let revision = 0;
    let disposed = false;
    let dragging = null;
    const position = { zoom: 1, x: 50, y: 50 };

    function read_avatar() {
        try {
            const value = localStorage.getItem(STORAGE_KEY) || "";
            return value.length <= 600000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : "";
        } catch (error) {
            if (!(error instanceof DOMException)) throw error;
            return "";
        }
    }

    function render_avatar() {
        const value = read_avatar();
        if (value) document.body.style.setProperty("--glass-avatar-image", `url("${value}")`);
        else document.body.style.removeProperty("--glass-avatar-image");
        document.body.dataset.glassCustomAvatar = String(Boolean(value));
        root.querySelector("[data-avatar=remove]").disabled = !value;
    }

    function draw_crop() {
        if (!bitmap) return;
        const size = Math.min(bitmap.width, bitmap.height) / position.zoom;
        const x = (bitmap.width - size) * position.x / 100;
        const y = (bitmap.height - size) * position.y / 100;
        context.clearRect(0, 0, 256, 256);
        context.drawImage(bitmap, x, y, size, size, 0, 0, 256, 256);
        for (const slider of crop.querySelectorAll("[data-crop]")) slider.value = String(position[slider.dataset.crop]);
    }

    function release_bitmap() {
        revision++;
        bitmap?.close();
        bitmap = null;
        dragging = null;
        context.clearRect(0, 0, 256, 256);
    }

    async function on_file() {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        status.textContent = "";
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_FILE_BYTES) {
            status.textContent = "请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片。";
            return;
        }
        const current = ++revision;
        let decoded;
        try {
            decoded = await createImageBitmap(file, { imageOrientation: "from-image" });
            if (disposed || current !== revision) { decoded.close(); return; }
            if (decoded.width * decoded.height > 32000000) {
                decoded.close();
                status.textContent = "图片尺寸过大，请先缩小至 3200 万像素以内。";
                return;
            }
            bitmap?.close();
            bitmap = decoded;
            Object.assign(position, { zoom: 1, x: 50, y: 50 });
            draw_crop();
            if (!crop.open) crop.showModal();
        } catch (error) {
            decoded?.close();
            if (!(error instanceof DOMException || error instanceof TypeError)) throw error;
            if (!disposed && current === revision) status.textContent = "无法读取此图片，请换一张图片。";
        }
    }

    function on_click(event) {
        const action = event.target.closest?.("[data-avatar]")?.dataset.avatar;
        if (action === "upload") input.click();
        if (action === "cancel") crop.close();
        if (action !== "save" && action !== "remove") return;
        if (action === "save" && !bitmap) return;
        try {
            if (action === "save") localStorage.setItem(STORAGE_KEY, canvas.toDataURL("image/png"));
            else localStorage.removeItem(STORAGE_KEY);
            render_avatar();
            status.textContent = action === "save" ? "头像已保存到本机。" : "已恢复默认头像。";
            if (crop.open) crop.close();
        } catch (error) {
            if (!(error instanceof DOMException)) throw error;
            status.textContent = "本地空间不足，头像未保存，请清理浏览器存储后重试。";
        }
    }

    function on_input(event) {
        if (!event.target.dataset.crop) return;
        position[event.target.dataset.crop] = Number(event.target.value);
        draw_crop();
    }

    function on_pointer_down(event) {
        if (!bitmap) return;
        dragging = { x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
    }

    function on_pointer_move(event) {
        if (!dragging || !bitmap) return;
        const size = Math.min(bitmap.width, bitmap.height) / position.zoom;
        const scale = size / canvas.getBoundingClientRect().width * 100;
        for (const [key, dimension, coordinate] of [["x", bitmap.width, event.clientX], ["y", bitmap.height, event.clientY]]) {
            if (dimension > size) position[key] = Math.max(0, Math.min(100, position[key] - (coordinate - dragging[key]) * scale / (dimension - size)));
            dragging[key] = coordinate;
        }
        draw_crop();
    }

    function on_pointer_end() { dragging = null; }
    function on_storage(event) { if (event.key === STORAGE_KEY || event.key === null) render_avatar(); }
    input.addEventListener("change", on_file);
    root.addEventListener("click", on_click);
    crop.addEventListener("input", on_input);
    crop.addEventListener("close", release_bitmap);
    canvas.addEventListener("pointerdown", on_pointer_down);
    canvas.addEventListener("pointermove", on_pointer_move);
    canvas.addEventListener("pointerup", on_pointer_end);
    canvas.addEventListener("pointercancel", on_pointer_end);
    window.addEventListener("storage", on_storage);
    render_avatar();
    return () => {
        disposed = true;
        input.removeEventListener("change", on_file);
        root.removeEventListener("click", on_click);
        crop.removeEventListener("input", on_input);
        crop.removeEventListener("close", release_bitmap);
        canvas.removeEventListener("pointerdown", on_pointer_down);
        canvas.removeEventListener("pointermove", on_pointer_move);
        canvas.removeEventListener("pointerup", on_pointer_end);
        canvas.removeEventListener("pointercancel", on_pointer_end);
        window.removeEventListener("storage", on_storage);
        if (crop.open) crop.close();
        release_bitmap();
        crop.remove();
        delete document.body.dataset.glassCustomAvatar;
        document.body.style.removeProperty("--glass-avatar-image");
    };
}
