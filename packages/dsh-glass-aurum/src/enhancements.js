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
