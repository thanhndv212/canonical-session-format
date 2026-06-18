/**
 * CSF Validation — schema validation for CSF records
 */

import type { Session, Message, Memory, Checkpoint, CSFRecord, HarnessSource, MemoryCategory, MemorySource } from './types.js';
import { CSF_VERSION } from './types.js';

const VALID_SOURCES: HarnessSource[] = [
  'opencode', 'zcode', 'codex', 'claude-code',
  'copilot-chat', 'copilot-agent', 'copilot-cli', 'cursor',
];

const VALID_CATEGORIES: MemoryCategory[] = [
  'fact', 'contact', 'task', 'preference', 'identity',
  'project', 'goal', 'learning', 'summary', 'instruction',
];

const VALID_MEMORY_SOURCES: MemorySource[] = [
  'user', 'distillation', 'codex', 'copilot', 'manual',
];

const VALID_ROLES = ['user', 'assistant', 'system', 'tool'] as const;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSession(session: Session): ValidationResult {
  const errors: string[] = [];

  if (typeof session.version !== 'number' || session.version < 1) {
    errors.push('session.version must be a positive number');
  }

  if (!session.id || typeof session.id !== 'string') {
    errors.push('session.id must be a non-empty string');
  }

  if (!VALID_SOURCES.includes(session.source)) {
    errors.push(`session.source must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  if (!session.machineId || typeof session.machineId !== 'string') {
    errors.push('session.machineId must be a non-empty string');
  }

  if (!session.directory || typeof session.directory !== 'string') {
    errors.push('session.directory must be a non-empty string');
  }

  if (!session.projectId || typeof session.projectId !== 'string') {
    errors.push('session.projectId must be a non-empty string');
  }

  if (!session.git || typeof session.git !== 'object') {
    errors.push('session.git must be an object');
  } else {
    if (session.git.commitHash !== null && typeof session.git.commitHash !== 'string') {
      errors.push('session.git.commitHash must be string or null');
    }
    if (session.git.branch !== null && typeof session.git.branch !== 'string') {
      errors.push('session.git.branch must be string or null');
    }
    if (session.git.repositoryUrl !== null && typeof session.git.repositoryUrl !== 'string') {
      errors.push('session.git.repositoryUrl must be string or null');
    }
  }

  if (!session.createdAt || !isValidISO(session.createdAt)) {
    errors.push('session.createdAt must be a valid ISO 8601 string');
  }

  if (!session.updatedAt || !isValidISO(session.updatedAt)) {
    errors.push('session.updatedAt must be a valid ISO 8601 string');
  }

  if (typeof session.hasRedactions !== 'boolean') {
    errors.push('session.hasRedactions must be a boolean');
  }

  if (!session.provenance || typeof session.provenance !== 'object') {
    errors.push('session.provenance must be an object');
  } else {
    if (!session.provenance.sourcePath || typeof session.provenance.sourcePath !== 'string') {
      errors.push('session.provenance.sourcePath must be a non-empty string');
    }
    if (!session.provenance.contentHash || typeof session.provenance.contentHash !== 'string') {
      errors.push('session.provenance.contentHash must be a non-empty string');
    }
    if (!session.provenance.originalFormat || typeof session.provenance.originalFormat !== 'string') {
      errors.push('session.provenance.originalFormat must be a non-empty string');
    }
  }

  if (!session.extras || typeof session.extras !== 'object') {
    errors.push('session.extras must be an object');
  }

  return { valid: errors.length === 0, errors };
}

export function validateMessage(message: Message): ValidationResult {
  const errors: string[] = [];

  if (!message.id || typeof message.id !== 'string') {
    errors.push('message.id must be a non-empty string');
  }

  if (!message.sessionId || typeof message.sessionId !== 'string') {
    errors.push('message.sessionId must be a non-empty string');
  }

  if (!VALID_ROLES.includes(message.role)) {
    errors.push(`message.role must be one of: ${VALID_ROLES.join(', ')}`);
  }

  if (!Array.isArray(message.content)) {
    errors.push('message.content must be an array of ContentItem');
  } else {
    for (let i = 0; i < message.content.length; i++) {
      const item = message.content[i];
      if (!item || !item.type || typeof item.type !== 'string') {
        errors.push(`message.content[${i}] must have a type field`);
      }
    }
  }

  if (!message.timestamp || !isValidISO(message.timestamp)) {
    errors.push('message.timestamp must be a valid ISO 8601 string');
  }

  if (!message.extras || typeof message.extras !== 'object') {
    errors.push('message.extras must be an object');
  }

  return { valid: errors.length === 0, errors };
}

export function validateMemory(memory: Memory): ValidationResult {
  const errors: string[] = [];

  if (!memory.id || typeof memory.id !== 'string') {
    errors.push('memory.id must be a non-empty string');
  }

  if (!memory.content || typeof memory.content !== 'string') {
    errors.push('memory.content must be a non-empty string');
  }

  if (!VALID_CATEGORIES.includes(memory.category)) {
    errors.push(`memory.category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  if (!VALID_MEMORY_SOURCES.includes(memory.source)) {
    errors.push(`memory.source must be one of: ${VALID_MEMORY_SOURCES.join(', ')}`);
  }

  if (memory.confidence !== undefined && (typeof memory.confidence !== 'number' || memory.confidence < 0 || memory.confidence > 1)) {
    errors.push('memory.confidence must be a number between 0 and 1');
  }

  if (!memory.createdAt || !isValidISO(memory.createdAt)) {
    errors.push('memory.createdAt must be a valid ISO 8601 string');
  }

  return { valid: errors.length === 0, errors };
}

export function validateCheckpoint(checkpoint: Checkpoint): ValidationResult {
  const errors: string[] = [];

  if (!checkpoint.sessionId || typeof checkpoint.sessionId !== 'string') {
    errors.push('checkpoint.sessionId must be a non-empty string');
  }

  if (typeof checkpoint.checkpointNumber !== 'number' || checkpoint.checkpointNumber < 1) {
    errors.push('checkpoint.checkpointNumber must be a positive number');
  }

  if (!checkpoint.title || typeof checkpoint.title !== 'string') {
    errors.push('checkpoint.title must be a non-empty string');
  }

  if (!checkpoint.createdAt || !isValidISO(checkpoint.createdAt)) {
    errors.push('checkpoint.createdAt must be a valid ISO 8601 string');
  }

  return { valid: errors.length === 0, errors };
}

export function validateRecord(record: CSFRecord): ValidationResult {
  const errors: string[] = [];

  if (typeof record.version !== 'number' || record.version < 1) {
    errors.push('record.version must be a positive number');
    return { valid: false, errors };
  }

  if (record.version > CSF_VERSION) {
    errors.push(`record.version ${record.version} is newer than supported version ${CSF_VERSION}`);
    return { valid: false, errors };
  }

  if (!record.type || !record.data) {
    errors.push('record must have type and data fields');
    return { valid: false, errors };
  }

  switch (record.type) {
    case 'session':
      return validateSession(record.data);
    case 'message':
      return validateMessage(record.data);
    case 'memory':
      return validateMemory(record.data);
    case 'checkpoint':
      return validateCheckpoint(record.data);
    default:
      errors.push(`unknown record type: ${(record as { type: string }).type}`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Helpers ────────────────────────────────────────────────────

function isValidISO(s: string): boolean {
  try {
    const d = new Date(s);
    return !isNaN(d.getTime());
  } catch {
    return false;
  }
}
