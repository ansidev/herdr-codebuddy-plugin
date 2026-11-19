# Research Log: CodeBuddy Integration

## Summary

Full discovery for a new integration. The repository contains no implementation or steering documents; the sibling ZCode plugin is a useful behavioral reference, not a drop-in implementation. The `kiro-spec-design` full discovery, design principles, synthesis and review-gate guidance were consulted. Design and research templates are absent, so fallback structures are used.

## Research Log

### CodeBuddy hook contracts

[CodeBuddy hooks](https://www.workbuddy.ai/docs/cli/hooks) are documented as beta from v1.16.0. User hooks are stored in `~/.codebuddy/settings.json`; `CODEBUDDY_CONFIG_DIR` overrides the configuration root. Hook commands receive JSON on stdin, run through a POSIX shell, and matching hooks can execute in parallel. On Windows CodeBuddy requires Git Bash. Sessions snapshot settings; external changes may require `/hooks` review. Successful `SessionStart` and `UserPromptSubmit` hook stdout enters the conversation context, so the reporter must be silent.

The documented event payload contains `session_id`, `hook_event_name` and optional `generation_id`, but no common event sequence or timestamp. Generation IDs correlate turns, not their order. Receipt timestamps and locks cannot reconstruct upstream ordering. The user explicitly chose best-effort ordering; requirements 3.6–3.7 reflect this. `Stop` is skipped on manual interruption and permission resolution is not comprehensively documented. [Release notes](https://www.workbuddy.ai/docs/cli/release-notes/v2.103.1) say subagent events can share the main session ID and carry a separate agent ID; exact main-agent identification is not fully documented. Live verification is needed.

### Herdr contract

[Herdr plugins](https://herdr.dev/docs/plugins) use a `herdr-plugin.toml` manifest with argv commands and workspace actions. Plugin root is managed installation content; Herdr offers persistent config and state directories. The sibling reference registers startup plus install/remove/status actions, but its settings schema is ZCode-specific.

[Herdr agent integration](https://herdr.dev/docs/add-herdr-support/) defines `pane report-agent` states, source, increasing sequence numbers, and a resume argv after `--`. A state report can include session ID and resume argv, establishing authority at the same time. Herdr 0.9.2+ supports resume. Validate the resume argv restrictions before reporting; Herdr rejects the entire report if the command is invalid. Use `HERDR_BIN_PATH` and short timeouts. Herdr recommends releasing only on actual exit. `SessionEnd` reasons such as `clear` are not sufficient evidence of a process exit.

The public documentation describes a separate `report-agent-session` command that was absent from the inspected local Herdr checkout; the combined state report avoids reliance on that disputed interface. The reference plugin's shared, unlocked sequence file is vulnerable to collisions; its separate session report also precedes pane authority. Follow the public source-wide monotonic sequence contract rather than assuming the local checkout's per-pane implementation.

### Compatibility

The installed CLI reports CodeBuddy 2.185.0, and its help supports `--resume [sessionId]`; no live hooks or restore were exercised. CodeBuddy supports native installation without Node, so a Node-based plugin must state Node 18+ as an additional prerequisite. Herdr 0.9.2 is the documented minimum for resume; actual supported combinations require tests. Beta event schemas, subagent filtering, permission recovery, interruption behavior and Windows shell quoting require live verification before compatibility claims.

## Architecture Evaluation and Synthesis

- **Generalization:** Manage all integration-owned hooks through one declarative event inventory; use the same inventory for install, remove and status to avoid inconsistent definitions. Map observed activity through a single reporter without introducing a generic agent framework.
- **Build versus adopt:** Adopt CodeBuddy's existing hook and settings interfaces and Herdr's CLI contract; do not bundle either product. Use Node's standard library, following the sibling's dependency-free CommonJS approach. Build a small settings manager and process-safe sequence allocator because neither host provides this plugin-specific behavior. This introduces an explicit Node runtime prerequisite.
- **Simplification:** Attach resume data to the state report instead of issuing a second session command. Avoid ZCode-specific SQLite and transcript probing, a persistent daemon, and speculative subagent reconciliation.
- **Settings and reporter ownership:** The manager owns only plugin-identified hook definitions and a stable reporter copy. The reporter owns only its durable sequence state and Herdr calls; CodeBuddy owns event production and Herdr owns pane presentation and restore execution.

## Risks and Decisions

- Unknown source order cannot be recovered after concurrent delivery; serialize allocation and use monotonic sequences to prevent older allocated reports arriving late from overwriting newer allocated reports, while documenting remaining uncertainty.
- Preserve settings on malformed input, and identify owned hooks precisely; avoid overwriting unrelated concurrent settings changes. Use short bounded locks and report conflicts rather than silently discarding edits.
- Reporter failures, invalid payloads, invalid resume IDs, and unavailable Herdr must not block CodeBuddy. A rejected resume argument must not suppress a valid state update.
- Subagent identity fields vary by release. Do not claim complete main/subagent isolation until verified; document actual behavior and test main and subagent scenarios.
- If event schemas, ordering guarantees, resume semantics, Herdr API/version compatibility, or supported platform behavior changes, revalidate the event mapping and tests before release.
