# Requirements Document

## Project Description (Input)

People running Tencent CodeBuddy Code in Herdr need to see whether an agent is working, idle, or waiting for permission, and to restore its session. Without a dedicated integration, Herdr cannot reliably receive CodeBuddy's lifecycle and session information. Create a Herdr-managed plugin, modeled on the sibling ZCode integration, that installs, removes, and checks CodeBuddy hooks, reports agent state and session information without interrupting CodeBuddy, and supports session restoration while preserving unrelated settings. Adapt to CodeBuddy's documented interfaces, account for concurrent hooks and report ordering, and verify compatibility and actual lifecycle behavior. See [brief.md](brief.md) for scope and constraints.

## Scope and Adjacent Expectations

The integration covers the Tencent CodeBuddy Code CLI in Herdr, including management of its own hooks, pane state reporting, and session restoration. It depends on CodeBuddy delivering supported events and Herdr accepting reports and restoring sessions. It does not modify Herdr or CodeBuddy, distribute the CodeBuddy CLI, or manage unrelated settings, hooks, credentials, or plugins. Full subagent and interruption tracking are not promised without verified event support.

## Requirements

### Requirement 1: Install and remove the integration

**User story:** As a Herdr user, I want to manage the CodeBuddy integration so that I can enable or remove it without disrupting my existing configuration.

#### Acceptance criteria

1. When a user installs the integration, the CodeBuddy integration shall register the hooks needed for its supported reporting behaviors.
2. When a user installs the integration more than once, the CodeBuddy integration shall leave only one instance of each integration-owned hook.
3. When a user removes the integration, the CodeBuddy integration shall remove its own hooks.
4. When a user installs or removes the integration, the CodeBuddy integration shall preserve unrelated CodeBuddy settings and hooks.
5. If installation or removal cannot be completed, the CodeBuddy integration shall report the failure to the user.
6. If existing settings cannot be safely read, the CodeBuddy integration shall leave those settings unchanged.

### Requirement 2: Inspect integration status

**User story:** As a Herdr user, I want to inspect the integration's status so that I can tell whether its hooks are installed.

#### Acceptance criteria

1. When a user requests status, the CodeBuddy integration shall indicate whether all integration-owned hooks are installed.
2. When a user requests status and only some integration-owned hooks are installed, the CodeBuddy integration shall identify the installation as incomplete.
3. If the integration cannot determine hook status, the CodeBuddy integration shall report that status cannot be determined.

### Requirement 3: Report agent activity

**User story:** As a Herdr user, I want the pane to reflect CodeBuddy activity so that I can identify whether the agent is working, idle, or awaiting permission.

#### Acceptance criteria

1. When CodeBuddy starts or resumes a session and supplies a supported session-start event, the CodeBuddy integration shall report the pane as idle.
2. When CodeBuddy begins processing a user prompt and supplies the corresponding supported event, the CodeBuddy integration shall report the pane as working.
3. When CodeBuddy performs a tool operation and supplies a supported activity event, the CodeBuddy integration shall report the pane as working.
4. When CodeBuddy requests user permission and supplies a supported permission event, the CodeBuddy integration shall report the pane as blocked.
5. When CodeBuddy completes its response and supplies a supported stop event, the CodeBuddy integration shall report the pane as idle.
6. When the CodeBuddy integration can determine the order of events for the same pane, the CodeBuddy integration shall prevent an older event's report from replacing the state of a newer event.
7. When event ordering cannot be determined, the CodeBuddy integration shall document that concurrent events may temporarily produce an incorrect pane state.

### Requirement 4: Restore sessions

**User story:** As a Herdr user, I want to restore a CodeBuddy session so that I can continue my conversation in a restored pane.

#### Acceptance criteria

1. When a supported CodeBuddy event supplies a session identifier for a session in a Herdr pane, the CodeBuddy integration shall provide Herdr with the information needed to resume that session.
2. When Herdr restores a pane for which valid CodeBuddy session information was registered, the CodeBuddy integration shall enable Herdr to resume that same session.
3. If CodeBuddy does not supply a session identifier, the CodeBuddy integration shall not register a resume command for an unidentified session.
4. When multiple CodeBuddy sessions report activity, the CodeBuddy integration shall associate each session's restore information with its own pane.

### Requirement 5: Preserve the CodeBuddy workflow

**User story:** As a CodeBuddy user, I want integration failures to leave my session usable so that reporting does not interfere with my work.

#### Acceptance criteria

1. If Herdr is unavailable or a report fails, the CodeBuddy integration shall allow the CodeBuddy operation that triggered the report to continue.
2. If CodeBuddy runs outside a Herdr pane, the CodeBuddy integration shall allow the CodeBuddy operation that triggered a hook to continue.
3. When an integration hook runs, the CodeBuddy integration shall not add its reporting output to the conversation context.

### Requirement 6: Explain setup and compatibility

**User story:** As a Herdr user, I want setup instructions and compatibility limits so that I can install and troubleshoot the integration.

#### Acceptance criteria

1. When a user consults the integration documentation, the CodeBuddy integration shall provide installation, status, and removal instructions.
2. When a user consults the integration documentation, the CodeBuddy integration shall identify its supported CodeBuddy and Herdr versions and required runtime dependencies.
3. When a user consults the integration documentation, the CodeBuddy integration shall explain how CodeBuddy's settings snapshot and hook review affect activation of configuration changes.
4. When a user consults the integration documentation, the CodeBuddy integration shall identify supported platforms and observed limitations for permission, interruption, subagent, and session lifecycle reporting.
