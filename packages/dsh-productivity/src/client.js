const STYLE_TEXT = "";
const PREFIX = "/plugins/dsh-productivity/";
const TOP_UP_URL = "https://platform.deepseek.com/top_up";

function mount_productivity(owner) {
    const React = require("react");
    const slots = owner.get("slots");
    const navigation = owner.get("uiWorkspace");
    const sessions = owner.get("sessions");
    const lifetime = new AbortController();
    const session_actions = new Set();
    const cleanup_drafts = new Map();
    const style = document.createElement("style");
    style.textContent = STYLE_TEXT;
    document.head.append(style);
    const dialog = document.createElement("dialog");
    dialog.className = "dp-dialog";
    dialog.setAttribute("aria-labelledby", "dp-title");
    dialog.innerHTML = `<header class="dp-header"><div><small>DSH · PRODUCTIVITY</small><h2 id="dp-title">效率中心</h2></div><button type="button" class="dp-close" aria-label="关闭效率中心">×</button></header><p class="dp-session"></p><nav class="dp-tabs" aria-label="效率功能"><button type="button" data-tab="search">全文搜索</button><button type="button" data-tab="checkpoints">检查点</button><button type="button" data-tab="context">上下文</button><button type="button" data-tab="cleanup">清理文件</button></nav><p class="dp-status" role="status" aria-live="polite"></p><main class="dp-content"></main>`;
    const header_actions = document.createElement("div");
    header_actions.className = "dp-header-actions";
    const top_up = document.createElement("a");
    top_up.className = "dp-top-up";
    top_up.href = TOP_UP_URL;
    top_up.target = "_blank";
    top_up.rel = "noopener noreferrer";
    top_up.textContent = "API 充值 ↗";
    top_up.title = "打开 DeepSeek 官方 API 充值页面";
    header_actions.append(top_up, dialog.querySelector(".dp-close"));
    dialog.querySelector(".dp-header").append(header_actions);
    document.body.append(dialog);
    const content = dialog.querySelector(".dp-content");
    const status = dialog.querySelector(".dp-status");
    let active_tab = "chats";
    let active_session = null;
    let disposed = false;
    let generation = 0;
    let pending = false;
    let controller = new AbortController();
    let search_controller = null;
    let search_timer = null;
    let search_text = "";
    let search_scope = "all";
    let search_mode = "literal";
    let checkpoint_label = "";
    const assistant_nav = dialog.querySelector(".dp-tabs");
    for (const [tab, label] of [["today", "今日计划"], ["tasks", "目标待办"], ["memories", "长期记忆"], ["chats", "主聊与旁聊"]]) assistant_nav.prepend(node("button", { type: "button", "data-tab": tab }, label));

    function node(tag, attributes = {}, ...children) {
        const result = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key.startsWith("on")) result.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key === "checked" || key === "disabled") result[key] = value;
            else result.setAttribute(key, String(value));
        }
        result.append(...children.filter(child => child !== null && child !== undefined).map(child => typeof child === "object" ? child : document.createTextNode(String(child))));
        return result;
    }

    function action(label, callback, secondary = false) {
        return node("button", { type: "button", class: secondary ? "dp-secondary" : "dp-primary", "data-mutation": "true", onClick: callback }, label);
    }

    function say(message, error = false) {
        status.textContent = message;
        status.dataset.error = String(error);
    }

    function update_busy() {
        for (const button of dialog.querySelectorAll("[data-mutation]")) button.disabled = pending || session_actions.has(active_session) || button.dataset.protected === "true";
    }

    async function api(path, body, signal = controller.signal) {
        const response = await fetch(`${PREFIX}${path}`, {
            method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
            ...(body === undefined ? {} : { headers: { "content-type": "application/json", "x-dsh-productivity": "1" }, body: JSON.stringify(body) }),
        });
        const value = await response.json();
        if (response.status === 404 && path.startsWith("assistant")) throw new Error("个人助理后台尚未加载新版。请完整退出 DSH（包括托盘）再启动；仅关闭窗口或最小化不会更新后台。");
        if (!response.ok) throw new Error(value.error || "操作失败。");
        return value;
    }

    async function run(operation) {
        if (pending) return;
        pending = true;
        const current = generation;
        update_busy();
        say("正在处理…");
        try { await operation(current); }
        catch (error) { if (current === generation && error.name !== "AbortError") say(error.message, true); }
        finally { if (current === generation) { pending = false; update_busy(); } }
    }

    function highlight(text, query) {
        const result = node("span");
        if (!query) { result.textContent = text; return result; }
        let from = 0;
        const lower = text.toLocaleLowerCase();
        const term = query.toLocaleLowerCase();
        let index;
        while ((index = lower.indexOf(term, from)) !== -1) {
            result.append(document.createTextNode(text.slice(from, index)), node("mark", {}, text.slice(index, index + query.length)));
            from = index + query.length;
        }
        result.append(document.createTextNode(text.slice(from)));
        return result;
    }

    function current_id() { return navigation.selection.getSnapshot().sessionId || null; }

    async function with_session(id, operation) {
        if (disposed || !id || current_id() !== id) throw new Error("当前会话已改变，请重新打开面板。");
        if (session_actions.has(id)) throw new Error("此会话的操作尚未完成，请稍后再试。");
        session_actions.add(id);
        update_busy();
        try {
            return await sessions.using(id, { source: "dsh-productivity", signal: lifetime.signal }, async reference => {
                if (disposed || current_id() !== id) throw new Error("当前会话已改变，本次操作未发送。");
                return operation(reference.binding.session);
            });
        } finally { session_actions.delete(id); if (!disposed) update_busy(); }
    }

    function session_title(id) {
        const row = sessions.list.getSnapshot().byId?.[id];
        return row?.title || "未命名会话";
    }

    async function search_tab() {
        const input = node("input", { type: "search", placeholder: "搜索所有对话、代码和工具输出…", "aria-label": "搜索对话全文", maxlength: 300 });
        input.value = search_text;
        const scope = node("select", { "aria-label": "搜索范围" }, node("option", { value: "all" }, "全部会话"), node("option", { value: "workspace" }, "当前工作区"), node("option", { value: "session" }, "当前会话"));
        scope.value = search_scope;
        const mode = node("select", { "aria-label": "搜索方式" }, node("option", { value: "literal" }, "逐字匹配 · 中文适用"), node("option", { value: "indexed" }, "索引搜索 · 词语匹配"));
        mode.value = search_mode;
        const results = node("div", { class: "dp-results", "aria-label": "搜索结果" });
        const controls = node("div", { class: "dp-search-controls" }, input, scope, mode);
        content.replaceChildren(controls, node("p", { class: "dp-muted" }, "搜索包含历史回复、代码及工具输出；压缩前的历史也可检索。"), results);
        let cursor = null;
        let search_version = 0;

        async function perform(append = false) {
            const version = ++search_version;
            const current = generation;
            search_controller?.abort();
            search_controller = new AbortController();
            if (!append) results.replaceChildren();
            const query = search_text.trim();
            if (!query) { say("输入关键词开始搜索。"); return; }
            if (search_scope !== "all" && !active_session) { say("请先打开一个会话，或改为搜索全部会话。", true); return; }
            say("正在搜索…");
            const params = new URLSearchParams({ q: query, scope: search_scope, mode: search_mode });
            if (active_session) params.set("session_id", active_session);
            if (append && cursor) params.set("cursor", cursor);
            try {
                const data = await api(`search?${params}`, undefined, search_controller.signal);
                if (disposed || version !== search_version || current !== generation) return;
                results.querySelector(".dp-more")?.remove();
                for (const item of data.items) {
                    const details = node("div", { class: "dp-match-details" });
                    const hit = node("article", { class: "dp-result" },
                        node("h3", {}, item.title), node("small", { class: "dp-muted" }, `${item.cwd || "无工作区"} · #${item.seq}${item.match_count ? ` · ${item.match_count} 处匹配` : ""}`),
                        node("p", { class: "dp-snippet" }, highlight(item.snippet, query)),
                        node("div", { class: "dp-actions" }, action("打开会话", () => run(async () => { await navigation.openSession(item.session_id); dialog.close(); }), true), action("查看匹配", () => run(async current_view => {
                            const matches = await api(`matches?${new URLSearchParams({ session_id: item.session_id, q: query })}`);
                            if (current_view !== generation) return;
                            details.replaceChildren(...matches.items.map(match => node("details", {}, node("summary", {}, `#${match.seq} · ${match.type} · ${match.surface === "current" ? "当前上下文" : "历史记录"}`), node("pre", {}, highlight(match.text, query)))));
                            if (matches.total > matches.items.length) details.append(node("p", { class: "dp-muted" }, `共 ${matches.total} 处，显示前 ${matches.items.length} 处。`));
                            say("可展开查看匹配内容，或打开原会话。");
                        }), true)), details);
                    results.append(hit);
                }
                cursor = data.next_cursor || null;
                if (cursor) results.append(node("button", { type: "button", class: "dp-more dp-secondary", onClick: () => perform(true) }, "加载更多"));
                const found = results.querySelectorAll(".dp-result").length;
                if (data.notice) {
                    mode.value = "literal";
                    search_mode = "literal";
                    mode.querySelector("option[value=indexed]").disabled = true;
                }
                say(`${found ? `已找到 ${found} 个会话。${cursor ? "可加载更多。" : ""}` : "没有匹配的对话。"}${data.notice || ""}`);
                update_busy();
            } catch (error) { if (version === search_version && current === generation && error.name !== "AbortError") say(error.message, true); }
        }

        input.addEventListener("input", () => { search_text = input.value; clearTimeout(search_timer); search_timer = setTimeout(() => perform(), 280); });
        input.addEventListener("keydown", event => { if (event.key === "Enter") { clearTimeout(search_timer); void perform(); } });
        scope.addEventListener("change", () => { search_scope = scope.value; void perform(); });
        mode.addEventListener("change", () => { search_mode = mode.value; void perform(); });
        await perform();
        if (dialog.open && !disposed) input.focus();
    }

    async function checkpoints_tab() {
        const current = generation;
        say("正在读取检查点…");
        const data = await api(`checkpoints?${new URLSearchParams({ session_id: active_session })}`);
        if (current !== generation) return;
        const label = node("input", { type: "text", maxlength: 100, "aria-label": "检查点名称", placeholder: "给当前文件状态起个名字" });
        label.value = checkpoint_label;
        label.addEventListener("input", () => { checkpoint_label = label.value; });
        const list = node("div", { class: "dp-results" });
        const preview = node("section", { class: "dp-preview", "aria-label": "回退差异预览" });
        content.replaceChildren(node("p", { class: "dp-path" }, data.root), node("div", { class: "dp-create" }, label, action("创建检查点", () => run(async () => {
            await api("checkpoints/create", { session_id: active_session, label: checkpoint_label });
            await checkpoints_tab();
            say("检查点已保存。");
        }))), node("p", { class: "dp-muted" }, `自动在文件与命令工具执行前快照；保留最近 40 个状态。单文件 ≤ ${Math.round(data.limits.file_bytes / 1048576)} MB，快照 ≤ ${Math.round(data.limits.total_bytes / 1048576)} MB。`), node("details", {}, node("summary", {}, "查看快照覆盖范围"), node("p", { class: "dp-muted" }, `不包含：${data.omitted.join("、")}。外部文件和数据库不在文件回退范围内。`)), list, preview);
        for (const item of data.items) {
            list.append(node("article", { class: "dp-result dp-checkpoint" }, node("div", {}, node("h3", {}, item.label), node("small", { class: "dp-muted" }, `${new Date(item.created_at).toLocaleString()} · ${item.files} 个文件 · ${(item.bytes / 1048576).toFixed(1)} MB${item.skipped.length ? ` · 排除 ${item.skipped.length} 项` : ""}`)), action("预览回退", () => run(async view => {
                const state = await api("checkpoints/preview", { session_id: active_session, id: item.id });
                if (view !== generation) return;
                preview.replaceChildren(node("h3", {}, `回到「${state.label}」`), node("p", {}, `${state.total} 个文件将改变。回退前会自动保存当前文件备份。`));
                for (const change of state.changes) preview.append(node("details", {}, node("summary", {}, `${{ added: "删除新文件", deleted: "恢复已删文件", modified: "还原修改" }[change.kind]} · ${change.path}`), node("pre", { class: "dp-diff" }, change.diff)));
                if (state.truncated) preview.append(node("p", { class: "dp-muted" }, "预览只显示前 100 个文件，确认后回退全部列出的文件范围。"));
                if (state.skipped.length) preview.append(node("details", {}, node("summary", {}, `排除项目（${state.skipped.length}）`), node("pre", {}, state.skipped.slice(0, 100).join("\n"))));
                if (state.total) {
                    const confirmation = node("input", { type: "checkbox", "aria-label": "确认回退文件" });
                    const confirm = action("备份并回退", () => {
                        if (!confirmation.checked) { say("请先勾选确认回退。", true); return; }
                        void run(async () => {
                            const restored = await api("checkpoints/restore", { session_id: active_session, id: state.id, fingerprint: state.fingerprint });
                            await checkpoints_tab();
                            say(`已回退 ${restored.restored} 个文件，可用「回退前备份」撤销。`);
                        });
                    });
                    preview.append(node("label", { class: "dp-confirm" }, confirmation, "确认按预览回退工作区文件"), confirm);
                }
                say("差异预览已就绪。请展开文件查看。检查点只回退文件，不删除对话。");
                preview.scrollIntoView({ block: "nearest", behavior: "smooth" });
                update_busy();
            }), true)));
        }
        if (!data.items.length) list.append(node("p", { class: "dp-empty" }, "还没有检查点。可先手动保存当前状态。"));
        say(data.automatic_error ? `最近自动快照未保存：${data.automatic_error}` : "检查点按当前工作区共享；执行任务时暂停手动回退。", Boolean(data.automatic_error));
        update_busy();
    }

    async function context_tab() {
        const current = generation;
        const id = active_session;
        say("正在读取上下文…");
        const data = await api(`context?${new URLSearchParams({ session_id: active_session })}`);
        if (current !== generation) return;
        const pressure = data.pressure;
        const tokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
        const window_size = pressure?.contextWindow;
        const meter = node("section", { class: "dp-metrics" }, node("strong", {}, typeof tokens === "number" ? `${Math.round(tokens).toLocaleString()}${window_size ? ` / ${window_size.toLocaleString()}` : ""} tokens` : "暂无原生占用数据"));
        if (typeof tokens === "number" && window_size > 0) meter.append(node("progress", { max: window_size, value: Math.min(tokens, window_size), "aria-label": "原生上下文占用" }));
        if (data.breakdown) meter.append(node("p", { class: "dp-muted" }, `系统 ${data.breakdown.systemTokens.toLocaleString()} · 工具 ${data.breakdown.toolsTokens.toLocaleString()} · 消息 ${data.breakdown.messageTokens.toLocaleString()}（估算）`));
        const excluded_characters = data.turns.filter(turn => turn.excluded && turn.in_surface && !turn.protected).reduce((sum, turn) => sum + turn.characters, 0);
        const list = node("div", { class: "dp-turns" });
        const tools = node("div", { class: "dp-actions" }, action("恢复全部轮次", () => run(async () => { await api("context", { session_id: active_session, excluded: [] }); await context_tab(); say("所有排除已恢复，下次请求生效。"); }), true), action("生成 MD 总结", () => run(async view => {
            const summary = await api(`summary?${new URLSearchParams({ session_id: id })}`);
            if (view !== generation) return;
            const result = await with_session(id, session => session.prompt([{ type: "text", text: summary.prompt }], "queue", lifetime.signal));
            if (!result.ok) throw new Error(result.error?.message || "总结指令未确认发送，请查看原会话后重试。");
            if (view !== generation) return;
            say("总结指令已发送，DeepSeek 将生成 MD 总结并返回文件路径。");
            dialog.close();
        })), action("压缩上下文…", () => {
            const confirm = node("section", { class: "dp-compact-confirm" }, node("p", {}, "使用原生 /compact 生成历史摘要，会调用当前模型。执行结果显示在原会话中。"), action("执行压缩", () => run(async () => {
                const view = generation;
                const result = await with_session(id, session => session.command("/compact"));
                if (!result.ok || !result.value?.matched) throw new Error(result.error?.message || "原生压缩命令未成功接收。");
                if (view !== generation) return;
                await context_tab();
                say("压缩命令已执行，请在原会话查看结果。");
            })), action("取消", () => confirm.remove(), true));
            content.querySelector(".dp-compact-confirm")?.remove();
            tools.after(confirm);
        }, true));
        content.replaceChildren(meter, node("p", { class: "dp-muted" }, `已排除 ${data.excluded.length} 轮，当前可省略约 ${excluded_characters.toLocaleString()} 个文本字符。原生占用表尚包含这些轮次；实际请求会按选择过滤。`), tools, node("p", { class: "dp-muted" }, "生成 MD 总结会给 DeepSeek 发送指令，在当前工作区创建总结文件并返回路径。取消勾选可排除整轮历史，原始对话保留；系统指令、最近一轮和进行中的轮次始终保留。"), list);
        for (const turn of data.turns.slice().reverse()) {
            const available = turn.in_surface && !turn.protected && !data.running;
            const checkbox = node("input", { type: "checkbox", checked: !turn.excluded || turn.protected, disabled: !available, "aria-label": `将第 ${turn.turn} 轮纳入上下文`, "data-mutation": "true" });
            checkbox.dataset.protected = String(!available);
            checkbox.addEventListener("change", () => {
                const next = checkbox.checked ? data.excluded.filter(value => value !== turn.turn) : [...data.excluded, turn.turn];
                void run(async () => {
                    let committed = false;
                    try {
                        await api("context", { session_id: active_session, excluded: next });
                        committed = true;
                        await context_tab();
                        say("上下文选择已保存，下次请求生效。");
                    } finally { if (!committed) checkbox.checked = !turn.excluded; }
                });
            });
            list.append(node("label", { class: `dp-turn${turn.excluded ? " dp-excluded" : ""}` }, checkbox, node("span", {}, node("strong", {}, `第 ${turn.turn} 轮 · ${turn.characters.toLocaleString()} 字符${turn.protected ? " · 保留" : !turn.in_surface ? " · 已归档/压缩" : ""}`), node("span", { class: "dp-turn-preview" }, turn.preview))));
        }
        if (!data.turns.length) list.append(node("p", { class: "dp-empty" }, "当前会话还没有可管理的历史轮次。"));
        say(data.running ? "会话正在生成，完成后可修改上下文。" : "勾选的轮次会发送给模型，未勾选的轮次可随时恢复。");
        update_busy();
    }

    async function cleanup_tab() {
        const current = generation;
        const id = active_session;
        say("正在准备当前会话的清理指令…");
        const data = await api(`cleanup?${new URLSearchParams({ session_id: id })}`);
        if (current !== generation) return;
        if (!data.cwd) {
            content.replaceChildren(node("p", { class: "dp-empty" }, "此会话没有本地工作区，请先为会话选择工作区。"));
            say("未发送清理指令。");
            return;
        }
        const input = node("textarea", { class: "dp-cleanup-prompt", rows: 13, maxlength: 12000, "aria-label": "清理指令", "data-mutation": "true" });
        input.value = cleanup_drafts.get(id) ?? data.prompt;
        input.addEventListener("input", () => cleanup_drafts.set(id, input.value));
        const send = action("发送清理指令给 DeepSeek", () => run(async view => {
            const text = input.value.trim();
            if (!text) throw new Error("清理指令不能为空。");
            const result = await with_session(id, session => session.prompt([{ type: "text", text }], "queue", lifetime.signal));
            if (!result.ok) throw new Error(result.error?.message || "清理指令未确认发送，请查看原会话后重试。");
            cleanup_drafts.delete(id);
            if (view !== generation) return;
            say("清理指令已发送，DeepSeek 将在原会话执行并汇报结果。");
            dialog.close();
        }));
        content.replaceChildren(node("h3", {}, "清理当前会话的垃圾文件"), node("p", { class: "dp-path" }, data.cwd), node("p", { class: "dp-muted" }, "将下面的指令作为一条消息发送到当前会话，由 DeepSeek 检查并执行清理。可先编辑指令；原有输入草稿会保留。"), node("label", { class: "dp-cleanup-label" }, "清理指令", input), node("div", { class: "dp-actions" }, send, action("恢复默认指令", () => { input.value = data.prompt; cleanup_drafts.delete(id); }, true)));
        say(data.running ? "当前任务仍在运行，清理指令会排队执行。" : "点击发送后才执行，不会自动清理文件。");
        update_busy();
    }

    function reset_requests() {
        generation++;
        clearTimeout(search_timer);
        search_controller?.abort();
        controller.abort();
        controller = new AbortController();
        pending = false;
    }

    async function render_tab() {
        reset_requests();
        active_session = current_id();
        dialog.querySelector(".dp-session").textContent = active_session ? `当前会话 · ${session_title(active_session)}` : "当前未选择会话";
        for (const button of dialog.querySelectorAll("[data-tab]")) button.setAttribute("aria-pressed", String(button.dataset.tab === active_tab));
        content.replaceChildren();
        if (!assistant.has(active_tab) && active_tab !== "search" && !active_session) { content.append(node("p", { class: "dp-empty" }, "先打开一个会话，再管理它的文件与上下文。")); say(""); return; }
        try {
            if (assistant.has(active_tab)) await assistant.render(active_tab);
            else if (active_tab === "search") await search_tab();
            else if (active_tab === "checkpoints") await checkpoints_tab();
            else if (active_tab === "context") await context_tab();
            else await cleanup_tab();
        } catch (error) { if (error.name !== "AbortError") say(error.message, true); }
    }

    function open_panel(tab) { if (typeof tab === "string") active_tab = tab; if (!dialog.open) dialog.showModal(); void render_tab(); }
    const assistant = mount_assistant({ node, action, api, run, say, sessions, navigation, content, dialog, lifetime, open_panel, get_view: () => generation, get_session: () => active_session });
    dialog.querySelector(".dp-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", reset_requests);
    for (const button of dialog.querySelectorAll("[data-tab]")) button.addEventListener("click", () => { active_tab = button.dataset.tab; void render_tab(); });
    const stop_selection = navigation.selection.subscribe(() => { if (dialog.open && current_id() !== active_session) void render_tab(); });
    const keyboard = event => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyF") { event.preventDefault(); active_tab = "search"; open_panel(); }
    };
    document.addEventListener("keydown", keyboard);
    const release = slots.inject("sidebar.footer.action", () => slots.register({ name: "sidebar.footer.action", id: "dsh-productivity", order: 5 }, ({ wide }) => React.createElement("button", { type: "button", className: "dp-launch", onClick: open_panel, title: "效率中心 · Ctrl+Shift+F", "aria-label": "打开效率中心" }, React.createElement("span", { "aria-hidden": true }, "⌕"), wide ? "效率中心" : null)));
    const release_top_up = slots.inject("sidebar.footer.action", () => slots.register({ name: "sidebar.footer.action", id: "dsh-productivity-top-up", order: 6 }, ({ wide }) => React.createElement("a", { className: "dp-launch dp-top-up-launch", href: TOP_UP_URL, target: "_blank", rel: "noopener noreferrer", title: "DeepSeek 官方 API 充值", "aria-label": "打开 DeepSeek 官方 API 充值页面" }, React.createElement("span", { "aria-hidden": true }, "↗"), wide ? "API 充值" : null)));

    return () => {
        disposed = true;
        lifetime.abort();
        reset_requests();
        assistant.dispose();
        release();
        release_top_up();
        stop_selection();
        document.removeEventListener("keydown", keyboard);
        if (dialog.open) dialog.close();
        dialog.remove();
        style.remove();
    };
}

exports.name = "dsh-productivity";
exports.apply = ctx => {
    ctx.inject(["slots", "uiWorkspace", "sessions"], owner => owner.effect(() => mount_productivity(owner)));
};
