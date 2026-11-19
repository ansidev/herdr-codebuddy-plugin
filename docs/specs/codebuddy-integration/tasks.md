# Implementation Plan

## Task Format Template

Use whichever pattern fits the work breakdown:

### Major task only
- [ ] {{NUMBER}}.{{PARALLEL_MARK}} {{TASK_DESCRIPTION}}
  - {{DETAIL_ITEM_1}} (Include details only when needed. If the task stands alone, omit bullet items.)
  - _Requirements: {{REQUIREMENT_IDS}}_

### Major + Sub-task structure
- [ ] {{MAJOR_NUMBER}}. {{MAJOR_TASK_SUMMARY}}
- [ ] {{MAJOR_NUMBER}}.{{SUB_NUMBER}}{{SUB_PARALLEL_MARK}} {{SUB_TASK_DESCRIPTION}}
  - {{DETAIL_ITEM_1}}
  - {{DETAIL_ITEM_2}}
  - {{OBSERVABLE_COMPLETION_ITEM}} (At least one detail item should state the observable completion condition for this task.)
  - _Boundary: {{COMPONENT_NAMES}}_ (Only for (P) tasks. Omit when scope is obvious.)
  - _Depends: {{TASK_IDS}}_ (Only for non-obvious cross-boundary dependencies. Most tasks omit this.)
  - _Requirements: {{REQUIREMENT_IDS}}_ (IDs only; do not add descriptions or parentheses.)

> **Parallel marker**: Insert ` (P)` immediately after the task number for tasks that can be executed in parallel. Omit the marker when running in `--sequential` mode.

> **Optional test coverage**: When a sub-task is deferrable test work tied to acceptance criteria, mark the checkbox as `- [ ]*` and explain the referenced requirements in the detail bullets.

---

- [x] 1. Foundation: Project setup and infrastructure
  - Initialize project structure with herdr-plugin.toml, scripts/, hooks/, tests/, and README
  - Set up Node.js 18+ environment and install package dependencies (herdr-plugin-manager, codebuddy hook SDK)
  - Configure CODEBUDDY_CONFIG_DIR support and fallback to user ~/.codebuddy directory
  - _Requirements: 6.2_

- [x] 2. Core: Hook manager implementation
  - Hook inventory management and CodeBuddy settings resolution
    - Read and validate CodeBuddy settings.json, maintain owned hook inventory using exact matcher groups
    - Implement safe path quoting for shell (spaces, apostrophes, Windows Git Bash)
    - Handle settings preservation: retain unrelated JSON values, groups, and hooks during install/remove
    - Implement repeatable install: create settings only if absent, replace only exactly identified owned hooks
    - Implement removal: delete only owned entries and empty groups; abort on malformed/unreadable settings
    - Implement status: compare full inventory against reporter availability; report installed, incomplete, or undeterminable
    - Write temporary file and atomically replace settings only after successful parsing and serialization
    - Use bounded cross-process lock for concurrent manager actions; detect external modifications and abort with actionable conflict
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3_
  - _Boundary: CodeBuddy Settings_

- [x] 2.2 Install integration (install-hooks action, node scripts/manage_hooks.js install)
  - Create settings file only if absent; retain all other JSON values and groups
  - Replace only exactly identified owned hooks using versioned integration marker; do not remove entire matcher groups
  - Preserve unrelated CodeBuddy settings and hooks during installation
  - Report failure to user if installation cannot be completed
  - Ensure repeatable installation: running install multiple times leaves only one instance of each owned hook
  - _Requirements: 1.1, 1.2, 1.4, 1.5_
  - _Depends: 2.1_

- [x] 2.3 Remove integration (remove-hooks action, node scripts/manage_hooks.js remove)
  - Delete only owned entries and empty groups created by their removal
  - Preserve unrelated CodeBuddy settings and hooks during removal
  - Write temporary file in same directory and replace target after successful parsing and serialization
  - Resolve and quote paths for the shell in use, including spaces and apostrophes; exercise Windows Git Bash explicitly
  - Preserve permissions where supported; never replace malformed settings with defaults
  - _Requirements: 1.3, 1.4, 1.6_
  - _Depends: 2.1_

