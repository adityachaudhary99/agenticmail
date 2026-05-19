# Realtime Voice — Tool-Using Agent Plan (v0.9.53)

Status: PLAN — approved direction, not yet built.
Owner: Ope. Coordination: AgenticMail multi-agent team, integrated by the host.
Builds on: v0.9.52 `RealtimeVoiceBridge` (conversation + memory only).

---

## 1. Goal

Turn the realtime voice agent from a *talker* into a *full personal agent on
the phone*. While on a live call it must be able to:

- Look things up (web search, calendar, the agent's own memory/email).
- Pause the call ("can you hold a moment?"), ask the operator (Ope) a
  question, wait up to ~5 minutes for an answer, then resume — and if the
  caller hangs up while waiting, **call them back** once the answer is in.
- Take real actions: make reservations, place orders, negotiate (negotiation
  is already just conversation — it is the *acting* that needs tools).

The enabler is **OpenAI Realtime function calling**. v0.9.52 wired the audio
bridge; v0.9.53 wires a tool layer on top of it.

## 2. Where v0.9.52 leaves us

`RealtimeVoiceBridge` (`packages/core/src/phone/realtime-bridge.ts`) bridges
46elks audio ⇄ an OpenAI Realtime session. `buildRealtimeSessionConfig()`
folds the agent's memory into the session `instructions`. There are **no
tools** in the session — the model can only converse.

Everything below is additive. The bridge stays transport-agnostic and
unit-tested with mocked sockets.

## 3. OpenAI Realtime function calling — protocol

Tools are declared in `session.update` under `session.tools`:

```json
{
  "type": "session.update",
  "session": {
    "tools": [
      {
        "type": "function",
        "name": "ask_operator",
        "description": "Ask the human operator a question when you need information or approval you do not have.",
        "parameters": { "type": "object", "properties": { "...": {} }, "required": ["question"] }
      }
    ],
    "tool_choice": "auto"
  }
}
```

Call flow on the wire:
1. Model decides to call a tool → emits `response.function_call_arguments.delta`
   (streamed) then `response.function_call_arguments.done`
   `{ call_id, name, arguments }` (`arguments` is a JSON string).
2. We parse + dispatch to a tool executor.
3. We send the result back:
   `conversation.item.create` with
   `{ type: "function_call_output", call_id, output: "<string>" }`.
4. We send `response.create` so the model continues speaking with the result.

> Exact GA event names must be verified against current OpenAI docs before the
> live smoke test (same discipline as v0.9.52's `response.output_audio.delta`
> vs legacy `response.audio.delta` — handle both names defensively).

A tool call can take seconds (web search) to minutes (`ask_operator`). The
bridge must keep the phone line warm during slow calls — see §6.

## 4. The tools

Phased so Phase 1 is shippable on its own.

### Phase 1 — the keystone: `ask_operator`

Human-in-the-loop. The single most important tool.

- **Parameters:** `question` (what to ask Ope), `call_context` (one line on
  what the call is about), `urgency` (`normal` | `high`).
- **Behavior:**
  1. Records an *operator query* against the phone mission
     (`mission.metadata.operatorQueries[]` — `{ id, question, askedAt,
     answer?, answeredAt? }`).
  2. Notifies the operator (see §5 — channel-agnostic; default email).
  3. Blocks, polling the query record for an answer, up to a hard
     `OPERATOR_QUERY_TIMEOUT` (~5 min).
  4. Returns the operator's answer as the tool `output` — or a timeout
     sentinel the model is instructed to handle gracefully
     ("I could not reach my operator; I will follow up and call back").
- **Hold UX:** the system instructions tell the model: before calling
  `ask_operator`, say something like "Let me check on that — can you hold for
  a moment?"; while the result is pending it should periodically reassure
  ("still checking, thank you for holding").
- **Callback on disconnect:** if the 46elks call drops while a query is
  pending, the mission keeps the pending query; when the operator answers,
  a **callback** is triggered (§7).

### Phase 2 — lookups (fast, inline)

Return in seconds; no hold needed.

- `web_search(query)` — a search API call; returns top results as text.
- `recall_memory(query)` — queries the agent's own `AgentMemoryManager`
  (the universal memory) for anything not pre-loaded into instructions.
- `get_datetime()` — current date/time in the operator's timezone (trivial,
  but the model needs it for "tomorrow", "next Tuesday").
- (Optional) `search_email(query)` — searches the agent's AgenticMail inbox.

### Phase 3 — actions

Real-world side effects. Each is a deliberate, logged action.

- `schedule_callback(when, reason)` — record an intent to call back later.
- `end_call(summary)` — the model gracefully ends; bridge sends 46elks `bye`,
  writes the summary to the mission transcript.
