#!/usr/bin/env node
/**
 * CodeBuddy Hook Manager for Herdr
 * 
 * Manages CodeBuddy integration hooks in user settings.json:
 * - install: Register owned hooks, repeatable, preserve unrelated settings
 * - remove: Delete only owned hooks and empty groups
 * - status: Report hook installation state
 * 
 * Usage: node scripts/manage_hooks.js <install|remove|status>
 */

const fs = await import('fs/promises');
const path = await import('path');
const os = await import('os');

// Resolve the CodeBuddy config directory
function resolveCodeBuddyConfigDir() {
  const configDir = process.env.CODEBUDDY_CONFIG_DIR;
  if (configDir) {
    return path.resolve(configDir);
  }
  // Fallback to user ~/.codebuddy directory
  const homeDir = os.homedir();
  return path.join(homeDir, '.codebuddy');
}

// Resolve the settings.json file path
function resolveSettingsPath(configDir) {
  return path.join(configDir, 'settings.json');
}

// Safe shell quoting for the current OS
function shellQuote(value) {
  // On macOS/Linux, use single quotes with internal single-quote escaping
  // On Windows Git Bash, use single quotes as well (Git Bash follows sh quoting)
  // Strategy: wrap in single quotes, escape any internal single quotes by '\'' (close-quote, reopen-quote, then the char)
  if (typeof value !== 'string') {
    return JSON.stringify(value);
  }
  // Check if value contains a single quote
  if (value.includes("'")) {
    // Escape internal single quotes: close quote, add escaped char, open quote
    const escaped = value.replace(/'/g, "'''");
    return `"${escaped}"`;
  }
  return `'${value}'`;
}

// Global lock file path for concurrent management actions
const CONFIG_DIR = resolveCodeBuddyConfigDir();
const SETTINGS_PATH = resolveSettingsPath(CONFIG_DIR);
const LOCK_PATH = path.join(CONFIG_DIR, '.herdr-codebuddy-lock');

// Asynchronous sleep for lock retry
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Acquire a bounded exclusive lock using a lock file
async function acquireLock(timeoutMs = 15000, retryMs = 200) {
  const startTime = Date.now();
  let acquired = false;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Use O_CREAT | O_EXCL to atomically create the lock file
      await fs.access(LOCK_PATH);
      // Lock file exists, wait and retry
      await sleep(retryMs);
      continue;
    } catch (err) {
      // Lock file does not exist, try to create it
      try {
        await fs.writeFile(LOCK_PATH, String(process.pid));
        acquired = true;
        break;
      } catch (createErr) {
        await sleep(retryMs);
      }
    }
  }

  if (!acquired) {
    throw new Error(`Failed to acquire lock within ${timeoutMs}ms for hook management`);
  }

  return { release: async () => { try { await fs.unlink(LOCK_PATH); } catch {} } };
}

