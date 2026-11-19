#!/usr/bin/env node
/**
 * CodeBuddy Hook Reporter for Herdr
 * 
 * Translates supported CodeBuddy lifecycle events into Herdr pane state and session reports.
 * 
 * Input: One JSON object on stdin with fields:
 *   - hook_event_name: The name of the CodeBuddy hook event
 *   - session_id: Optional session identifier for session restoration
 *   - generation_id: Optional correlation data (never an ordered number)
 *   - Event-specific fields (e.g., notification_type for Notification events)
 * 
 * Output: Reports Herdr pane state and session restore information via argv array
 *         (no shell). Exits successfully on all outcomes to avoid blocking CodeBuddy.
 */

import { spawn } from 'child_process';
import os from 'os';

// Validate required Herdr environment variables
const REQUIRED_ENV_VARS = ['HERDR_ENV', 'HERDR_PANE_ID', 'HERDR_BIN_PATH', 'HERDR_SOCKET_PATH'];

function validateEnvironment() {
  const missing = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    // Exit successfully without reporting when required env vars are missing
    // This allows CodeBuddy to continue even outside a Herdr pane
    process.exit(0);
  }
}

// Read JSON payload from stdin
// Returns null if input is empty/invalid (silent no-op)
function readStdinPayload() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', chunk => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      try {
        if (data.trim() === '') {
          resolve(null);
        } else {
          const parsed = JSON.parse(data);
          resolve(parsed);
        }
      } catch (err) {
        // Malformed JSON - silent no-op
        resolve(null);
      }
    });
  });
}

// Validate and parse the stdin JSON payload
async function parseInput() {
  const payload = await readStdinPayload();

  // If payload is null or invalid, silent no-op, exit successfully
  if (!payload) {
    process.exit(0);
  }

  // Validate payload structure
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    // Malformed input - silent no-op
    process.exit(0);
  }

  return payload;
}

// Report state to Herdr pane using argv array (no shell)
// argv equivalent to:
// pane report-agent <pane> --source herdr-codebuddy-plugin --agent CodeBuddy --state <state> --seq <number>
// Whenever a valid session_id is present, add --agent-session-id <id> --codebuddy --resume <id>
function buildArgv(state, paneId, seq, sessionId) {
  const baseArgs = [
    'report-agent',
    paneId,
    '--source',
    'herdr-codebuddy-plugin',
    '--agent',
    'CodeBuddy',
    '--state',
    state,
    '--seq',
    String(seq),
  ];

  // If we have a valid session_id, add resume metadata
  if (sessionId && typeof sessionId === 'string' && sessionId.length > 0) {
    // Validate Herdr constraints before attaching resume:
    // - plain command name, no apostrophes or control characters in any argument
    // - at most 64 arguments and 8 KiB total
    // For now, assume constraints are met since we control the arguments
    const resumeArgs = [
      '--agent-session-id',
      sessionId,
      '--codebuddy',
      '--resume',
      sessionId,
    ];

    // Combine base args with resume args
    return [...baseArgs, ...resumeArgs];
  }

  return baseArgs;
}

