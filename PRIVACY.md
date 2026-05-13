# Privacy

AgenticMail is self hosted. Everything runs on the user's machine. This page is a plain explanation of what data the software touches, where it goes, and what choices the user has.

## What runs locally

Everything. The pieces that do real work are:

1. A local Stalwart mail server, run as a Colima or Docker container on the user's machine. It stores email in a local volume.
2. A local Express API on `127.0.0.1` (default port 3829). It is bound to loopback only and does not accept connections from outside the machine.
3. A local SQLite database in `~/.agenticmail/agenticmail.db`. It holds accounts, API keys, contacts, drafts, templates, rules, tags, spam log, and task state.
4. A local dispatcher daemon under PM2 that watches each agent's inbox and wakes Claude Code subagents when mail arrives.

There is no cloud component. There is no AgenticMail server in the middle. There is no telemetry, no analytics, and no phone home by default.

## What leaves the machine

Three things can leave the machine, and only when the user has explicitly turned them on.

1. **Outbound mail to the public internet.** Only if the user wires a Gmail relay or their own domain through `agenticmail setup`. Without that step, mail between agents only travels inside the local Stalwart server and `*@localhost`. No internet traffic.
2. **SMS through a configured gateway.** Only if the user wires Google Voice or another provider. SMS data goes through whichever provider the user picks, under that provider's privacy policy. AgenticMail itself does not see the messages after they reach the gateway.
3. **Claude API traffic.** When the dispatcher wakes an agent, that agent's Claude turn runs through Anthropic under the user's existing Claude Code OAuth. The same credential they already use with Claude Code. AgenticMail does not have its own Anthropic key and does not proxy anything.

## What the plugin sends to Anthropic during normal use

Same as any other Claude Code session. The plugin does not add any data path to Anthropic that is not already there. When an agent thinks, the prompt and tool calls go through the host's Claude OAuth exactly like any other Claude Code subagent. Email content, file content, and shell output included in a Claude turn flow through that same channel under Anthropic's privacy policy, which the user already agreed to when they signed in to Claude Code.

## Logs

Local only. The dispatcher and the API write logs under `~/.agenticmail/logs/`. Nothing is shipped off the machine. Users can `rm -rf ~/.agenticmail/` at any time and the install is gone.

## API keys

The master key and each agent's API key are stored locally in `~/.agenticmail/`. They are scoped to the local API and never sent to a third party.

## Outbound content guard

External email goes through a content guard before it is sent. HIGH severity content is held in a pending queue for the owner to approve. This is a safety feature, not a tracking feature. The guard runs locally. Held mail is stored locally. The owner can review or reject pending sends through the MCP `manage_pending_emails` tool.

## What the user controls

Everything. Delete `~/.agenticmail/` to wipe state. Stop the dispatcher with `pm2 delete agenticmail-claudecode-dispatcher`. Stop the mail server with `docker rm -f agenticmail-stalwart`. Uninstall the CLI with `npm uninstall -g @agenticmail/cli`. There is no remote off switch because there is nothing remote to switch off.

## Questions

The repo is at https://github.com/agenticmail/agenticmail. Open an issue and I will answer.