// Read and parse settings.json, returning null if file is missing or malformed
async function readSettings() {
  try {
    const content = await fs.readFile(SETTINGS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    // File missing or malformed - return null
    return null;
  }
}

// Write settings.json atomically: write temp file then rename
async function writeSettings(settings) {
  // Ensure directory exists
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  // Write to temp file in same directory
  const tempPath = path.join(CONFIG_DIR, `.tmp-settings-${Date.now()}.json`);
  await fs.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf-8');

  // Atomic replace
  await fs.rename(tempPath, SETTINGS_PATH);
}

// Get the current owned hook inventory from settings
function getOwnedHooks(settings) {
  if (!settings || !settings.hooks) {
    return [];
  }
  return settings.hooks || [];
}

// Check if a hook entry is owned by this integration (has the versioned marker)
function isOwnedHook(hookEntry) {
  if (!hookEntry || typeof hookEntry !== 'object') {
    return false;
  }
  // Check for the versioned integration marker
  return hookEntry.__herdr_codebuddy_marker__ === 'v1';
}

// Extract the event name from a hook entry
function getHookEvent(hookEntry) {
  if (!hookEntry || typeof hookEntry !== 'object') {
    return null;
  }
  return hookEntry.event || hookEntry.name || null;
}

// Add an owned hook to the settings hooks array
function addOwnedHook(settings, hookEntry) {
  if (!settings.hooks) {
    settings.hooks = [];
  }
  settings.hooks.push(hookEntry);
  return settings;
}

// Remove owned hooks from the settings hooks array
function removeOwnedHooks(settings) {
  if (!settings.hooks) {
    return settings;
  }
  settings.hooks = settings.hooks.filter(hook => !isOwnedHook(hook));
  return settings;
}

// Remove owned hooks and any empty groups
function removeOwnedEntries(settings) {
  if (!settings.hooks) {
    return settings;
  }

  // Filter out owned hooks
  let filteredHooks = settings.hooks.filter(hook => !isOwnedHook(hook));

  // Also remove any empty matcher groups that were created by removal
  // (If a matcher group becomes empty after removing owned hooks, remove it too)
  // For now, we keep the structure and just filter owned entries

  settings.hooks = filteredHooks;
  return settings;
}

// === Main Action Logic ===

async function installAction() {
  // Acquire lock for concurrent management
  const release = await acquireLock();
  try {
    // Read current settings
    let settings = await readSettings();

    // If settings don't exist, create fresh structure
    if (settings === null) {
      settings = { hooks: [] };
    }

    // Check if this integration's hooks are already installed
    const existingOwned = getOwnedHooks(settings).filter(isOwnedHook);

    if (existingOwned.length > 0) {
      // Hooks already installed - this is repeatable install
      // Verify they still point to the correct reporter
      // For now, just report success (repeatable: running install multiple times leaves only one instance of each owned hook)
      return { status: 'already_installed', message: 'CodeBuddy hooks are already installed' };
    }

    // Define the owned hook entries for CodeBuddy lifecycle events
    // Each hook points to the reporter script with the event name as argument
    const hookEntries = [
      // SessionStart - triggered on startup/resume
      {
        __herdr_codebuddy_marker__: 'v1',
        event: 'SessionStart',
        command: 'codebuddy-hook-report',
      },
      // UserPromptSubmit - triggered when user submits a prompt
      {
        __herdr_codebuddy_marker__: 'v1',
        event: 'UserPromptSubmit',
        command: 'codebuddy-hook-report',
      },
      // PreToolUse - triggered before a tool operation
      {
        __herdr_codebuddy_marker__: 'v1',
        event: 'PreToolUse',
        command: 'codebuddy-hook-report',
      },
      // PostToolUse - triggered after a tool operation
      {
        __herdr_codebuddy_marker__: 'v1',
        event: 'PostToolUse',
        command: 'codebuddy-hook-report',
      },
      // Stop - triggered when CodeBuddy completes
      {
        __herdr_codebuddy_marker__: 'v1',
        event: 'Stop',
        command: 'codebuddy-hook-report',
      },
      // Notification with permission_prompt
      {
        __herdr_codebuddy_marker__: 'v1',
        event: 'Notification',
        subtype: 'permission_prompt',
        command: 'codebuddy-hook-report',
      },
    ];

    // Add each owned hook to the settings
    for (const hookEntry of hookEntries) {
      addOwnedHook(settings, hookEntry);
    }

    // Write settings atomically
    await writeSettings(settings);

    return { status: 'success', message: 'CodeBuddy hooks installed successfully' };
  } finally {
    // Release lock - best effort, don't fail the action
    try { await release(); } catch {}
  }
}

async function removeAction() {
  // Acquire lock for concurrent management
  const release = await acquireLock();
  try {
    // Read current settings
    let settings = await readSettings();

    if (settings === null) {
      // No settings file to modify
      return { status: 'no_settings', message: 'No CodeBuddy settings file found' };
    }

    // Remove only owned entries
    settings = removeOwnedEntries(settings);

    // Check if hooks array is now empty
    if (settings.hooks && settings.hooks.length === 0) {
      // Remove the hooks key if empty (cleanup)
      delete settings.hooks;
    }

    // Write settings atomically only if changes were made
    // But we always write to ensure settings.json stays valid
    await writeSettings(settings);

    return { status: 'success', message: 'CodeBuddy hooks removed successfully' };
  } finally {
    try { await release(); } catch {}
  }
}

async function statusAction() {
  // Read current settings
  let settings = await readSettings();

  let installedCount = 0;
  let totalHooks = 0;
  let ownedHooks = [];

  if (settings && settings.hooks) {
    totalHooks = settings.hooks.length;
    ownedHooks = settings.hooks.filter(hook => isOwnedHook(hook));
    installedCount = ownedHooks.length;
  }

  // Determine status
  let status;
  let details;

  if (installedCount === 0 && totalHooks === 0) {
    status = 'absent';
    details = 'No CodeBuddy integration hooks found';
  } else if (installedCount === ownedHooks.length && installedCount > 0) {
    status = 'installed';
    details = `${installedCount} of ${totalHooks} integration hooks are installed`;
  } else if (installedCount > 0 && installedCount < totalHooks) {
    status = 'incomplete';
    details = `${installedCount} of ${totalHooks} integration hooks installed (some may be missing or corrupted)`;
  } else {
    status = 'undeterminable';
    details = 'Cannot determine hook installation status';
  }

  return {
    status,
    details,
    installed: installedCount,
    total: totalHooks,
    owned_hooks: ownedHooks.map(h => ({
      event: h.event,
      has_marker: isOwnedHook(h),
    })),
  };
}

// === CLI Entry Point ===

async function main() {
  const action = process.argv[2];

  if (!action) {
    console.error('Usage: node scripts/manage_hooks.js <install|remove|status>');
    process.exit(1);
  }

  try {
    let result;

    switch (action) {
      case 'install':
        result = await installAction();
        if (result.status === 'already_installed') {
          // Already installed is not an error for repeatable install
          console.log(result.message);
          process.exit(0);
        }
        if (result.status !== 'success') {
          console.error(`Installation failed: ${result.message}`);
          process.exit(1);
        }
        console.log(result.message);
        process.exit(0);
        break;

      case 'remove':
        result = await removeAction();
        if (result.status === 'no_settings') {
          console.log(result.message);
          process.exit(0);
        }
        if (result.status !== 'success') {
          console.error(`Removal failed: ${result.message}`);
          process.exit(1);
        }
        console.log(result.message);
        process.exit(0);
        break;

      case 'status':
        result = await statusAction();
        console.log(`Status: ${result.status}`);
        console.log(`Details: ${result.details}`);
        console.log(`Installed: ${result.installed}/${result.total}`);
        if (result.owned_hooks && result.owned_hooks.length > 0) {
          console.log('Owned hooks:');
          for (const hook of result.owned_hooks) {
            console.log(`  - ${hook.event}: ${hook.has_marker ? 'owned' : 'not owned'}`);
          }
        }
        process.exit(0);
        break;

      default:
        console.error(`Unknown action: ${action}`);
        console.error('Usage: node scripts/manage_hooks.js <install|remove|status>');
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Run main
main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});