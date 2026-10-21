const STYLE_TEXT = "";
const PACKAGE_ID = "dsh-glass-theme";
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
        for (const key of ["enabled", "dynamic", "focus", "ornaments", "gpt_slider", "liquid_glass", "reply_identity", "gold_code", "polished_sidebar", "fate_home"]) {
            if (typeof value[key] === "boolean") settings[key] = value[key];
        }
        if (Object.hasOwn(PALETTES, value.palette)) settings.palette = value.palette;
        if (Number.isFinite(value.strength)) settings.strength = Math.max(0, Math.min(65, value.strength));
        if (typeof value.assistant_name === "string") settings.assistant_name = value.assistant_name.slice(0, 40);
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
                <p class="ep-panel-intro">把花束、星牌与一抹金辉，留在每一次对话里。</p>
                <section class="ep-avatar-settings" aria-label="助手头像设置">
                    <span class="ep-character-avatar" role="img" aria-label="当前助手头像"></span>
                    <div><strong>助手头像</strong><small>本机保存，用于主页与助手回复</small></div>
                    <label class="ep-assistant-name">助手名称<input type="text" data-setting="assistant_name" maxlength="40" aria-label="助手名称" placeholder="DSH 助手"></label>
                    <div class="ep-avatar-actions"><button type="button" data-avatar="upload">上传头像</button><button type="button" data-avatar="remove">恢复默认头像</button></div>
                    <input class="ep-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择头像图片" hidden>
                    <p class="ep-avatar-status" role="status" aria-live="polite"></p>
                </section>
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
            id: "glass-theme",
            order: 12,
        }, () => React.createElement("div", { className: "ep-settings-row" },
            React.createElement("div", null,
                React.createElement("strong", null, "DSH 助手 · 主题"),
                React.createElement("small", null, "配色、玻璃与专注模式")),
            React.createElement("button", { type: "button", onClick: open_panel }, "自定义 ✧")))));
    });

    return () => {
        disposed = true;
        media_revision++;
        effort_adapter.dispose();
        release_glass_lighting();
        world_enhancements.dispose();
        release_avatar();
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
