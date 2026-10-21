window.__ModuleLoader__.load({ id: "dsh-productivity", factory: (require) => {
const module = { exports: {} }; const exports = module.exports;
function local_day(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function mount_assistant(options) {
    const { node, action, api, run, say, sessions, navigation, content, dialog, lifetime, open_panel, get_view, get_session } = options;
    const assistant_tabs = new Set(["chats", "memories", "tasks", "today"]);
    const drafts = new Map();
    let snapshot = null;
    let active_tab = "chats";
    let memory_edit = null;
    let task_edit = null;
    let document_key = "memory";
    let selected_day = null;
    let checking_reminder = false;
    let disposed = false;
    let placement_frame = null;
    let retry_timer = null;
    let checked_day = null;
    let toast = null;

    function field(label, element) { return node("label", { class: "dp-field" }, node("span", {}, label), element); }
    function input(name, value = "", type = "text", limit = 200) { const element = node("input", { type, "aria-label": name, maxlength: limit }); element.value = value || ""; return element; }
    function area(name, value = "", limit = 10000) { const element = node("textarea", { rows: 5, "aria-label": name, maxlength: limit }); element.value = value; return element; }
    function select(name, entries, value) { const element = node("select", { "aria-label": name }, ...entries.map(([id, label]) => node("option", { value: id }, label))); element.value = value || ""; return element; }
    function check(name, value) { return node("input", { type: "checkbox", checked: value === true, "aria-label": name }); }
    function automation_switch(key, label) {
        const toggle = check(label, snapshot.settings[key]);
        toggle.dataset.mutation = "true";
        toggle.addEventListener("change", () => void run(async () => { await change("settings.save", { [key]: toggle.checked }, null); await refresh(); }));
        return field(label, toggle);
    }
    function source_note(quote) { return node("details", { class: "dp-source-note" }, node("summary", {}, "自动整理依据"), node("p", { class: "dp-snippet" }, quote || "来自已保存并加入当天的任务，没有额外推断用户原话。")); }
    function rows() { const catalog = sessions.list.getSnapshot(); return (catalog.ids || Object.keys(catalog.byId || {})).map(id => ({ id, ...catalog.byId[id] })); }
    function title(id) { return sessions.list.getSnapshot().byId?.[id]?.title || id || "未设置"; }
    function session_options() { return [["", "不关联会话"], ...rows().map(row => [row.id, row.title || "未命名会话"])]; }
    function keep(key, form, values) { form.addEventListener("input", () => drafts.set(key, values())); form.addEventListener("change", () => drafts.set(key, values())); }
    function form_with(label, children, save) {
        const form = node("form", { class: "dp-assistant-form" }, ...children);
        const button = node("button", { type: "submit", class: "dp-primary", "data-mutation": "true" }, label);
        form.append(button);
        form.addEventListener("submit", event => { event.preventDefault(); void run(save); });
        return form;
    }
    async function change(kind, item, session_id = get_session(), extra = {}) {
        const result = await api("assistant/changes", { kind, item, revision: snapshot.revision, ...(session_id ? { session_id } : {}), day: local_day(), ...extra }, lifetime.signal);
        snapshot = result;
        update_sidebar();
        return result;
    }
    async function refresh() { await render(active_tab); }
    async function open_session(id) {
        if (!rows().some(row => row.id === id)) throw new Error("该会话已删除或尚未加载，请刷新列表后重试。");
        navigation.openSession(id);
        dialog.close();
    }
    async function send_prompt(id, text) {
        if (!id) throw new Error("请先打开或设置一个会话。");
        const result = await sessions.using(id, { source: "dsh-productivity-assistant", signal: lifetime.signal }, reference => reference.binding.session.prompt([{ type: "text", text }], "queue", lifetime.signal));
        if (!result.ok) throw new Error(result.error?.message || "指令未确认发送，请查看原会话。");
        await open_session(id);
    }
    async function create_chat(side, label) {
        const current = get_session();
        const parent_id = snapshot.main_session;
        if (side && !parent_id) throw new Error("请先设置主聊。");
        const parent = rows().find(row => row.id === (side ? parent_id : current));
        const id = await sessions.create(parent?.cwd ? { cwd: parent.cwd } : {});
        if (disposed) return;
        try {
            await change(side ? "side.add" : "main.set", { label: label || "新旁聊" }, id);
        } catch (error) { throw new Error(`${error.message} 新会话已创建，可在原生会话列表找到；请刷新后将其加入分组。`); }
        await open_session(id);
    }

    function chats_view() {
        const main = snapshot.main_session;
        const main_card = node("section", { class: "dp-result" }, node("h3", {}, "主聊 · 一直聊下去"), node("p", { class: "dp-muted" }, main ? title(main) : "选择一个已有会话，或创建一段持续的主聊。"));
        const picker = select("选择主聊会话", session_options(), main || get_session());
        main_card.append(picker, node("div", { class: "dp-actions" }, action("设为主聊", () => run(async () => { if (!picker.value) throw new Error("请选择会话。"); await change("main.set", {}, picker.value); await refresh(); })), action("新建主聊", () => run(() => create_chat(false)), true)));
        if (main) main_card.append(action("进入主聊", () => run(() => open_session(main)), true));
        const side_label = input("旁聊名称", drafts.get("side_label") || "", "text", 120);
        side_label.placeholder = "例如：准备考试、整理文件";
        side_label.addEventListener("input", () => drafts.set("side_label", side_label.value));
        const side_form = form_with("新建旁聊", [field("旁聊名称", side_label)], async () => { await create_chat(true, side_label.value.trim() || "新旁聊"); drafts.delete("side_label"); });
        side_form.append(action("将当前会话加入旁聊", () => run(async () => { if (!get_session()) throw new Error("请先选择当前会话。"); await change("side.add", { label: side_label.value.trim() || title(get_session()) }); await refresh(); }), true));
        const list = node("section", {}, node("h3", {}, "旁聊 · 每个主题各自展开"), side_form);
        for (const row of snapshot.sides) {
            list.append(node("article", { class: "dp-result" }, node("h3", {}, row.label), node("p", { class: "dp-muted" }, `${title(row.session_id)} · 主聊：${title(row.parent_id)}`), node("div", { class: "dp-actions" }, action("打开旁聊", () => run(() => open_session(row.session_id)), true), action("移出分组", () => run(async () => { await change("side.remove", { session_id: row.session_id }, null); await refresh(); }), true))));
        }
        if (!snapshot.sides.length) list.append(node("p", { class: "dp-muted" }, "旁聊使用独立的原生会话，共享适用的长期记忆；移出分组保留原对话。"));
        const summary = area("带回主聊的结论", drafts.get("handoff") || "", 6000);
        summary.addEventListener("input", () => drafts.set("handoff", summary.value));
        const handoff = form_with("发送结论到主聊", [field("旁聊结论（可编辑后带回主聊）", summary)], async () => {
            const text = summary.value.trim();
            if (!text) throw new Error("请先填写结论。");
            const latest = await api("assistant");
            if (latest.main_session !== main) throw new Error("主聊已改变，请刷新后重新发送。");
            await send_prompt(main, `以下是用户确认带回主聊的旁聊结论，请结合当前目标继续。\n\n${text}`);
            drafts.delete("handoff");
        });
        handoff.append(action("请 DeepSeek 总结当前旁聊", () => run(() => send_prompt(get_session(), "请总结本旁聊的结论、关键决定和待办，供我编辑后带回主聊。只在本会话回复，不自动发送给其他会话。")), true));
        content.append(main_card, list, handoff);
        say("主聊与旁聊按原生会话分开保存，长期记忆按范围共享。");
    }

    function memories_view() {
        const automatic = check("对话中主动记忆", snapshot.settings.auto_memory);
        automatic.dataset.mutation = "true";
        automatic.addEventListener("change", () => void run(async () => { await change("settings.save", { auto_memory: automatic.checked }, null); await refresh(); }));
        content.append(field("允许 DeepSeek 在对话中主动记住稳定事实与偏好", automatic));
        const docs = select("记忆文档", [["memory", "Memory.md · 用户记忆"], ["soul", "Soul.md · 原则与人设"], ["identity", "Identity.md · 名称与风格"]], document_key);
        docs.addEventListener("change", () => { document_key = docs.value; paint_snapshot(); });
        const key = `doc:${document_key}`;
        const document = snapshot.documents[document_key];
        const document_draft = drafts.get(key);
        const editor = area("记忆文档内容", document_draft?.text ?? document.text, 12000);
        editor.rows = 8;
        const baseline_hash = document_draft?.hash || document.hash;
        editor.addEventListener("input", () => drafts.set(key, { text: editor.value, hash: baseline_hash }));
        const document_form = form_with("保存记忆文档", [docs, field("可直接编辑的 Markdown 文档", editor), node("p", { class: "dp-path" }, document.path)], async () => { await change("document.save", { key: document_key, text: editor.value, hash: baseline_hash }, null); drafts.delete(key); await refresh(); say("文档已保存，下次请求读取新内容。"); });
        if (document.notice) document_form.append(node("p", { class: "dp-muted" }, document.notice));
        if (document.available === false) {
            editor.disabled = true;
            const save = document_form.querySelector("button[type=submit]");
            save.disabled = true; save.dataset.protected = "true";
        }
        document_form.append(action("丢弃草稿并重载文档", () => { drafts.delete(key); void refresh().catch(error => say(error.message, true)); }, true));
        content.append(document_form, node("h3", {}, "记忆条目"), node("p", { class: "dp-muted" }, "可以说“记住我偏好……”或“忘记关于……的记忆”。记忆按当前消息相关词召回，置顶条目优先；不会额外发起后台模型请求。忘记记忆不删除原聊天记录。"));
        const search = input("筛选记忆", drafts.get("memory_search") || "");
        search.placeholder = "搜索记忆标题或内容";
        const list = node("div", {});
        function filter_rows() {
            const query = search.value.trim().toLocaleLowerCase();
            drafts.set("memory_search", search.value);
            list.replaceChildren();
            for (const row of snapshot.memories.filter(row => `${row.title}\n${row.text}`.toLocaleLowerCase().includes(query))) {
                const scope = row.scope === "global" ? "全局" : row.scope === "session" ? "指定会话" : "指定工作区";
                list.append(node("article", { class: "dp-result" }, node("h3", {}, `${row.pinned ? "★ " : ""}${row.title}`), node("p", { class: "dp-muted" }, `${scope} · ${row.enabled ? "生效" : "暂停"} · ${row.automatic ? "对话记忆" : "手动保存"}`), node("p", { class: "dp-snippet" }, row.text), node("div", { class: "dp-actions" }, action("编辑记忆", () => { memory_edit = row.id; drafts.delete("memory_form"); void refresh().catch(error => say(error.message, true)); }, true), action("忘记这条记忆", () => run(async () => { await change("memory.remove", { id: row.id }, null); if (memory_edit === row.id) memory_edit = null; await refresh(); }), true))));
                if (row.source_quote) list.lastElementChild.append(source_note(row.source_quote));
            }
            if (!list.childElementCount) list.append(node("p", { class: "dp-empty" }, "尚无匹配记忆。"));
        }
        search.addEventListener("input", filter_rows);
        filter_rows();
        content.append(search, list);
        const old = snapshot.memories.find(row => row.id === memory_edit);
        const draft = drafts.get("memory_form") || old || {};
        const name = input("记忆标题", draft.title, "text", 120);
        const text = area("记忆内容", draft.text || "", 2000);
        const scope = select("记忆适用范围", [["global", "全局共享"], ["workspace", "当前工作区"], ["session", "当前会话"]], draft.scope || "global");
        const category = select("记忆分类", [["fact", "事实"], ["preference", "偏好"], ["project", "项目"], ["daily", "近期背景"]], draft.category || "fact");
        const enabled = check("启用记忆", draft.enabled !== false);
        const pinned = check("置顶记忆", draft.pinned);
        const values = () => ({ title: name.value, text: text.value, scope: scope.value, category: category.value, enabled: enabled.checked, pinned: pinned.checked });
        const form = form_with(old ? "保存记忆修改" : "添加记忆", [field("记忆标题", name), field("记忆内容", text), node("div", { class: "dp-form-grid" }, field("适用范围", scope), field("分类", category)), node("div", { class: "dp-actions" }, field("启用", enabled), field("置顶", pinned))], async () => {
            const id = old && old.scope === scope.value && old.scope !== "global" ? old.scope === "session" ? old.scope_key : old.source_session : get_session();
            await change("memory.save", { ...values(), ...(old ? { id: old.id } : {}) }, id);
            memory_edit = null; drafts.delete("memory_form"); await refresh();
        });
        keep("memory_form", form, values);
        if (old) form.append(action("取消编辑", () => { memory_edit = null; drafts.delete("memory_form"); void refresh().catch(error => say(error.message, true)); }, true));
        content.append(form);
        say(`${snapshot.memories.length} 条长期记忆 · 三份 Markdown 文档会在每次请求时重新读取。`);
    }

    function task_row(row, today) {
        const checked = check(`完成：${row.title}`, row.done);
        checked.dataset.mutation = "true";
        checked.addEventListener("change", () => void run(async () => { await change("task.save", { ...row, done: checked.checked }, null); await refresh(); }));
        const children = snapshot.tasks.filter(item => item.parent_id === row.id);
        const details = [row.kind === "goal" ? "目标" : "待办", row.due ? `截止 ${row.due}${!row.done && row.due < today ? " · 已逾期" : ""}` : "", row.kind === "goal" && children.length ? `${children.filter(item => item.done).length}/${children.length} 项完成` : ""].filter(Boolean).join(" · ");
        const card = node("article", { class: `dp-result dp-task${row.done ? " dp-task-done" : ""}` }, node("div", { class: "dp-task-heading" }, checked, node("h3", {}, row.title)), node("p", { class: "dp-muted" }, details));
        if (row.notes) card.append(node("p", { class: "dp-snippet" }, row.notes));
        const actions = node("div", { class: "dp-actions" }, action("编辑任务", () => { task_edit = row.id; drafts.delete("task_form"); open_panel("tasks"); }, true));
        if (!row.done) actions.append(action(row.plan_date === today ? "移出今日" : "加入今日", () => run(async () => { await change("task.save", { ...row, plan_date: row.plan_date === today ? null : today }, null); await refresh(); }), true));
        if (row.session_id) actions.append(action("相关对话", () => run(() => open_session(row.session_id)), true));
        actions.append(action("删除任务", () => run(async () => { await change("task.remove", { id: row.id }, null); if (task_edit === row.id) task_edit = null; await refresh(); }), true));
        card.append(actions);
        if (row.source_quote) card.append(source_note(row.source_quote));
        return card;
    }

    function tasks_view() {
        const today = local_day();
        const open = snapshot.tasks.filter(row => !row.done).length;
        content.append(automation_switch("auto_tasks", "对话中自动整理目标待办"), node("p", { class: "dp-muted" }, "根据你明确的安排、变更与进展记录任务；已有任务先查找再更新，模糊意向先询问。"));
        content.append(node("div", { class: "dp-metrics" }, node("strong", {}, `${open} 项进行中`), node("p", { class: "dp-muted" }, "目标可拆为多条待办，关联原会话，并加入今日计划。")));
        const old = snapshot.tasks.find(row => row.id === task_edit);
        const draft = drafts.get("task_form") || old || {};
        const name = input("任务标题", draft.title);
        const kind = select("任务类型", [["task", "待办"], ["goal", "目标"]], draft.kind || "task");
        const parent = select("所属目标", [["", "独立待办"], ...snapshot.tasks.filter(row => row.kind === "goal" && row.id !== old?.id).map(row => [row.id, row.title])], draft.parent_id);
        const due = input("截止日期", draft.due, "date");
        const notes = area("任务备注", draft.notes || "", 4000);
        const related = select("关联会话", session_options(), draft.session_id || "");
        if (draft.session_id && !rows().some(row => row.id === draft.session_id)) related.append(node("option", { value: draft.session_id, selected: "selected" }, "原会话已不可用（可取消关联）"));
        const planned = check("加入今日计划", draft.plan_date === today);
        const values = () => ({ title: name.value, kind: kind.value, parent_id: parent.value, due: due.value, notes: notes.value, session_id: related.value, plan_date: planned.checked ? today : null });
        const form = form_with(old ? "保存任务修改" : "添加目标或待办", [field("标题", name), node("div", { class: "dp-form-grid" }, field("类型", kind), field("所属目标", parent), field("截止日期", due), field("关联会话", related)), field("备注", notes), field("加入今日计划", planned)], async () => { await change("task.save", { ...values(), ...(old ? { id: old.id, done: old.done } : {}) }, related.value); task_edit = null; drafts.delete("task_form"); await refresh(); });
        keep("task_form", form, values);
        if (old) form.append(action("取消任务编辑", () => { task_edit = null; drafts.delete("task_form"); void refresh().catch(error => say(error.message, true)); }, true));
        const creator = node("details", { class: "dp-task-creator" }, node("summary", {}, old ? "编辑所选任务" : "新建目标或待办…"), form);
        creator.open = !!old || !snapshot.tasks.length;
        content.append(creator);
        const filter = select("任务筛选", [["open", "进行中"], ["all", "全部"], ["done", "已完成"]], drafts.get("task_filter") || "open");
        const list = node("div", {});
        function filter_rows() { drafts.set("task_filter", filter.value); list.replaceChildren(...snapshot.tasks.filter(row => filter.value === "all" || row.done === (filter.value === "done")).sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "9999").localeCompare(b.due || "9999")).map(row => task_row(row, today))); if (!list.childElementCount) list.append(node("p", { class: "dp-empty" }, "这里还没有任务。")); }
        filter.addEventListener("change", filter_rows); filter_rows(); content.append(filter, list);
        say("勾选完成会保存状态；删除目标前需先处理其待办。");
    }

    function today_view() {
        const day = selected_day || local_day();
        const state = drafts.get(`day:${day}`) || snapshot.days[day] || {};
        const plan = area("今日计划", state.plan || "");
        const review = area("今日复盘", state.review || "");
        const tasks = snapshot.tasks.filter(row => row.plan_date === day || row.completed_on === day || !row.done && row.due && row.due <= day);
        content.append(node("h3", {}, `${day} · 今日计划与复盘`), node("p", { class: "dp-muted" }, "每天首次进入时提醒一次。选择稍后会关闭当天提醒；今天的计划和复盘随时可从效率中心查看。"));
        content.append(automation_switch("auto_plan", "对话中自动完善今日计划"));
        const date_picker = input("计划与复盘日期", day, "date");
        date_picker.addEventListener("change", () => { if (date_picker.value) { selected_day = date_picker.value; void refresh().catch(error => say(error.message, true)); } });
        content.append(field("查看或补写某一天", date_picker));
        const automatic_entries = snapshot.days[day]?.auto_entries || [];
        const automatic_list = node("section", { "aria-label": "对话自动整理记录" }, node("h3", {}, "随对话更新"), node("p", { class: "dp-muted" }, "自动计划与复盘单独保存，手写内容保留；更改安排时可直接在聊天里说。"));
        for (const entry of automatic_entries) automatic_list.append(node("article", { class: "dp-result" }, node("h3", {}, entry.kind === "plan" ? "计划更新" : "进展与复盘"), node("p", { class: "dp-snippet" }, entry.text), source_note(entry.source_quote), action("移除此条自动记录", () => run(async () => { await change("day.entry.remove", { entry_id: entry.id }, null, { day }); await refresh(); }), true)));
        if (!automatic_entries.length) automatic_list.append(node("p", { class: "dp-muted" }, "聊到明确安排或进展后，DeepSeek 可以在这里记录；不会为了填满页面编造计划。"));
        content.append(automatic_list);
        const form = form_with("保存今日计划与复盘", [field("今日计划", plan), field("今日复盘", review)], async () => { await change("day.save", { plan: plan.value, review: review.value }, null, { day }); drafts.delete(`day:${day}`); await refresh(); say("今日计划与复盘已保存。"); });
        keep(`day:${day}`, form, () => ({ plan: plan.value, review: review.value }));
        const target = get_session() || snapshot.main_session;
        const task_data = JSON.stringify(tasks.map(({ title, notes, due, done }) => ({ title, notes, due, done })));
        const automatic_text = automatic_entries.map(entry => entry.text).join("\n");
        const save_guidance = snapshot.settings.auto_plan ? "请先用 assistant_tasks 读取最新记录，把有明确依据的安排或进展保存为自动条目，保留手写内容；未经确认的新建议先与我商量。" : "只在聊天中提供建议，待我确认后再记录。";
        form.append(node("div", { class: "dp-actions" }, action("请 DeepSeek 帮我安排今天", () => run(() => send_prompt(target, `今天是 ${day}。请结合我的长期记忆和以下待办，给出可执行的今日计划，保留休息时间。${save_guidance}\n手写计划：${plan.value}\n自动记录：${automatic_text}\n待办资料：${task_data}`)), true), action("请 DeepSeek 帮我复盘", () => run(() => send_prompt(target, `请帮我复盘 ${day}：完成情况、阻碍、学到什么、明天第一步。不要猜测完成结果，未知部分先问我。${save_guidance}\n计划：${plan.value}\n我的记录：${review.value}\n自动记录：${automatic_text}\n任务状态：${task_data}`)), true)));
        content.append(form, node("h3", {}, `当天相关任务 · ${tasks.filter(row => row.done).length}/${tasks.length} 完成`), ...tasks.map(row => task_row(row, local_day())));
        if (!tasks.length) content.append(node("p", { class: "dp-empty" }, "可在目标待办中把任务加入今日。"));
        const history = Object.keys(snapshot.days).filter(date => date !== day).sort().reverse().slice(0, 30);
        if (history.length) content.append(node("details", {}, node("summary", {}, "最近的计划与复盘"), ...history.map(date => node("article", { class: "dp-result" }, node("h3", {}, date), node("p", { class: "dp-snippet" }, snapshot.days[date].plan || "未写手写计划"), node("p", { class: "dp-snippet" }, snapshot.days[date].review || "未写手写复盘"), ...(snapshot.days[date].auto_entries || []).map(entry => node("p", { class: "dp-snippet" }, entry.text))))));
        say("开启自动整理后，DeepSeek 可随明确安排和进展更新自动记录，手写内容保留。");
    }

    function persistence_panel() {
        const id = get_session();
        const panel = node("section", { class: "dp-result dp-persistence", "aria-label": "模型工具保存状态" }, node("h3", {}, "当前会话 · 模型工具保存状态"));
        if (!id) { panel.append(node("p", { class: "dp-muted" }, "选择一个会话后可检查其记忆、待办和计划保存情况。")); return panel; }
        if (!snapshot.diagnostics_version) { panel.append(node("p", { class: "dp-muted" }, "当前后台尚不提供保存状态，请完整退出 DSH（含托盘）后启动新版。")); return panel; }
        const statuses = snapshot.persistence_status?.[id]?.features || {};
        const labels = { saved: "已写入", blocked: "保存被拒绝", failed: "保存失败", disabled: "自动整理关闭", not_written: "本轮尚未保存" };
        for (const [feature, label] of [["memories", "长期记忆"], ["tasks", "目标待办"], ["plan", "今日计划"]]) {
            const status = statuses[feature];
            const row = node("div", { class: "dp-save-row", "data-save-state": status?.state || "unknown" }, node("strong", {}, `${label} · ${labels[status?.state] || "暂无工具保存记录"}`), node("p", { class: "dp-muted" }, status?.reason || "此版本启用后开始记录；口头回答、读取和搜索不表示写入。"));
            if (status?.last_saved_at) row.append(node("small", { class: "dp-muted" }, `最近成功写入：${new Date(status.last_saved_at).toLocaleString()}`));
            panel.append(row);
        }
        panel.append(action("补整理当前对话", () => run(() => send_prompt(id, "请补整理当前会话中用户提供的真实信息，落实到已开启的长期记忆、目标待办和今日计划。先用 assistant_memory.read/search 与 assistant_tasks.list 读取最新开关、已有条目和 revision；只处理已开启项，先查重再保存。本次是用户明确要求补整理，可使用 mode=requested；不要因为较早一次自动保存被拒绝就只做口头承诺。今日计划保留手写内容，优先更新对应待办并加入正确日期；需要独立自动记录时仍需真实用户原话作为 evidence。若没有值得记录的信息或工具失败，说明实际原因；只有工具写入成功才说已保存。")), true));
        return panel;
    }

    function paint_snapshot() {
        content.replaceChildren(node("div", { class: "dp-assistant-toolbar" }, node("small", {}, "PERSONAL ASSISTANT"), action("刷新助理数据", () => run(refresh), true)));
        if (active_tab !== "chats") content.append(persistence_panel());
        if (active_tab === "chats") chats_view();
        else if (active_tab === "memories") memories_view();
        else if (active_tab === "tasks") tasks_view();
        else today_view();
    }

    async function render(tab) {
        active_tab = tab;
        const view = get_view();
        const result = await api("assistant");
        if (disposed || view !== get_view()) return;
        if (result.assistant_api_version !== 2) throw new Error("新版界面已加载，后台仍是旧版本。请完整退出 DSH（包括托盘）后重新启动，以加载对话自动整理工具。");
        snapshot = result;
        update_sidebar();
        paint_snapshot();
    }

    const chat_links = node("div", { class: "dp-chat-links", "aria-label": "主聊与旁聊" });
    function rail_button(label, symbol, callback) { return node("button", { type: "button", class: "dp-rail-row", "aria-label": label, title: label, onClick: callback }, node("span", { "aria-hidden": "true" }, symbol), node("span", { class: "dp-rail-label" }, label)); }
    const main_button = rail_button("主聊", "◉", () => {
        void api("assistant", undefined, lifetime.signal).then(data => {
            if (disposed) return;
            snapshot = data; update_sidebar();
            if (data.main_session && rows().some(row => row.id === data.main_session)) navigation.openSession(data.main_session);
            else open_panel("chats");
        }).catch(error => { if (!disposed && error.name !== "AbortError") { open_panel("chats"); say(error.message, true); } });
    });
    const side_button = rail_button("旁聊", "⑂", () => { open_panel("chats"); });
    const side_rows = node("div", { class: "dp-side-rows" });
    chat_links.append(main_button, side_button, side_rows);
    const goals_link = rail_button("目标待办", "☑", () => open_panel("tasks"));
    goals_link.classList.add("dp-goals-link");
    function update_sidebar() {
        if (!snapshot || disposed) return;
        side_rows.replaceChildren(...snapshot.sides.filter(row => rows().some(item => item.id === row.session_id)).slice(-5).map(row => {
            const button = rail_button(row.label, "·", () => { navigation.openSession(row.session_id); });
            button.classList.add("dp-side-row");
            return button;
        }));
        main_button.title = snapshot.main_session ? `主聊 · ${title(snapshot.main_session)}` : "主聊 · 点击设置";
    }
    function place_sidebar() {
        placement_frame = null;
        const new_button = document.querySelector("button[class*='_newSession']");
        if (!new_button) return;
        if (new_button.nextElementSibling !== chat_links) new_button.after(chat_links);
        const collapsed = String(!new_button.querySelector("[class*='_newSessionContent'] > span"));
        chat_links.dataset.collapsed = collapsed;
        const panel_list = new_button.parentElement.querySelector("nav[class*='_panelList']") || document.querySelector("nav[class*='_panelList']");
        if (panel_list && panel_list.lastElementChild !== goals_link) panel_list.append(goals_link);
        goals_link.dataset.collapsed = collapsed;
    }
    const observer = new MutationObserver(() => { if (placement_frame === null) placement_frame = requestAnimationFrame(place_sidebar); });
    observer.observe(document.body, { childList: true, subtree: true });
    place_sidebar();
    void api("assistant", undefined, lifetime.signal).then(data => { if (!disposed) { snapshot = data; update_sidebar(); } }).catch(() => {});

    async function check_reminder() {
        if (disposed || checking_reminder || document.visibilityState !== "visible") return;
        const day = local_day();
        if (checked_day === day) return;
        if (document.querySelector(".ep_boot, dialog[open]")) {
            clearTimeout(retry_timer);
            retry_timer = setTimeout(check_reminder, 2000);
            return;
        }
        checking_reminder = true;
        try {
            const result = await api("assistant/reminders", { day }, lifetime.signal);
            if (disposed) return;
            checked_day = day;
            if (!result.claimed) return;
            toast?.remove();
            toast = node("section", { class: "dp-daily-reminder", role: "status", "aria-label": "每日计划提醒" }, node("strong", {}, "今天，想先完成哪件事？"), node("p", {}, "安排今日计划，也可以补上昨天的复盘。"), node("div", { class: "dp-actions" }, node("button", { type: "button", class: "dp-primary", onClick: () => { toast?.remove(); selected_day = null; open_panel("today"); } }, "查看今日计划"), node("button", { type: "button", class: "dp-secondary", onClick: () => toast?.remove() }, "稍后")));
            document.body.append(toast);
        } catch (error) {
            if (error.name !== "AbortError") { clearTimeout(retry_timer); retry_timer = setTimeout(check_reminder, 30000); }
        } finally { checking_reminder = false; }
    }
    const focus = () => { void check_reminder(); };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("focus", focus);
    const daily_timer = setInterval(focus, 60000);
    void check_reminder();

    return {
        has: tab => assistant_tabs.has(tab), render,
        dispose() {
            disposed = true; observer.disconnect();
            if (placement_frame !== null) cancelAnimationFrame(placement_frame);
            clearInterval(daily_timer); clearTimeout(retry_timer);
            document.removeEventListener("visibilitychange", focus); window.removeEventListener("focus", focus);
            toast?.remove(); chat_links.remove(); goals_link.remove();
        },
    };
}

const STYLE_TEXT = ".dp-launch { display:flex; align-items:center; gap:9px; width:100%; padding:9px 12px; border:1px solid transparent; border-radius:10px; background:transparent; color:var(--ep-accent,#d7bd86); cursor:pointer; font:inherit; }\n.dp-launch:hover { background:rgba(201,169,240,.1); border-color:rgba(232,197,139,.2); }\n.dp-launch > span { font-size:23px; line-height:1; }\n.dp-top-up-launch { box-sizing:border-box; text-decoration:none; }\n.dp-top-up-launch:focus-visible { outline:2px solid var(--ep-accent,#d7bd86); outline-offset:2px; }\n.dp-header-actions { display:flex; align-items:center; gap:12px; flex-shrink:0; }\n.dp-top-up { padding:7px 10px; border:1px solid #d6b57655; border-radius:10px; color:#f0d29a; background:#c9a9f012; font-size:12px; white-space:nowrap; text-decoration:none; }\n.dp-top-up:hover { background:#e8c58b16; }\n.dp-dialog { width:min(900px,calc(100vw - 32px)); max-height:calc(100dvh - 48px); padding:0; border:1px solid rgba(232,197,139,.32); border-radius:24px; background:rgba(25,21,35,.94); color:#f0e7d7; box-shadow:0 28px 100px #0008; backdrop-filter:blur(32px); font:14px/1.65 system-ui,sans-serif; overflow:hidden; }\n.dp-dialog::backdrop { background:rgba(10,8,17,.48); backdrop-filter:blur(8px); }\n.dp-dialog *, .dp-dialog *::before, .dp-dialog *::after { box-sizing:border-box; }\n.dp-dialog button, .dp-dialog input, .dp-dialog select { font:inherit; }\n.dp-dialog button { cursor:pointer; }\n.dp-dialog button:disabled, .dp-dialog input:disabled { opacity:.45; cursor:default; }\n.dp-dialog :focus-visible { outline:2px solid #e8c58b; outline-offset:3px; }\n.dp-header { display:flex; align-items:center; justify-content:space-between; padding:22px 26px 8px; }\n.dp-header small { color:#c6a4ea; font-size:10px; letter-spacing:.19em; }\n.dp-header h2 { margin:2px 0 0; font-size:24px; font-weight:550; letter-spacing:.08em; color:#f0d29a; }\n.dp-close { width:34px; height:34px; border:0; border-radius:50%; color:#eedbbc; background:#ffffff09; font-size:24px!important; }\n.dp-session { margin:0; padding:0 26px 16px; color:#b6a9c1; font-size:12px; }\n.dp-tabs { display:flex; gap:8px; padding:0 26px 14px; border-bottom:1px solid #d7bb8b1e; overflow-x:auto; scrollbar-width:thin; }\n.dp-tabs button { flex-shrink:0; white-space:nowrap; }\n.dp-tabs button { border:1px solid transparent; border-radius:10px; padding:8px 20px; background:transparent; color:#bdb0cb; }\n.dp-tabs button[aria-pressed=true] { background:linear-gradient(120deg,#e8c58b1b,#c9a9f014); border-color:#e8c58b50; color:#f0d29a; }\n.dp-status { padding:12px 26px 0; margin:0; min-height:36px; color:#c5b8cf; font-size:12px; }\n.dp-status[data-error=true] { color:#ffb8aa; }\n.dp-content { padding:14px 26px 26px; overflow:auto; max-height:calc(100dvh - 265px); min-height:260px; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#c6a4ea66 transparent; }\n.dp-content h3 { margin:0 0 5px; font-size:15px; font-weight:550; color:#ebd2a6; }\n.dp-muted { color:#b4a7be; font-size:12px; overflow-wrap:anywhere; }\n.dp-search-controls { display:grid; grid-template-columns:minmax(180px,1fr) 125px 185px; gap:9px; }\n.dp-dialog input[type=search], .dp-dialog input[type=text], .dp-dialog select { border:1px solid #d8b97940; border-radius:10px; background:#0c081666; color:#f0d29a; padding:10px 12px; min-width:0; }\n.dp-dialog select { color-scheme:dark; padding:10px 8px; }\n.dp-dialog input::placeholder { color:#9a8eaa; }\n.dp-result { background:linear-gradient(120deg,#ffffff06,#c9a9f006); border:1px solid #d7bb8b22; border-radius:14px; padding:16px; margin:12px 0; overflow-wrap:anywhere; }\n.dp-result small { display:block; }\n.dp-snippet { white-space:pre-wrap; line-height:1.85; }\n.dp-dialog mark { background:#e8c58b25; color:#ffe2a7; border-radius:3px; padding:0 2px; }\n.dp-actions { display:flex; gap:10px; flex-wrap:wrap; }\n.dp-primary, .dp-secondary { padding:8px 14px; border-radius:9px; border:1px solid #d6b57655; background:#c9a9f012; color:#f0d29a; }\n.dp-primary { background:linear-gradient(130deg,#b58a4533,#83629c33); border-color:#d6b57680; }\n.dp-secondary:hover, .dp-primary:hover { background-color:#e8c58b16; }\n.dp-more { width:100%; }\n.dp-dialog details { border-top:1px solid #ffffff0d; margin-top:10px; padding-top:10px; }\n.dp-dialog summary { cursor:pointer; color:#d7c3e9; font-size:12px; overflow-wrap:anywhere; }\n.dp-dialog pre { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.8 ui-monospace,Consolas,monospace; max-height:350px; overflow:auto; padding:14px; border-radius:10px; background:#08061066; color:#e5d4f0; }\n.dp-diff { color:#e9d3a7!important; }\n.dp-create { display:flex; gap:10px; }\n.dp-create input { flex:1; }\n.dp-path { font-size:12px; color:#c9afd9; overflow-wrap:anywhere; }\n.dp-checkpoint { display:flex; align-items:center; justify-content:space-between; gap:15px; }\n.dp-preview:empty { display:none; }\n.dp-preview { margin-top:20px; padding:18px; border:1px solid #d6b57655; border-radius:14px; }\n.dp-confirm { display:flex; align-items:center; gap:10px; margin:20px 0 12px; }\n.dp-dialog input[type=checkbox] { accent-color:#d8b777; width:16px; height:16px; flex-shrink:0; }\n.dp-empty { padding:32px 12px; text-align:center; color:#b6a9c1; }\n.dp-metrics { background:linear-gradient(100deg,#d8b77712,#b28be31a); border:1px solid #d7bb8b33; border-radius:14px; padding:20px; }\n.dp-metrics strong { font-size:20px; font-weight:500; color:#f0d29a; }\n.dp-metrics progress { display:block; width:100%; height:8px; accent-color:#d8b777; margin-top:12px; border:0; border-radius:8px; overflow:hidden; }\n.dp-metrics progress::-webkit-progress-bar { background:#ffffff12; }\n.dp-metrics progress::-webkit-progress-value { background:linear-gradient(90deg,#d8b777,#b69bde); }\n.dp-turn { display:flex; align-items:flex-start; gap:12px; padding:16px 0; border-bottom:1px solid #ffffff0c; }\n.dp-turn > span { min-width:0; }\n.dp-turn strong { font-size:12px; color:#dac4ed; }\n.dp-turn-preview { display:block; margin-top:5px; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.8; }\n.dp-excluded .dp-turn-preview { opacity:.5; }\n.dp-compact-confirm { border:1px solid #d7bb8b55; border-radius:12px; padding:16px; margin:16px 0; }\n.dp-compact-confirm button { margin-right:10px; }\n.dp-cleanup-label { display:block; color:#d7c3e9; font-size:12px; }\n.dp-cleanup-prompt { display:block; width:100%; resize:vertical; min-height:240px; max-height:480px; margin:8px 0 18px; padding:16px; border:1px solid #d8b97940; border-radius:12px; background:#0c081666; color:#f0d29a; font:13px/1.9 system-ui,sans-serif; }\n@media(max-width:650px) { .dp-search-controls { grid-template-columns:1fr 1fr; } .dp-search-controls input { grid-column:1/-1; } .dp-header,.dp-tabs { padding-left:16px; padding-right:16px; } .dp-content { padding:14px 16px 20px; } .dp-session,.dp-status { padding-left:16px; padding-right:16px; } .dp-tabs { gap:3px; } .dp-tabs button { padding:8px 9px; white-space:nowrap; } .dp-checkpoint { align-items:flex-start; } }\n@media(prefers-reduced-transparency:reduce) { .dp-dialog { background:#191523; backdrop-filter:none; } .dp-dialog::backdrop { backdrop-filter:none; } }\n.dp-assistant-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; color:#c6a4ea; letter-spacing:.12em; }\n.dp-save-row { padding:9px 0; border-bottom:1px solid #d7bb8b16; }\n.dp-save-row strong { color:#d4bedf; font-size:12px; }\n.dp-save-row p { margin:3px 0; }\n.dp-save-row[data-save-state=saved] strong { color:#b7d7b3; }\n.dp-save-row:is([data-save-state=failed],[data-save-state=blocked]) strong { color:#ffb8aa; }\n.dp-persistence > button { margin-top:12px; }\n.dp-assistant-form { display:grid; gap:14px; padding:18px; margin:16px 0 24px; border:1px solid #d7bb8b2e; border-radius:16px; background:linear-gradient(140deg,#e8c58b08,#c9a9f009); }\n.dp-assistant-form > button { justify-self:start; }\n.dp-field { display:flex; flex-direction:column; gap:7px; font-size:12px; color:#cbb7dd; }\n.dp-field:has(> input[type=checkbox]) { flex-direction:row; align-items:center; justify-content:space-between; gap:12px; }\n.dp-assistant-form textarea { width:100%; resize:vertical; min-height:100px; max-height:400px; border:1px solid #d8b97940; border-radius:10px; background:#0c081666; color:#f0d29a; padding:12px; font:13px/1.85 system-ui,sans-serif; }\n.dp-assistant-form input, .dp-assistant-form select { width:100%; }\n.dp-assistant-form input[type=date] { border:1px solid #d8b97940; border-radius:10px; background:#0c081666; color:#f0d29a; padding:10px 12px; color-scheme:dark; }\n.dp-assistant-form input[type=checkbox] { width:16px; }\n.dp-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }\n.dp-task-heading { display:flex; align-items:center; gap:10px; }\n.dp-task-heading h3 { margin:0; }\n.dp-task-done .dp-task-heading h3 { opacity:.6; text-decoration:line-through; }\n.dp-chat-links { display:grid; gap:3px; margin:4px 0 8px; }\n.dp-side-row { padding-left:26px!important; font-size:12px!important; }\n.dp-side-row .dp-rail-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n.dp-chat-links[data-collapsed=true] .dp-side-rows { display:none; }\n.dp-rail-row { display:flex; align-items:center; gap:10px; width:100%; min-width:0; padding:9px 12px; border:1px solid transparent; border-radius:10px; background:transparent; color:var(--dsw-alias-label-secondary,#cbb7dd); cursor:pointer; font:inherit; font-size:13px; text-align:left; }\n.dp-rail-row > span:first-child { width:18px; flex-shrink:0; text-align:center; color:var(--ep-accent,#d7bd86); font-size:17px; }\n.dp-rail-row:hover { background:rgba(201,169,240,.1); border-color:rgba(232,197,139,.18); }\n.dp-rail-row:focus-visible { outline:2px solid var(--ep-accent,#d7bd86); outline-offset:2px; }\n.dp-chat-links[data-collapsed=true] .dp-rail-label, .dp-goals-link[data-collapsed=true] .dp-rail-label { display:none; }\n.dp-chat-links[data-collapsed=true] .dp-rail-row, .dp-goals-link[data-collapsed=true] { justify-content:center; padding-inline:0; }\n.dp-daily-reminder { position:fixed; right:24px; bottom:28px; z-index:10000; width:min(360px,calc(100vw - 32px)); box-sizing:border-box; padding:22px; border:1px solid #d8b97966; border-radius:20px; background:rgba(25,21,35,.96); color:#f0e7d7; box-shadow:0 16px 64px #0006; backdrop-filter:blur(24px); font:13px/1.75 system-ui,sans-serif; }\n.dp-daily-reminder strong { color:#f0d29a; font-size:16px; }\n.dp-daily-reminder p { color:#c5b8cf; margin:8px 0 16px; }\n.dp-daily-reminder button { cursor:pointer; font:inherit; }\n@media(max-width:650px) { .dp-form-grid { grid-template-columns:1fr; } .dp-assistant-toolbar { letter-spacing:0; } .dp-header-actions { gap:5px; } .dp-top-up { padding:6px; } .dp-daily-reminder { right:16px; bottom:16px; } }\n@media(prefers-reduced-transparency:reduce) { .dp-daily-reminder { background:#191523; backdrop-filter:none; } }\n";
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

return module.exports;
} });