- `make_reservation` / `place_order` — Phase 3b, likely a constrained
  `http_action` tool or specific integrations. Deferred until Phase 1+2 land;
  high-side-effect actions should route through `ask_operator` for approval
  until trust is established.

## 5. Operator notification — channel-agnostic

`ask_operator` must not hard-code Telegram (that is Fola-specific; the
open-source product cannot depend on it).

Design: an **operator-query record** + a pluggable notifier.

- The query is persisted on the mission and exposed via the API:
  - `GET  /api/agenticmail/calls/:id/operator-queries` — list, with answers.
  - `POST /api/agenticmail/calls/:id/operator-queries/:queryId/answer`
    `{ answer }` — submit an answer (agent-key scoped).
- Default notifier: **email** to `config.operatorEmail` (already exists in
  `AgenticMailConfig`). The operator can reply to that email; an inbound
  hook parses the reply into the answer. Email is the AgenticMail-native,
  zero-extra-dependency path.
- Host extension: Fola wires Telegram by watching the operator-query
  endpoint and POSTing Ope's Telegram reply back to the answer endpoint.
  This is a Fola integration, **not** in the agenticmail repo.

So: the agenticmail product ships the email path; Fola adds Telegram on top
via the public endpoint. The bridge only ever polls the query record — it
does not care which channel produced the answer.

## 6. Keeping the line warm during a slow tool call

A live call cannot go silent for minutes. Two layers:

1. **Model-side:** system instructions make the model announce the hold and
   periodically reassure the caller. The model keeps talking; the tool runs
   async.
2. **Bridge-side safety net:** while a long-running tool (`ask_operator`) is
   pending, the bridge tracks "tool in flight". It does not mute anything —
   the model is still streaming audio — but it does enforce the
   `OPERATOR_QUERY_TIMEOUT` so a never-answered query cannot wedge the call.

Decision per Ope (2026-05-19): a human caller will hold for up to ~5 minutes;
that is acceptable. The fallback for longer waits is callback (§7), not
keeping someone on hold indefinitely.

## 7. Callback on disconnect

If the caller hangs up while an `ask_operator` query is unanswered:

1. The 46elks `bye` / socket close ends the bridge as normal — but the
   mission is left with an **unanswered operator query** and a
   `callbackPending` flag in `metadata`.
2. When the operator answers (via any channel → the answer endpoint), the
   API detects an answered query on a `callbackPending` mission and triggers
   a callback: `PhoneManager.startMission()` re-dials the same number with a
   continuation task.
3. The new call's Realtime session is seeded with continuity: the prior
   transcript + memory + "You were on a call, were disconnected, and now have
   the answer you were waiting for: <answer>. Resume the task."

This is exactly what a human assistant does: "Sorry we got cut off — I have
that answer for you now."

## 8. File-by-file changes

**`@agenticmail/core`**
- `phone/realtime-bridge.ts`
  - `buildRealtimeSessionConfig()` — accept a `tools` array, emit
    `session.tools` + `tool_choice`.
  - `RealtimeVoiceBridge` — handle `response.function_call_arguments.done`;
    dispatch via an injected `ToolExecutor`; send `function_call_output` +
    `response.create`. Track in-flight tool calls.
- `phone/realtime-tools.ts` (NEW) — tool definitions (JSON schemas) +
  `ToolExecutor` interface + the pure/fast tool implementations
  (`get_datetime`, `recall_memory`).
- `phone/manager.ts` — operator-query helpers on the mission
  (`addOperatorQuery`, `answerOperatorQuery`, `findCallbackPendingMissions`);
  callback origination.

**`@agenticmail/api`**
- `realtime-ws.ts` — build the `ToolExecutor` for a connection (wires
  `ask_operator`, `web_search`, etc. to real implementations); pass tools
  into the session config.
- `routes/phone.ts` — the operator-query endpoints (list / answer).
- inbound mail hook — parse an operator's email reply into a query answer.

**Config** — `OPENAI_API_KEY` already exists; add optional
`webSearchApiKey` (or reuse an existing search integration) for `web_search`.

**Tests** — `realtime-bridge.test.ts`: function-call dispatch, slow-tool
handling, timeout. New `realtime-tools.test.ts`: each tool. API: the
operator-query endpoints + callback trigger.

## 9. Testing strategy

- Unit: the bridge's function-call path with mocked sockets + a fake
  `ToolExecutor`. Each tool tested directly. Operator-query endpoints with a
  test DB. The callback trigger with a mocked `PhoneManager`.
- e2e boundary (unchanged from v0.9.52): the live OpenAI ⇄ 46elks path needs
  a real key + websocket number. The function-calling round-trip must be
  smoke-tested on a real call before v0.9.53 is published. Do **not** publish
  on "build passes" alone.

## 10. Phasing & releases

