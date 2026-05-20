# AgenticMail Skill Library — design + roadmap

## Vision

A community-curated JSON library of **how a skilled human handles
real-world phone tasks** — bill negotiation, court check-ins,
medical appointments, debt collectors, rebooking flights, etc. —
loadable on demand by an agent mid-call. Eventually 100+ skills
covering everything an adult might phone someone about across the
course of a year, across demographics and life stages.

A skill is a playbook, not a script: principles + scripted phrases
+ ordered tactics + boundaries + exit strategy. The skill grounds
the agent's behaviour without removing its judgment.

## Phase 1 — Foundation (✅ shipped in v0.9.72)

**Schema + registry + 8 starter skills + MCP tools + contribution
guide.** Status: done. See:

- [`packages/core/src/skills/types.ts`](../packages/core/src/skills/types.ts)
  — the `Skill` interface (the on-disk JSON shape)
- [`packages/core/src/skills/registry.ts`](../packages/core/src/skills/registry.ts)
  — load / list / search / save / validate
- [`packages/core/src/skills/built-in/`](../packages/core/src/skills/built-in)
  — bundled JSON files (8 starter skills)
- [`packages/core/src/skills/README.md`](../packages/core/src/skills/README.md)
  — contribution guide
- MCP tools — `skill_list`, `skill_search`, `skill_load` in
  [`packages/mcp/src/tools.ts`](../packages/mcp/src/tools.ts)

Starter library (v0.9.72) covers:

| ID | Category | What it does |
|---|---|---|
| `negotiate-bill-reduction` | negotiation | Call a provider's retention line and negotiate a recurring bill down |
| `book-restaurant-reservation` | reservations | Book a table; angle politely for a better seating |
| `cancel-subscription-graceful` | subscription | Cancel and capture retention offers cleanly |
| `handle-debt-collector` | debt-collection | US/FDCPA-aware: don't acknowledge, request validation, exit |
| `book-medical-appointment` | medical-admin | Verify insurance, book, capture prep instructions |
| `dispute-credit-card-charge` | finance-admin | File a dispute, capture case number + provisional credit |
| `schedule-home-service` | home-services | Surface diagnostic fee + tight window; diagnostic-only authorisation |
| `airline-change-or-refund` | travel | Lead with PNR + status, frame as disruption, capture rebook details |
| `court-administrative-checkin` | legal-admin | Clerk's office only, NOT representation, mandatory disclaimer |

## Phase 2 — Real-time mid-call loading

**Goal**: an agent on a live phone call can pause, search the library,
load a skill, and have that skill ground its NEXT turn's behaviour —
all without dropping the call.

### What needs building

