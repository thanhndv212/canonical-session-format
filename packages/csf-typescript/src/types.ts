/**
 * Canonical Session Format (CSF) — Type Definitions
 *
 * Lean JSONL format for storing AI coding sessions.
 * 4 structured types + extras bag. Versioned from day 1.
 *
 * See: session-knowledge-ecosystem-plan.md §4
 */

// ─── Schema Version ─────────────────────────────────────────────

export const CSF_VERSION = 1 as const;

// ─── Source Types ───────────────────────────────────────────────

export type HarnessSource =
  | 'opencode'
  | 'zcode'
  | 'codex'
  | 'claude-code'
  | 'copilot-chat'
  | 'copilot-agent'
  | 'copilot-cli'
  | 'cursor';

// ─── Session ────────────────────────────────────────────────────

export interface Session {
  // Schema
  version: number;

  // Identity
  id: string;
  source: HarnessSource;
  machineId: string;

  // Project context
  directory: string;
  projectId: string;
  git: {
    commitHash: string | null;
    branch: string | null;
    repositoryUrl: string | null;
  };

  // Metadata
  title: string | null;
  summary: string | null;
  status: SessionStatus; // borrowed from AgentLog — lifecycle state
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  parentSessionId: string | null;

  // Agent/model info
  agent: string | null;
  agentVersion: string | null; // borrowed from AgentLog
  model: string | null;
  provider: string | null;
  sourceInfo: string | null; // 'cli' | 'vscode' | 'desktop' | 'tui'

  // Cost tracking
  cost: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokenUsage: {
    cachedReadTokens: number | null;   // borrowed from AgentLog
    cachedWriteTokens: number | null;
    reasoningTokens: number | null;
  } | null;

  // Aggregate metrics (borrowed from AgentLog — useful for context briefs)
  metrics: {
    messageCount: number | null;
    toolCallCount: number | null;
    filesTouchedCount: number | null;
    durationMinutes: number | null;
    filesTouched: string[] | null;
    toolsUsed: string[] | null;
  } | null;

  // Redaction
  hasRedactions: boolean;
  redactionSummary: string[] | null;

  // Provenance
  provenance: {
    sourcePath: string;
    contentHash: string;
    importedAt: string | null;
    originalFormat: string;
  };

  // Source-specific extras
  extras: Record<string, unknown>;
}

export type SessionStatus = 'active' | 'completed' | 'failed' | 'cancelled';

// ─── Message ────────────────────────────────────────────────────

export interface Message {
  id: string;
  sessionId: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';

  content: ContentItem[];

  timestamp: string; // ISO 8601

  // borrowed from agent-session-protocol — distinguishes streamed commentary from final output
  phase: 'commentary' | 'final' | null;

  extras: Record<string, unknown>;
}

export type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'input_text'; text: string }
  | { type: 'reasoning'; text: string; summary?: string; reasoningType?: ReasoningType } // reasoningType borrowed from AgentLog
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; output: string; isError?: boolean }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'attachment'; data: unknown }
  // borrowed from AgentLog — common in coding sessions
  | { type: 'search'; tool: string; query: string; resultCount?: number; topResults?: string[] }
  | { type: 'terminal'; command: string; cwd?: string; stdout?: string; stderr?: string; exitCode?: number; durationMs?: number }
  | { type: 'other'; data: Record<string, unknown> };

export type ReasoningType = 'planning' | 'analysis' | 'reflection' | 'decision' | 'evaluation' | 'debugging';

// ─── Memory ─────────────────────────────────────────────────────

export interface Memory {
  id: string;
  sessionId?: string;
  content: string;
  category: MemoryCategory;
  source: MemorySource;
  confidence?: number;
  createdAt: string;
}

export type MemoryCategory =
  | 'fact'
  | 'contact'
  | 'task'
  | 'preference'
  | 'identity'
  | 'project'
  | 'goal'
  | 'learning'
  | 'summary'
  | 'instruction';

export type MemorySource =
  | 'user'
  | 'distillation'
  | 'codex'
  | 'copilot'
  | 'manual';

// ─── Checkpoint ─────────────────────────────────────────────────

export interface Checkpoint {
  sessionId: string;
  checkpointNumber: number;
  title: string;
  overview: string;
  workDone: string;
  technicalDetails: string;
  importantFiles: string[];
  nextSteps: string;
  createdAt: string;
  // borrowed from AgentLog
  checkpointType: CheckpointType;
  restorable: boolean;
  extras: Record<string, unknown>;
}

export type CheckpointType = 'manual' | 'auto_save' | 'git_commit' | 'session_end';

// ─── CSF Record (JSONL line types) ──────────────────────────────

export type CSFRecord =
  | { version: number; type: 'session'; data: Session }
  | { version: number; type: 'message'; data: Message }
  | { version: number; type: 'checkpoint'; data: Checkpoint }
  | { version: number; type: 'memory'; data: Memory };

// ─── Session Data (full session with all records) ───────────────

export interface CSFSessionData {
  session: Session;
  messages: Message[];
  checkpoints: Checkpoint[];
  memories: Memory[];
}
