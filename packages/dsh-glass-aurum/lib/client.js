window.__ModuleLoader__.load({ id: "dsh-glass-aurum", factory: (require) => {
const module = { exports: {} }; const exports = module.exports;
function create_world_enhancements(ctx) {
    const headers = new Map();
    const listeners = new Set();
    let snapshot = { enabled: false, fate_home: false, reply_identity: false, focus: false };
    let frame = null;
    let disposed = false;
    const intersection = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.dataset.epReplyEntered = "true";
            intersection.unobserve(entry.target);
        }
    }, { threshold: .08 });

    function remove_identity(reply, header) {
        header.remove();
        intersection.unobserve(reply);
        delete reply.dataset.epReplyEntered;
        delete reply.dataset.epReplyStreaming;
    }

    function scan_replies() {
        frame = null;
        const enabled = snapshot.enabled && snapshot.reply_identity;
        for (const [reply, header] of headers) {
            if (!enabled || !reply.isConnected) {
                remove_identity(reply, header);
                headers.delete(reply);
            }
        }
        if (!enabled || disposed) return;
        for (const reply of document.querySelectorAll(".hWmORq_root")) {
            if (!headers.has(reply)) {
                const header = document.createElement("div");
                header.className = "ep-reply-identity";
                header.innerHTML = `<span class="ep-character-avatar" role="img" aria-label="DSH 助手头像"></span><span class="ep-reply-name">DSH 助手</span><span class="ep-reply-star" aria-hidden="true">✧</span>`;
                reply.prepend(header);
                headers.set(reply, header);
                intersection.observe(reply);
            }
            const streaming = reply.matches("[data-streaming=true]") || reply.querySelector("[data-streaming=true]") !== null;
            const name = headers.get(reply).querySelector(".ep-reply-name");
            if (name.textContent !== (snapshot.assistant_name || "DSH 助手")) name.textContent = snapshot.assistant_name || "DSH 助手";
            headers.get(reply).querySelector(".ep-character-avatar").setAttribute("aria-label", `${snapshot.assistant_name || "DSH 助手"}头像`);
            reply.dataset.epReplyStreaming = String(streaming);
        }
    }

    function schedule_scan() {
        if (!disposed && frame === null) frame = requestAnimationFrame(scan_replies);
    }

    const observer = new MutationObserver(schedule_scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-streaming"] });

    ctx.inject(["slots", "uiWorkspace", "sessions", "workspaces", "layout"], (owner) => {
        const React = require("react");
        const e = React.createElement;
        const slots = owner.get("slots");
        const navigation = owner.get("uiWorkspace");
        const sessions = owner.get("sessions");
        const workspaces = owner.get("workspaces");
        const layout = owner.get("layout");
        const subscribe = (notify) => { listeners.add(notify); return () => listeners.delete(notify); };
        const get_snapshot = () => snapshot;

        owner.effect(() => {
            const startup_key = Symbol.for("dsh.glass-theme.startup");
            let active = true;
            let queued = false;
            const open_home = () => {
                layout.beginNavigation();
                navigation.clearMain();
            };
            const restore_selection = navigation.restoreSelection;
            const restore_with_home = async function (...args) {
                await Promise.resolve();
                if (active && !window[startup_key] && snapshot.enabled && snapshot.fate_home) {
                    window[startup_key] = true;
                    open_home();
                    return;
                }
                return restore_selection.apply(this, args);
            };
            navigation.restoreSelection = restore_with_home;
            const show_startup_home = () => {
                if (!active || queued || window[startup_key]) return;
                if (!snapshot.enabled || !snapshot.fate_home) return;
                if (sessions.list.getSnapshot().phase !== "ready" || workspaces.list.getSnapshot().phase !== "ready") return;
                queued = true;
                queueMicrotask(() => {
                    queued = false;
                    if (!active || window[startup_key] || !snapshot.enabled || !snapshot.fate_home) return;
                    window[startup_key] = true;
                    open_home();
                });
            };
            const stop_sessions = sessions.list.subscribe(show_startup_home);
            const stop_workspaces = workspaces.list.subscribe(show_startup_home);
            listeners.add(show_startup_home);
            show_startup_home();
            return () => {
                active = false;
                if (navigation.restoreSelection === restore_with_home) navigation.restoreSelection = restore_selection;
                stop_sessions();
                stop_workspaces();
                listeners.delete(show_startup_home);
            };
        });

        function FateHome() {
            const settings = React.useSyncExternalStore(subscribe, get_snapshot);
            const catalog = React.useSyncExternalStore(notify => sessions.list.subscribe(notify), () => sessions.list.getSnapshot());
            const workspace_catalog = React.useSyncExternalStore(notify => workspaces.list.subscribe(notify), () => workspaces.list.getSnapshot());
            const [picker_open, set_picker_open] = React.useState(false);
            const [notice, set_notice] = React.useState("");
            const [busy, set_busy] = React.useState(false);
            const mounted = React.useRef(true);
            React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
            if (!settings.enabled || !settings.fate_home) return null;
            const archived = new Set(workspace_catalog.archivedSessionIds || []);
            const recent_id = (catalog.ids || []).find(id => {
                const row = catalog.byId[id];
                return row && !row.blank && !archived.has(id) && navigation.isSessionVisible(id);
            });
            const recent = recent_id ? catalog.byId[recent_id] : null;
            const recent_title = typeof recent?.title === "string" && recent.title.trim() ? recent.title : "回到最近的一段对话";
            const projects = (workspace_catalog.items || []).filter(item => navigation.isWorkspaceVisible(item.workspaceId));

            function run_action(action) {
                if (busy) return;
                set_busy(true);
                set_notice("");
                Promise.resolve().then(action).catch(() => {
                    if (mounted.current) set_notice("暂时无法打开，请稍后重试。");
                }).finally(() => { if (mounted.current) set_busy(false); });
            }

            function card(id, numeral, symbol, title, subtitle, action, disabled = false) {
                return e("button", {
                    key: id,
                    type: "button",
                    className: `ep-fate-card ep-fate-${id}`,
                    "data-fate": id,
                    "aria-label": title,
                    disabled: busy || disabled,
                    onClick: action,
                }, e("span", { className: "ep-fate-number", "aria-hidden": true }, numeral),
                e("span", { className: "ep-fate-sigil", "aria-hidden": true }, symbol),
                e("strong", null, title), e("small", null, subtitle),
                e("span", { className: "ep-fate-corner", "aria-hidden": true }, "✧"));
            }

            return e("section", { className: "ep-fate-home", "aria-label": "工作台卡片主页" },
                e("header", { className: "ep-fate-heading" },
                    e("span", { className: "ep-character-avatar ep-home-avatar", role: "img", "aria-label": `${settings.assistant_name || "DSH 助手"}头像` }),
                    e("div", null, e("p", null, `${settings.assistant_name || "DSH 助手"} · FOCUS & FLOW`), e("h1", null, "今天，想开启怎样的旅程？"), e("small", null, "抽取一张工作台卡片，让灵感在此盛放。"))),
                e("div", { className: "ep-fate-cards" },
                    card("new", "I", "❀", "启程 · 新建会话", "留一束花，给新的灵感", () => run_action(() => navigation.startSession())),
                    card("recent", "II", "✧", "续章 · 最近对话", recent ? recent_title : "还没有可以继续的对话", () => run_action(() => navigation.openSession(recent_id)), !recent),
                    card("workspace", "III", "⌘", "星图 · 选择工作区", "让每一个想法，都有归处", () => { set_picker_open(!picker_open); set_notice(""); })),
                picker_open ? e("div", { className: "ep-fate-workspaces", role: "region", "aria-label": "选择已有工作区" },
                    e("div", { className: "ep-fate-picker-heading" }, "选择工作区", e("button", { type: "button", "aria-label": "关闭工作区列表", onClick: () => set_picker_open(false) }, "×")),
                    projects.length ? projects.map(item => e("button", {
                        key: item.workspaceId,
                        type: "button",
                        className: "ep-fate-project",
                        disabled: busy,
                        onClick: () => run_action(async () => { await navigation.openWorkspace(item.workspaceId); if (mounted.current) set_picker_open(false); }),
                    }, e("span", { "aria-hidden": true }, "◇"), e("span", null, typeof item.title === "string" && item.title ? item.title : item.path?.split(/[/\\]/).filter(Boolean).at(-1) || "工作区")))
                        : e("p", null, "请先从侧栏添加工作区。")) : null,
                notice ? e("p", { className: "ep-fate-notice", role: "status" }, notice) : null);
        }

        owner.effect(() => {
            let release_home = null;
            const sync_home = () => {
                const active = snapshot.enabled && snapshot.fate_home;
                if (active && !release_home) {
                    release_home = slots.inject("conversation.hero.brand.mark", () => slots.register({
                        name: "conversation.hero.brand.mark", id: "glass-fate-home", priority: -60,
                    }, FateHome));
                } else if (!active && release_home) {
                    release_home();
                    release_home = null;
                }
            };
            listeners.add(sync_home);
            sync_home();
            return () => { listeners.delete(sync_home); release_home?.(); };
        });
    });

    function set_state(settings) {
        if (disposed) return;
        const next = {
            enabled: settings.enabled,
            reply_identity: settings.reply_identity,
            fate_home: settings.fate_home,
            focus: settings.focus,
            assistant_name: settings.assistant_name,
        };
        if (Object.keys(next).some(key => snapshot[key] !== next[key])) {
            snapshot = next;
            listeners.forEach(notify => notify());
        }
        document.body.dataset.glassAvatar = String(settings.enabled && settings.reply_identity);
        document.body.dataset.glassCode = String(settings.enabled && settings.gold_code);
        document.body.dataset.glassSidebar = String(settings.enabled && settings.polished_sidebar);
        document.body.dataset.glassHome = String(settings.enabled && settings.fate_home);
        schedule_scan();
    }

    return {
        set_state,
        dispose() {
            disposed = true;
            observer.disconnect();
            intersection.disconnect();
            if (frame !== null) cancelAnimationFrame(frame);
            for (const [reply, header] of headers) remove_identity(reply, header);
            headers.clear();
            listeners.clear();
            for (const key of ["glassAvatar", "glassCode", "glassSidebar", "glassHome"]) delete document.body.dataset[key];
        },
    };
}

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

const STYLE_TEXT = "#glass-ambient {\n    position: fixed;\n    inset: 0;\n    z-index: 0;\n    pointer-events: none;\n    overflow: hidden;\n    background: #eee4db;\n    contain: strict;\n}\n#glass-ambient[hidden] { display: none; }\nbody[data-ds-dark-theme] #glass-ambient { background: #17151e; }\n.ep-wallpaper, .ep-video, .ep-vignette, .ep-motes, .ep-orbit { position: absolute; inset: 0; }\n.ep-wallpaper, .ep-video {\n    width: 100%;\n    height: 100%;\n    object-fit: cover;\n    object-position: 75% center;\n    opacity: var(--ep-strength, .36);\n}\n.ep-wallpaper {\n    background: radial-gradient(circle at 70% 28%, #b693d44a, #231b31 62%);\n    transition: opacity 1.2s ease;\n}\n.ep-video { opacity: 0; transition: opacity 1.2s ease; }\n[data-playing=\"true\"] .ep-video { opacity: var(--ep-strength, .36); }\n[data-playing=\"true\"] .ep-wallpaper { opacity: 0; }\n/* 用户导入的图片 / 视频壁纸：铺满窗口，模糊时向外扩张避免边缘露底 */\n#glass-ambient .ep-wallpaper-media {\n    position: absolute;\n    inset: calc(var(--ep-wallpaper-blur, 0px) * -2);\n    overflow: hidden;\n    opacity: var(--ep-wallpaper-opacity, .36);\n    filter: blur(var(--ep-wallpaper-blur, 0px));\n    transition: opacity .8s ease, filter .3s ease;\n}\n#glass-ambient .ep-wallpaper-media:empty { display: none; }\n#glass-ambient .ep-wallpaper-image,\n#glass-ambient .ep-wallpaper-video {\n    display: block;\n    width: 100%;\n    height: 100%;\n    object-fit: cover;\n    object-position: center;\n}\n#glass-ambient[data-wallpaper=\"true\"] .ep-wallpaper { opacity: 0; }\n@media (prefers-reduced-motion: reduce) {\n    #glass-ambient .ep-wallpaper-media { transition: none; }\n}\n.ep-vignette {\n    background: linear-gradient(90deg, #f3e9e1 0%, #f6f0eac9 24%, #f6f0ea85 52%, #f6f0ea18 85%),\n        linear-gradient(0deg, #f5ede6f0 0%, transparent 40%, #f7f0e9b3 100%);\n}\nbody[data-ds-dark-theme] .ep-vignette {\n    background: linear-gradient(90deg, #17151e 0%, #17151ee8 20%, #17151e9c 48%, #17151e1f 86%),\n        linear-gradient(0deg, #17151eed 0%, transparent 45%, #17151e91 100%);\n}\n.ep-orbit {\n    inset: 12% -18% auto auto;\n    width: 65vw;\n    height: 65vw;\n    border: 1px solid rgba(var(--ep-accent-rgb, 232, 197, 139), .13);\n    border-radius: 50%;\n    transform: rotate(-18deg);\n    box-shadow: 0 0 0 40px rgba(var(--ep-accent-rgb, 232, 197, 139), .025),\n        0 0 0 180px rgba(var(--ep-accent-rgb, 232, 197, 139), .025);\n}\n.ep-motes {\n    opacity: .65;\n    background-image: radial-gradient(1px 1px at 40% 18%, #eacb93 99%, transparent),\n        radial-gradient(1px 1px at 90% 64%, #f6dba7 99%, transparent),\n        radial-gradient(2px 2px at 77% 26%, #e8c58b9c 99%, transparent),\n        radial-gradient(1px 1px at 54% 72%, #e8c58b 99%, transparent),\n        radial-gradient(1px 1px at 67% 89%, #e8c58b 99%, transparent);\n    animation: ep-shimmer 8s ease-in-out infinite alternate;\n}\n.ep-signature {\n    position: absolute;\n    right: 36px;\n    top: 19%;\n    display: flex;\n    align-items: center;\n    gap: 12px;\n    color: #8b6a43;\n    opacity: .66;\n}\nbody[data-ds-dark-theme] .ep-signature { color: #ead1aa; }\n.ep-signature b { font-size: 36px; font-weight: 300; }\n.ep-signature span { font: 500 12px/1.8 Georgia, serif; letter-spacing: .3em; }\n.ep-signature small { display: block; font: 8px/1.8 \"Segoe UI\", sans-serif; letter-spacing: .2em; }\nbody[data-glass-ornaments=\"false\"] :is(.ep-orbit, .ep-motes, .ep-signature) { display: none; }\n\nbody[data-glass-theme] #root { position: relative; z-index: 1; background: transparent; }\nbody[data-glass-theme] :is(.pI_x6G_frame, .pI_x6G_centerCol, .wSkVaW_root) { background: transparent !important; }\nbody[data-glass-theme] .pI_x6G_sidebarCol {\n    background: var(--dsw-specific-sidebar-fill);\n    border-right: 1px solid rgba(var(--ep-accent-rgb), .13);\n    box-shadow: 12px 0 40px #00000008;\n}\nbody[data-glass-theme] .hHd-Xa_root { background: transparent; }\nbody[data-glass-theme] .hHd-Xa_logoRow {\n    border-bottom: 1px solid rgba(var(--ep-accent-rgb), .2);\n    margin-bottom: 10px;\n    padding-bottom: 13px;\n}\nbody[data-glass-theme] .wSkVaW_header {\n    background: #f8f1eab8;\n    backdrop-filter: blur(18px);\n    border-bottom-color: rgba(var(--ep-accent-rgb), .15);\n}\nbody[data-glass-theme][data-ds-dark-theme] .wSkVaW_header { background: #1b1723a3; }\nbody[data-glass-theme] .wSkVaW_headerBlank { background: transparent; backdrop-filter: none; }\nbody[data-glass-theme] .uV2eYG_card {\n    border: 1px solid rgba(var(--ep-accent-rgb), .27);\n    background: linear-gradient(135deg, #fffcf8f5, #f5ece4f2);\n    backdrop-filter: blur(20px);\n    box-shadow: 0 12px 40px #5d3f2920, inset 0 1px 0 #ffffff8a;\n    transition: border-color .2s, box-shadow .2s;\n}\nbody[data-glass-theme][data-ds-dark-theme] .uV2eYG_card {\n    background: linear-gradient(135deg, #312736f5, #241e2cf5);\n    box-shadow: 0 16px 48px #08060d52, inset 0 1px 0 #f7d6ad0c;\n}\nbody[data-glass-theme] .uV2eYG_card:focus-within {\n    border-color: rgba(var(--ep-accent-rgb), .65);\n    box-shadow: 0 12px 42px #09060d35, 0 0 0 3px rgba(var(--ep-accent-rgb), .06);\n}\nbody[data-glass-theme] .uV2eYG_primary {\n    background: linear-gradient(145deg, #d4ac70, #89633d);\n    box-shadow: 0 3px 12px #b6894a24;\n}\nbody[data-glass-theme=\"violet\"] .uV2eYG_primary { background: linear-gradient(145deg, #ac8bd0, #70548e); }\nbody[data-glass-theme=\"rose\"] .uV2eYG_primary { background: linear-gradient(145deg, #d693a9, #9d5d75); }\nbody[data-glass-theme] .wSkVaW_composerSeat { background: transparent; }\nbody[data-glass-theme] .wSkVaW_composerSeat::before { background: transparent; }\nbody[data-glass-theme] pre { border: 1px solid rgba(var(--ep-accent-rgb), .14); }\nbody[data-glass-theme] ::selection { background: #bf9a6852; }\nbody[data-glass-theme][data-glass-focus=\"true\"] .pI_x6G_frame { background: var(--dsw-alias-bg-base) !important; }\nbody[data-glass-theme][data-glass-focus=\"true\"] .wSkVaW_header { backdrop-filter: none; }\nbody[data-glass-theme][data-glass-focus=\"true\"] .uV2eYG_card { backdrop-filter: none; }\n\nbody[data-glass-theme] {\n    --ep-input-gold: #80581a;\n    --ep-glass-fill: #fffcf78a;\n    --ep-glass-rim: #ffffffab;\n    --ep-glass-shadow: #5a3b2924;\n    --ep-glass-inner: #ffffff9c;\n    --ep-glass-sheen: #ffffff75;\n    --ep-glass-lens: #ffffff70;\n}\nbody[data-glass-theme][data-ds-dark-theme] {\n    --ep-input-gold: #f4d392;\n    --ep-glass-fill: #29223280;\n    --ep-glass-rim: #f7e5d548;\n    --ep-glass-shadow: #09061152;\n    --ep-glass-inner: #fff4e42e;\n    --ep-glass-sheen: #ffffff19;\n    --ep-glass-lens: #fff5df1c;\n}\nbody[data-glass-theme] :is(.uV2eYG_input, [contenteditable=\"true\"][role=\"textbox\"]) {\n    color: var(--ep-input-gold);\n    caret-color: var(--ep-input-gold);\n    -webkit-text-fill-color: var(--ep-input-gold);\n}\nbody[data-glass-theme] :is(.uV2eYG_input, [contenteditable=\"true\"][role=\"textbox\"]) [data-lexical-text=\"true\"] {\n    color: inherit;\n    -webkit-text-fill-color: inherit;\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] :is(.uV2eYG_card, .Sixlwa_bubble, .oRe1gG_bubble, .ROF66W_bubble, .hWmORq_root) {\n    position: relative;\n    border: 1px solid var(--ep-glass-rim);\n    border-radius: 24px;\n    background:\n        radial-gradient(ellipse at var(--ep-light-x, 18%) var(--ep-light-y, 0%), var(--ep-glass-lens), transparent 68%),\n        linear-gradient(145deg, var(--ep-glass-sheen), transparent 38%, #c3a4ee08 76%, #f6d6a512),\n        var(--ep-glass-fill);\n    -webkit-backdrop-filter: blur(24px) saturate(155%) brightness(1.05);\n    backdrop-filter: blur(24px) saturate(155%) brightness(1.05);\n    box-shadow:\n        inset 0 1px 0 var(--ep-glass-inner),\n        inset 1px 0 0 #ffffff0c,\n        inset 0 -1px 0 #ffffff13,\n        inset 0 0 16px #ffffff06,\n        0 10px 34px var(--ep-glass-shadow);\n    transition: border-color .2s ease, box-shadow .2s ease;\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] :is(.uV2eYG_card, .Sixlwa_bubble, .hWmORq_root)::before {\n    content: \"\";\n    position: absolute;\n    inset: -1px;\n    z-index: 1;\n    padding: 1px;\n    border-radius: inherit;\n    background: linear-gradient(135deg, #fff5e7cc, #ffffff0a 25%, #ffffff04 65%, #ead8ff66 88%, #ffe5ba8c);\n    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);\n    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);\n    -webkit-mask-composite: xor;\n    mask-composite: exclude;\n    pointer-events: none;\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] .uV2eYG_card {\n    --ep-glass-fill: #fffbf58c;\n    border-radius: 25px;\n}\nbody[data-glass-theme][data-ds-dark-theme][data-glass-glass=\"true\"] .uV2eYG_card { --ep-glass-fill: #2c243485; }\nbody[data-glass-theme][data-glass-glass=\"true\"] .uV2eYG_card:focus-within {\n    border-color: rgba(var(--ep-accent-rgb), .7);\n    box-shadow: inset 0 1px 0 #fff1df4d, inset 0 0 20px #fff1df06, 0 12px 40px var(--ep-glass-shadow), 0 0 0 3px rgba(var(--ep-accent-rgb), .07);\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] :is(.Sixlwa_bubble, .oRe1gG_bubble, .ROF66W_bubble) {\n    color: var(--ep-input-gold);\n    border-radius: 22px 22px 8px 22px;\n    padding: 13px 18px;\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] .hWmORq_root {\n    padding: 20px 24px;\n    margin: 6px 0 12px;\n    min-width: 0;\n    --ep-glass-fill: #fffaf5a6;\n    --ep-glass-lens: #ffffff3d;\n}\nbody[data-glass-theme][data-ds-dark-theme][data-glass-glass=\"true\"] .hWmORq_root {\n    --ep-glass-fill: #211c2b9c;\n    --ep-glass-lens: #fff5df0e;\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] .hWmORq_root .hWmORq_actions { margin-bottom: -4px; }\nbody[data-glass-theme][data-glass-glass=\"true\"] .hWmORq_root pre { background: var(--dsw-alias-markdown-code-block); }\nbody[data-glass-theme][data-glass-glass=\"true\"] :is(.re-model-menu, .ep-panel) {\n    background: linear-gradient(135deg, #ffffff0e, #ffffff02 55%, #f2d4a90a), #292231b8;\n    backdrop-filter: blur(32px) saturate(155%);\n    -webkit-backdrop-filter: blur(32px) saturate(155%);\n    border-color: #fff1db45;\n    box-shadow: inset 0 1px 0 #fff1db30, inset 0 -1px 0 #dbccff1c, 0 22px 70px #08050f59;\n}\nbody[data-glass-theme]:not([data-ds-dark-theme])[data-glass-glass=\"true\"] .re-model-menu {\n    background: linear-gradient(135deg, #ffffff80, #fff7ef24), #faf1e5ba;\n    border-color: #ffffffb3;\n}\nbody[data-glass-theme][data-glass-glass=\"true\"][data-glass-focus=\"true\"] :is(.uV2eYG_card, .Sixlwa_bubble, .oRe1gG_bubble, .ROF66W_bubble, .hWmORq_root) {\n    background: var(--dsw-alias-bg-layer-1);\n    -webkit-backdrop-filter: none;\n    backdrop-filter: none;\n}\nbody[data-glass-theme][data-glass-focus=\"true\"] :is(.uV2eYG_card, .Sixlwa_bubble, .hWmORq_root)::before { display: none; }\n@supports not (backdrop-filter: blur(1px)) {\n    body[data-glass-theme][data-glass-glass=\"true\"] :is(.uV2eYG_card, .Sixlwa_bubble, .oRe1gG_bubble, .ROF66W_bubble, .hWmORq_root) { background: var(--dsw-alias-bg-layer-1); }\n}\n@media (prefers-reduced-transparency: reduce) {\n    body[data-glass-theme][data-glass-glass=\"true\"] :is(.uV2eYG_card, .Sixlwa_bubble, .oRe1gG_bubble, .ROF66W_bubble, .hWmORq_root, .re-model-menu) {\n        background: var(--dsw-alias-bg-layer-1);\n        -webkit-backdrop-filter: none;\n        backdrop-filter: none;\n    }\n}\n@media (max-width: 760px) {\n    body[data-glass-theme][data-glass-glass=\"true\"] :is(.uV2eYG_card, .Sixlwa_bubble, .hWmORq_root) {\n        -webkit-backdrop-filter: blur(14px) saturate(135%);\n        backdrop-filter: blur(14px) saturate(135%);\n    }\n    body[data-glass-theme][data-glass-glass=\"true\"] .hWmORq_root { padding: 16px; }\n}\n@media (prefers-reduced-motion: reduce) {\n    body[data-glass-theme][data-glass-glass=\"true\"] :is(.uV2eYG_card, .Sixlwa_bubble, .hWmORq_root) { transition: none; }\n}\n\n#glass-theme-ui {\n    --ep-ui-bg: #241e2c;\n    --ep-ui-panel: #2d2434;\n    --ep-ui-text: #f6eee5;\n    --ep-ui-muted: #b7a5b5;\n    font-family: \"Segoe UI\", \"Microsoft YaHei\", sans-serif;\n    color: var(--ep-ui-text);\n}\n.ep-theme-launcher {\n    position: fixed;\n    z-index: 24;\n    top: calc(var(--dsh-windows-titlebar-height, 0px) + 13px);\n    right: 144px;\n    display: flex;\n    align-items: center;\n    gap: 7px;\n    padding: 6px 10px;\n    border: 1px solid #b491622e;\n    border-radius: 8px;\n    background: #f1e6dbe8;\n    color: #805d36;\n    font: 12px/16px \"Microsoft YaHei\", sans-serif;\n    cursor: pointer;\n    box-shadow: 0 3px 12px #281c1710;\n}\nbody[data-ds-dark-theme] .ep-theme-launcher { background: #2c2431eb; color: #e8c58b; }\n.ep-theme-launcher:hover { border-color: #d2ad72b3; }\n#glass-theme-ui[data-enabled=\"false\"] .ep-theme-launcher { filter: grayscale(1); opacity: .75; }\n#glass-theme-ui button:focus-visible, #glass-theme-ui input:focus-visible {\n    outline: 2px solid #f1ce98;\n    outline-offset: 4px;\n}\n.ep-panel {\n    box-sizing: border-box;\n    position: fixed;\n    inset: 0;\n    width: min(820px, calc(100vw - 40px));\n    max-height: calc(100dvh - 48px);\n    border: 1px solid #c19a6c42;\n    border-radius: 22px;\n    padding: 0;\n    color: #f6eee5;\n    background: #241e2c;\n    overflow: auto;\n    box-shadow: 0 40px 120px #00000088;\n}\n.ep-panel[open] { display: grid; grid-template-columns: 31% 1fr; }\n.ep-panel::backdrop { background: #100c17b3; }\n.ep-panel form { position: absolute; inset: 0 0 auto auto; z-index: 1; }\n.ep-close {\n    margin: 12px;\n    width: 30px;\n    height: 30px;\n    border: 1px solid #dec49e22;\n    border-radius: 50%;\n    background: #ffffff06;\n    color: #cdbecb;\n    font: 22px/26px \"Segoe UI\", sans-serif;\n    cursor: pointer;\n}\n.ep-panel-art {\n    position: relative;\n    min-height: 530px;\n    border-right: 1px solid #d7b17b20;\n    background: linear-gradient(0deg, #211923f5, #21192310 75%),\n        radial-gradient(circle at 70% 28%, #b693d44a, #231b31 62%);\n}\n.ep-panel-art > span { position: absolute; top: 30px; left: 24px; color: #fff2dfaa; font: 11px Georgia, serif; letter-spacing: .38em; }\n.ep-panel-art > div { position: absolute; bottom: 34px; left: 24px; font: 28px/1.5 Georgia, \"Microsoft YaHei\", serif; letter-spacing: .15em; }\n.ep-panel-art small { display: block; font: 8px/2.2 \"Segoe UI\", sans-serif; letter-spacing: .2em; color: #dcbf95; }\n.ep-panel-content { padding: 34px 30px 22px; min-width: 0; }\n.ep-eyebrow { margin: 0 0 12px; font: 9px/1.5 \"Segoe UI\", sans-serif; letter-spacing: .18em; color: #d5b585; }\n.ep-panel h2 { margin: 0; font: 500 23px/1.5 Georgia, \"Microsoft YaHei\", serif; letter-spacing: .02em; }\n.ep-panel-intro { margin: 8px 0 24px; color: #baa9b7; font-size: 11px; line-height: 1.8; }\n.ep-section-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-size: 12px; }\n.ep-section-title > span { color: #a08d9e; font-size: 10px; }\n.ep-palettes { display: flex; gap: 7px; margin: 12px 0 22px; }\n.ep-palettes button {\n    flex: 1;\n    min-width: 0;\n    border: 1px solid #ae8b9c33;\n    border-radius: 10px;\n    padding: 12px 4px 9px;\n    background: #ffffff03;\n    color: #bca9b9;\n    font: 10px/1.6 \"Microsoft YaHei\", sans-serif;\n    cursor: pointer;\n}\n.ep-palettes button[aria-pressed=\"true\"] { border-color: #d4ae74; color: #f0d1a3; background: #d4ae7410; }\n.ep-palettes i { display: block; width: 20px; height: 20px; margin: 0 auto 6px; border-radius: 50%; background: linear-gradient(135deg, #f2d49d, #936f48); }\n.ep-palettes [data-palette=\"violet\"] i { background: linear-gradient(135deg, #ddc4ff, #725390); }\n.ep-palettes [data-palette=\"rose\"] i { background: linear-gradient(135deg, #f7d8df, #b77c90); }\n.ep-range-label { display: flex; justify-content: space-between; font-size: 12px; }\n.ep-range-label output { font: 11px \"Segoe UI\", sans-serif; color: #d8b886; }\n#ep-strength { width: 100%; margin: 12px 0 14px; accent-color: #d6b37e; height: 4px; cursor: pointer; }\n.ep-setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid #ffffff08; cursor: pointer; font-size: 12px; }\n.ep-setting small { display: block; margin-top: 5px; color: #ac98ab; font-size: 10px; }\n.ep-setting input, .ep-panel-footer input { accent-color: #d6b37e; width: 15px; height: 15px; cursor: pointer; flex: none; }\n.ep-panel-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-top: 20px; color: #d3c2cf; font-size: 11px; }\n.ep-panel-footer label { display: flex; gap: 7px; align-items: center; cursor: pointer; }\n.ep-panel-footer button { border: 0; color: #b8a2b3; background: none; font: inherit; cursor: pointer; padding: 4px; }\n.ep-settings-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; gap: 16px; }\n.ep-settings-row strong { font-size: 13px; font-weight: 500; }\n.ep-settings-row small { display: block; margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }\n.ep-settings-row button { color: var(--dsw-alias-state-business-primary); border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); border-radius: 8px; padding: 7px 12px; cursor: pointer; }\nbody[data-glass-gpt-slider=\"true\"] .re-model-menu {\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 16px;\n    box-shadow: 0 12px 42px #00000030;\n}\nbody[data-glass-gpt-slider=\"true\"] .re-advanced { padding: 18px 18px 16px; }\nbody[data-glass-gpt-slider=\"true\"] .re-effort[data-ep-gpt-effort] {\n    display: flex;\n    flex-direction: column;\n    align-items: stretch;\n    gap: 0;\n    height: auto;\n    padding: 0;\n}\n.ep-gpt-effort-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; font: 500 13px/20px \"Segoe UI\", \"Microsoft YaHei\", sans-serif; color: var(--dsw-alias-label-primary); }\n.ep-gpt-effort-value { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; }\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-slider {\n    flex: none;\n    width: 100%;\n    height: 32px;\n    margin: 13px 0 0;\n    border-radius: 0;\n    isolation: isolate;\n    filter: none;\n}\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-track {\n    inset: 14px 8px auto;\n    height: 4px;\n    overflow: visible;\n    border: 0;\n    border-radius: 999px;\n    background: linear-gradient(to right, var(--dsw-alias-label-primary) 0 var(--re-progress), var(--dsw-alias-border-l2) var(--re-progress) 100%);\n    box-shadow: none;\n    animation: none;\n}\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-track::before,\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-track::after,\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-fx { display: none; }\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-knob {\n    z-index: 4;\n    left: clamp(8px, var(--re-progress), calc(100% - 8px));\n    top: 50%;\n    width: 18px;\n    height: 18px;\n    border: 1px solid #b5b5b54d;\n    border-radius: 50%;\n    background: #ffffff;\n    corner-shape: round;\n    background-image: none;\n    box-shadow: 0 1px 5px #00000030 !important;\n    filter: none;\n    animation: none;\n    transform: translate(-50%, -50%);\n    transition: left .12s ease, box-shadow .12s ease;\n}\nbody[data-glass-gpt-slider=\"true\"] .re-effort.is-dragging .re-effort-knob {\n    transform: translate(-50%, -50%) scale(1.08);\n    transition: none;\n}\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-input {\n    z-index: 5;\n    inset: 0;\n    height: 32px;\n    cursor: pointer;\n}\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-input:active { cursor: grabbing; }\nbody[data-glass-gpt-slider=\"true\"] .re-effort .re-effort-input:focus-visible + .re-effort-knob { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 3px; }\n.ep-gpt-effort-ticks { position: absolute; inset: 0; pointer-events: none; z-index: 2; }\n.ep-gpt-effort-ticks span { position: absolute; top: 50%; width: 7px; height: 7px; transform: translate(-50%, -50%); border-radius: 50%; corner-shape: round; background: var(--dsw-alias-border-l2); }\n.ep-gpt-effort-ticks span[data-selected=\"true\"] { background: var(--dsw-alias-label-primary); }\n.ep-gpt-effort-footer { display: flex; justify-content: space-between; color: var(--dsw-alias-label-tertiary); font: 10px/18px \"Segoe UI\", \"Microsoft YaHei\", sans-serif; padding-top: 1px; }\nbody[data-glass-gpt-slider=\"true\"] :is(.re-model-effort, .re-model-row-effort, .re-model-check) { color: var(--dsw-alias-state-business-primary); }\n@keyframes ep-shimmer { from { opacity: .28; transform: translateY(0); } to { opacity: .7; transform: translateY(-10px); } }\n@media (prefers-reduced-motion: reduce) {\n    .ep-motes { animation: none; }\n    .ep-video, .ep-wallpaper { transition: none; }\n}\n@media (max-width: 1000px) {\n    .ep-theme-launcher { right: 112px; width: 28px; height: 28px; justify-content: center; padding: 0; }\n    .ep-launcher-label { display: none; }\n    .ep-signature { display: none; }\n}\n@media (max-width: 760px) {\n    .ep-wallpaper { background-position: 77% center; opacity: calc(var(--ep-strength, .36) * .65); }\n    .ep-panel[open] { grid-template-columns: 1fr; }\n    .ep-panel-art { display: none; }\n    .ep-panel-content { padding: 36px 22px 24px; }\n    .ep-panel { width: min(460px, calc(100vw - 24px)); }\n    .ep-panel h2 { font-size: 21px; }\n}\n\n.ep-enhancement-settings { margin-top: 16px; border: 1px solid #dec49e22; border-radius: 10px; padding: 0 12px; }\n.ep-enhancement-settings summary { padding: 11px 0; cursor: pointer; color: #dec49e; font: 11px/1.6 \"Microsoft YaHei\", sans-serif; }\n.ep-enhancement-settings .ep-setting:last-child { border: 0; }\n.ep-character-avatar {\n    display: inline-block;\n    position: relative;\n    flex: none;\n    width: 38px;\n    height: 38px;\n    border: 1px solid #f0d0a49c;\n    border-radius: 50%;\n    corner-shape: round;\n    overflow: hidden;\n    background: #3c2c38;\n    box-shadow: 0 0 0 3px #e8c58b0a, 0 3px 12px #10091424;\n}\n.ep-character-avatar::before {\n    content: \"\";\n    position: absolute;\n    inset: 0;\n    background: radial-gradient(circle at 70% 28%, #b693d44a, #231b31 62%);\n    transform: rotate(-32deg);\n}\n.ep-reply-identity { display: flex; align-items: center; gap: 11px; margin: -1px 0 19px; min-height: 38px; }\nbody[data-glass-custom-avatar=\"true\"] .ep-character-avatar::before {\n    background: var(--glass-avatar-image) center / cover no-repeat;\n    transform: none;\n}\n.ep-avatar-settings { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 14px 0; margin-bottom: 18px; border-bottom: 1px solid #dec49e22; }\n.ep-avatar-settings strong { font-size: 12px; }\n.ep-assistant-name { display: flex; align-items: center; gap: 10px; width: 100%; color: #d3c2cf; font-size: 12px; }\n.ep-assistant-name input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #dec49e33; border-radius: 8px; background: #ffffff05; color: #f0d1a3; font: inherit; }\n.ep-avatar-settings small { display: block; margin-top: 5px; font-size: 10px; color: #baa9b7; }\n.ep-avatar-actions { display: flex; flex-wrap: wrap; gap: 8px; }\n.ep-avatar-actions button { border: 1px solid #d4ae7455; background: #d4ae7410; color: #f0d1a3; border-radius: 8px; padding: 8px 12px; cursor: pointer; font: 12px/1.5 \"Microsoft YaHei\", sans-serif; }\n.ep-avatar-actions button:disabled { opacity: .4; cursor: default; }\n.ep-avatar-status { width: 100%; margin: 0; font: 11px/1.6 \"Microsoft YaHei\", sans-serif; color: #e8c58b; }\n.ep-avatar-status:empty { display: none; }\n.ep-wallpaper-section { margin-bottom: 20px; }\n.ep-wallpaper-settings { margin-top: 12px; padding: 14px; border: 1px solid #dec49e22; border-radius: 12px; background: #ffffff04; }\n.ep-wallpaper-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }\n.ep-wallpaper-current strong { display: block; font-size: 12px; }\n.ep-wallpaper-current small { display: block; margin-top: 5px; font-size: 10px; color: #baa9b7; overflow-wrap: anywhere; }\n.ep-wallpaper-settings .ep-range-label { margin-top: 14px; }\n.ep-wallpaper-settings input[type=\"range\"] { width: 100%; height: 4px; margin: 9px 0 2px; accent-color: #d6b37e; cursor: pointer; }\n.ep-wallpaper-fit { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; font-size: 12px; }\n.ep-wallpaper-fit select { border: 1px solid #dec49e33; border-radius: 8px; background: #2a2231; color: #f0d1a3; padding: 6px 10px; font: 12px/1.5 \"Microsoft YaHei\", sans-serif; cursor: pointer; }\n.ep-wallpaper-video { margin-top: 4px; padding-top: 4px; border-top: 1px dashed #dec49e22; }\n.ep-wallpaper-video[hidden] { display: none; }\n.ep-wallpaper-status { margin: 10px 0 0; font: 11px/1.6 \"Microsoft YaHei\", sans-serif; color: #e8c58b; }\n.ep-wallpaper-status:empty { display: none; }\n.ep-avatar-crop { width: min(390px, calc(100vw - 48px)); max-height: calc(100dvh - 48px); box-sizing: border-box; overflow: auto; padding: 26px; border: 1px solid #d4ae7460; border-radius: 20px; background: #211c2af5; color: #f4ece4; box-shadow: 0 30px 120px #0009; backdrop-filter: blur(24px); }\n.ep-avatar-crop::backdrop { background: #100c17b3; }\n.ep-avatar-crop h2 { font: 500 20px/1.5 \"Microsoft YaHei\", sans-serif; margin: 0; }\n.ep-avatar-crop p { font: 11px/1.7 \"Microsoft YaHei\", sans-serif; color: #c4b3bf; }\n.ep-avatar-crop canvas { display: block; width: min(256px, 100%); height: auto; margin: 20px auto; border-radius: 50%; outline: 2px solid #e8c58b88; outline-offset: 3px; background: #342a3e; cursor: grab; touch-action: none; }\n.ep-avatar-crop canvas:active { cursor: grabbing; }\n.ep-avatar-crop label { display: grid; grid-template-columns: 80px 1fr; align-items: center; gap: 10px; margin: 14px 0; font: 12px/1.6 \"Microsoft YaHei\", sans-serif; }\n.ep-avatar-crop input { width: 100%; accent-color: #e8c58b; }\n.ep-avatar-crop .ep-avatar-actions { justify-content: flex-end; margin-top: 22px; }\n.ep-reply-name { color: var(--ep-input-gold); font: 500 13px/1.7 \"Microsoft YaHei\", sans-serif; letter-spacing: .04em; }\n.ep-reply-star { margin-left: auto; color: var(--dsw-alias-state-business-primary); opacity: .65; font-size: 20px; }\nbody[data-glass-avatar=\"true\"] .hWmORq_root[data-ep-reply-entered=\"true\"] { animation: ep-reply-arrive .42s cubic-bezier(.2,.7,.2,1) both; }\nbody[data-glass-avatar=\"true\"] .hWmORq_root[data-ep-reply-streaming=\"true\"] .ep-character-avatar { animation: ep-avatar-breathe 2.4s ease-in-out infinite; }\nbody[data-glass-avatar=\"true\"] .hWmORq_root[data-ep-reply-streaming=\"true\"] .ep-reply-star { animation: ep-star-breathe 2.4s ease-in-out infinite; }\n@keyframes ep-reply-arrive { from { opacity: .45; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }\n@keyframes ep-avatar-breathe { 0%,100% { box-shadow: 0 0 0 3px #e8c58b0a, 0 3px 12px #10091424; } 50% { box-shadow: 0 0 0 5px #e8c58b13, 0 0 20px #e8c58b24; } }\n@keyframes ep-star-breathe { 0%,100% { opacity: .35; } 50% { opacity: .95; } }\n\nbody[data-glass-code=\"true\"] {\n    --shiki-foreground: #49384f;\n    --shiki-background: #f2e9e1;\n    --shiki-token-constant: #855a1a;\n    --shiki-token-string: #886426;\n    --shiki-token-comment: #88778c;\n    --shiki-token-keyword: #7b4598;\n    --shiki-token-parameter: #805a4f;\n    --shiki-token-function: #8e6724;\n    --shiki-token-string-expression: #7c5a25;\n    --shiki-token-punctuation: #7a6582;\n    --shiki-token-link: #8056a3;\n}\nbody[data-glass-code=\"true\"][data-ds-dark-theme] {\n    --shiki-foreground: #eee2ee;\n    --shiki-background: #201928;\n    --shiki-token-constant: #f0cf92;\n    --shiki-token-string: #d9bd8f;\n    --shiki-token-comment: #9e87ac;\n    --shiki-token-keyword: #d0a9f1;\n    --shiki-token-parameter: #edc4bf;\n    --shiki-token-function: #efcf95;\n    --shiki-token-string-expression: #e5c595;\n    --shiki-token-punctuation: #bfa9cf;\n    --shiki-token-link: #cfb1ec;\n}\nbody[data-glass-code=\"true\"] pre { border: 1px solid #bc91d22e; border-radius: 14px; box-shadow: inset 0 1px 0 #ffffff08, 0 10px 26px #09051114; }\nbody[data-glass-code=\"true\"] [data-code-block-banner] { border-bottom: 1px solid #c9a07224; color: var(--dsw-alias-label-secondary); background: linear-gradient(90deg, #aa7dba16, #c8a16d12), var(--dsw-alias-markdown-code-block-banner); }\nbody[data-glass-code=\"true\"] pre code { font-variant-ligatures: none; }\nbody[data-glass-theme][data-glass-glass=\"true\"] .hWmORq_root .md-table-wide {\n    --dsh-table-spare: 0px;\n    --dsh-table-lead: 0px;\n    box-sizing: border-box;\n    width: 100%;\n    max-width: 100%;\n    margin-left: 0;\n    padding-left: 0;\n    overflow-x: auto;\n}\nbody[data-glass-code=\"true\"] :is(.syntax-purple) { color: var(--shiki-token-keyword); }\nbody[data-glass-code=\"true\"] :is(.syntax-gold) { color: var(--shiki-token-function); }\nbody[data-glass-code=\"true\"] :is(.syntax-green) { color: var(--shiki-token-string); }\n\nbody[data-glass-sidebar=\"true\"] .pI_x6G_sidebarCol {\n    background: linear-gradient(160deg, #c6a0700a, transparent 42%, #9b71ac0a), var(--dsw-specific-sidebar-fill);\n    box-shadow: inset -1px 0 0 #ffffff05, 12px 0 42px #07040d0f;\n}\nbody[data-glass-sidebar=\"true\"] .hHd-Xa_newSession {\n    border: 1px solid rgba(var(--ep-accent-rgb), .32);\n    background: linear-gradient(135deg, rgba(var(--ep-accent-rgb), .13), #c8a3ed08);\n    box-shadow: inset 0 1px 0 #ffffff0d;\n    color: var(--dsw-alias-state-business-primary);\n    border-radius: 12px;\n}\nbody[data-glass-sidebar=\"true\"] .hHd-Xa_newSession:hover { background: linear-gradient(135deg, rgba(var(--ep-accent-rgb), .22), #c8a3ed14); }\nbody[data-glass-sidebar=\"true\"] [data-row-key^=\"session:\"] { border-radius: 10px; transition: background .18s, box-shadow .18s; }\nbody[data-glass-sidebar=\"true\"] [data-row-key^=\"session:\"]:hover { background: linear-gradient(90deg, rgba(var(--ep-accent-rgb), .07), #c5a0ee06); }\nbody[data-glass-sidebar=\"true\"] [data-row-key^=\"session:\"][aria-selected=\"true\"] {\n    background: linear-gradient(95deg, rgba(var(--ep-accent-rgb), .16), rgba(var(--ep-accent-rgb), .035));\n    box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary), inset 0 1px 0 #ffffff06;\n}\nbody[data-glass-sidebar=\"true\"] .YDXeBa_projectRow { color: var(--dsw-alias-label-primary); border-radius: 9px; }\nbody[data-glass-sidebar=\"true\"] :is(.YDXeBa_folder, .YDXeBa_pinIndicator) { color: var(--dsw-alias-state-business-primary); opacity: .82; }\nbody[data-glass-sidebar=\"true\"] .YDXeBa_time { opacity: .74; font-variant-numeric: tabular-nums; }\nbody[data-glass-sidebar=\"true\"] .hHd-Xa_logoRow { border-image: linear-gradient(90deg, #c9a17000, #c9a17066, #c9a17000) 1; }\n\n.ep-fate-home { width: 100%; min-width: 0; color: var(--dsw-alias-label-primary); padding-bottom: 8px; }\n.ep-fate-heading { display: flex; align-items: center; gap: 15px; margin-bottom: 25px; }\n.ep-home-avatar { width: 52px; height: 52px; box-shadow: 0 0 0 5px #e8c58b09, 0 0 30px #e8c58b0c; }\n.ep-fate-heading p { color: var(--dsw-alias-state-business-primary); font: 9px/1.5 \"Segoe UI\", sans-serif; letter-spacing: .2em; margin: 0 0 7px; }\n.ep-fate-heading h1 { font: 500 clamp(19px, 2vw, 27px)/1.5 Georgia, \"Microsoft YaHei\", serif; letter-spacing: .03em; margin: 0; }\n.ep-fate-heading small { display: block; margin-top: 7px; color: var(--dsw-alias-label-secondary); font: 11px/1.7 \"Microsoft YaHei\", sans-serif; }\n.ep-fate-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }\n.ep-fate-card {\n    position: relative;\n    min-width: 0;\n    height: 167px;\n    border: 1px solid #b7946245;\n    border-radius: 16px;\n    padding: 16px 15px 15px;\n    color: var(--dsw-alias-label-primary);\n    background: radial-gradient(ellipse at 50% 0, #d6af7624, transparent 74%), linear-gradient(145deg, #ffffff0d, #ffffff02), #261e2db8;\n    backdrop-filter: blur(18px);\n    box-shadow: inset 0 1px 0 #fff0d41a, 0 8px 26px #0a06131a;\n    cursor: pointer;\n    text-align: left;\n    transition: transform .2s, border-color .2s, box-shadow .2s;\n    overflow: hidden;\n}\nbody:not([data-ds-dark-theme]) .ep-fate-card { background: radial-gradient(ellipse at 50% 0, #d6af7624, transparent 74%), #fff9efc7; }\n.ep-fate-recent { background: radial-gradient(ellipse at 50% 0, #ba8de12b, transparent 74%), linear-gradient(145deg, #ffffff0d, #ffffff02), #261e2db8; border-color: #b396d14a; }\n.ep-fate-workspace { background: radial-gradient(ellipse at 50% 0, #dfb6bb29, transparent 74%), linear-gradient(145deg, #ffffff0d, #ffffff02), #261e2db8; border-color: #cea1ad45; }\n.ep-fate-card::before { content: \"\"; position: absolute; inset: 6px; border: 1px solid #d3b48513; border-radius: 12px; pointer-events: none; }\n.ep-fate-card:hover:not(:disabled) { transform: translateY(-4px); border-color: #e6c48eab; box-shadow: inset 0 1px 0 #fff0d426, 0 12px 30px #0a061326, 0 0 20px #d3b4850b; }\n.ep-fate-card:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 4px; }\n.ep-fate-card:disabled { opacity: .48; cursor: default; }\n.ep-fate-number { position: absolute; top: 14px; right: 15px; color: #cbb1867d; font: 11px Georgia, serif; }\n.ep-fate-sigil { display: block; color: #edcd94; font: 34px/1.2 Georgia, serif; margin: 8px 0 23px; text-shadow: 0 0 20px #e8c58b20; }\n.ep-fate-recent .ep-fate-sigil { color: #c9a6e8; }\n.ep-fate-workspace .ep-fate-sigil { color: #ddb2bc; }\n.ep-fate-card strong { display: block; font: 500 12px/1.6 \"Microsoft YaHei\", sans-serif; letter-spacing: .04em; }\n.ep-fate-card small { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 6px; color: var(--dsw-alias-label-tertiary); font: 9px/1.6 \"Microsoft YaHei\", sans-serif; }\n.ep-fate-corner { position: absolute; right: 15px; bottom: 15px; color: #bfa27b52; font-size: 13px; }\n.ep-fate-workspaces { margin-top: 13px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-specific-menu); max-height: 210px; overflow-y: auto; }\n.ep-fate-picker-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 6px 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }\n.ep-fate-picker-heading button { background: none; border: 0; color: inherit; cursor: pointer; font-size: 18px; }\n.ep-fate-project { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 8px; background: none; color: var(--dsw-alias-label-primary); border: 0; border-radius: 7px; cursor: pointer; font: 12px \"Microsoft YaHei\", sans-serif; text-align: left; }\n.ep-fate-project:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.ep-fate-project > span:first-child { color: var(--dsw-alias-state-business-primary); }\n.ep-fate-notice { color: var(--dsw-alias-label-secondary); font-size: 12px; }\nbody[data-glass-home=\"true\"] .wSkVaW_composerHero:has(.ep-fate-home) { gap: 16px; }\nbody[data-glass-home=\"true\"] .pXSMma_root:has(.ep-fate-home) { height: auto; min-height: 0; padding: 0; margin-bottom: 8px; }\nbody[data-glass-home=\"true\"] .pXSMma_stack:has(.ep-fate-home) { gap: 0; width: 100%; }\nbody[data-glass-home=\"true\"] .pXSMma_headline:has(.ep-fate-home) { display: block; width: 100%; }\nbody[data-glass-home=\"true\"] .pXSMma_headline:has(.ep-fate-home) .pXSMma_titleGroup { display: none; }\nbody[data-glass-home=\"true\"] .pXSMma_fishHitbox:has(.ep-fate-home) { display: contents; }\nbody[data-glass-home=\"true\"] [data-slot=\"conversation.hero.brand.mark\"]:has(.ep-fate-home) { display: block; min-width: 0; width: 100%; }\n@media (max-width: 760px) {\n    .ep-fate-cards { gap: 8px; }\n    .ep-fate-card { height: 148px; padding: 14px 10px; }\n    .ep-fate-card strong { font-size: 10px; letter-spacing: 0; }\n    .ep-fate-card small { font-size: 8px; }\n    .ep-fate-heading { gap: 12px; margin-bottom: 18px; }\n    .ep-home-avatar { width: 42px; height: 42px; }\n    .ep-fate-heading p { font-size: 8px; letter-spacing: .12em; }\n    .ep-fate-heading small { font-size: 10px; }\n    .ep-fate-sigil { font-size: 28px; margin-bottom: 20px; }\n}\n@media (prefers-reduced-motion: reduce) {\n    body[data-glass-avatar=\"true\"] .hWmORq_root[data-ep-reply-entered=\"true\"],\n    body[data-glass-avatar=\"true\"] .hWmORq_root[data-ep-reply-streaming=\"true\"] :is(.ep-character-avatar, .ep-reply-star) { animation: none; }\n    .ep-fate-card { transition: none; }\n    .ep-fate-card:hover:not(:disabled) { transform: none; }\n}\nbody[data-glass-focus=\"true\"] .hWmORq_root[data-ep-reply-entered=\"true\"],\nbody[data-glass-focus=\"true\"] .hWmORq_root[data-ep-reply-streaming=\"true\"] :is(.ep-character-avatar, .ep-reply-star) { animation: none; }\n\nbody[data-glass-theme] {\n    --ep-overlay-fill: linear-gradient(145deg, #fffdf8e8, #f2e6f3e0);\n    --ep-overlay-edge: #aa80564a;\n    --ep-overlay-shadow: 0 18px 60px #28142d24, inset 0 1px 0 #ffffffa8;\n    scrollbar-color: #a5805299 transparent;\n    scrollbar-width: thin;\n}\nbody[data-glass-theme][data-ds-dark-theme] {\n    --ep-overlay-fill: linear-gradient(145deg, #302838ed, #211c2be8);\n    --ep-overlay-edge: #dab87f45;\n    --ep-overlay-shadow: 0 18px 60px #09061066, inset 0 1px 0 #fff1d51a;\n    scrollbar-color: #c6a17088 transparent;\n}\nbody[data-glass-theme] * { scrollbar-width: thin; scrollbar-color: inherit; }\nbody[data-glass-theme] ::selection { background: #bc965c55; color: var(--dsw-alias-label-primary); }\nbody[data-glass-theme] ::-webkit-scrollbar { width: 8px; height: 8px; }\nbody[data-glass-theme] ::-webkit-scrollbar-track { background: transparent; }\nbody[data-glass-theme] ::-webkit-scrollbar-thumb {\n    min-height: 32px;\n    border: 2px solid transparent;\n    border-radius: 8px;\n    background: #b9916080;\n    background-clip: padding-box;\n}\nbody[data-glass-theme] ::-webkit-scrollbar-thumb:hover { background-color: #cba472bb; }\nbody[data-glass-theme] ::-webkit-scrollbar-corner { background: transparent; }\nbody[data-glass-theme] :where(button, a, [role=\"menuitem\"], [role=\"option\"]):focus-visible {\n    outline: 2px solid var(--dsw-alias-state-business-primary);\n    outline-offset: 3px;\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] {\n    --ep-menu-fill: var(--ep-overlay-fill);\n    --dsw-menu-backdrop-filter: blur(24px) saturate(145%);\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] :is([data-menu-material], .re-model-menu, .ep-fate-workspaces) {\n    box-sizing: border-box;\n    border: 1px solid var(--ep-overlay-edge);\n    border-radius: 14px;\n    box-shadow: var(--ep-overlay-shadow);\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] :is(.re-model-menu, .ep-fate-workspaces) {\n    background: var(--ep-overlay-fill);\n    backdrop-filter: var(--dsw-menu-backdrop-filter);\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] :is([role=\"tooltip\"], [role=\"dialog\"], dialog[open]):not(.ep-panel) {\n    border: 1px solid var(--ep-overlay-edge);\n    background: var(--ep-overlay-fill);\n    backdrop-filter: var(--dsw-menu-backdrop-filter);\n    color: var(--dsw-alias-label-primary);\n    box-shadow: var(--ep-overlay-shadow);\n}\nbody[data-glass-theme][data-glass-glass=\"true\"] :is([role=\"dialog\"], dialog[open]):not(.ep-panel) { border-radius: 20px; }\nbody[data-glass-theme][data-glass-glass=\"true\"] [role=\"tooltip\"] { border-radius: 8px; padding: 5px 9px; }\nbody[data-glass-theme] :is([data-menu-material], [role=\"listbox\"]) :is([role=\"menuitem\"], [role=\"option\"]) {\n    border-radius: 8px;\n    transition: background-color .15s ease;\n}\nbody[data-glass-theme] :is([data-menu-material], [role=\"listbox\"]) :is([role=\"menuitem\"], [role=\"option\"]):not(:disabled):not([aria-disabled=\"true\"]):is(:hover, :focus-visible) {\n    background: linear-gradient(100deg, rgba(var(--ep-accent-rgb), .16), #b894d50d);\n}\nbody[data-glass-theme] :is([data-menu-material], [role=\"dialog\"], [role=\"tooltip\"]) kbd {\n    border: 1px solid var(--ep-overlay-edge);\n    border-radius: 5px;\n    box-shadow: 0 1px 0 #aa825522;\n    font-variant-numeric: tabular-nums;\n}\nbody[data-glass-theme] .hWmORq_body {\n    max-inline-size: 80ch;\n    margin-inline: auto;\n    line-height: 1.85;\n    letter-spacing: .012em;\n    overflow-wrap: anywhere;\n}\nbody[data-glass-theme] .hWmORq_body :is(p, ul, ol, blockquote) { margin-block: .85em; line-height: 1.85; }\nbody[data-glass-theme] .hWmORq_body :is(h1, h2, h3, h4) {\n    margin-block: 1.5em .6em;\n    font-weight: 600;\n    line-height: 1.45;\n    letter-spacing: .02em;\n    text-wrap: pretty;\n}\nbody[data-glass-theme] .hWmORq_body :is(p, h1, h2, h3, h4):first-child { margin-block-start: 0; }\nbody[data-glass-theme] .hWmORq_body > :last-child { margin-block-end: 0; }\nbody[data-glass-theme] .hWmORq_body :is(ul, ol) { padding-inline-start: 1.65em; }\nbody[data-glass-theme] .hWmORq_body li { padding-inline-start: .2em; margin-block: .3em; }\nbody[data-glass-theme] .hWmORq_body li::marker { color: var(--dsw-alias-state-business-primary); }\nbody[data-glass-theme] .hWmORq_body blockquote {\n    border: 0;\n    border-inline-start: 2px solid var(--dsw-alias-state-business-primary);\n    border-radius: 0 12px 12px 0;\n    padding: 8px 16px;\n    background: linear-gradient(90deg, rgba(var(--ep-accent-rgb), .09), transparent);\n    color: var(--dsw-alias-label-secondary);\n}\nbody[data-glass-theme] .hWmORq_body :not(pre) > code {\n    padding: .14em .38em;\n    border: 1px solid rgba(var(--ep-accent-rgb), .15);\n    border-radius: 5px;\n    background: rgba(var(--ep-accent-rgb), .08);\n    color: var(--dsw-alias-state-business-primary);\n    font-size: .92em;\n    letter-spacing: 0;\n}\nbody[data-glass-theme] .hWmORq_body pre { margin-block: 1.15em; letter-spacing: 0; overflow-x: auto; }\nbody[data-glass-theme] .hWmORq_body pre code { line-height: 1.7; overflow-wrap: normal; }\nbody[data-glass-theme] .hWmORq_body a { text-underline-offset: .22em; text-decoration-thickness: 1px; }\nbody[data-glass-theme] .hWmORq_body :is(th, td) { padding: 10px 14px; line-height: 1.65; }\nbody[data-glass-theme] .hWmORq_body th { background: rgba(var(--ep-accent-rgb), .08); font-weight: 600; }\nbody[data-glass-theme] .hWmORq_body tbody tr:hover { background: rgba(var(--ep-accent-rgb), .04); }\nbody[data-glass-theme] .hWmORq_body img { max-inline-size: 100%; height: auto; border-radius: 12px; }\nbody[data-glass-theme] .hWmORq_body hr {\n    margin-block: 1.75em;\n    height: 1px;\n    border: 0;\n    background: linear-gradient(90deg, transparent, rgba(var(--ep-accent-rgb), .35), transparent);\n}\nbody[data-glass-theme][data-glass-focus=\"true\"] { --dsw-menu-backdrop-filter: none; }\nbody[data-glass-theme][data-glass-focus=\"true\"] { --ep-overlay-fill: var(--dsw-alias-bg-layer-2); }\n@media (prefers-reduced-transparency: reduce) {\n    body[data-glass-theme][data-glass-glass=\"true\"] { --dsw-menu-backdrop-filter: none; --ep-overlay-fill: var(--dsw-alias-bg-layer-2); }\n}\n@media (prefers-reduced-motion: reduce) {\n    body[data-glass-theme] :is([data-menu-material], [role=\"listbox\"]) :is([role=\"menuitem\"], [role=\"option\"]) { transition: none; }\n}\n@media (forced-colors: active) {\n    body[data-glass-theme], body[data-glass-theme] * { scrollbar-color: auto; }\n    body[data-glass-theme] :is([data-menu-material], [role=\"tooltip\"], [role=\"dialog\"]):not(.ep-panel) { border-color: CanvasText; }\n}\n";
const PACKAGE_ID = "dsh-glass-aurum";
const STORAGE_KEY = "dsh.glass-theme.v1";
const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    palette: "champagne",
    strength: 36,
    dynamic: false,
    focus: false,
    ornaments: true,
    gpt_slider: true,
    liquid_glass: true,
    reply_identity: true,
    gold_code: true,
    polished_sidebar: true,
    fate_home: true,
    assistant_name: "DSH 助手",
    wallpaper_opacity: 36,
    wallpaper_blur: 0,
    wallpaper_fit: "cover",
    wallpaper_muted: true,
    wallpaper_volume: 60,
    wallpaper_playing: true,
});
const PALETTES = {
    champagne: { name: "金辉 · 流光", light: "#91682f", dark: "#e8c58b", rgb: "232, 197, 139", ink: "#211c26" },
    violet: { name: "星夜 · 紫罗兰", light: "#7855a4", dark: "#c9a9f0", rgb: "201, 169, 240", ink: "#1d192a" },
    rose: { name: "月白 · 誓约", light: "#aa5b70", dark: "#efb3c5", rgb: "239, 179, 197", ink: "#281d25" },
};

