/**
 * OpenCode CSF Adapter — reads from opencode SQLite database, produces CSF
 *
 * Source: ~/.local/share/opencode/opencode.db
 * Tables: session, message, part, todo
 *
 * See: session-knowledge-ecosystem-plan.md §5.6
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  Session,
  Message,
  ContentItem,
  CSFSessionData,
  HarnessSource,
} from '../types.js';
import { CSF_VERSION } from '../types.js';
import { redactSessionMessages } from '../redact.js';
import { serializeSession } from '../serialize.js';

// ─── Types ──────────────────────────────────────────────────────

interface OpenCodeSessionRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string | null;
  version: number;
  share_url: string | null;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: string | null;
  summary_diffs: string | null;
  revert: string | null;
  permission: string | null;
  time_created: number;
  time_updated: number;
  time_compacting: number | null;
  time_archived: number | null;
  workspace_id: string | null;
  path: string | null;
  agent: string | null;
  model: string | null; // JSON string like {"id":"...","providerID":"...","variant":"..."}
  cost: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  metadata: string | null;
}

interface OpenCodeMessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: string; // JSON: { role: 'user' | 'assistant' | 'system' | 'tool' }
}

interface OpenCodePartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  data: string; // JSON: { type, text?, tool?, state?, reasoning? }
}

interface OpenCodeTodoRow {
  session_id: string;
  content: string;
  status: string;
  priority: number;
  position: number;
  time_created: number;
  time_updated: number;
}

// ─── Helpers ────────────────────────────────────────────────────

function getOpencodeDbPath(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

function epochToISO(ms: number): string {
  return new Date(ms).toISOString();
}

function deriveProjectId(directory: string): string {
  return 'proj_' + createHash('sha256').update(directory).digest('hex').substring(0, 12);
}

function parseModel(modelJson: string | null): { model: string | null; provider: string | null } {
  if (!modelJson) return { model: null, provider: null };
  try {
    const parsed = JSON.parse(modelJson);
    return {
      model: parsed.id ?? null,
      provider: parsed.providerID ?? null,
    };
  } catch {
    return { model: modelJson, provider: null };
  }
}

// ─── Session Mapping ────────────────────────────────────────────

function mapSession(row: OpenCodeSessionRow, dbPath: string): Session {
  const { model, provider } = parseModel(row.model);

  const tokenUsage = (row.tokens_reasoning !== null || row.tokens_cache_read !== null || row.tokens_cache_write !== null)
    ? {
        cachedReadTokens: row.tokens_cache_read,
        cachedWriteTokens: row.tokens_cache_write,
        reasoningTokens: row.tokens_reasoning,
      }
    : null;

  // Parse metadata if present
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try { metadata = JSON.parse(row.metadata); } catch { /* ignore */ }
  }

  return {
    version: CSF_VERSION,
    id: row.id,
    source: 'opencode' as HarnessSource,
    machineId: getMachineId(),
    directory: row.directory,
    projectId: row.project_id || deriveProjectId(row.directory),
    git: {
      commitHash: null,
      branch: null,
      repositoryUrl: null,
    },
    title: row.title,
    summary: null,
    status: row.time_archived ? 'completed' : 'active',
    createdAt: epochToISO(row.time_created),
    updatedAt: epochToISO(row.time_updated),
    parentSessionId: row.parent_id,
    agent: row.agent,
    agentVersion: null,
    model,
    provider,
    sourceInfo: 'cli',
    cost: row.cost,
    tokensIn: row.tokens_input,
    tokensOut: row.tokens_output,
    tokenUsage,
    metrics: null, // Could be computed from messages, but leave null for MVP
    hasRedactions: false,
    redactionSummary: null,
    provenance: {
      sourcePath: dbPath,
      contentHash: 'sha256:' + createHash('sha256').update(row.id).digest('hex'),
      importedAt: new Date().toISOString(),
      originalFormat: 'opencode-sqlite',
    },
    extras: {
      shareUrl: row.share_url,
      revert: row.revert,
      permission: row.permission,
      slug: row.slug,
      workspaceId: row.workspace_id,
      summaryAdditions: row.summary_additions,
      summaryDeletions: row.summary_deletions,
      summaryFiles: row.summary_files,
      metadata,
    },
  };
}

