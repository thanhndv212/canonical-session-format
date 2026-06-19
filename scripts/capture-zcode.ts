#!/usr/bin/env npx tsx
/**
 * Capture zcode sessions from SQLite database → CSF .jsonl files
 * Reuses the opencode-capture adapter (identical schema), then post-processes
 * to set source='zcode' and rename files.
 *
 * Usage:
 *   npx tsx scripts/capture-zcode.ts [--limit N] [--output DIR] [--db PATH]
 */

import { captureAll } from '../packages/csf-typescript/src/adapters/opencode-capture.js';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
let limit: number | undefined;
let outputDir = path.join(os.homedir(), 'copilot-trace-data', 'traces');
let dbPath: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) { limit = parseInt(args[i + 1], 10); i++; }
  else if (args[i] === '--output' && args[i + 1]) { outputDir = args[i + 1]; i++; }
  else if (args[i] === '--db' && args[i + 1]) { dbPath = args[i + 1]; i++; }
}

const zcodeDbPath = dbPath || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');

if (!existsSync(zcodeDbPath)) {
  console.error(`zcode database not found: ${zcodeDbPath}`);
  process.exit(1);
}

// Use a temp directory for initial capture to avoid mixing with opencode files
const tmpDir = path.join(os.tmpdir(), `zcode-capture-${Date.now()}`);

console.log('Scanning zcode database...');
const result = captureAll(tmpDir, { dbPath: zcodeDbPath, limit });

if (result.captured === 0) {
  console.log('No sessions captured.');
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(0);
}

console.log(`\n=== Post-processing for zcode source ===`);

// Find the captured files in temp dir
const machineDir = readdirSync(tmpDir)[0];
const opencodeTmpDir = path.join(tmpDir, machineDir, 'opencode');
const capturedFiles = readdirSync(opencodeTmpDir).filter(f => f.endsWith('.csf.jsonl'));

// Create zcode output directory
const zcodeOutputDir = path.join(outputDir, machineDir, 'zcode');
mkdirSync(zcodeOutputDir, { recursive: true });

let processed = 0;
for (const file of capturedFiles) {
  const tmpPath = path.join(opencodeTmpDir, file);
  const newPath = path.join(zcodeOutputDir, file.replace(/^opencode-/, 'zcode-'));

  // Read, fix source field, write to zcode dir
  const content = readFileSync(tmpPath, 'utf-8');
  const fixed = content.replace(/"source":"opencode"/g, '"source":"zcode"');
  writeFileSync(newPath, fixed, 'utf-8');
  processed++;
}

// Clean up temp directory
rmSync(tmpDir, { recursive: true, force: true });

console.log(`Processed: ${processed} files → ${zcodeOutputDir}`);
console.log(`\n=== zcode Capture Complete ===`);
console.log(`Captured: ${result.captured} sessions`);
console.log(`Redacted: ${result.redacted} sessions had secrets stripped`);
if (result.errors.length > 0) {
  console.log(`Errors: ${result.errors.length}`);
  for (const err of result.errors.slice(0, 5)) console.log(`  ${err}`);
}
console.log(`Output: ${zcodeOutputDir}/zcode-<id>.csf.jsonl`);
