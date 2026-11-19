# Herdr CodeBuddy Integration

[![version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/herdr/codebuddy-integration)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Integration Overview

This Herdr plugin manages CodeBuddy hooks and translates supported lifecycle events into Herdr pane state and session reports. It enables Herdr users to see whether a CodeBuddy agent is working, idle, or waiting for permission, and to restore CodeBuddy sessions when the necessary session information is available.

**Current Status**: Beta. Hook payloads and subagent behavior may change across CodeBuddy releases. Failed reporting intentionally degrades to continued CodeBuddy operation without interruption.

## Installation Prerequisites

| Component | Minimum Version |
|-----------|----------------|
| Node.js | 18+ |
| CodeBuddy Code | v1.16.0+ |
| Herdr | 0.9.2+ |

## Plugin Activation

### 1. Install the integration

```bash
# From the herdr-codebuddy-plugin directory
node scripts/manage_hooks.js install
```

This will:
- Create `settings.json` in your CodeBuddy config directory (or `~/.codebuddy/settings.json` if `CODEBUDDY_CONFIG_DIR` is not set)
- Register six owned hooks for CodeBuddy lifecycle events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, and `Notification` (with `permission_prompt` subtype)
- Preserve all unrelated CodeBuddy settings and hooks

### 2. Verify installation

```bash
node scripts/manage_hooks.js status
```

Expected output:
```
Status: installed
Details: 6 of 6 integration hooks are installed
Installed: 6/6
Owned hooks:
  - SessionStart: owned
  - UserPromptSubmit: owned
  - PreToolUse: owned
  - PostToolUse: owned
  - Stop: owned
  - Notification: owned
```

### 3. Remove the integration (if needed)

```bash
node scripts/manage_hooks.js remove
```

This will:
- Delete only the integration-owned hooks
- Preserve all unrelated CodeBuddy settings and hooks
- Clean up empty groups if applicable

### 4. Review settings with Herdr

After installation, use Herdr's `/hooks` command to review the integrated hooks and verify configuration:

```bash
/herocks review
```

Configuration changes require a Herdr restart and `/hooks` review to take effect.

## CodeBuddy Settings Directory Configuration

The integration respects the `CODEBUDDY_CONFIG_DIR` environment variable to locate the CodeBuddy settings file:

- **If `CODEBUDDY_CONFIG_DIR` is set**: Uses `<CODEBUDDY_CONFIG_DIR>/settings.json`
- **If `CODEBUDDY_CONFIG_DIR` is not set**: Falls back to `~/.codebuddy/settings.json`

### Example: Custom config directory

```bash
CODEBUDDY_CONFIG_DIR=/path/to/codebuddy/config node scripts/manage_hooks.js install
```

## Plugin Workflow

### Startup Behavior

The plugin manifest (`herdr-plugin.toml`) has `enabled = false` by default. This means:

- A linked or enabled plugin does **not** automatically run startup immediately
- Users can explicitly invoke the install action: `node scripts/manage_hooks.js install`
- To enable auto-startup, set `enabled = true` in `herdr-plugin.toml`

### Troubleshooting

| Issue | Resolution |
|-------|------------|
| Hooks not appearing in Herdr | Ensure `CODEBUDDY_CONFIG_DIR` is set correctly, or verify `~/.codebuddy/settings.json` exists |
| `/hooks review` shows no changes | Run `node scripts/manage_hooks.js install` to register hooks |
| Herdr pane stuck in one state | Check that CodeBuddy is sending supported events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `Notification`) |
| Permission prompt not reflected | Verify `Notification` event with `permission_prompt` subtype is being sent by CodeBuddy |

## Supported Platforms

- **darwin** (macOS) - Full support
- **linux** - Full support
- **windows** - Pending Git Bash shell quoting verification (see limitations below)

## Observed Limitations

### Permission and Interruption Tracking

- Full subagent and interruption tracking are **not promised** without verified event support from CodeBuddy
- The event schema is beta; payload and subagent behavior may change across CodeBuddy releases
- Permission prompts (`Notification` with `permission_prompt`) are reflected in Herdr pane state as `blocked`, but prompt contents are never copied into Herdr calls

### Session Restoration

- Session restoration relies on CodeBuddy supplying a valid `session_id` in supported events
- If CodeBuddy does not supply a `session_id`, no resume command is registered for an unidentified session
- Session restoration uses Herdr's native restore mechanism; `clear` and similar commands do not reliably prove process termination

### Windows Git Bash Quoting

- Paths containing spaces or apostrophes require explicit handling in Windows Git Bash
- The integration resolves and quotes paths for the shell in use, including spaces and apostrophes
- Windows support is pending full verification with Git Bash

### Subagent Identity

- Subagent identity variability across CodeBuddy releases means complete main/subagent isolation cannot be claimed until verified
- When subagent tool activity cannot be distinguished, behavior is best-effort and documented

### Report Sequencing

- A monotonically increasing sequence number is maintained for report ordering
- If events arrive in a different order from their actual occurrence, the displayed state may temporarily be wrong
- The integration treats unordered delivery as best effort rather than falsely asserting source order

## Development

### Project Structure

```
herdr-codebuddy-plugin/
├── herdr-plugin.toml        # Plugin manifest
├── package.json             # Node.js project setup
├── scripts/
│   └── manage_hooks.js      # Hook manager (install/remove/status)
├── hooks/
│   └── herdr_agent_state.js # Hook reporter (event→state mapping)
├── tests/
│   ├── manage_hooks.test.js   # Manager tests
│   └── herdr_agent_state.test.js  # Reporter tests
└── README.md                # This file
```

### Running Tests

```bash
# From the project root
npm test
# or
node --test tests/manage_hooks.test.js
node --test tests/herdr_agent_state.test.js
```

### Adding New Hooks or Events

If CodeBuddy introduces new supported events, you can:

1. Add the event to the hook manager's owned hook inventory in `scripts/manage_hooks.js`
2. Add the event mapping in `hooks/herdr_agent_state.js`
3. Update the tests accordingly
4. Document the new event in the README

## License

MIT. See the accompanying LICENSE file for details.