function read_settings() {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        const settings = { ...DEFAULT_SETTINGS };
        if (!value || typeof value !== "object") return settings;
        for (const key of ["enabled", "dynamic", "focus", "ornaments", "gpt_slider", "liquid_glass", "reply_identity", "gold_code", "polished_sidebar", "fate_home", "wallpaper_muted", "wallpaper_playing"]) {
            if (typeof value[key] === "boolean") settings[key] = value[key];
        }
        if (Object.hasOwn(PALETTES, value.palette)) settings.palette = value.palette;
        if (Number.isFinite(value.strength)) settings.strength = Math.max(0, Math.min(65, value.strength));
        if (typeof value.assistant_name === "string") settings.assistant_name = value.assistant_name.slice(0, 40);
        if (Number.isFinite(value.wallpaper_opacity)) settings.wallpaper_opacity = Math.max(0, Math.min(100, value.wallpaper_opacity));
        if (Number.isFinite(value.wallpaper_blur)) settings.wallpaper_blur = Math.max(0, Math.min(24, value.wallpaper_blur));
        if (value.wallpaper_fit === "contain" || value.wallpaper_fit === "cover") settings.wallpaper_fit = value.wallpaper_fit;
        if (Number.isFinite(value.wallpaper_volume)) settings.wallpaper_volume = Math.max(0, Math.min(100, value.wallpaper_volume));
        return settings;
    } catch (error) {
        if (error instanceof SyntaxError || error instanceof DOMException) return { ...DEFAULT_SETTINGS };
        throw error;
    }
}

