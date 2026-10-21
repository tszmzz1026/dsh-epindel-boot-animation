import { join } from "node:path";
import { atomic_write, read_json, serial_queue } from "./storage.js";

export function event_message(event) {
    if (event.type === "user/message") return event.data;
    if (["assistant/message", "tool/result", "system/message", "developer/message"].includes(event.type)) return event.data?.message;
    return null;
}

export function message_text(message) {
    return (message?.content || []).map(block => block.type === "text" ? block.text : block.type === "tool-call" ? `[${block.name}] ${typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments)}` : "").filter(Boolean).join("\n");
}

export function group_turns(events) {
    const turns = new Map();
    const message_turns = new Map();
    let active = null;
    let pending = [];
    for (const event of events) {
        if (event.type === "turn/start") {
            active = event.data.turn;
            if (!turns.has(active)) turns.set(active, { turn: active, complete: false, ids: [], text: "", characters: 0 });
            for (const message of pending) assign(message, active);
            pending = [];
        }
        const message = event_message(event);
        if (message?.id && !["system", "developer"].includes(message.role)) {
            const turn = event.type === "user/message" ? active : event.data?.turn ?? active;
            if (turn !== null && turns.has(turn)) assign(message, turn);
            else if (event.type === "user/message") pending.push(message);
        }
        if (event.type === "turn/end") {
            if (turns.has(event.data.turn)) turns.get(event.data.turn).complete = true;
            active = null;
        }
    }
    function assign(message, turn) {
        const row = turns.get(turn);
        message_turns.set(message.id, turn);
        row.ids.push(message.id);
        const text = message_text(message);
        row.characters += text.length;
        if (message.role === "user" && !row.text) row.text = text.slice(0, 240);
    }
    return { turns: [...turns.values()], message_turns };
}

export function filter_context(events, messages, excluded_turns) {
    const { turns, message_turns } = group_turns(events);
    const newest_turn = turns.at(-1)?.turn;
    const newest_user = messages.findLast(message => message.role === "user");
    const newest_user_turn = message_turns.get(newest_user?.id);
    const removable = new Set(turns.filter(row => row.complete && row.turn !== newest_turn && row.turn !== newest_user_turn && excluded_turns.includes(row.turn)).map(row => row.turn));
    const removable_ids = () => new Set(messages.filter(message => !["system", "developer"].includes(message.role) && message.id !== newest_user?.id && removable.has(message_turns.get(message.id))).map(message => message.id));
    let removed_ids = removable_ids();
    // 跨轮次工具调用必须成对保留
    const groups = new Map();
    for (const message of messages) {
        const calls = (message.content || []).filter(block => block.type === "tool-call").map(block => block.id);
        if (message.role === "tool") calls.push(message.toolCallId ?? message.source?.callId);
        for (const id of calls.filter(Boolean)) {
            if (!groups.has(id)) groups.set(id, []);
            groups.get(id).push(message.id);
        }
    }
    let changed;
    do {
        changed = false;
        for (const ids of groups.values()) {
            if (ids.some(id => !removed_ids.has(id)) && ids.some(id => removed_ids.has(id))) {
                for (const id of ids) changed = removable.delete(message_turns.get(id)) || changed;
                removed_ids = removable_ids();
            }
        }
    } while (changed);
    return messages.filter(message => !removed_ids.has(message.id));
}

export class ContextPolicies {
    constructor(storage) {
        this.path = join(storage, "context-policies.json");
        this.queue = serial_queue();
        this.ready = read_json(this.path, {}).then(value => { this.policies = value; });
        this.ready.catch(() => {});
    }

    async get(id) {
        await this.ready;
        return this.policies[id] || [];
    }

    async set(id, turns) {
        await this.ready;
        return this.queue("policies", async () => {
            const next = { ...this.policies, [id]: [...new Set(turns)] };
            await atomic_write(this.path, JSON.stringify(next));
            this.policies = next;
            return next[id];
        });
    }
}
