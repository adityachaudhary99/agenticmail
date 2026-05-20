# AgenticMail Skill Library

A **skill** is a JSON playbook that teaches an AgenticMail agent how to
handle one specific real-world phone task like a skilled human would
— negotiate a bill, book a reservation, handle a debt collector, file
a chargeback. Skills are loaded **on demand during a call**: when an
agent hits a situation it doesn't have ambient knowledge of, it pauses
("hold on one moment"), searches the library, loads the right skill,
and resumes with that playbook grounding its next turns.

Skills are JSON-on-disk so non-engineers can write and contribute
them. The schema is in [`types.ts`](./types.ts) and validated at load
time.

## Where skills live

- **Built-in** (ship with `@agenticmail/core`):
  [`packages/core/src/skills/built-in/*.json`](./built-in)
- **User-contributed** (loaded at runtime per install):
  `~/.agenticmail/skills/*.json`

User-contributed skills override built-ins if the `id` matches.

## v0.9.87 — 160+ built-in skills, including life-safety bundle

The 0.9.87 community-skills drop added 150 new playbooks across 15
categories (customer-support, healthcare, government-services,
insurance, banking, travel, utility/telecom, housing, education,
professional-services intake, outbound sales, advanced negotiation,
critical reasoning, emotional intelligence, closing/commitment) —
all author-and-reviewed by an 18-agent build farm (15 creators + 3
reviewers covering schema, adversarial robustness, and tone).

The 0.9.87 release also added a hand-written **emergency-services
bundle** (10 skills) covering 911 (medical / fire / violent crime
in progress), the local police non-emergency line, welfare-check
requests, the FBI tip line, 988 (suicide & crisis lifeline),
poison control (1-800-222-1222), elder + child abuse reporting
(APS/CPS), and fraud reporting (IC3/FTC/state AG). Each emergency
skill has airtight boundaries: explicit per-call operator
authorisation, AI-self-identification on the first sentence, and
hard refusal of false reports / SWATting / coerced disclosure.

## How an agent uses a skill mid-call

```
1. Caller asks something the agent didn't expect.
2. Agent: "Hold on one moment — let me check something."
   (TTS plays while the agent runs tool calls.)
3. Agent calls skill_search({ query: "rep wants me to commit to payment now" }).
4. Agent picks the top match — e.g. `negotiate-bill-reduction`.
5. Agent calls skill_load({ id: "negotiate-bill-reduction" }).
6. Response includes a `rendered_prompt` block — the agent injects
   it into the next turn's context (today: appended to assistant
   reasoning; v0.9.73+: dynamic session.update.instructions patch).
7. Agent resumes the call grounded in the loaded skill.
```

## How to contribute a new skill

1. **Copy an existing skill** as your starting point — `book-restaurant-reservation.json`
   is a good lightweight template, `handle-debt-collector.json` is a
   good heavyweight (with disclaimer + jurisdiction) template.

2. **Fill in the schema** ([`types.ts`](./types.ts) for the full
   shape). Required:
   - `id` — lowercase-hyphenated slug, must be unique
   - `name`, `version`, `description`, `category`, `tags`
   - `disclaimer` — string for skills with legal / medical /
     financial sensitivity (the agent MUST recite this at the start
     of the substantive turn); `null` otherwise
   - `context` — when to use, preconditions, estimated duration
   - `principles` — 3-7 strategic frames the agent internalises
   - `phrases` — named scripted phrases (keys like `opener`,
     `stall_thinking`, `ask_supervisor`)
   - `tactics` — ordered list of moves, each with `name`, `when`,
     `script`
   - `boundaries` — hard rules the agent must not cross
   - `success_signals` / `failure_signals` — signs to continue / exit
   - `exit_strategy` — `on_success` / `on_failure` / `follow_ups`
   - `required_user_info` — what the operator must supply up front
   - `contributed_by` — your name or handle

3. **Write like a friend giving advice**, not like a corporate policy
   document. The model performs best when the tactical knowledge is
   spelled out narratively. A skill that just says "be assertive"
   doesn't transfer competence to a model that hasn't made the call
   before. A skill that says "after stating the target, stay quiet
   for 3-5 seconds — silence makes the rep counter" actually works.

4. **Test against real interactions**. Skills are easy to write
   plausibly and hard to write effectively. If you can, run the
   skill against a sample call (your own real one, or a roleplay)
   and refine the phrases that didn't quite land.

5. **Open a PR** with the new JSON file in
   `packages/core/src/skills/built-in/`. Include in the PR
   description:
   - A 1-2 sentence summary of what the skill does
   - One real situation that prompted you to write it
   - Any jurisdiction or domain constraints (US-only,
     industry-specific, age-restricted)

6. The schema validator runs in CI. Make sure
   `npm test --workspace=@agenticmail/core` passes (it auto-loads
   every JSON in `built-in/` and runs `validateSkill`).

## What makes a good skill

- **Specific phrases over general advice.** "Mention the loyalty
  rate" is weak. `"Hi, I've been a customer since 2019 — what
  loyalty rates do you have available?"` is strong.
- **Tactic ORDER matters.** First tactic is the opener. Last
  tactic is the escape hatch. The model tries them in order, so
  put the highest-leverage moves early.
- **Boundaries that are real, not theatrical.** "Don't lie" is
  obvious; "don't acknowledge the debt amount even with 'yeah,
  about right'" is genuinely useful and shows you've thought about
  the failure mode.
- **Disclaimers when warranted.** Legal, medical, financial, and
  some civic skills need the agent to disclaim non-attorney /
  non-clinician status. Don't skip this — it protects the user
  and the project.
- **Exit strategy on BOTH paths.** A great skill knows what to do
  when the call goes well AND when it goes south.

## What's NOT a skill

- One-off scripts for a specific user's account
- Pure information retrieval ("look up the phone number for…")
- Tasks that should be done by software, not on a phone call
  (most online transactions, anything API-able)
- Anything that requires a licensed professional (legal
  representation, medical diagnosis, financial advice) —
  administrative variants are OK with disclaimers; substantive
  ones are not appropriate for agent-driven calls

## Planned skills (PRs welcome)

These are categories the starter library doesn't cover yet:

- Civic / DMV / voter registration
- Real estate (rental viewing scheduling, lease question
  follow-up)
- Employment (declining a job offer politely, requesting a
  reference check, callback after an interview)
- Social calls (RSVP'ing politely on someone's behalf, breaking
  difficult news with care, condolence calls)
- Veterinary / pet-services (booking, follow-ups, emergency
  routing)
- Travel (hotel late-checkout, rental-car damage dispute, lost
  luggage)
- Insurance claim follow-up (auto, homeowner's, health)
- Order tracking / returns (e-commerce phone support)

If you're a domain expert in one of these areas, your contributed
skill is uniquely valuable — model training data thins out fast
once you leave the most common knowledge bands.