function token_pairs(palette) {
    const pair = (light, dark) => ({ light, dark });
    const accent = pair(palette.light, palette.dark);
    return {
        "--dsw-alias-bg-base": pair("#f6f1ec", "#17151e"),
        "--dsw-alias-bg-layer-1": pair("#fbf7f2", "#211d29"),
        "--dsw-alias-bg-layer-2": pair("#f0e9e3", "#292332"),
        "--dsw-alias-bg-layer-3": pair("#e9e0db", "#322b3b"),
        "--dsw-alias-label-primary": pair("#342a35", "#f4ece4"),
        "--dsw-alias-label-primary-bluish": pair("#342a35", "#f4ece4"),
        "--dsw-alias-label-primary-dimmed": pair("#51434f", "#d2c1c9"),
        "--dsw-alias-label-secondary": pair("#6e5c69", "#c4b3bf"),
        "--dsw-alias-label-tertiary": pair("#806f7c", "#ac99aa"),
        "--dsw-alias-label-caption": pair("#806f7c", "#a995a5"),
        "--dsw-alias-label-dimmed": pair("#83727e", "#b3a0b0"),
        "--dsw-alias-state-business-primary": accent,
        "--dsw-alias-link": accent,
        "--dsw-alias-brand-primary": accent,
        "--dsw-alias-label-deep-diving": accent,
        "--dsw-alias-button-info-fill": pair("#986d46", "#927248"),
        "--dsw-alias-button-info-hover": pair("#7e5635", "#a88452"),
        "--dsw-alias-button-primary-fill": pair("#725c42", "#e8c58b"),
        "--dsw-alias-button-primary-hover": pair("#604c35", "#f4d5a0"),
        "--dsw-alias-border-l1": pair("#cfbdad", "#594753"),
        "--dsw-alias-border-l2": pair("#decec2", "#4a3d4d"),
        "--dsw-alias-border-l3": pair("#e8ddd5", "#3b3041"),
        "--dsw-alias-border-l4": pair("#cdbbae", "#5b4658"),
        "--dsw-alias-interactive-bg-hover": pair("#b8997920", "#e8c58b12"),
        "--dsw-alias-interactive-bg-hover-solid": pair("#e7d9ce", "#3b303c"),
        "--dsw-alias-interactive-bg-active": pair("#aa7b4624", "#e8c58b25"),
        "--dsw-specific-sidebar-fill": pair("#f0e7dfed", "#1c1824ed"),
        "--dsw-specific-sidebar-nav-item-active": pair("#d9c1a34d", "#e8c58b20"),
        "--dsw-specific-sidebar-nav-item-active-accent": pair("#d9c1a366", "#e8c58b28"),
        "--dsw-specific-sidebar-nav-item-hover": pair("#aa7b4614", "#e8c58b0f"),
        "--dsw-specific-input-major": pair("#fffaf5f5", "#292230f2"),
        "--dsw-specific-selector": pair("#e8dad0", "#493a4c"),
        "--dsw-specific-bubble": pair("#ede0d8f2", "#443343f0"),
        "--dsw-specific-bubble-highlight": pair("#e5d2c8", "#513d50"),
        "--dsw-specific-menu": pair("#fcf7f2fa", "#2c2433fa"),
        "--dsw-menu-surface-fill": pair("var(--ep-menu-fill, #fcf7f2fa)", "var(--ep-menu-fill, #2c2433fa)"),
        "--dsw-alias-menu-group-header-fill": pair("#f3eae2", "#2c2433"),
        "--dsw-alias-settings-card-fill": pair("#fffaf5", "#2b2332"),
        "--dsw-alias-settings-card-stroke": pair("#decec2", "#514052"),
        "--dsw-alias-markdown-code-block": pair("#f1e8e0", "#1c1824"),
        "--dsw-alias-markdown-code-block-banner": pair("#e9ddd3", "#28202f"),
        "--dsw-alias-markdown-inline-code": pair("#e9ddd3", "#3b2e41"),
        "--dsw-alias-scrollbar-bg-l1": pair("#bda99588", "#8c738688"),
        "--dsw-alias-scrollbar-bg-l2": pair("#bda99588", "#8c738688"),
        "--dsw-alias-scrollbar-hover-l1": pair("#a58d73", "#ae91a3"),
        "--dsw-alias-scrollbar-hover-l2": pair("#a58d73", "#ae91a3"),
    };
}