// ─── Message + Part Mapping ─────────────────────────────────────

function mapMessagesAndParts(
  messageRows: OpenCodeMessageRow[],
  partRows: OpenCodePartRow[],
  sessionId: string
): Message[] {
  // Group parts by message_id
  const partsByMessage = new Map<string, OpenCodePartRow[]>();
  for (const part of partRows) {
    if (!partsByMessage.has(part.message_id)) {
      partsByMessage.set(part.message_id, []);
    }
    partsByMessage.get(part.message_id)!.push(part);
  }

  const messages: Message[] = [];

  for (const msgRow of messageRows) {
    let msgData: { role?: string };
    try {
      msgData = JSON.parse(msgRow.data);
    } catch {
      continue;
    }

    const role = mapRole(msgData.role);
    const parts = partsByMessage.get(msgRow.id) || [];
    const contentItems = mapPartsToContentItems(parts);

    // Skip messages with no content
    if (contentItems.length === 0) continue;

    messages.push({
      id: msgRow.id,
      sessionId,
      parentId: null, // opencode doesn't have parent message IDs
      role,
      content: contentItems,
      timestamp: epochToISO(msgRow.time_created),
      phase: null,
      extras: {},
    });
  }

  return messages;
}

function mapRole(role: string | undefined): Message['role'] {
  switch (role) {
    case 'user': return 'user';
    case 'assistant': return 'assistant';
    case 'system': return 'system';
    case 'tool': return 'tool';
    default: return 'assistant';
  }
}

function mapPartsToContentItems(parts: OpenCodePartRow[]): ContentItem[] {
  const items: ContentItem[] = [];

  for (const partRow of parts) {
    let partData: {
      type: string;
      text?: string;
      tool?: string;
      state?: {
        status?: string;
        input?: unknown;
        output?: string;
        title?: string;
        exit?: number;
      };
      reasoning?: string;
    };
    try {
      partData = JSON.parse(partRow.data);
    } catch {
      continue;
    }

    switch (partData.type) {
      case 'text':
        if (typeof partData.text === 'string') {
          items.push({ type: 'text', text: partData.text });
        }
        break;

      case 'reasoning':
        if (typeof partData.text === 'string') {
          items.push({
            type: 'reasoning',
            text: partData.text,
            summary: partData.reasoning,
          });
        }
        break;

      case 'tool':
        if (partData.tool) {
          // Tool use
          const input = partData.state?.input;
          items.push({
            type: 'tool_use',
            id: partRow.id,
            name: partData.tool,
            input: typeof input === 'string' ? safeParseJSON(input) : input,
          });

          // If tool has output, add tool_result
          if (partData.state?.output) {
            items.push({
              type: 'tool_result',
              toolUseId: partRow.id,
              output: partData.state.output,
              isError: partData.state.status === 'error',
            });
          }
        }
        break;

      case 'step-start':
      case 'step-finish':
        // Skip — these are metadata markers, not content
        break;

      default:
        // Unknown part type — capture as 'other'
        items.push({ type: 'other', data: partData as Record<string, unknown> });
    }
  }

  return items;
}

function safeParseJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

// ─── Machine ID ─────────────────────────────────────────────────

let cachedMachineId: string | null = null;

function getMachineId(): string {
  if (cachedMachineId) return cachedMachineId;

  // Try to read from copilot-trace-data machines.json
  try {
    const machinesPath = path.join(os.homedir(), 'copilot-trace-data', 'machines.json');
    const machines = JSON.parse(readFileSync(machinesPath, 'utf-8'));
    // Find the machine matching this hostname
    const hostname = os.hostname();
    for (const [id, info] of Object.entries(machines) as [string, { hostname?: string }][]) {
      if (info.hostname === hostname || info.hostname === '') {
        cachedMachineId = id;
        return id;
      }
    }
  } catch { /* ignore */ }

  // Fallback: derive from IOPlatformUUID (macOS) or hostname
  cachedMachineId = createHash('sha256').update(os.hostname()).digest('hex').substring(0, 36);
  return cachedMachineId;
}

