import assert from "node:assert/strict";
import { test } from "node:test";
import { filter_context, group_turns } from "../src/context.js";

const message = (id, role, text = id) => ({ id, role, content: [{ type: "text", text }] });
const user = (id) => ({ type: "user/message", data: message(id, "user") });
const start = turn => ({ type: "turn/start", data: { turn } });
const end = turn => ({ type: "turn/end", data: { turn } });

test("complete turns can be excluded without losing newest prompt, instructions or tools", () => {
    const tool_call = { id: "call-message", role: "assistant", content: [{ type: "tool-call", id: "call-id", name: "write", arguments: "{}" }] };
    const tool_result = { ...message("result", "tool"), toolCallId: "call-id", source: { kind: "tool", callId: "call-id" } };
    const events = [user("old-user"), start(1), { type: "assistant/message", data: { turn: 1, message: tool_call } }, { type: "tool/result", data: { turn: 1, message: tool_result } }, end(1), user("new-user"), start(2), { type: "assistant/message", data: { turn: 2, message: message("new-reply", "assistant") } }, end(2)];
    const system = message("system", "system");
    const developer = message("developer", "developer");
    const messages = [system, developer, events[0].data, tool_call, tool_result, events[5].data, events[7].data.message];
    assert.deepEqual(group_turns(events).turns.map(turn => turn.ids), [["old-user", "call-message", "result"], ["new-user", "new-reply"]]);
    assert.deepEqual(filter_context(events, messages, [1, 2]).map(item => item.id), ["system", "developer", "new-user", "new-reply"]);
    assert.deepEqual(filter_context(events, messages, []), messages);
    const queued = user("queued-user");
    assert.ok(filter_context([...events, queued], [...messages, queued.data], [1, 2]).some(item => item.id === "queued-user"));
});

test("in-progress turns and call/result pairs crossing boundaries stay usable", () => {
    const call = { id: "call", role: "assistant", content: [{ type: "tool-call", id: "cross", name: "exec", arguments: "{}" }] };
    const result = { ...message("result", "tool"), toolCallId: "cross" };
    const events = [user("one"), start(1), { type: "assistant/message", data: { turn: 1, message: call } }, end(1), user("two"), start(2), { type: "tool/result", data: { turn: 2, message: result } }];
    const filtered = filter_context(events, [events[0].data, call, events[4].data, result], [1, 2]);
    assert.ok(filtered.includes(call));
    assert.ok(filtered.includes(result));
    assert.ok(filtered.some(item => item.id === "one"));
    assert.ok(filtered.some(item => item.id === "two"));
});
