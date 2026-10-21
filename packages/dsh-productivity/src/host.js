import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { Checkpoints, CheckpointError } from "./checkpoints.js";
import { ContextPolicies, filter_context, group_turns } from "./context.js";
import { cleanup_prompt } from "./cleanup.js";
import { summary_prompt } from "./summary.js";
import { randomUUID } from "node:crypto";
import { AssistantStore, memory_tool, tasks_tool } from "./assistant.js";

export const name = "dsh-productivity";
export const inject = ["webServer", "sessionQuery", "agents", "sessions", "tools"];
export const PREFIX = "/plugins/dsh-productivity/";

function session_id(value) {
    if (typeof value !== "string" || !value || value.length > 200 || /[\x00-\x20/\\]/.test(value)) throw new CheckpointError("请选择有效会话。", 400);
    return value;
}

async function read_body(req) {
    if (req.headers["x-dsh-productivity"] !== "1" || !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "") || req.headers["sec-fetch-site"] === "cross-site") throw new CheckpointError("请求来源无效。", 403);
    const origin = req.headers.origin;
    if (origin && origin !== "null") {
        const source = new URL(origin);
        if (source.protocol !== "dsh-desktop:" && source.host !== req.headers.host) throw new CheckpointError("请求来源无效。", 403);
    }
    let bytes = 0;
    const parts = [];
    for await (const part of req) {
        bytes += part.length;
        if (bytes > 65536) throw new CheckpointError("请求内容过大。", 413);
        parts.push(part);
    }
    try {
        const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
        if (!value || Array.isArray(value) || typeof value !== "object") throw new SyntaxError();
        return value;
    } catch (error) { if (error instanceof SyntaxError) throw new CheckpointError("JSON 请求无效。", 400); throw error; }
}

function snippet(text, query) {
    const index = Math.max(0, text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()));
    return `${index > 100 ? "…" : ""}${text.slice(Math.max(0, index - 100), index + query.length + 220)}${text.length > index + query.length + 220 ? "…" : ""}`;
}

