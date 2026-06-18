/**
 * Migrate NormalizedSession .json files to CSF .jsonl format.
 *
 * Reads all .json files from ~/copilot-trace-data/traces/<machineId>/<source>/
 * Maps to CSF Session + Messages, runs redaction, writes <source>-<id>.csf.jsonl.
 *
 * Usage: npx tsx scripts/migrate-traces.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { type Session, type Message, type ContentItem, type HarnessSource, CSF_VERSION } from '../packages/csf-typescript/src/types.js';
import { serializeSession } from '../packages/csf-typescript/src/serialize.js';
import { redactSessionMessages } from '../packages/csf-typescript/src/redact.js';

// ─── Interfaces for the NormalizedSession JSON format ────────────

interface NormalizedSession {
  machineId: string;
  source: string;
  sessionId: string;
  title?: string;
  startedAt: number; // epoch ms
  lastActiveAt: number; // epoch ms
  modelId?: string;
  requestCount?: number;
  firstMessage?: string;
  summary?: Record<string, unknown>;
  workspaceHash?: string;
  workspaceRoot?: string;
  directory?: string;
  messages: NormalizedMessage[];
  files?: NormalizedFile[];
  filesReferenced?: string[];
}

interface NormalizedMessage {
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'system';
  content: string;
  timestamp: number; // epoch ms
  toolName?: string;
}

interface NormalizedFile {
  filePath?: string;
  lastSeenAt?: number;
  referenceCount?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function normalizeSource(source: string): HarnessSource {
  if (source === 'vscode-copilot') return 'copilot-chat';
  // opencode → opencode (no change), and any other source passes through
  return source as HarnessSource;
}

/**
 * Extract file reference paths from the NormalizedSession `files` or `filesReferenced` field.
 * The `files` field can be:
 *   - An array of strings (file paths)
 *   - An array of objects with `filePath` (vscode-copilot format)
 *   - An empty array
 */
function extractFilePaths(normalized: NormalizedSession): string[] {
  // Prefer filesReferenced if present and non-empty
  if (normalized.filesReferenced && normalized.filesReferenced.length > 0) {
    return normalized.filesReferenced;
  }

  if (normalized.files && normalized.files.length > 0) {
    return normalized.files.map((f) => {
      if (typeof f === 'string') return f;
      if (typeof f === 'object' && f !== null && 'filePath' in f) return (f as NormalizedFile).filePath ?? '';
      return '';
    }).filter(Boolean);
  }

  return [];
}

/**
 * Derive a projectId from whatever context we have.
 * Uses workspaceHash if available, otherwise fallback to a hash of machineId + session.
 */
function deriveProjectId(normalized: NormalizedSession): string {
  const seed = normalized.workspaceHash || normalized.machineId || normalized.sessionId;
  return sha256Hex(seed);
}

// ─── Mapping ─────────────────────────────────────────────────────

function mapMessage(normalizedMsg: NormalizedMessage, sessionId: string, index: number): Message {
  let role: 'user' | 'assistant' | 'tool' | 'system';
  let content: ContentItem[];

  switch (normalizedMsg.role) {
    case 'user':
      role = 'user';
      content = [{ type: 'text' as const, text: normalizedMsg.content }];
      break;
    case 'assistant':
      role = 'assistant';
      content = [{ type: 'text' as const, text: normalizedMsg.content }];
      break;
    case 'thinking':
      // Thinking messages map to assistant role with reasoning content type
      role = 'assistant';
      content = [{ type: 'reasoning' as const, text: normalizedMsg.content }];
      break;
    case 'tool':
      role = 'tool';
      content = [{
        type: 'tool_result' as const,
        toolUseId: 'unknown',
        output: normalizedMsg.content,
      }];
      break;
    case 'system':
      role = 'system';
      content = [{ type: 'text' as const, text: normalizedMsg.content }];
      break;
    default:
      role = 'user';
      content = [{ type: 'text' as const, text: normalizedMsg.content }];
  }

  const extras: Record<string, unknown> = {};
  if (normalizedMsg.toolName) {
    extras.toolName = normalizedMsg.toolName;
  }

  return {
    id: crypto.randomUUID(),
    sessionId,
    parentId: null,
    role,
    content,
    timestamp: epochMsToIso(normalizedMsg.timestamp),
    phase: null,
    extras,
  };
}

