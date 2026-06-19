#!/usr/bin/env npx tsx
/**
 * Capture opencode sessions from SQLite database → CSF .jsonl files
 *
 * Usage:
 *   npx tsx scripts/capture-opencode.ts [--limit N] [--output DIR] [--db PATH]
 *
 * Defaults:
 *   --output: ~/session-trace-data/traces (same as existing trace repo)
 *   --db: ~/.local/share/opencode/opencode.db
 *   --limit: all sessions
 */

import { listSessions, captureAll } from '../packages/csf-typescript/src/adapters/opencode-capture.js';
import path from 'node:path';
import os from 'node:os';

// Parse args
const args = process.argv.slice(2);
let limit: number | undefined;
let outputDir = path.join(os.homedir(), 'session-trace-data', 'traces');
let dbPath: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    outputDir = args[i + 1];
    i++;
  } else if (args[i] === '--db' && args[i + 1]) {
    dbPath = args[i + 1];
    i++;
  }
}

// List sessions first
console.log('Scanning opencode database...');
const sessions = listSessions(dbPath);
console.log(`Found ${sessions.length} sessions (${sessions.filter(s => s.messageCount > 0).length} with messages)`);

if (sessions.length === 0) {
  console.log('No sessions found. Exiting.');
  process.exit(0);
}

// Show a few
console.log('\nLatest 5 sessions:');
for (const s of sessions.slice(0, 5)) {
  console.log(`  ${s.id.substring(0, 12)}... | msgs: ${s.messageCount} | ${s.title?.substring(0, 50) || 'untitled'}`);
}
if (sessions.length > 5) {
  console.log(`  ... and ${sessions.length - 5} more`);
}

// Capture
console.log(`\nCapturing to: ${outputDir}`);
if (limit) console.log(`Limit: ${limit} sessions`);

const result = captureAll(outputDir, { dbPath, limit });

console.log(`\n=== Capture Complete ===`);
console.log(`Captured: ${result.captured} sessions`);
console.log(`Redacted: ${result.redacted} sessions had secrets stripped`);
if (result.errors.length > 0) {
  console.log(`Errors: ${result.errors.length}`);
  for (const err of result.errors.slice(0, 5)) {
    console.log(`  ${err}`);
  }
}
console.log(`Output: ${outputDir}/<machineId>/opencode/opencode-<id>.csf.jsonl`);
