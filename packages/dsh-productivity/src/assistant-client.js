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
