# Wake patterns

Who actually burns a Claude turn when an email lands? This page covers the rules + the patterns we recommend for multi-agent threads.

> **TL;DR.** Since 0.9.0 the default is **wake who's on `To:`, not `Cc:`**. A second per-agent preference (`wake_on_cc: false`) lets quiet/coder agents opt out of CC wakes entirely. Bursts on the same `(agent, thread)` inside 30 s coalesce into one Claude turn.

---

## The three layers that decide a wake

When AgenticMail receives an email destined for `agent_X@localhost`, the dispatcher walks three filters in order. The first one to say "no" drops the wake (the mail still lands in the agent's inbox; only the Claude turn is gated).

| Layer | Source | What it controls |
|---|---|---|
| **1. Sender's `wake` argument** | per-send | Sender names exactly who should wake on this message. Most powerful, most explicit. |
| **2. Default-from-To** (new in 0.9.0) | per-send fallback | When sender omits `wake`, the API derives the implicit allowlist from local `To:` recipients only. CC'd local agents don't wake. |
| **3. Per-agent `wake_on_cc`** (new in 0.9.1) | per-account preference | When `wake_on_cc: false`, the agent refuses every wake where it wasn't on `To:`, regardless of sender's wake list. |

There's also a 30 s **coalescing window** that runs *after* the wake passes all three layers — bursts of replies on the same `(agent, thread)` collapse into one Claude turn.

---

## Sender-side: the `wake` argument

All four send tools (`send_email`, `reply_email`, `forward_email`, `template_send`) accept the same `wake` value with these shapes:

```js
// 1. Explicit list — wake exactly these agents, regardless of To/Cc.
await send_email({ to, cc, wake: ['alice', 'bob'] });

// 2. The string 'all' — pre-0.9.0 behaviour: wake every local recipient.
await send_email({ to, cc, wake: 'all' });

// 3. Empty array — deliver silently, no wakes at all.
await send_email({ to, cc, wake: [] });

// 4. Omitted — new 0.9.0 default: wake local recipients on To: only.
await send_email({ to, cc });
```

Bare names (`alice`) and `@localhost` addresses (`alice@localhost`) are equivalent; the API normalises both.

---

## Recipient-side: the `wake_on_cc` preference

Some agents should *never* burn a turn on CC, no matter who sends them what. Coder agents are the canonical example — a designer's `cc:` accidentally including a coder shouldn't fire a 5-minute build run.

Toggle the preference per account:

```bash
curl -X PATCH http://127.0.0.1:3829/api/agenticmail/accounts/<agentId>/wake-on-cc \
  -H "Authorization: Bearer $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wakeOnCc": false}'
```

When this is `false`, the dispatcher drops every wake where the SSE event's `wasOnTo` field is anything but `true`. Doesn't matter what the sender's `wake` list said. The agent still receives the mail in their inbox; they just don't burn a Claude turn.

The default is `true`, which respects whatever the sender (and the default-from-To rule) decided.

---

## Wake coalescing

After a wake makes it past all three filter layers, the dispatcher *debounces* per `(agent, thread)` for 30 s. Multiple events arriving in the window collapse into ONE Claude turn that sees the burst as a batch.

```
t=0s   ─── orion sends reply #1 ────────► wake queued for vesper
t=8s   ─── orion sends reply #2 ────────► wake extended, queued
t=18s  ─── orion sends reply #3 ────────► wake extended, queued
t=48s  ─── timer fires ────────────────► ONE Claude turn, vesper sees [#1, #2, #3]
```

The agent's wake prompt gets a `newMailPromptForBatch` header: *"You have 3 new messages on this thread (coalesced — they arrived in a burst, you are seeing them in one turn)"* with a list of `(UID, sender, subject)` for each. Wake budget charges once.

Tunable via `wakeCoalesceMs` on the dispatcher options (default `30000`; set to `0` to disable).

---

## Recommended patterns

### Pattern A — Designer → coder handoff

Designer Alice has finished a spec. She wants to hand it off to coder Bob and keep Carol on the thread for awareness.

```js
// Alice
await send_email({
  to: 'bob@localhost',
  cc: 'carol@localhost',
  subject: 'Slice 4 build',
  text: 'Bob — Slice 4 ready to build. Spec below…',
});
```

Without `wake`, the default kicks in: Bob (on To) wakes. Carol (on CC) **doesn't** wake — she'll see it on her next natural wake. Designer doesn't need to remember to set `wake` for this common case.

### Pattern B — Multi-agent thread with rotating actors

A 4-agent thread where the designer (Alice) names the next actor explicitly each round:

```js
await send_email({
  to: 'orion@localhost',                  // primary actor
  cc: 'vesper@localhost, lyra@localhost', // awareness
  wake: ['orion'],                         // explicit — make it obvious
  subject: 'Re: [Build] Slice 4',
});
```

Same effective behaviour as Pattern A (Orion wakes, the rest don't), but explicit. Use this when you want to make the wake intent visible to humans reading the thread later.

### Pattern C — Coder agents opt out of CC wakes entirely

If your coder agents should *never* respond to CC traffic regardless of what designers do, set their `wake_on_cc` preference at provisioning time:

```bash
# After creating the agent:
curl -X PATCH …/accounts/$BOB_ID/wake-on-cc -d '{"wakeOnCc": false}'
curl -X PATCH …/accounts/$CAROL_ID/wake-on-cc -d '{"wakeOnCc": false}'
```

Now Bob and Carol are safe from accidental wakes via CC, no matter what designers send.

### Pattern D — Broadcast to everyone (rare)

Sometimes you genuinely want every recipient to wake — e.g. an emergency stop-work notice:

```js
await send_email({
  to: 'all-hands@localhost',
  cc: 'orion@localhost, vesper@localhost, lyra@localhost, atlas@localhost',
  wake: 'all',                    // pre-0.9.0 behaviour
  subject: '[URGENT] stop building',
  text: '…',
});
```

### Pattern E — Deliver silently for audit

Need to put a record in someone's inbox without burning a turn:

```js
await send_email({
  to: 'compliance@localhost',
  wake: [],                       // no wakes; just file the mail
  subject: 'Audit log for slice 4',
  text: '…',
});
```

---

## Worker context-budget telemetry

`check_activity` now shows the SDK-reported usage line per finished worker:

```
○ vesper [new-mail] finished 1m23s · 8 tool calls — Re: [Build] Slice 4
    → done; replied UID 42 with the audit table.
    ⚡ in=12450 out=890 cacheR=8200 cacheW=4250 cost=$0.0312
```

`cacheR` is cache-read tokens — those are 0.9.0's wake-context layer working: prior thread context that didn't need to be re-tokenised. The higher that number relative to `in`, the more the layered cache + per-agent memory paid off.

---

## Migration checklist (from <0.9.0)

- [ ] Re-test multi-CC threads — recipients you'd previously expected to wake on CC don't any more. Either pass them on `To:`, name them in `wake`, or accept the new behaviour.
- [ ] If any of your agents should *never* wake on CC: `PATCH /accounts/:id/wake-on-cc` with `{wakeOnCc: false}`.
- [ ] Watch `check_activity` for `⚡` lines once 0.9.1 is running — your token cost per turn should drop on long-running threads as the cache + memory fill in.
- [ ] Read [`CHANGELOG.md`'s 0.9.0 entry](../CHANGELOG.md) for the full breaking-change list.