function create_ui() {
    const root = document.createElement("div");
    root.id = "glass-theme-ui";
    root.innerHTML = `
        <button class="ep-theme-launcher" type="button" aria-label="打开主题设置" title="主题设置">
            <span aria-hidden="true">✧</span><span class="ep-launcher-label">主题</span>
        </button>
        <dialog class="ep-panel" aria-labelledby="ep-panel-title">
            <form method="dialog"><button class="ep-close" aria-label="关闭主题设置" title="关闭">×</button></form>
            <div class="ep-panel-art" aria-hidden="true"><span>GLASS</span><div>玻璃工作台<small>FOCUS & FLOW</small></div></div>
            <div class="ep-panel-content">
                <p class="ep-eyebrow">A LITTLE MAGIC, EVERY DAY</p>
                <h2 id="ep-panel-title">让灵感，悄然盛放。</h2>
                <p class="ep-panel-intro">把花束、星牌与一抹金辉，留在每一次对话里；也可以换成自己的图片或视频壁纸。</p>
                <section class="ep-avatar-settings" aria-label="助手头像设置">
                    <span class="ep-character-avatar" role="img" aria-label="当前助手头像"></span>
                    <div><strong>助手头像</strong><small>本机保存，用于主页与助手回复</small></div>
                    <label class="ep-assistant-name">助手名称<input type="text" data-setting="assistant_name" maxlength="40" aria-label="助手名称" placeholder="DSH 助手"></label>
                    <div class="ep-avatar-actions"><button type="button" data-avatar="upload">上传头像</button><button type="button" data-avatar="remove">恢复默认头像</button></div>
                    <input class="ep-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择头像图片" hidden>
                    <p class="ep-avatar-status" role="status" aria-live="polite"></p>
                </section>
                <section class="ep-wallpaper-section" aria-label="壁纸设置"></section>
                <div class="ep-section-title">主题色调 <span>跟随 DSH 深浅模式</span></div>
                <div class="ep-palettes" role="group" aria-label="主题色调">
                    <button type="button" data-palette="champagne" aria-pressed="false"><i></i>金辉 · 流光</button>
                    <button type="button" data-palette="violet" aria-pressed="false"><i></i>星夜 · 紫罗兰</button>
                    <button type="button" data-palette="rose" aria-pressed="false"><i></i>月白 · 誓约</button>
                </div>
                <label class="ep-range-label" for="ep-strength">画面浓度 <output id="ep-strength-value">36%</output></label>
                <input id="ep-strength" data-setting="strength" type="range" min="0" max="65" step="1" value="36" aria-label="画面浓度">
                <label class="ep-setting"><span>专注时刻<small>收起背景与装饰，保留主题配色</small></span><input type="checkbox" data-setting="focus" role="switch" aria-label="专注模式"></label>
                <label class="ep-setting"><span>星光与花笺<small>轻盈的星轨、金线与角标</small></span><input type="checkbox" data-setting="ornaments" role="switch" aria-label="星光装饰"></label>
                <label class="ep-setting"><span>液态玻璃<small>透光对话卡片、流动高光与金色输入文字</small></span><input type="checkbox" data-setting="liquid_glass" role="switch" aria-label="液态玻璃"></label>
                <label class="ep-setting"><span>GPT 风格思考滑块<small>简洁圆点与分档刻度，沿用模型实际档位</small></span><input type="checkbox" data-setting="gpt_slider" role="switch" aria-label="GPT 风格思考滑块"></label>
                <details class="ep-enhancement-settings"><summary>头像、代码与工作台卡片</summary>
                    <label class="ep-setting"><span>助手标记与回复动效</span><input type="checkbox" data-setting="reply_identity" role="switch" aria-label="助手标记与回复动效"></label>
                    <label class="ep-setting"><span>金紫代码配色</span><input type="checkbox" data-setting="gold_code" role="switch" aria-label="金紫代码配色"></label>
                    <label class="ep-setting"><span>侧栏精修</span><input type="checkbox" data-setting="polished_sidebar" role="switch" aria-label="侧栏精修"></label>
                    <label class="ep-setting"><span>工作台卡片主页</span><input type="checkbox" data-setting="fate_home" role="switch" aria-label="工作台卡片主页"></label>
                </details>
                <div class="ep-panel-footer"><label><input type="checkbox" data-setting="enabled" role="switch" aria-label="启用主题">启用主题</label><button type="button" data-action="reset">恢复默认</button></div>
            </div>
        </dialog>`;
    const ambient = document.createElement("div");
    ambient.id = "glass-ambient";
    ambient.setAttribute("aria-hidden", "true");
    ambient.innerHTML = `<div class="ep-wallpaper"></div><div class="ep-vignette"></div><div class="ep-orbit"></div><div class="ep-motes"></div><div class="ep-signature"><b>✧</b><span>GLASS<small>FOCUS & FLOW</small></span></div>`;
    return { root, ambient };
}