- [x] 3. Core: Hook reporter event mapping
  - Validate JSON input types and bound input size; malformed or unsupported input becomes a silent no-op
  - Do not emit hook stdout or include prompt, tool contents, or transcript contents in Herdr calls
  - Implement event-to-state mapping per design table:
    - SessionStart (source startup/resume) → pane state: idle, attach valid session and resume argv
    - UserPromptSubmit → pane state: working, start a turn
    - PreToolUse, PostToolUse → pane state: working, tool activity; verify main/subagent behavior
    - Notification (permission_prompt) → pane state: blocked, no prompt contents copied
    - Stop → pane state: idle, manual interruption can omit this event
  - Handle source identity reliably to distinguish subagent events; when subagent tool activity cannot be distinguished, document best-effort behavior
  - Subsequent supported working or stop event updates state after a permission prompt; no universal resolution event assumed
  - SessionEnd not used to release; Herdr's idle-shell cleanup is the fallback
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: Hook Reporter_

- [x] 3.2 Session restoration metadata attachment
  - When a supported event supplies a valid session_id, attach --agent-session-id and --codebuddy-resume to the state report argv
  - When session metadata is absent or invalid, send state without resume metadata; do not fabricate an ID
  - Report session updates to the pane that supplied the event
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: Hook Reporter_
  - _Depends: 3.1_

- [x] 3.3 Sequence contract
  - Maintain a source-wide monotonically increasing integer in the persistent plugin state path
  - Use a bounded cross-process exclusive lock: read and validate current value under lock, choose a strictly larger safe integer even when clocks collide or move backwards, persist before unlocking
  - Use the allocated sequence number for every state report
  - No lock means no report: never reuse or invent an unsafe sequence after lock failure, corrupt state, or overflow
  - Do not automatically break an apparently stale lock without proving ownership has ended; surface recovery instructions in documentation
  - A later allocated sequence suppresses a delayed earlier report in Herdr
  - If events arrive in a different order from actual occurrence, the integration cannot infer original order; displayed state may temporarily be wrong
  - Report using a short bounded timeout; suppress subprocess output; always exit successfully so CodeBuddy continues
  - _Requirements: 3.6, 3.7_
  - _Boundary: Hook Reporter_
  - _Depends: 3.1, 3.2_

- [x] 3.4 Environment validation
  - Require HERDR_ENV=1, HERDR_PANE_ID, HERDR_BIN_PATH, and HERDR_SOCKET_PATH; exit successfully without reporting when any required env var is missing
  - Before attaching a resume command, validate Herdr's constraints: plain command name, no apostrophes or control characters in any argument, at most 64 arguments and 8 KiB total
  - When session metadata is absent or invalid, send the state without resume metadata; do not fabricate an ID
  - Use no shell for Herdr invocation; use argv array equivalent to: `pane report-agent <pane> --source herdr-codebuddy-plugin --agent CodeBuddy --state <state> --seq <number>`
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: Hook Reporter_
  - _Depends: 3.1_

- [x] 4. Integration: Plugin manifest and wiring
  - Plugin manifest (herdr-plugin.toml) with plugin ID, min_herdr_version = "0.9.2", declared supported platforms, and startup installation
  - Workspace actions with local IDs: install-hooks, remove-hooks, and status
  - Commands are argv arrays invoked from the plugin root: `node scripts/manage_hooks.js <action>`
  - Herdr supplies plugin config and state directories to actions and startup; startup failures must be visible in the Herdr plugin log
  - A linked or enabled plugin does not automatically run startup immediately; users can invoke the install action explicitly
  - _Requirements: 1.1, 1.3, 1.5, 5.1, 5.2, 5.3, 6.1, 6.4_
  - _Boundary: Plugin Manifest_

