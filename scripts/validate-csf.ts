import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deserializeSession, validateSession, validateMessage } from '../packages/csf-typescript/src/index.js';

const rootDir = process.argv[2] || '/var/folders/cv/1gldz2x92tz21dwhm0msqpm80000gn/T/opencode/csf-test';

// Recursively find all .csf.jsonl files
function findCsfFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findCsfFiles(fullPath));
    } else if (entry.endsWith('.csf.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

const csfFiles = findCsfFiles(rootDir);
console.log(`Found ${csfFiles.length} CSF files in ${rootDir}\n`);

let allValid = true;
let totalMessages = 0;
let totalRedacted = 0;
let validCount = 0;
let errorCount = 0;
let warnCount = 0;

for (const filePath of csfFiles) {
  const fileName = filePath.split('/').pop()!;
  try {
    const jsonl = readFileSync(filePath, 'utf-8');
    const data = deserializeSession(jsonl);

    const sessionResult = validateSession(data.session);
    if (!sessionResult.valid) {
      console.log(`⚠️  ${fileName}: ${sessionResult.errors[0]}`);
      warnCount++;
      continue;
    }

    let msgErrors = 0;
    for (const msg of data.messages) {
      const r = validateMessage(msg);
      if (!r.valid) { msgErrors++; }
    }

    totalMessages += data.messages.length;
    if (data.session.hasRedactions) totalRedacted++;
    validCount++;

    if (msgErrors > 0) {
      console.log(`⚠️  ${fileName}: ${msgErrors} message validation errors`);
      warnCount++;
    }
  } catch (e) {
    console.log(`❌ ${fileName}: ${e instanceof Error ? e.message.substring(0, 80) : String(e).substring(0, 80)}`);
    errorCount++;
    allValid = false;
  }
}

console.log(`\n=== Summary ===`);
console.log(`Files: ${csfFiles.length} | Valid: ${validCount} | Warnings: ${warnCount} | Errors: ${errorCount}`);
console.log(`Messages: ${totalMessages} | Redacted: ${totalRedacted}`);
console.log(`All valid: ${allValid && errorCount === 0}`);