function create_effort_adapter() {
    const decorated = new Map();
    let enabled = false;
    let frame = null;

    function remove_decoration(effort, decoration) {
        decoration.head.remove();
        decoration.ticks.remove();
        decoration.footer.remove();
        delete effort.dataset.epGptEffort;
    }

    function scan() {
        frame = null;
        if (!enabled) return;
        for (const [effort, decoration] of decorated) {
            if (!effort.isConnected) {
                remove_decoration(effort, decoration);
                decorated.delete(effort);
            }
        }
        for (const effort of document.querySelectorAll(".re-effort")) {
            const input = effort.querySelector(".re-effort-input");
            const slider = effort.querySelector(".re-effort-slider");
            if (!input || !slider) continue;
            const min = Number(input.min || 0);
            const max = Number(input.max);
            const count = max - min + 1;
            if (!Number.isInteger(count) || count < 2 || count > 20) continue;
            let decoration = decorated.get(effort);
            if (!decoration) {
                const head = document.createElement("div");
                head.className = "ep-gpt-effort-head";
                head.setAttribute("aria-hidden", "true");
                const caption = document.createElement("span");
                caption.textContent = "思考强度";
                const value = document.createElement("span");
                value.className = "ep-gpt-effort-value";
                head.append(caption, value);
                const ticks = document.createElement("div");
                ticks.className = "ep-gpt-effort-ticks";
                ticks.setAttribute("aria-hidden", "true");
                const footer = document.createElement("div");
                footer.className = "ep-gpt-effort-footer";
                footer.setAttribute("aria-hidden", "true");
                const fast = document.createElement("span");
                fast.textContent = "更快响应";
                const deep = document.createElement("span");
                deep.textContent = "更深入思考";
                footer.append(fast, deep);
                effort.prepend(head);
                slider.append(ticks);
                effort.append(footer);
                decoration = { head, value, ticks, footer, count: 0 };
                decorated.set(effort, decoration);
                effort.dataset.epGptEffort = "true";
            }
            const value = input.getAttribute("aria-valuetext") || input.value;
            if (decoration.value.textContent !== value) decoration.value.textContent = value;
            if (decoration.count !== count) {
                decoration.ticks.replaceChildren();
                for (let index = 0; index < count; index++) {
                    const dot = document.createElement("span");
                    const ratio = index / (count - 1);
                    dot.style.left = `calc(${ratio * 100}% + ${8 - 16 * ratio}px)`;
                    decoration.ticks.append(dot);
                }
                decoration.count = count;
            }
            const selected = Math.round(Number(input.value) - min);
            for (const [index, dot] of [...decoration.ticks.children].entries()) {
                const state = index <= selected ? "true" : "false";
                if (dot.dataset.selected !== state) dot.dataset.selected = state;
            }
        }
    }

    function schedule_scan() {
        if (enabled && frame === null) frame = requestAnimationFrame(scan);
    }

    const observer = new MutationObserver(schedule_scan);

    function set_enabled(next) {
        if (next === enabled) return;
        enabled = next;
        if (enabled) {
            document.body.dataset.glassGptSlider = "true";
            observer.observe(document.body, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ["aria-valuetext", "min", "max", "value", "disabled"],
            });
            document.addEventListener("input", schedule_scan, true);
            scan();
        } else {
            observer.disconnect();
            document.removeEventListener("input", schedule_scan, true);
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            for (const [effort, decoration] of decorated) remove_decoration(effort, decoration);
            decorated.clear();
            delete document.body.dataset.glassGptSlider;
        }
    }

    return { set_enabled, dispose: () => set_enabled(false) };
}

