/**
 * CSF Adapter Template
 *
 * Template for building source adapters that emit CSF (Canonical Session Format).
 * Evolves the existing session-look-up SourceAdapter pattern to produce CSF.
 *
 * Each adapter:
 * 1. Implements CSFSourceAdapter (sync, like existing SourceAdapter)
 * 2. Reads from a harness tool's native storage
 * 3. Maps native format → CSF types
 * 4. Runs redaction on all message content before returning
 *
 * See: session-knowledge-ecosystem-plan.md §5
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  Session,
  Message,
  ContentItem,
  CSFSessionData,
  HarnessSource,
} from './types.js';
import {
  CSF_VERSION,
} from './types.js';
import {
  redactSessionMessages,
} from './redact.js';

// ─── CSF Adapter Interface ──────────────────────────────────────

/**
 * Session reference — lightweight metadata for listing available sessions.
 * Evolved from session-look-up's SessionRef to include machineId.
 */
export interface CSFSessionRef {
  source: HarnessSource;
  nativeId: string;
  nativePath: string;
  machineId: string;
  lastModifiedMs: number;
}

/**
 * CSF Source Adapter — reads from a harness tool and produces CSF.
 *
 * This is the sync interface (matching session-look-up's existing pattern).
 * Each adapter reads from one source and maps to CSF types.
 */
export interface CSFSourceAdapter {
  readonly source: HarnessSource;
  listSessions(): CSFSessionRef[];
  readSession(ref: CSFSessionRef): CSFSessionData | null;
}

// ─── Helpers for Adapters ───────────────────────────────────────

/**
 * Compute SHA-256 content hash of a file (for provenance/dedup).
 */
export function computeContentHash(filePath: string): string {
  const content = readFileSync(filePath);
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

/**
 * Convert epoch milliseconds to ISO 8601 string.
 */
export function epochToISO(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Derive project ID from a directory path.
 * Uses a simple hash of the directory path.
 */
export function deriveProjectId(directory: string): string {
  return 'proj_' + createHash('sha256').update(directory).digest('hex').substring(0, 12);
}

/**
 * Create a base Session with common fields filled in.
 * Adapters call this and override source-specific fields.
 */
export function createBaseSession(params: {
  id: string;
  source: HarnessSource;
  machineId: string;
  directory: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  sourcePath: string;
  contentHash: string;
  originalFormat: string;
}): Session {
  return {
    version: CSF_VERSION,
    id: params.id,
    source: params.source,
    machineId: params.machineId,
    directory: params.directory,
    projectId: deriveProjectId(params.directory),
    git: {
      commitHash: null,
      branch: null,
      repositoryUrl: null,
    },
    title: params.title,
    summary: null,
    status: 'completed',
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    parentSessionId: null,
    agent: null,
    agentVersion: null,
    model: null,
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
      sourcePath: params.sourcePath,
      contentHash: params.contentHash,
      importedAt: new Date().toISOString(),
      originalFormat: params.originalFormat,
    },
    extras: {},
  };
}

/**
 * Create a base Message with common fields filled in.
 * Adapters call this and add content items.
 */
export function createBaseMessage(params: {
  id: string;
  sessionId: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentItem[];
  timestamp: string;
}): Message {
  return {
    id: params.id,
    sessionId: params.sessionId,
    parentId: params.parentId,
    role: params.role,
    content: params.content,
    timestamp: params.timestamp,
    phase: null,
    extras: {},
  };
}

/**
 * Run redaction on a session and its messages.
 * Returns the updated session (with hasRedactions flag) and redacted messages.
 */
export function applyRedaction(
  session: Session,
  messages: Message[]
): { session: Session; messages: Message[] } {
  const result = redactSessionMessages(session, messages);
  return { session: result.session, messages: result.messages };
}

// ─── Example: Minimal Adapter Skeleton ──────────────────────────

/**
 * Skeleton showing how to implement a CSFSourceAdapter.
 * Copy this file, rename, and implement the source-specific logic.
 *
 * Example for a hypothetical "mytool" source:
 *
 * ```typescript
 * export class MyToolAdapter implements CSFSourceAdapter {
 *   readonly source: HarnessSource = 'opencode'; // or your source
 *
 *   listSessions(): CSFSessionRef[] {
 *     // 1. Find all session files/records in the source's storage
 *     // 2. Return lightweight refs (no need to read full content)
 *     const refs: CSFSessionRef[] = [];
 *     // ... scan source storage ...
 *     return refs;
 *   }
 *
 *   readSession(ref: CSFSessionRef): CSFSessionData | null {
 *     // 1. Read the full session from source storage
 *     // 2. Map native format → CSF Session + Messages
 *     // 3. Run redaction
 *     // 4. Return CSFSessionData
 *
 *     const session = createBaseSession({
 *       id: ref.nativeId,
 *       source: this.source,
 *       machineId: ref.machineId,
 *       directory: '/path/to/project',
 *       title: 'Session title',
 *       createdAt: epochToISO(ref.lastModifiedMs),
 *       updatedAt: epochToISO(ref.lastModifiedMs),
 *       sourcePath: ref.nativePath,
 *       contentHash: computeContentHash(ref.nativePath),
 *       originalFormat: 'mytool-sqlite',
 *     });
 *
 *     const messages: Message[] = [
 *       createBaseMessage({
 *         id: 'msg-001',
 *         sessionId: session.id,
 *         parentId: null,
 *         role: 'user',
 *         content: [{ type: 'text', text: 'Hello' }],
 *         timestamp: new Date().toISOString(),
 *       }),
 *     ];
 *
 *     // Run redaction before returning
 *     const { session: redactedSession, messages: redactedMessages } = applyRedaction(session, messages);
 *
 *     return {
 *       session: redactedSession,
 *       messages: redactedMessages,
 *       checkpoints: [],
 *       memories: [],
 *     };
 *   }
 * }
 * ```
 */
