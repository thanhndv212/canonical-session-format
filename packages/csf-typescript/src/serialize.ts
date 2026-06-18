/**
 * CSF Serialization — JSONL read/write
 */

import type { CSFRecord, CSFSessionData, Session, Message, Checkpoint, Memory } from './types.js';
import { CSF_VERSION } from './types.js';

// ─── Serialize ──────────────────────────────────────────────────

/**
 * Serialize a full session (with messages, checkpoints, memories) to CSF JSONL.
 * First line is the session record, followed by messages, checkpoints, memories.
 */
export function serializeSession(data: CSFSessionData): string {
  const lines: string[] = [];

  // Session record first
  lines.push(serializeRecord({ version: CSF_VERSION, type: 'session', data: data.session }));

  // Messages in order
  for (const msg of data.messages) {
    lines.push(serializeRecord({ version: CSF_VERSION, type: 'message', data: msg }));
  }

  // Checkpoints
  for (const cp of data.checkpoints) {
    lines.push(serializeRecord({ version: CSF_VERSION, type: 'checkpoint', data: cp }));
  }

  // Memories
  for (const mem of data.memories) {
    lines.push(serializeRecord({ version: CSF_VERSION, type: 'memory', data: mem }));
  }

  return lines.join('\n') + '\n';
}

/**
 * Serialize a single CSF record to a JSONL line.
 */
export function serializeRecord(record: CSFRecord): string {
  return JSON.stringify(record);
}

// ─── Deserialize ────────────────────────────────────────────────

/**
 * Deserialize CSF JSONL text into a full session data structure.
 * Throws if the first line is not a session record.
 */
export function deserializeSession(jsonl: string): CSFSessionData {
  const trimmed = jsonl.trim();
  if (!trimmed) {
    throw new Error('Empty CSF JSONL — no records');
  }
  const lines = trimmed.split('\n');

  const records = lines.map((line, i) => {
    try {
      return deserializeRecord(line);
    } catch (e) {
      throw new Error(`Failed to parse CSF line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const first = records[0];
  if (first.type !== 'session') {
    throw new Error(`First CSF record must be type "session", got "${first.type}"`);
  }

  const messages: Message[] = [];
  const checkpoints: Checkpoint[] = [];
  const memories: Memory[] = [];

  for (const record of records.slice(1)) {
    switch (record.type) {
      case 'message':
        messages.push(record.data);
        break;
      case 'checkpoint':
        checkpoints.push(record.data);
        break;
      case 'memory':
        memories.push(record.data);
        break;
      default:
        // Unknown record type — skip with warning (forward compatibility)
        break;
    }
  }

  return {
    session: first.data,
    messages,
    checkpoints,
    memories,
  };
}

/**
 * Deserialize a single CSF JSONL line into a CSFRecord.
 */
export function deserializeRecord(line: string): CSFRecord {
  const parsed = JSON.parse(line);
  if (!parsed.type || !parsed.data || typeof parsed.version !== 'number') {
    throw new Error('Invalid CSF record — missing type, data, or version field');
  }
  return parsed as CSFRecord;
}

// ─── Stream Deserialize ─────────────────────────────────────────

/**
 * Lazily yield CSF records from JSONL text (for streaming large files).
 */
export function* streamRecords(jsonl: string): Generator<CSFRecord> {
  const lines = jsonl.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      yield deserializeRecord(line);
    }
  }
}