function create_glass_lighting() {
    const reduced_motion = matchMedia("(prefers-reduced-motion: reduce)");
    const surfaces = new Set();
    let frame = null;
    let sample = null;

    function reset_surface(surface) {
        surface.style.removeProperty("--ep-light-x");
        surface.style.removeProperty("--ep-light-y");
    }

    function update() {
        frame = null;
        if (!sample) return;
        const { surface, x, y } = sample;
        if (!surface.isConnected) return;
        const bounds = surface.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        for (const previous of surfaces) {
            if (previous !== surface) {
                reset_surface(previous);
                surfaces.delete(previous);
            }
        }
        surface.style.setProperty("--ep-light-x", `${Math.max(0, Math.min(100, (x - bounds.left) / bounds.width * 100))}%`);
        surface.style.setProperty("--ep-light-y", `${Math.max(0, Math.min(100, (y - bounds.top) / bounds.height * 100))}%`);
        surfaces.add(surface);
    }

    function on_pointer_move(event) {
        if (reduced_motion.matches || event.pointerType === "touch"
            || !document.body.hasAttribute("data-glass-theme")
            || document.body.dataset.glassGlass !== "true"
            || document.body.dataset.glassFocus === "true") return;
        const surface = event.target instanceof Element
            ? event.target.closest(".uV2eYG_card, .Sixlwa_bubble, .hWmORq_root, .re-model-menu, .ep-panel") : null;
        if (!surface) return;
        sample = { surface, x: event.clientX, y: event.clientY };
        if (frame === null) frame = requestAnimationFrame(update);
    }

    function reset() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        sample = null;
        for (const surface of surfaces) reset_surface(surface);
        surfaces.clear();
    }

    document.addEventListener("pointermove", on_pointer_move, { passive: true });
    reduced_motion.addEventListener("change", reset);
    return () => {
        document.removeEventListener("pointermove", on_pointer_move);
        reduced_motion.removeEventListener("change", reset);
        reset();
    };
}

