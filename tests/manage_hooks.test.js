#!/usr/bin/env node
/**
 * Tests for the CodeBuddy Hook Manager (scripts/manage_hooks.js)
 * 
 * Exercise settings management, identity, preservation and error cases
 * using isolated temporary homes.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3
 */

import { spawn } from 'child_process';
import { mkdir, writeFile, readFile, rm, exec } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

// Helper to run manage_hooks.js with a custom CWD and env
async function runManageHooks(action, cwd, env = {}) {
  const envVars = {
    ...process.env,
    CODEBUDDY_CONFIG_DIR: cwd,
    ...env,
  };
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.argv[0], [join(cwd, 'scripts', 'manage_hooks.js'), action], {
      cwd,
      env: envVars,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => { reject(err); });
  });
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

// Helper to create a temporary directory with a settings.json
async function createTempSettings(initialContent = {}) {
  const tmpDir = tmpdir();
  const testDir = join(tmpDir, `codebuddy-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
  
  const settingsPath = join(testDir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify(initialContent), 'utf-8');
  
  return { testDir, settingsPath };
}

describe('CodeBuddy Hook Manager', () => {
  afterEach(async () => {
    // Cleanup is handled by using temp dirs
  });

  describe('install action', () => {
    it('should install hooks when no settings file exists', async () => {
      const { testDir, settingsPath } = await createTempSettings();
      
      try {
        const result = await runManageHooks('install', testDir);
        
        // Should succeed (create settings file with hooks)
        expect(result.code).toBe(0);
        
        // Verify settings.json was created with hooks
        const content = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        expect(settings.hooks).toBeDefined();
        expect(settings.hooks.length).toBeGreaterThan(0);
        
        // Verify owned hooks have the marker
        const ownedHooks = settings.hooks.filter(hook => hook.__herdr_codebuddy_marker__ === 'v1');
        expect(ownedHooks.length).toBe(settings.hooks.length);
      } finally {
        // Cleanup
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should be repeatable: running install multiple times leaves only one instance of each owned hook', async () => {
      const { testDir, settingsPath } = await createTempSettings();
      
      try {
        // First install
        await runManageHooks('install', testDir);
        
        // Second install (should be repeatable)
        const result2 = await runManageHooks('install', testDir);
        
        // Verify settings.json was created with hooks
        const content = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        
        // Should have exactly one instance of each owned hook (no duplicates)
        const ownedHooks = settings.hooks.filter(hook => hook.__herdr_codebuddy_marker__ === 'v1');
        const uniqueEvents = [...new Set(ownedHooks.map(h => h.event))];
        expect(ownedHooks.length).toBe(uniqueEvents.length);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should preserve unrelated settings and hooks during install', async () => {
      const { testDir, settingsPath } = await createTempSettings({
        existingHook: { event: 'custom-hook', command: 'echo hello' },
        groups: { general: { setting: 'value' } }
      });
      
      try {
        const result = await runManageHooks('install', testDir);
        
        // Should succeed
        expect(result.code).toBe(0);
        
        // Verify unrelated settings are preserved
        const content = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        
        // Original unrelated hook should still be present
        expect(settings.existingHook).toBeDefined();
        expect(settings.existingHook.event).toBe('custom-hook');
        
        // Groups should be preserved
        expect(settings.groups).toBeDefined();
        expect(settings.groups.general.setting).toBe('value');
        
        // Integration-owned hooks should be added
        expect(settings.hooks).toBeDefined();
        expect(settings.hooks.length).toBeGreaterThan(0);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should create settings file only if absent', async () => {
      const { testDir, settingsPath } = await createTempSettings({
        // Settings already exist
        existingSetting: 'value'
      });
      
      try {
        // Install should succeed and preserve existing settings
        const result = await runManageHooks('install', testDir);
        
        expect(result.code).toBe(0);
        
        // Verify existing settings are preserved
        const content = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        expect(settings.existingSetting).toBe('value');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('remove action', () => {
    it('should remove only owned entries and empty groups', async () => {
      const { testDir, settingsPath } = await createTempSettings({
        __herdr_codebuddy_marker__: 'v1',
        event: 'SessionStart',
        command: 'codebuddy-hook-report',
        unrelatedHook: { event: 'custom-hook', command: 'echo hello' },
        groups: { general: { setting: 'value' } }
      });
      
      try {
        const result = await runManageHooks('remove', testDir);
        
        // Should succeed
        expect(result.code).toBe(0);
        
        // Verify owned hook was removed
        const content = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        
        // Unrelated hook should still be present
        expect(settings.unrelatedHook).toBeDefined();
        
        // Groups should be preserved
        expect(settings.groups).toBeDefined();
        
        // Owned hook should be removed
        expect(settings.hooks).toBeUndefined() || settings.hooks.length === 0;
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should preserve unrelated CodeBuddy settings and hooks during removal', async () => {
      const { testDir, settingsPath } = await createTempSettings({
        __herdr_codebuddy_marker__: 'v1',
        event: 'SessionStart',
        command: 'codebuddy-hook-report',
        unrelatedHook: { event: 'custom-hook', command: 'echo hello' },
        groups: { general: { setting: 'value' } }
      });
      
      try {
        const result = await runManageHooks('remove', testDir);
        
        // Should succeed
        expect(result.code).toBe(0);
        
        // Verify unrelated settings are preserved
        const content = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        
        // Unrelated hook should still be present
        expect(settings.unrelatedHook).toBeDefined();
        expect(settings.unrelatedHook.event).toBe('custom-hook');
        
        // Groups should be preserved
        expect(settings.groups).toBeDefined();
        expect(settings.groups.general.setting).toBe('value');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should handle malformed settings gracefully', async () => {
      const { testDir, settingsPath } = await createTempSettings('not valid json');
      
      try {
        // Should not crash - leave settings unchanged
        const result = await runManageHooks('remove', testDir);
        
        // Should report no settings or handle gracefully
        // The key is it doesn't crash
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should handle unreadable settings gracefully', async () => {
      const { testDir, settingsPath } = await createTempSettings({});
      
      try {
        // Make settings unreadable
        await execSync(`chmod 000 ${settingsPath}`);
        
        // Should not crash
        const result = await runManageHooks('remove', testDir);
      } finally {
        // Restore permissions for cleanup
        try { await execSync(`chmod 644 ${settingsPath}`); } catch {}
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('status action', () => {
    it('should report absent when no settings file exists', async () => {
      const { testDir, settingsPath } = await createTempSettings();
      
      try {
        // Remove settings file to test absent state
        await execSync(`rm -f ${settingsPath}`);
        
        const result = await runManageHooks('status', testDir);
        
        // Should report absent
        expect(result.stdout).toContain('absent');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should report installed when all integration hooks are installed', async () => {
      const { testDir, settingsPath } = await createTempSettings({
        __herdr_codebuddy_marker__: 'v1',
        event: 'SessionStart',
        command: 'codebuddy-hook-report'
      });
      
      try {
        const result = await runManageHooks('status', testDir);
        
        // Should report installed
        expect(result.stdout).toContain('installed');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should report incomplete when only some hooks are installed', async () => {
      const { testDir, settingsPath } = await createTempSettings({
        __herdr_codebuddy_marker__: 'v1',
        event: 'SessionStart',
        command: 'codebuddy-hook-report',
        otherHook: { event: 'other-event', some: 'data' }
      });
      
      try {
        const result = await runManageHooks('status', testDir);
        
        // Should report incomplete (has both owned and non-owned hooks)
        expect(result.stdout).toContain('incomplete');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should report owned hooks and their status', async () => {
      const { testDir, settingsPath } = await createTempSettings({
        __herdr_codebuddy_marker__: 'v1',
        event: 'SessionStart',
        command: 'codebuddy-hook-report'
      });
      
      try {
        const result = await runManageHooks('status', testDir);
        
        // Should show owned hooks info
        expect(result.stdout).toContain('owned');
        expect(result.stdout).toContain('SessionStart');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});