// ─── Adapter ────────────────────────────────────────────────────

export interface OpenCodeCaptureResult {
  session: Session;
  messages: Message[];
  hadRedactions: boolean;
  redactedTypes: string[];
}

/**
 * Capture a single opencode session from the SQLite database as CSF.
 */
export function captureSession(sessionId: string, dbPath?: string): CSFSessionData | null {
  const db = new Database(dbPath || getOpencodeDbPath(), { readonly: true });

  try {
    const sessionRow = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId) as OpenCodeSessionRow | undefined;
    if (!sessionRow) return null;

    const messageRows = db.prepare(
      'SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC'
    ).all(sessionId) as OpenCodeMessageRow[];

    const partRows = db.prepare(
      'SELECT id, message_id, session_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created ASC'
    ).all(sessionId) as OpenCodePartRow[];

    const session = mapSession(sessionRow, dbPath || getOpencodeDbPath());
    const messages = mapMessagesAndParts(messageRows, partRows, sessionId);

    // Run redaction
    const { session: redactedSession, messages: redactedMessages, hadRedactions, redactedTypes } =
      redactSessionMessages(session, messages);

    return {
      session: redactedSession,
      messages: redactedMessages,
      checkpoints: [],
      memories: [],
    };
  } finally {
    db.close();
  }
}

/**
 * List all opencode sessions from the SQLite database.
 * Returns lightweight refs (no message content).
 */
export function listSessions(dbPath?: string): Array<{
  id: string;
  title: string | null;
  directory: string;
  timeCreated: number;
  timeUpdated: number;
  messageCount: number;
}> {
  const db = new Database(dbPath || getOpencodeDbPath(), { readonly: true });

  try {
    const rows = db.prepare(`
      SELECT s.id, s.title, s.directory, s.time_created, s.time_updated,
             (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) as message_count
      FROM session s
      WHERE s.time_archived IS NULL
      ORDER BY s.time_created DESC
    `).all() as Array<{
      id: string;
      title: string | null;
      directory: string;
      time_created: number;
      time_updated: number;
      message_count: number;
    }>;

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      directory: r.directory,
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
      messageCount: r.message_count,
    }));
  } finally {
    db.close();
  }
}

/**
 * Capture all opencode sessions and write them as CSF .jsonl files.
 */
export function captureAll(
  outputDir: string,
  options?: { dbPath?: string; machineId?: string; limit?: number }
): { captured: number; redacted: number; errors: string[] } {
  const dbPath = options?.dbPath || getOpencodeDbPath();
  const sessions = listSessions(dbPath);
  const limit = options?.limit || sessions.length;
  const errors: string[] = [];
  let captured = 0;
  let redacted = 0;

  for (const sessionRef of sessions.slice(0, limit)) {
    try {
      const data = captureSession(sessionRef.id, dbPath);
      if (!data) {
        errors.push(`Session ${sessionRef.id}: not found`);
        continue;
      }

      // Write to output dir: <machineId>/opencode/opencode-<id>.csf.jsonl
      const machineId = options?.machineId || getMachineId();
      const sourceDir = path.join(outputDir, machineId, 'opencode');
      mkdirSync(sourceDir, { recursive: true });

      const fileName = `opencode-${sessionRef.id}.csf.jsonl`;
      const filePath = path.join(sourceDir, fileName);
      writeFileSync(filePath, serializeSession(data), 'utf-8');

      captured++;
      if (data.session.hasRedactions) redacted++;
    } catch (e) {
      errors.push(`Session ${sessionRef.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { captured, redacted, errors };
}