function mount_theme(ctx, theme) {
    const style = document.createElement("style");
    style.dataset.plugin = PACKAGE_ID;
    style.textContent = STYLE_TEXT;
    document.head.appendChild(style);
    const { root, ambient } = create_ui();
    document.body.append(ambient, root);
    const dialog = root.querySelector("dialog");
    const launcher = root.querySelector(".ep-theme-launcher");
    const reduced_motion = matchMedia("(prefers-reduced-motion: reduce)");
    const narrow = matchMedia("(max-width: 760px)");
    const effort_adapter = create_effort_adapter();
    const release_glass_lighting = create_glass_lighting();
    const world_enhancements = create_world_enhancements(ctx);
    const release_avatar = create_avatar_editor(root);
    let settings = read_settings();
    const wallpaper = create_wallpaper(ambient);
    wallpaper.bind_panel(root.querySelector(".ep-wallpaper-section"), (patch) => {
        Object.assign(settings, patch);
        persist(false);
    });
    let release_tokens = null;
    let disposed = false;
    let media_revision = 0;

    function sync_media() { ambient.dataset.playing = "false"; }

    function sync_controls() {
        for (const input of root.querySelectorAll("[data-setting]")) {
            const key = input.dataset.setting;
            if (input.type === "checkbox") input.checked = settings[key];
            else input.value = String(settings[key]);
        }
        root.querySelector("output").textContent = `${settings.strength}%`;
        for (const button of root.querySelectorAll("[data-palette]")) {
            button.setAttribute("aria-pressed", String(settings.palette === button.dataset.palette));
        }
    }

    function render(rebuild_tokens = true) {
        const body = document.body;
        const palette = PALETTES[settings.palette];
        if (rebuild_tokens) {
            const previous_release = release_tokens;
            release_tokens = settings.enabled ? theme.overrideTokens(PACKAGE_ID, token_pairs(palette)) : null;
            previous_release?.();
        }
        if (settings.enabled) body.dataset.glassTheme = settings.palette;
        else delete body.dataset.glassTheme;
        body.dataset.glassFocus = String(settings.focus);
        body.dataset.glassOrnaments = String(settings.ornaments);
        body.dataset.glassGlass = String(settings.liquid_glass);
        body.style.setProperty("--ep-strength", String(settings.strength / 100));
        body.style.setProperty("--ep-accent-rgb", palette.rgb);
        body.style.setProperty("--ep-accent", palette.dark);
        body.style.setProperty("--ep-ink", palette.ink);
        ambient.hidden = !settings.enabled || settings.focus;
        root.dataset.enabled = String(settings.enabled);
        effort_adapter.set_enabled(settings.gpt_slider);
        world_enhancements.set_state(settings);
        wallpaper.set_state(settings);
        sync_controls();
        sync_media();
    }

    function persist(rebuild_tokens = true) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            if (!(error instanceof DOMException)) throw error;
        }
        render(rebuild_tokens);
    }

    function open_panel() {
        if (!dialog.open) dialog.showModal();
    }

    function on_click(event) {
        const target = event.target instanceof Element ? event.target : null;
        const palette = target?.closest("[data-palette]");
        if (palette) {
            settings.palette = palette.dataset.palette;
            persist();
        } else if (target?.closest("[data-action=reset]")) {
            settings = { ...DEFAULT_SETTINGS };
            persist();
        } else if (target?.closest(".ep-theme-launcher")) {
            open_panel();
        } else if (event.target === dialog) {
            const bounds = dialog.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right
                || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
        }
    }

    function on_input(event) {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || !input.dataset.setting) return;
        const key = input.dataset.setting;
        settings[key] = key === "assistant_name" ? input.value.slice(0, 40) : input.type === "checkbox" ? input.checked : Math.max(0, Math.min(65, Number(input.value)));
        persist(key === "enabled");
    }

    function on_storage(event) {
        if (event.key !== STORAGE_KEY && event.key !== null) return;
        settings = read_settings();
        render();
    }

    function on_video_error() {
        ambient.dataset.playing = "false";
    }

    root.addEventListener("click", on_click);
    root.addEventListener("input", on_input);
    window.addEventListener("storage", on_storage);
    document.addEventListener("visibilitychange", sync_media);
    reduced_motion.addEventListener("change", sync_media);
    narrow.addEventListener("change", sync_media);
    render();

    ctx.inject(["slots"], (owner) => {
        const slots = owner.get("slots");
        const React = require("react");
        owner.effect(() => slots.inject("settings.general.item", () => slots.register({
            name: "settings.general.item",
            id: "glass-aurum-theme",
            order: 12,
        }, () => React.createElement("div", { className: "ep-settings-row" },
            React.createElement("div", null,
                React.createElement("strong", null, "DSH 助手 · 主题"),
                React.createElement("small", null, "配色、玻璃、壁纸与专注模式")),
            React.createElement("button", { type: "button", onClick: open_panel }, "自定义 ✧")))));
    });

    return () => {
        disposed = true;
        media_revision++;
        effort_adapter.dispose();
        release_glass_lighting();
        world_enhancements.dispose();
        release_avatar();
        wallpaper.dispose();
        release_tokens?.();
        root.removeEventListener("click", on_click);
        root.removeEventListener("input", on_input);
        window.removeEventListener("storage", on_storage);
        document.removeEventListener("visibilitychange", sync_media);
        reduced_motion.removeEventListener("change", sync_media);
        narrow.removeEventListener("change", sync_media);
        if (dialog.open) dialog.close();
        ambient.remove();
        root.remove();
        style.remove();
        for (const key of ["glassTheme", "glassFocus", "glassOrnaments", "glassGlass"]) delete document.body.dataset[key];
        for (const key of ["--ep-strength", "--ep-accent-rgb", "--ep-accent", "--ep-ink"]) document.body.style.removeProperty(key);
    };
}

exports.name = PACKAGE_ID;
exports.apply = (ctx) => {
    ctx.inject(["theme"], (owner) => {
        owner.effect(() => mount_theme(owner, owner.get("theme")));
    });
};

return module.exports;
} });