1. **Stall TTS during tool runs.** When the agent calls
   `skill_search` mid-call, the OpenAI Realtime session needs to
   either (a) say something filler ("hold on one moment", "let me
   check something") OR (b) leave a comfortable silence. Today the
   session has no concept of "I'm thinking, please don't fill the
   air with my next response yet." Two options:
   - Inject a `response.create` with a system instruction
     `"Say 'hold on one moment' and wait for further instructions"`,
     await its completion, then issue the actual tool call.
   - Use the upcoming OpenAI Realtime "background thinking" API
     when it lands.

2. **Dynamic context injection.** Today, `session.update.instructions`
   is set once at session-open and rarely changed. To inject a
   loaded skill mid-call, the bridge sends a `session.update` with
   `instructions: <original instructions> + "\n\n" + renderSkillAsPrompt(skill)`.
   The next assistant turn uses the updated instructions. This is
   already supported by the OpenAI Realtime API but the bridge
   doesn't wire it up.

   Implementation: extend
   [`packages/core/src/phone/realtime-bridge.ts`](../packages/core/src/phone/realtime-bridge.ts)
   with a `loadSkill(skillId)` method that:
   1. Fetches the skill via the registry.
   2. Renders it with `renderSkillAsPrompt`.
   3. Issues a `session.update` with merged instructions.
   4. Records the loaded skill on the active phone mission so the
      transcript shows which skills were used.

3. **A `load_skill` function the model can call.** The Realtime
   session's `tools` array gets a new entry:

   ```ts
   {
     name: 'load_skill',
     description: 'Load a phone-call skill playbook into your context for the rest of the call. Search first with `search_skills`.',
     parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
   }
   ```

   And a sibling `search_skills(query)` that returns the same
   summaries as the MCP `skill_search`. These run inside the
   realtime bridge — not through MCP — because the realtime session
   has its own tool surface separate from the host's MCP tools.

4. **Skill-load transcript marker.** The phone mission transcript
   should record `{at, source: 'system', text: 'Skill loaded: <id> v<version>'}` so
   post-call review shows the agent's adaptation.

### Likely friction

- The model may load too aggressively (loading 3 skills on one call,
  blowing context). Cap at 2 loaded skills per call, with the second
  load replacing the first if the first didn't help.
- The model may load too late (after the moment passed). Train the
  system prompt to recognise the "hold on, I need to check something"
  pattern as a trigger.
- Latency: the cold-load of a skill JSON is fast (<10ms), but the
  `session.update` round-trip + the model's next turn could feel
  long. The "hold on one moment" filler covers it.

## Phase 3 — Community contribution farm

**Goal**: scale from 8 starter skills to 100+ via crowd-sourced
contributions, with a reviewer agent vetting each submission.

### Architecture

1. **Open a `skills@agenticmail.io` inbox** that accepts skill PRs
   via email. The body or attachment is the JSON; the email is the
   contributor's bio + the situation that prompted the skill.

2. **Spawn a reviewer agent on each PR.** The reviewer:
   - Validates the schema (`validateSkill`).
   - Checks the disclaimer requirement (if the category is legal,
     medical, financial, or debt-collection and `disclaimer` is null,
     reject with a request to add one).
   - Reads through the phrases and tactics, flags ones that read
     too generic ("just be polite") vs specific enough to teach a
     model the move.
   - Checks for hard-rule violations (asking the model to lie,
     misrepresent identity, claim attorney-status without one, etc).
   - Posts comments on the PR with specific suggestions.

3. **Once a reviewer approves, a second human + a core maintainer
   final-approve** before merge. This is the equivalent of the
   "PR + reviewer + maintainer" workflow most open-source projects
   already have, just with agents pre-screening.

4. **Top-of-list categories to seed** (these have the highest
   community impact and the model's training data is thinnest):
   - Civic services (DMV, voter registration, city permits)
   - Insurance claim follow-up (auto / homeowner's / health)
   - Real estate (viewing scheduling, lease questions)
   - Employment (interview scheduling, polite declines)
   - Veterinary (booking, follow-ups, emergency routing)
   - Order tracking / returns (e-commerce phone support)
   - International / non-US variants of existing skills (debt
     collection rules vary by country; airline disruption laws too)

### Multi-agent build farm

Use AgenticMail itself to scale the build:

```
Operator emails the build coordinator agent:
> "Draft 10 new skills covering [list]. Reviewer should be vesper.
>  Final reviewer is me. CC me on the build thread."

Coordinator spawns 10 builder agents (each a clean Claude turn
in its own agent inbox). Each builder:
  - Picks one skill from the list
  - Drafts the JSON
  - Emails the reviewer with the draft

Reviewer (vesper) reads each draft and replies:
  - APPROVED → coordinator commits to a branch
  - REQUEST CHANGES → with specific phrase / tactic feedback;
    builder revises and resends

Coordinator opens a PR with the approved skills, CC's the operator.
Operator does the final human review and merges.
```

The build-farm pattern is exactly what AgenticMail was designed for:
multi-agent coordination over email threads with a final-human-in-the-loop
review. The skill library is its own dogfood test case.

## Open questions

- **Localisation.** Should skills be tagged with locale (`en-US`,
  `en-GB`, `de-DE`)? Many skills are jurisdiction-specific (FDCPA
  is US-only). Today this lives in `extra.jurisdiction`; should
  promote to a top-level field if we get >20 locale variants.
- **Skill composition.** Can two skills be loaded simultaneously?
  (E.g. `book-medical-appointment` + `negotiate-bill-reduction` for
  a call that needs both.) Probably yes for tactically independent
  pairs; risky for pairs that disagree on boundaries.
- **Versioning + migration.** When a built-in skill bumps version,
  do agents mid-call get the new version or stick with the loaded
  one? Today: stick (`version` is captured at load time). Probably
  the right default — mid-call surprises are bad.
- **Telemetry.** Should the registry track which skills get loaded
  most often + how often they succeed? Useful signal for refinement,
  but privacy-sensitive — would need to be opt-in.

## Versioning history

- `v0.9.72` — Phase 1 shipped: schema, registry, 8 starter skills,
  MCP tools, contribution guide.
- _Future_ — Phase 2: mid-call dynamic loading via realtime bridge.
- _Future_ — Phase 3: community PR pipeline + multi-agent build farm.