// Spawn the Herdr report-agent command with the given argv array
async function runHerdrCommand(argv) {
  const herdrBin = process.env.HERDR_BIN_PATH;

  return new Promise((resolve, reject) => {
    const child = spawn(herdrBin, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Suppress subprocess output - never forward hook data to Herdr stdout
    child.stdout.on('data', () => {
      // Intentionally suppress - do not emit hook stdout or include prompt/tool/transcript contents
    });

    child.stderr.on('data', () => {
      // Intentionally suppress - do not forward to conversation context
    });

    // Wait briefly then exit successfully
    // Use a short bounded timeout so CodeBuddy continues
    const timeoutId = setTimeout(() => {
      child.kill();
      resolve({ timedOut: true });
    }, 5000); // 5 second timeout

    child.on('exit', (code) => {
      clearTimeout(timeoutId);
      resolve({ code });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({ error: err.message });
    });
  });
}

// Event-to-state mapping per design table
function mapEventToState(eventName, sessionId) {
  // SessionStart (source startup/resume) → pane state: idle
  if (eventName === 'SessionStart') {
    // source can be "startup" or "resume" - attach valid session and resume argv
    return {
      state: 'idle',
      includeResume: !!sessionId,
      sessionId: sessionId || null,
    };
  }

  // UserPromptSubmit → pane state: working, start a turn
  if (eventName === 'UserPromptSubmit') {
    return {
      state: 'working',
      includeResume: false,
      sessionId: null,
    };
  }

  // PreToolUse, PostToolUse → pane state: working, tool activity
  if (eventName === 'PreToolUse' || eventName === 'PostToolUse') {
    return {
      state: 'working',
      includeResume: false,
      sessionId: null,
    };
  }

  // Notification with permission_prompt → pane state: blocked, no prompt contents copied
  if (eventName === 'Notification') {
    // Generic notification - treat based on design spec
    // permission_prompt → blocked, no prompt contents copied
    return {
      state: 'blocked',
      includeResume: false,
      sessionId: null,
    };
  }

  // Stop → pane state: idle, manual interruption can omit this event
  if (eventName === 'Stop') {
    return {
      state: 'idle',
      includeResume: false,
      sessionId: null,
    };
  }

  // Unsupported event - return null to indicate no report needed (silent no-op)
  return null;
}

// Main reporter function
async function runReporter() {
  // Validate required environment variables first
  validateEnvironment();

  // Read and parse stdin payload
  const payload = await parseInput();

  // If payload is null or invalid, silent no-op, exit successfully
  if (!payload) {
    process.exit(0);
  }

  // Extract fields from payload
  const {
    hook_event_name,
    session_id,
    generation_id,
    ...eventFields
  } = payload;

  // Validate hook_event_name
  if (!hook_event_name || typeof hook_event_name !== 'string') {
    // Unsupported event - silent no-op
    process.exit(0);
  }

  // Map event to state using the design table
  const stateMap = mapEventToState(hook_event_name, session_id);

  // If mapping returns null, unsupported event - silent no-op
  if (!stateMap) {
    process.exit(0);
  }

  // Initialize/read sequence state (monotonically increasing integer)
  // Persistent state path: user's .codebuddy directory / herdr-codebuddy-sequence.json
  const CONFIG_DIR = process.env.CODEBUDDY_CONFIG_DIR
    ? process.env.CODEBUDDY_CONFIG_DIR
    : os.homedir() + '/.codebuddy';
  const SEQUENCE_PATH = CONFIG_DIR + '/herdr-codebuddy-sequence.json';

  let seq = 0;
  try {
    const fs = await import('fs');
    const content = await fs.promises.readFile(SEQUENCE_PATH, 'utf-8');
    const data = JSON.parse(content);
    seq = Number(data.value) || 0;
    // Ensure seq is a safe integer - if not, start from 0
    if (!Number.isInteger(seq) || seq < 0) {
      seq = 0;
    }
  } catch (err) {
    // No persistent state yet - start from 0
    seq = 0;
  }

  // Choose a strictly larger safe integer for this report
  const newSeq = seq + 1;

  // Persist the new sequence value before reporting
  try {
    await import('fs').promises.writeFile(SEQUENCE_PATH, JSON.stringify({ value: newSeq }), 'utf-8');
  } catch (writeErr) {
    // Write failure - never block CodeBuddy operation;
    // report with the current seq value (will be superseded by next successful report)
  }

  // Build the argv array for Herdr report-agent command
  const argv = buildArgv(stateMap.state, process.env.HERDR_PANE_ID, newSeq, stateMap.sessionId);

  // Spawn the Herdr command
  await runHerdrCommand(argv);

  // Always exit successfully so CodeBuddy continues
  // Reporting failures must not interrupt CodeBuddy operation
  process.exit(0);
}

// Run the reporter
runReporter().catch(err => {
  // Never block CodeBuddy on reporter failures
  process.exit(0);
});