function mapSession(normalized: NormalizedSession, filePath: string, fileContent: string): { session: Session; messages: Message[] } {
  const source = normalizeSource(normalized.source);
  const sessionId = normalized.sessionId;

  // Compute content hash
  const contentHash = 'sha256:' + sha256Hex(fileContent);

  // Build extras
  const extras: Record<string, unknown> = {};
  if (normalized.workspaceHash) {
    extras.workspaceHash = normalized.workspaceHash;
  }
  if (normalized.requestCount != null) {
    extras.requestCount = normalized.requestCount;
  }
  // Store the original summary object if present (vscode-copilot AI-generated summary)
  if (normalized.summary && Object.keys(normalized.summary).length > 0) {
    extras.originalSummary = normalized.summary;
  }

  const fileRefs = extractFilePaths(normalized);
  if (fileRefs.length > 0) {
    extras.fileReferences = fileRefs;
  }

  const session: Session = {
    version: CSF_VERSION,
    id: sessionId,
    source,
    machineId: normalized.machineId,
    directory: normalized.workspaceRoot ?? normalized.directory ?? 'unknown',
    projectId: deriveProjectId(normalized),
    git: { commitHash: null, branch: null, repositoryUrl: null },
    title: normalized.title ?? null,
    summary: normalized.firstMessage ?? null,
    status: 'completed',
    createdAt: epochMsToIso(normalized.startedAt),
    updatedAt: epochMsToIso(normalized.lastActiveAt),
    parentSessionId: null,
    agent: null,
    agentVersion: null,
    model: normalized.modelId ?? null,
    provider: null,
    sourceInfo: null,
    cost: null,
    tokensIn: null,
    tokensOut: null,
    tokenUsage: null,
    metrics: null,
    hasRedactions: false,
    redactionSummary: null,
    provenance: {
      sourcePath: filePath,
      contentHash,
      importedAt: new Date().toISOString(),
      originalFormat: 'normalized-session-json',
    },
    extras,
  };

  const messages: Message[] = normalized.messages.map((msg, i) => mapMessage(msg, sessionId, i));

  return { session, messages };
}

// ─── Main ────────────────────────────────────────────────────────

interface MigrationCounts {
  total: number;
  migrated: number;
  skipped: number;
  redacted: number;
}

async function main(): Promise<void> {
  const traceDir = path.resolve(process.env.HOME || '~', 'copilot-trace-data', 'traces');

  if (!fs.existsSync(traceDir)) {
    console.error(`Trace directory not found: ${traceDir}`);
    process.exit(1);
  }

  const counts: MigrationCounts = { total: 0, migrated: 0, skipped: 0, redacted: 0 };

  // Discover all machineId directories
  const machineDirs = fs.readdirSync(traceDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (machineDirs.length === 0) {
    console.warn('No machine directories found in', traceDir);
  }

  for (const machineId of machineDirs) {
    const machinePath = path.join(traceDir, machineId);

    // Discover all source directories under this machine
    const sourceDirs = fs.readdirSync(machinePath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const source of sourceDirs) {
      const sourcePath = path.join(machinePath, source);

      // Discover all .json files
      let jsonFiles: string[];
      try {
        jsonFiles = fs.readdirSync(sourcePath)
          .filter((f) => f.endsWith('.json'));
      } catch (err) {
        console.warn(`Warning: Cannot read directory ${sourcePath}:`, err);
        continue;
      }

      for (const jsonFile of jsonFiles) {
        const fullPath = path.join(sourcePath, jsonFile);
        counts.total++;

        try {
          // Read and parse
          const fileContent = fs.readFileSync(fullPath, 'utf-8');
          const normalized: NormalizedSession = JSON.parse(fileContent);

          // Validate minimal required fields
          if (!normalized.sessionId || !normalized.machineId || !normalized.messages) {
            console.warn(`Warning: Skipping ${fullPath} — missing required fields (sessionId, machineId, or messages)`);
            counts.skipped++;
            continue;
          }

          // Map to CSF
          const { session, messages } = mapSession(normalized, fullPath, fileContent);

          // Run redaction
          const redacted = redactSessionMessages(session, messages);

          // Build CSFSessionData to serialize
          const csfData = {
            session: redacted.session,
            messages: redacted.messages,
            checkpoints: [],
            memories: [],
          };

          // Output filename: <source>-<id>.csf.jsonl
          const outName = `${source}-${normalized.sessionId}.csf.jsonl`;
          const outPath = path.join(sourcePath, outName);

          const jsonl = serializeSession(csfData);
          fs.writeFileSync(outPath, jsonl, 'utf-8');

          if (redacted.hadRedactions) {
            counts.redacted++;
          }
          counts.migrated++;

          console.log(`  ✓ ${jsonFile} → ${outName}${redacted.hadRedactions ? ' (redacted)' : ''}`);
        } catch (err) {
          console.warn(`Warning: Skipping ${fullPath} — ${err instanceof Error ? err.message : String(err)}`);
          counts.skipped++;
        }
      }
    }
  }

  // Summary
  console.log('');
  console.log('─'.repeat(60));
  console.log(`Migrated ${counts.migrated} traces (${counts.redacted} had redactions)`);
  if (counts.skipped > 0) {
    console.log(`Skipped ${counts.skipped} files due to errors`);
  }
  console.log(`Total files processed: ${counts.total}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