export function create_productivity(ctx, storage) {
    const policies = new ContextPolicies(storage);
    const assistant = new AssistantStore(storage);
    const automatic_errors = new Map();
    const busy = async root => {
        for (const record of await ctx.sessionQuery.listSessions()) {
            if (!record.header.cwd || ctx.agents.get(record.header.id)?.status !== "running") continue;
            const actual = await realpath(record.header.cwd).catch(() => resolve(record.header.cwd));
            if (actual.toLocaleLowerCase() === root.toLocaleLowerCase()) return true;
        }
        return false;
    };
    const checkpoints = new Checkpoints(join(storage, "checkpoints"), { busy });
    const header = async id => (await ctx.sessionQuery.readSession(session_id(id))).session;

    async function search(params, signal) {
        const query = (params.get("q") || "").trim();
        if (!query || query.length > 300) return { items: [] };
        const scope = params.get("scope") || "all";
        const mode = params.get("mode") || "literal";
        let reference;
        if (scope !== "all") reference = await header(params.get("session_id"));
        const session_filters = scope === "session" ? [{ kind: "id", values: [reference.id] }] : scope === "workspace" ? [{ kind: "cwd", values: [reference.cwd ?? null] }] : [];
        let result;
        let native;
        let notice;
        if (mode === "indexed" && typeof ctx.sessionQuery.searchSessions === "function") {
            try {
                native = await ctx.sessionQuery.searchSessions({ query, sessionFilters: session_filters, limit: 20, ...(params.get("cursor") ? { cursor: params.get("cursor") } : {}) }, { signal });
            } catch (error) {
                if (error.code !== "SESSION_QUERY_SEARCH_DISABLED") throw error;
                notice = "此桌面配置未启用原生索引，已改用逐字匹配。";
            }
        }
        if (native) {
            result = { items: native.items.map(item => ({ session_id: item.header.id, cwd: item.header.cwd, seq: item.bestMatch.seq, type: item.bestMatch.type, surface: item.bestMatch.surface, snippet: item.bestMatch.snippet })), next_cursor: native.nextCursor };
        } else {
            const records = session_filters.length ? await ctx.sessionQuery.filterSessions(session_filters, signal) : await ctx.sessionQuery.listSessions(signal);
            const offset = Number(params.get("cursor") || 0);
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > records.length) throw new CheckpointError("搜索结果已变化，请重新搜索。", 400);
            const items = [];
            let index = offset;
            for (; index < records.length && items.length < 20; index++) {
                signal.throwIfAborted();
                const record = records[index];
                const hits = await ctx.sessionQuery.filterEvents(record.header.id, [{ kind: "text", text: query }]);
                if (hits.length) {
                    const match = hits[0];
                    items.push({ session_id: record.header.id, cwd: record.header.cwd, seq: match.seq, type: match.type, surface: match.surface, snippet: snippet(match.text, query), match_count: hits.length });
                }
            }
            result = { items, next_cursor: index < records.length ? String(index) : undefined, scanned: index, sessions: records.length };
        }
        signal.throwIfAborted();
        const titles = await ctx.sessionQuery.readTitleSnapshots(result.items.map(item => item.session_id), signal);
        const title_map = new Map(titles.filter(item => item.status === "fulfilled").map(item => [item.value.session.id, item.value.title?.title]));
        result.items = result.items.map(item => ({ ...item, title: title_map.get(item.session_id) || "未命名会话" }));
        return { ...result, notice };
    }

    async function context(id) {
        session_id(id);
        const observation = await ctx.sessionQuery.observeSession(id, { projectionMode: "all" });
        let events;
        let projections;
        try {
            events = observation.events;
            projections = observation.projections?.values || {};
        } finally { observation[Symbol.dispose](); }
        const surface = await ctx.sessionQuery.readSurface(id);
        const current_ids = new Set(surface.events.map(event => event.type === "user/message" ? event.data.id : event.data?.message?.id).filter(Boolean));
        const grouped = group_turns(events);
        const excluded = await policies.get(id);
        const newest = grouped.turns.at(-1)?.turn;
        return {
            session_id: id,
            pressure: projections.contextPressure ?? null,
            breakdown: projections.contextBreakdown ?? null,
            running: ctx.agents.get(id)?.status === "running",
            turns: grouped.turns.map(row => ({ turn: row.turn, preview: row.text || "工具执行与回复", characters: row.characters, complete: row.complete, in_surface: row.ids.some(message_id => current_ids.has(message_id)), protected: !row.complete || row.turn === newest, excluded: excluded.includes(row.turn) })),
            excluded,
        };
    }

    async function route(req, res) {
        const signal_controller = new AbortController();
        const abort = () => { if (!res.writableEnded) signal_controller.abort(); };
        req.on("aborted", abort);
        res.on("close", abort);
        const signal = signal_controller.signal;
        const reply = (status, body) => {
            if (res.destroyed) return;
            res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
            res.end(JSON.stringify(body));
        };
        try {
            const url = new URL(req.url || "/", "http://localhost");
            if (!url.pathname.startsWith(PREFIX)) return reply(404, { error: "接口不存在。" });
            const path = url.pathname.slice(PREFIX.length);
            if (!["GET", "POST"].includes(req.method)) return reply(405, { error: "请求方法无效。" });
            let result;
            if (req.method === "GET" && path === "assistant") result = await assistant.snapshot();
            else if (req.method === "POST" && path === "assistant/changes") {
                const body = await read_body(req);
                const session = body.session_id ? await header(body.session_id) : null;
                result = await assistant.change(body, session);
            } else if (req.method === "POST" && path === "assistant/reminders") {
                const body = await read_body(req);
                result = await assistant.claim_reminder(body.day);
            } else if (req.method === "GET" && path === "search") result = await search(url.searchParams, signal);
            else if (req.method === "GET" && path === "matches") {
                const id = session_id(url.searchParams.get("session_id"));
                const query = url.searchParams.get("q") || "";
                if (!query || query.length > 300) throw new CheckpointError("搜索词无效。", 400);
                const hits = await ctx.sessionQuery.filterEvents(id, [{ kind: "text", text: query }]);
                result = { total: hits.length, items: hits.slice(0, 100).map(hit => ({ seq: hit.seq, type: hit.type, surface: hit.surface, text: snippet(hit.text, query) })) };
            } else if (req.method === "GET" && path === "context") result = await context(url.searchParams.get("session_id"));
            else if (req.method === "GET" && path === "cleanup") {
                const id = session_id(url.searchParams.get("session_id"));
                const session = await header(id);
                result = { session_id: id, cwd: session.cwd ?? null, running: ctx.agents.get(id)?.status === "running", prompt: session.cwd ? cleanup_prompt(session.cwd) : "" };
            }
            else if (req.method === "GET" && path === "summary") {
                const id = session_id(url.searchParams.get("session_id"));
                const session = await header(id);
                result = { session_id: id, cwd: session.cwd ?? null, prompt: summary_prompt(session.cwd) };
            }
            else if (req.method === "GET" && path === "checkpoints") {
                const id = session_id(url.searchParams.get("session_id"));
                result = { ...await checkpoints.list((await header(id)).cwd), automatic_error: automatic_errors.get(id) };
            } else if (req.method === "POST") {
                const body = await read_body(req);
                const id = session_id(body.session_id);
                if (path === "context") {
                    if (ctx.agents.get(id)?.status === "running") throw new CheckpointError("会话正在生成，完成后再管理上下文。");
                    if (!Array.isArray(body.excluded) || body.excluded.length > 10000 || body.excluded.some(turn => !Number.isSafeInteger(turn) || turn < 0)) throw new CheckpointError("上下文轮次无效。", 400);
                    const state = await context(id);
                    const allowed = new Set(state.turns.filter(turn => !turn.protected && turn.complete && turn.in_surface).map(turn => turn.turn));
                    result = { excluded: await policies.set(id, body.excluded.filter(turn => allowed.has(turn))) };
                } else if (path.startsWith("checkpoints/")) {
                    const cwd = (await header(id)).cwd;
                    if (path === "checkpoints/create") result = await checkpoints.capture(cwd, typeof body.label === "string" && body.label.trim() ? body.label.trim() : "手动检查点", id);
                    else if (path === "checkpoints/preview") result = await checkpoints.preview(cwd, body.id);
                    else if (path === "checkpoints/restore") result = await checkpoints.restore(cwd, body.id, body.fingerprint, id);
                    else return reply(404, { error: "接口不存在。" });
                } else return reply(404, { error: "接口不存在。" });
            } else return reply(404, { error: "接口不存在。" });
            reply(200, result);
        } catch (error) {
            const messages = { SESSION_QUERY_STALE_CURSOR: "搜索结果已变化，请重新搜索。", SESSION_QUERY_SESSION_NOT_FOUND: "会话已不存在，请重新选择。" };
            if (!signal.aborted) reply(error.status || (messages[error.code] ? 409 : 500), { error: error.status ? error.message : messages[error.code] || "操作失败，请检查工作区状态后重试。", code: error.code });
        } finally {
            req.off("aborted", abort);
            res.off("close", abort);
        }
    }

    async function before_step({ agent, signal }, next) {
        const decision = await next();
        if (decision.kind === "reject" || signal.aborted) return decision;
        const excluded = await policies.get(agent.session.id);
        let messages = decision.messages.filter(message => message.source?.kind !== "dsh-productivity-assistant");
        if (!messages.length) return decision;
        if (excluded.length) messages = filter_context(agent.session.log, messages, excluded);
        const latest = messages.findLast(message => message.role === "user" && !["agent-instructions", "model-selection"].includes(message.source?.kind));
        const query = (latest?.content || []).filter(block => block.type === "text").map(block => block.text).join("\n");
        let text;
        try {
            if (latest?.id) await assistant.begin_turn(agent.session.id, latest.id).catch(() => {});
            text = await assistant.model_context({ id: agent.session.id, cwd: agent.session.header.cwd }, query);
        }
        catch (error) {
            if (!(error instanceof SyntaxError) && !error.status && !["ENOENT", "EACCES", "EPERM"].includes(error.code)) throw error;
            text = "个人助理的本地记忆暂不可读。本轮继续处理用户请求，请勿声称已读取或写入长期记忆；用户可在效率中心检查数据。";
        }
        signal.throwIfAborted();
        const memory = { id: randomUUID(), role: "user", content: [{ type: "text", text }], source: { kind: "dsh-productivity-assistant", form: "notice", summary: "个人助理 · 长期记忆与目标" } };
        const index = latest ? messages.indexOf(latest) : messages.length;
        messages = [...messages.slice(0, index), memory, ...messages.slice(index)];
        return { ...decision, messages };
    }

    async function before_tool(exec, next) {
        if (!exec.agent || exec.parent !== undefined || !exec.agent.session.header.cwd || !/(write|edit|patch|shell|bash|powershell|exec|python|blender|code|file)/i.test(exec.name || "")) return next();
        if (/(?:^|[._/-])(?:read|list|search|glob|grep|find)(?:$|[._/-])/i.test(exec.name)) return next();
        const session = exec.agent.session;
        try {
            if (!exec.signal?.aborted) await checkpoints.capture(session.header.cwd, `自动 · ${exec.name}`, session.id, true);
            automatic_errors.delete(session.id);
        } catch (error) {
            automatic_errors.set(session.id, error.message);
        }
        return next();
    }

    return { route, before_step, before_tool, checkpoints, policies, assistant };
}

export function apply(ctx) {
    const storage = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "plugin-data", "dsh-productivity");
    const service = create_productivity(ctx, storage);
    ctx.effect(() => ctx.tools.register(memory_tool(service.assistant)));
    ctx.effect(() => ctx.tools.register(tasks_tool(service.assistant)));
    ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: PREFIX.slice(0, -1), handler: service.route }));
    ctx.on("agent/pre-step", service.before_step, { prepend: true });
    ctx.on("tools/execute", service.before_tool, { prepend: true });
}