- [x] 4.2 Wire hook manager and reporter with plugin actions
  - Integrate manager install/remove/status actions with plugin lifecycle events
  - Wire reporter invocation with Herdr pane report-agent command using argv array (no shell)
  - Attach --agent-session-id and --codebuddy-resume when a valid session ID is present in the event
  - Ensure reporter failures do not block the CodeBuddy operation that triggered the hook; allow continuation on Herdr unavailability or report failure
  - When CodeBuddy runs outside a Herdr pane, allow the CodeBuddy operation that triggered a hook to continue
  - When an integration hook runs, do not add reporting output to the conversation context
  - _Requirements: 1.1, 1.3, 1.5, 5.1, 5.3, 6.3_
  - _Boundary: Plugin Integration_
  - _Depends: 2.2, 2.3, 3.1, 4.1_

- [x] 5. Validation: Manager tests
  - Isolated settings fixtures exercise the following using temporary homes:
    - Missing settings file, preexisting unrelated hooks within the same matcher group
    - Repeated install (idempotency), partial status, removal, malformed and unreadable files
    - Writes failing, concurrent manager actions, external-change detection between read and replacement
    - Paths containing spaces or apostrophes, Windows Git Bash quoting
  - Assert owned-hook inventory and unrelated values rather than formatting
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3_
  - _Boundary: Test Infrastructure_

- [x] 5.2 Validation: Reporter tests
  - Feed documented JSON events and capture a fake Herdr executable's argv
  - Assert state, pane ID, source, resume ID and argv on SessionStart and later supported events carrying a session ID
  - Test invalid/missing session IDs, non-Herdr environments, malformed input, no stdout, failed or timed-out calls
  - Assert no prompt data, tool contents, or transcript contents in any Herdr arguments
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_
  - _Boundary: Test Infrastructure_
  - _Depends: 3.1, 3.2, 3.3_

- [x] 5.3 Concurrency and sequence allocation tests
  - Launch competing reporter processes against isolated persistent state with controlled clock collisions
  - Assert unique increasing sequence allocations, no duplicate sequences, and delayed lower reports rejected by a fake Herdr sequence filter
  - Exercise lock contention, corrupt state, and write failure scenarios
  - Treat unordered delivery as best effort rather than falsely asserting source order
  - _Requirements: 3.6, 3.7_
  - _Boundary: Test Infrastructure_
  - _Depends: 3.2, 3.3_

- [x] 5.4 Integration end-to-end tests (Herdr environment required)
  - In an isolated named Herdr session: install hooks, restart or review as CodeBuddy requires, send a prompt, request permission, finish a turn, inspect Herdr state
  - Restart Herdr and verify the same session resumes with correct restore information
  - Exercise two panes, resume, /clear, subagents, interruption, and configuration overrides
  - Record actual CodeBuddy, Herdr, Node, and OS versions
  - Verify Windows quoting with Git Bash before declaring Windows support
  - _Requirements: 1, 2, 3, 4, 5, 6_
  - _Boundary: Full System_
  - _Depends: 4.1, 4.2, 5.1, 5.2_

- [x] 6.1 README and setup documentation
  - Installation prerequisites: Node 18+, CodeBuddy v1.16.0+, Herdr 0.9.2+
  - CodeBuddy settings directory configuration (CODEBUDDY_CONFIG_DIR, ~/.codebuddy fallback)
  - Plugin activation, /hooks review, and troubleshooting steps
  - Settings snapshots, restart, and /hooks review requirements for configuration changes
  - Supported platforms and observed limitations for permission, interruption, subagent, and session lifecycle reporting
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Documentation_

- [x] 6.2 Compatibility and limitations documentation
  - Supported version matrix with actual CodeBuddy and Herdr versions tested
  - Beta event schema disclaimer: payload and subagent behavior may change; document actual verified behavior
  - Subagent identity variability across CodeBuddy releases; do not claim complete main/subagent isolation until verified
  - Windows Git Bash shell quoting considerations and path handling
  - Observed limitations: full subagent and interruption tracking not promised without verified event support
  - _Requirements: 6.2, 6.3, 6.4_
  - _Boundary: Documentation_
  - _Depends: 6.1_