- **v0.9.53 — Phase 1+2:** function-calling plumbing, `ask_operator` (email
  channel) + hold UX + callback, and the fast lookup tools. This is the
  milestone that makes it a "real" agent.
- **v0.9.54 — Phase 3:** action tools (reservations/orders), with
  `ask_operator` approval gating on high-side-effect actions.
- Telegram operator channel: Fola-side, tracked separately from the
  agenticmail repo.

## 11. Open decisions for Ope

1. `web_search` provider — which search API/key? (Brave, Bing, SerpAPI, …)
2. Phase 3 booking — generic constrained `http_action`, or specific
   integrations (OpenTable etc.)? Start generic + approval-gated?
3. Should every Phase 3 action require `ask_operator` approval at first
   (trust ramp), or only above a value threshold?

## 12. Coordination

Built by an AgenticMail agent team, integrated by the host:
- **voicebuilder** — implements Phase 1+2 against this plan.
- **voicereviewer** — security + code review (per the repo's two-agent audit
  norm) before anything is integrated.
- **host (Claude Code)** — integrates, runs the full test suite, and is the
  only one that commits/pushes. Agents propose; the host is the quality gate.

---

## 13. Decisions resolved + scope additions (2026-05-19, from Ope)

The §11 open questions are answered, and two capabilities are added. All
"copy from enterprise" code is already tuned — port it as-is, adapting only
imports/structure to fit the open-source package; do not rewrite it.

### 13.1 web_search → DuckDuckGo

`web_search` uses **DuckDuckGo** (free, no API key, no config). The
enterprise `web-search.ts` already implements search providers — reuse its
DuckDuckGo path. Source to port:
`../../../enterprise/src/agent-tools/tools/web-search.ts`
(abs: `/Users/ope/Desktop/projects/agenticmail/enterprise/src/agent-tools/tools/web-search.ts`).
Drop any non-DuckDuckGo / keyed providers unless they are also free.

### 13.2 Browser tools — port from enterprise as-is

The agent gets real browser automation. Port the tuned enterprise browser
tooling into `@agenticmail/core` (or a small `@agenticmail/browser` if it
pulls heavy deps — builder's call, keep core dependency-light):
- `enterprise/src/agent-tools/tools/browser-tool.ts` (441 LOC)
- `enterprise/src/agent-tools/tools/browser.ts` (764 LOC)
- `enterprise/src/agent-tools/tools/browser-tool.schema.ts` (122 LOC)
- `enterprise/src/agent-tools/tools/browser-snapshot-cleaner.ts` (471 LOC)

Use it as-is — it is tuned. Adapt only imports/packaging.

### 13.3 Booking = browser, not APIs

Phase 3 booking is **not** API integrations. The agent books by driving the
browser: navigate to the site (airline, hotel, restaurant, anything), log
in, fill the booking, confirm. So the "action tools" are really the browser
tools (§13.2) plus a thin booking workflow. Supersedes §4 Phase 3's
`make_reservation` / `http_action` sketch — there is one general path:
browser.

### 13.4 Approval gating + advance approval

Side-effecting actions (bookings, purchases, logins with the operator's
credentials) stay gated — but the operator can **pre-approve in advance**
from whatever channel they chat with the agent on (email OR Telegram), not
only answer per-action prompts. So `ask_operator` / the approval layer must
support: (a) per-action approval, and (b) a standing/advance approval the
operator grants ahead of time (e.g. "you may book hotels under $300 without
asking"). Approvals are accepted from any channel via the operator-query /
approval endpoints (§5).

### 13.5 Telegram channel — users chat with their agents

New workstream: an AgenticMail **Telegram integration** so any user can
talk to their agents over Telegram — the same model as the Fola
host↔operator bridge. Port + merge from two sources:
- enterprise: `src/agent-tools/tools/messaging/telegram.ts` (186 LOC),
  `src/agent-tools/tools/integrations/telegram.ts`,
  `src/mcp/adapters/telegram.adapter.ts`
- agent-harness (the Fola bridge): `fola-telegram-bridge.mjs`,
  `fola-lib/telegram-api.mjs`, `fola-tools/telegram-mcp.mjs`
  (abs base: `/Users/ope/Desktop/projects/agent-harness/`)

Goal: a user registers a Telegram bot token, links a chat, and can message
their AgenticMail agent / get replies over Telegram. This also becomes a
first-class channel for `ask_operator` notifications + approvals (§13.4).
This is a sizeable feature in its own right — treat it as a parallel
workstream to the voice tools, not a sub-task of Phase 1.

> NOTE for the host: §13.2 and §13.5 move code from the paid
> `@agenticmail/enterprise` repo into the open-source package. That is an
> intentional product decision by Ope (confirmed 2026-05-19), not an
> accidental stream-crossing — proceed.
