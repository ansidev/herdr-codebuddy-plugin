# Brief: codebuddy-integration

## Problem

People running Tencent CodeBuddy Code in Herdr need to see whether an agent is working, idle, or waiting for permission, and to restore its session. Without a dedicated integration, Herdr cannot reliably receive CodeBuddy's lifecycle and session information.

## Current State

This repository starts empty. The sibling `herdr-zcode-plugin` provides a Herdr plugin manifest, hook installation and status actions, and a reporter that translates ZCode events into Herdr pane reports. Its ZCode settings schema, database lookup, and resume command are specific to ZCode and must not be assumed to apply to CodeBuddy.

CodeBuddy documents command hooks in user settings, JSON event payloads containing session IDs, and `codebuddy --resume <session-id>`. Its hooks are beta; configuration changes may need review through `/hooks` and existing sessions use a settings snapshot.

## Desired Outcome

A Herdr user can install the plugin, inspect or remove its CodeBuddy hooks, see useful agent activity and permission states in Herdr, and restore a CodeBuddy session when the necessary session information is available. Reporting failures must not interrupt CodeBuddy.

## Approach

Use a Herdr-managed integration modeled on the ZCode plugin: a plugin manifest and hook-management actions install a standalone reporter, which translates documented CodeBuddy lifecycle events to Herdr state and session reports. Adapt the implementation to CodeBuddy's actual settings and hook contracts, verify Herdr's current reporting contract, and address report ordering and concurrent hook execution rather than copying the reference's shared state handling uncritically.

## Scope

- **In**: Hook installation, removal and status; preservation of unrelated CodeBuddy settings and hooks; working, idle and permission-waiting state reporting; session identification and restore; safe failure behavior; documentation and meaningful compatibility testing.
- **Out**: Changes to Herdr or CodeBuddy themselves, distribution of the CodeBuddy CLI, and unrelated CodeBuddy extensions. Do not assume ZCode-specific database internals apply to CodeBuddy.

## Boundary Candidates

- Herdr plugin lifecycle and configuration management: registration, installation, removal and status of only this integration's hooks.
- CodeBuddy event translation and Herdr reporting: event payload interpretation, state, concurrency, session identity and resume arguments.
- Documentation and verification: prerequisites, approval/restart behavior, supported environments and observed limitations.

## Out of Boundary

- Managing other CodeBuddy plugins, hooks, credentials, or unrelated settings.
- Claiming full subagent or interruption tracking unless supported and verified by CodeBuddy's actual events.

## Upstream / Downstream

- **Upstream**: Herdr's plugin and pane-reporting interfaces; CodeBuddy Code's settings, hook events, and session-resume interface; the ZCode plugin as an implementation reference.
- **Downstream**: Herdr pane state display and session restoration; future improvements for CodeBuddy-specific events or richer subagent tracking.

## Existing Spec Touchpoints

- **Extends**: None in this repository.
- **Adjacent**: The sibling `herdr-zcode-plugin` and Herdr's plugin/reporting interfaces; avoid modifying either as part of this spec.

## Constraints

- Target the Tencent CodeBuddy Code CLI (`codebuddy` / `cbc`); see https://www.workbuddy.ai/docs/cli/overview.
- Respect CodeBuddy's documented settings and configuration directory overrides; shell hook commands require correct path quoting, including Windows Git Bash. See https://www.workbuddy.ai/docs/cli/hooks.
- CodeBuddy documents hooks as beta for v1.16.0 and later. Confirm the actual minimum compatible versions of CodeBuddy and Herdr during implementation.
- Installation must be repeatable and removal must preserve unrelated settings. Explain settings snapshots, restart and `/hooks` review requirements.
- Verify report sequencing, concurrent events, session restore, permission prompts, interruption and shutdown behavior in realistic scenarios. Do not claim behavior that has not been verified.
- CodeBuddy can be installed without Node.js; choose and document the reporter's runtime requirement deliberately.
- Preserve applicable attribution and license notices if reusing the MIT-licensed ZCode implementation.
- Reference documentation: https://www.workbuddy.ai/docs/cli/cli-reference and https://herdr.dev/docs/add-herdr-support/.
