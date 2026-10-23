// 图片 / 视频壁纸：文件由宿主写入 plugin-data 目录，客户端只引用同源路由，
// 因此不占用浏览器存储、支持视频 Range 拖动，也不会被清缓存清掉。
function create_wallpaper(ambient) {
    const ROUTE = "/plugins/dsh-glass-aurum/wallpaper";
    const MAX_BYTES = 512 * 1024 * 1024;
    const reduced_motion = matchMedia("(prefers-reduced-motion: reduce)");
    const layer = document.createElement("div");
    layer.className = "ep-wallpaper-media";
    layer.setAttribute("aria-hidden", "true");
    ambient.appendChild(layer);
    let meta = null;
    let element = null;
    let disposed = false;
    let revision = 0;
    let controls = null;
    let busy = false;
    const requests = new AbortController();
    let state = {
        opacity: 36,
        blur: 0,
        fit: "cover",
        muted: true,
        volume: 60,
        playing: true,
    };

    const is_video = () => Boolean(meta && /^video\//.test(meta.type));

    function describe() {
        if (!meta) return "未导入，正在使用主题默认背景。";
        const size = Number.isFinite(meta.size) ? ` · ${(meta.size / 1048576).toFixed(1)} MB` : "";
        return `${meta.name || (is_video() ? "本地视频" : "本地图片")}${size}`;
    }

    function sync_controls() {
        if (!controls) return;
        const { name, opacity, blur, fit, muted, volume, playing, video } = controls;
        const output_of = input => input?.previousElementSibling?.querySelector?.("output") || null;
        name.textContent = describe();
        opacity.value = String(state.opacity);
        const opacity_output = output_of(opacity);
        if (opacity_output) opacity_output.textContent = `${state.opacity}%`;
        blur.value = String(state.blur);
        const blur_output = output_of(blur);
        if (blur_output) blur_output.textContent = `${state.blur} px`;
        fit.value = state.fit;
        muted.checked = state.muted;
        volume.value = String(state.volume);
        const volume_output = output_of(volume);
        if (volume_output) volume_output.textContent = `${state.volume}%`;
        video.hidden = !is_video();
        controls.toggle.textContent = state.playing ? "暂停" : "播放";
        controls.toggle.disabled = busy || !is_video();
        controls.clear.disabled = busy || !meta;
        controls.upload.disabled = busy;
        controls.file.disabled = busy;
        controls.section.setAttribute("aria-busy", String(busy));
    }

    function apply() {
        layer.style.setProperty("--ep-wallpaper-opacity", String(state.opacity / 100));
        layer.style.setProperty("--ep-wallpaper-blur", `${state.blur}px`);
        ambient.dataset.wallpaper = String(Boolean(meta));
        if (!element) { sync_controls(); return; }
        element.style.objectFit = state.fit === "contain" ? "contain" : "cover";
        if (element.tagName === "VIDEO") {
            element.volume = Math.max(0, Math.min(1, state.volume / 100));
            element.muted = state.muted || state.volume === 0;
            if (state.playing && !reduced_motion.matches && !document.hidden) element.play().catch(() => {});
            else element.pause();
        }
        sync_controls();
    }

    function release_element() {
        if (!element) return;
        if (element.tagName === "VIDEO") {
            element.pause();
            element.removeAttribute("src");
            element.load();
        } else {
            element.removeAttribute("src");
        }
        element.remove();
        element = null;
    }

    function mount(next) {
        release_element();
        meta = next && next.exists !== false ? next : null;
        if (!meta) { apply(); return; }
        const url = `${ROUTE}?v=${meta.updated || 0}`;
        if (/^video\//.test(meta.type)) {
            const video = document.createElement("video");
            video.className = "ep-wallpaper-video";
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = "auto";
            video.src = url;
            video.addEventListener("error", () => {
                if (disposed) return;
                set_status("这个视频无法播放，建议换成 MP4(H.264) 或 WebM。");
            });
            layer.replaceChildren(video);
            element = video;
        } else {
            const image = document.createElement("img");
            image.className = "ep-wallpaper-image";
            image.alt = "";
            image.decoding = "async";
            image.src = url;
            image.addEventListener("error", () => {
                if (!disposed) set_status("壁纸图片加载失败，请重新导入。");
            });
            layer.replaceChildren(image);
            element = image;
        }
        apply();
    }

    function set_status(text) {
        if (controls) controls.status.textContent = text;
    }

    async function restore() {
        const current = ++revision;
        try {
            const response = await fetch(`${ROUTE}?meta=1`, { cache: "no-store", signal: requests.signal });
            if (!response.ok) throw new Error(`http-${response.status}`);
            const payload = await response.json();
            if (disposed || current !== revision) return;
            if (payload?.exists) mount(payload);
        } catch {
            if (!disposed && current === revision) set_status("壁纸服务未就绪：请完整退出 DSH 后重新打开。");
        }
    }

    async function upload(file) {
        if (!file || disposed || busy) return;
        if (!/^(image|video)\//.test(file.type)) { set_status("请选择图片或视频文件。"); return; }
        if (file.size > MAX_BYTES) { set_status("文件超过 512 MB，请压缩后再导入。"); return; }
        const current = ++revision;
        busy = true;
        sync_controls();
        set_status("正在导入…");
        try {
            const response = await fetch(ROUTE, {
                method: "POST",
                headers: {
                    "content-type": file.type,
                    "x-glass-type": file.type,
                    "x-glass-name": encodeURIComponent(file.name || "wallpaper"),
                },
                body: file,
                signal: requests.signal,
            });
            const payload = await response.json().catch(() => null);
            if (disposed || current !== revision) return;
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || `http-${response.status}`);
            mount({ ...payload, exists: true });
            set_status("壁纸已保存到本机。");
        } catch (error) {
            if (!disposed && current === revision) set_status(error?.message === "too-large" ? "文件超过 512 MB，请压缩后再导入。" : error?.message === "busy" ? "另一个窗口正在导入壁纸，请稍后重试。" : "导入失败，请确认 DSH 已重新启动后再试。");
        } finally {
            busy = false;
            if (!disposed) sync_controls();
        }
    }

    async function clear() {
        if (disposed || busy) return;
        const current = ++revision;
        busy = true;
        sync_controls();
        set_status("正在清除…");
        try {
            const response = await fetch(ROUTE, { method: "DELETE", signal: requests.signal });
            const payload = await response.json().catch(() => null);
            if (disposed || current !== revision) return;
            if (!response.ok || !payload?.ok || payload.exists !== false) throw new Error("clear-failed");
            mount(null);
            set_status("壁纸已清除，已恢复主题默认背景。");
        } catch {
            if (!disposed && current === revision) set_status("清除失败，请稍后重试。");
        } finally {
            busy = false;
            if (!disposed) sync_controls();
        }
    }

    function bind_panel(section, update) {
        section.innerHTML = `
            <div class="ep-section-title">壁纸 <span>图片 / 视频，仅存本机</span></div>
            <div class="ep-wallpaper-settings">
                <div class="ep-wallpaper-row">
                    <div class="ep-wallpaper-current"><strong>当前壁纸</strong><small data-wallpaper-name>未导入</small></div>
                    <div class="ep-avatar-actions">
                        <button type="button" data-wallpaper="upload">导入图片/视频</button>
                        <button type="button" data-wallpaper="toggle">暂停</button>
                        <button type="button" data-wallpaper="clear">清除</button>
                    </div>
                </div>
                <input class="ep-wallpaper-file" type="file" accept="image/*,video/*" aria-label="选择壁纸文件" hidden>
                <label class="ep-range-label" for="ep-wallpaper-opacity">壁纸浓度 <output>36%</output></label>
                <input id="ep-wallpaper-opacity" data-wallpaper-setting="opacity" type="range" min="0" max="100" step="1" aria-label="壁纸浓度">
                <label class="ep-range-label" for="ep-wallpaper-blur">背景模糊 <output>0 px</output></label>
                <input id="ep-wallpaper-blur" data-wallpaper-setting="blur" type="range" min="0" max="24" step="1" aria-label="壁纸模糊">
                <label class="ep-wallpaper-fit">填充方式
                    <select data-wallpaper-setting="fit" aria-label="壁纸填充方式">
                        <option value="cover">铺满裁切</option>
                        <option value="contain">完整显示</option>
                    </select>
                </label>
                <div class="ep-wallpaper-video" hidden>
                    <label class="ep-setting"><span>静音播放<small>关闭静音后可按音量播放</small></span><input type="checkbox" data-wallpaper-setting="muted" role="switch" aria-label="静音播放"></label>
                    <label class="ep-range-label" for="ep-wallpaper-volume">视频音量 <output>60%</output></label>
                    <input id="ep-wallpaper-volume" data-wallpaper-setting="volume" type="range" min="0" max="100" step="1" aria-label="视频音量">
                </div>
                <p class="ep-wallpaper-status" role="status" aria-live="polite"></p>
            </div>`;
        const file_input = section.querySelector(".ep-wallpaper-file");
        controls = {
            section,
            file: file_input,
            upload: section.querySelector("[data-wallpaper=upload]"),
            name: section.querySelector("[data-wallpaper-name]"),
            status: section.querySelector(".ep-wallpaper-status"),
            clear: section.querySelector("[data-wallpaper=clear]"),
            toggle: section.querySelector("[data-wallpaper=toggle]"),
            video: section.querySelector(".ep-wallpaper-video"),
            opacity: section.querySelector('[data-wallpaper-setting="opacity"]'),
            blur: section.querySelector('[data-wallpaper-setting="blur"]'),
            fit: section.querySelector('[data-wallpaper-setting="fit"]'),
            muted: section.querySelector('[data-wallpaper-setting="muted"]'),
            volume: section.querySelector('[data-wallpaper-setting="volume"]'),
        };
        function on_click(event) {
            const action = event.target.closest?.("[data-wallpaper]")?.dataset.wallpaper;
            if (action === "upload") file_input.click();
            else if (action === "clear") clear();
            else if (action === "toggle") update({ wallpaper_playing: !state.playing });
        }
        function on_input(event) {
            const key = event.target?.dataset?.wallpaperSetting;
            if (!key) return;
            if (key === "fit") update({ wallpaper_fit: event.target.value });
            else if (key === "muted") update({ wallpaper_muted: event.target.checked });
            else if (key === "opacity") update({ wallpaper_opacity: Number(event.target.value) });
            else if (key === "blur") update({ wallpaper_blur: Number(event.target.value) });
            else if (key === "volume") update({ wallpaper_volume: Number(event.target.value) });
        }
        async function on_file() {
            const picked = file_input.files?.[0];
            file_input.value = "";
            await upload(picked);
        }
        section.addEventListener("click", on_click);
        section.addEventListener("input", on_input);
        section.addEventListener("change", on_input);
        file_input.addEventListener("change", on_file);
        controls.cleanup = () => {
            section.removeEventListener("click", on_click);
            section.removeEventListener("input", on_input);
            section.removeEventListener("change", on_input);
            file_input.removeEventListener("change", on_file);
            section.replaceChildren();
            controls = null;
        };
        sync_controls();
    }

    async function image_blob() {
        if (!meta || is_video()) return null;
        const response = await fetch(`${ROUTE}?v=${meta.updated || 0}`);
        if (!response.ok) return null;
        return response.blob();
    }

    document.addEventListener("visibilitychange", apply);
    reduced_motion.addEventListener("change", apply);
    restore();

    return {
        bind_panel,
        set_state(next) {
            const previous = state;
            state = {
                opacity: Math.max(0, Math.min(100, Number(next.wallpaper_opacity) || 0)),
                blur: Math.max(0, Math.min(24, Number(next.wallpaper_blur) || 0)),
                fit: next.wallpaper_fit === "contain" ? "contain" : "cover",
                muted: Boolean(next.wallpaper_muted),
                volume: Math.max(0, Math.min(100, Number(next.wallpaper_volume) || 0)),
                playing: next.wallpaper_playing !== false,
            };
            if (previous.opacity !== state.opacity || previous.blur !== state.blur || previous.fit !== state.fit
                || previous.muted !== state.muted || previous.volume !== state.volume || previous.playing !== state.playing) apply();
            else sync_controls();
        },
        image_blob,
        get_meta: () => meta,
        dispose() {
            disposed = true;
            revision++;
            requests.abort();
            document.removeEventListener("visibilitychange", apply);
            reduced_motion.removeEventListener("change", apply);
            controls?.cleanup?.();
            release_element();
            layer.remove();
            delete ambient.dataset.wallpaper;
        },
    };
}
