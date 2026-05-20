/**
 * AgenticMail skill library — public surface.
 *
 * Re-exports the types + registry helpers so the rest of the
 * monorepo (the MCP tool layer, the realtime voice bridge's
 * dynamic-context injection path, the CLI's `skill` subcommands)
 * can consume them without reaching into module internals.
 */

export type {
  Skill,
  SkillCategory,
  SkillContext,
  SkillTactic,
  SkillExitStrategy,
  SkillSummary,
  SkillValidationError,
} from './types.js';

export {
  listSkills,
  searchSkills,
  loadSkill,
  saveUserSkill,
  validateSkill,
  invalidateSkillCache,
  skillFilename,
  userSkillsDir,
} from './registry.js';

/**
 * Render a loaded skill into a single block of text suitable for
 * injection into an OpenAI Realtime `session.update.instructions`
 * (or any other plain-text system-prompt slot). The rendering is
 * intentionally verbose — language models perform best when the
 * tactical knowledge is spelled out narrative-style, not as a
 * skeletal outline.
 *
 * Convention: every rendered skill starts with a marker so the
 * agent can recognise it's operating with a loaded skill, and
 * ends with a separator so additional skills (loaded later in the
 * call) can be concatenated without ambiguity.
 */
export function renderSkillAsPrompt(skill: import('./types.js').Skill): string {
  const lines: string[] = [];
  lines.push(`=== SKILL LOADED: ${skill.name} (v${skill.version}) ===`);
  lines.push(`Category: ${skill.category}    Tags: ${skill.tags.join(', ')}`);
  lines.push('');
  lines.push(skill.description);
  lines.push('');
  if (skill.disclaimer) {
    lines.push('REQUIRED DISCLAIMER (recite at start of the substantive turn):');
    lines.push(`  "${skill.disclaimer}"`);
    lines.push('');
  }
  lines.push('WHEN TO USE THIS:');
  lines.push(`  ${skill.context.when_to_use}`);
  if (skill.context.preconditions.length > 0) {
    lines.push('Preconditions:');
    for (const p of skill.context.preconditions) lines.push(`  - ${p}`);
  }
  lines.push('');
  lines.push('PRINCIPLES:');
  for (const p of skill.principles) lines.push(`  - ${p}`);
  lines.push('');
  if (Object.keys(skill.phrases).length > 0) {
    lines.push('PHRASES (paraphrase to match your voice; keep the structural move):');
    for (const [k, v] of Object.entries(skill.phrases)) lines.push(`  [${k}] "${v}"`);
    lines.push('');
  }
  if (skill.tactics.length > 0) {
    lines.push('TACTICS (try in order; fall back to next on failure):');
    skill.tactics.forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.name}`);
      lines.push(`     When: ${t.when}`);
      lines.push(`     Script: "${t.script}"`);
    });
    lines.push('');
  }
  if (skill.boundaries.length > 0) {
    lines.push('HARD BOUNDARIES — do not cross:');
    for (const b of skill.boundaries) lines.push(`  - ${b}`);
    lines.push('');
  }
  lines.push('SUCCESS SIGNALS:');
  for (const s of skill.success_signals) lines.push(`  - ${s}`);
  lines.push('');
  lines.push('FAILURE SIGNALS — when these appear, escalate or exit:');
  for (const s of skill.failure_signals) lines.push(`  - ${s}`);
  lines.push('');
  lines.push('EXIT:');
  lines.push(`  On success: ${skill.exit_strategy.on_success}`);
  lines.push(`  On failure: ${skill.exit_strategy.on_failure}`);
  if (skill.exit_strategy.follow_ups && skill.exit_strategy.follow_ups.length > 0) {
    lines.push('  Follow-ups (after the call):');
    for (const f of skill.exit_strategy.follow_ups) lines.push(`    - ${f}`);
  }
  lines.push('');
  lines.push('=== END SKILL ===');
  return lines.join('\n');
}
