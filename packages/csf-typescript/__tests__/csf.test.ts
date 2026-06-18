import { describe, it, expect } from 'vitest';
import {
  CSF_VERSION,
  serializeSession,
  deserializeSession,
  validateSession,
  validateMessage,
  validateRecord,
  redactSessionMessages,
  type Session,
  type Message,
  type CSFSessionData,
} from '../src/index.js';

// ─── Test Fixtures ──────────────────────────────────────────────

function createTestSession(): Session {
  return {
    version: CSF_VERSION,
    id: 'test-session-001',
    source: 'opencode',
    machineId: 'AED6D88B-3E32-55D6-809A-C9D89BF4F841',
    directory: '/Users/test/project',
    projectId: 'proj_test',
    git: {
      commitHash: 'abc123',
      branch: 'main',
      repositoryUrl: 'https://github.com/test/project',
    },
    title: 'Test Session',
    summary: 'A test session for CSF validation',
    status: 'completed',
    createdAt: '2026-06-19T10:00:00.000Z',
    updatedAt: '2026-06-19T11:00:00.000Z',
    parentSessionId: null,
    agent: 'orchestrator',
    agentVersion: '1.0.0',
    model: 'gpt-4o',
    provider: 'openai',
    sourceInfo: 'cli',
    cost: 0.05,
    tokensIn: 1000,
    tokensOut: 500,
    tokenUsage: {
      cachedReadTokens: 200,
      cachedWriteTokens: 100,
      reasoningTokens: 50,
    },
    metrics: {
      messageCount: 3,
      toolCallCount: 1,
      filesTouchedCount: 1,
      durationMinutes: 60,
      filesTouched: ['app.py'],
      toolsUsed: ['edit'],
    },
    hasRedactions: false,
    redactionSummary: null,
    provenance: {
      sourcePath: '/home/.local/share/opencode/opencode.db',
      contentHash: 'sha256:abcdef',
      importedAt: '2026-06-19T12:00:00.000Z',
      originalFormat: 'opencode-sqlite',
    },
    extras: {},
  };
}

function createTestMessages(): Message[] {
  return [
    {
      id: 'msg-001',
      sessionId: 'test-session-001',
      parentId: null,
      role: 'user',
      content: [{ type: 'text', text: 'Add a health check endpoint to the Flask app' }],
      timestamp: '2026-06-19T10:00:00.000Z',
      phase: null,
      extras: {},
    },
    {
      id: 'msg-002',
      sessionId: 'test-session-001',
      parentId: 'msg-001',
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will add a /api/health endpoint.' },
        { type: 'tool_use', id: 'tool-001', name: 'edit', input: { path: 'app.py' } },
      ],
      timestamp: '2026-06-19T10:00:05.000Z',
      phase: 'final',
      extras: {},
    },
    {
      id: 'msg-003',
      sessionId: 'test-session-001',
      parentId: 'msg-002',
      role: 'tool',
      content: [
        { type: 'tool_result', toolUseId: 'tool-001', output: 'File app.py updated successfully' },
      ],
      timestamp: '2026-06-19T10:00:10.000Z',
      phase: null,
      extras: {},
    },
  ];
}

// ─── Tests ──────────────────────────────────────────────────────

describe('CSF Types', () => {
  it('CSF_VERSION is 1', () => {
    expect(CSF_VERSION).toBe(1);
  });
});

describe('CSF Validation', () => {
  it('validates a correct session', () => {
    const session = createTestSession();
    const result = validateSession(session);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects session with missing id', () => {
    const session = createTestSession();
    (session as unknown as Record<string, unknown>).id = '';
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('session.id must be a non-empty string');
  });

  it('rejects session with invalid source', () => {
    const session = createTestSession();
    (session as unknown as { source: string }).source = 'invalid-source';
    const result = validateSession(session);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('session.source must be one of');
  });

  it('validates a correct message', () => {
    const message = createTestMessages()[0];
    const result = validateMessage(message);
    expect(result.valid).toBe(true);
  });

  it('rejects message with invalid role', () => {
    const message = createTestMessages()[0];
    (message as unknown as { role: string }).role = 'invalid';
    const result = validateMessage(message);
    expect(result.valid).toBe(false);
  });
});

describe('CSF Serialization', () => {
  it('round-trips a session through serialize → deserialize', () => {
    const data: CSFSessionData = {
      session: createTestSession(),
      messages: createTestMessages(),
      checkpoints: [],
      memories: [],
    };

    const jsonl = serializeSession(data);
    expect(jsonl).toContain('"type":"session"');
    expect(jsonl).toContain('"type":"message"');

    const restored = deserializeSession(jsonl);
    expect(restored.session.id).toBe(data.session.id);
    expect(restored.session.source).toBe(data.session.source);
    expect(restored.messages).toHaveLength(3);
    expect(restored.messages[0].content[0]).toEqual({ type: 'text', text: 'Add a health check endpoint to the Flask app' });
  });

  it('throws on empty JSONL', () => {
    expect(() => deserializeSession('')).toThrow('Empty CSF JSONL');
  });

  it('throws when first record is not a session', () => {
    const badJsonl = JSON.stringify({ version: 1, type: 'message', data: { id: 'x' } });
    expect(() => deserializeSession(badJsonl)).toThrow('First CSF record must be type "session"');
  });
});

describe('CSF Redaction', () => {
  it('redacts API keys from message content', () => {
    const session = createTestSession();
    const messages: Message[] = [
      {
        id: 'msg-secret',
        sessionId: session.id,
        parentId: null,
        role: 'user',
        content: [{ type: 'text', text: 'My GitHub token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234' }],
        timestamp: '2026-06-19T10:00:00.000Z',
        extras: {},
      },
    ];

    const result = redactSessionMessages(session, messages);
    expect(result.hadRedactions).toBe(true);
    expect(result.session.hasRedactions).toBe(true);
    expect(result.session.redactionSummary).toContain('github-v2');

    // The secret should be gone from the redacted message
    const redactedText = result.messages[0].content[0];
    expect(redactedText.type).toBe('text');
    if (redactedText.type === 'text') {
      expect(redactedText.text).toContain('[REDACTED:github-v2]');
      expect(redactedText.text).not.toContain('ghp_');
    }
  });

  it('does not redact clean text', () => {
    const session = createTestSession();
    const messages = createTestMessages();

    const result = redactSessionMessages(session, messages);
    expect(result.hadRedactions).toBe(false);
    expect(result.session.hasRedactions).toBe(false);
    expect(result.session.redactionSummary).toBeNull();
  });

  it('redacts secrets from tool_result output', () => {
    const session = createTestSession();
    const messages: Message[] = [
      {
        id: 'msg-tool',
        sessionId: session.id,
        parentId: null,
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tool-001',
            output: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
          },
        ],
        timestamp: '2026-06-19T10:00:00.000Z',
        extras: {},
      },
    ];

    const result = redactSessionMessages(session, messages);
    expect(result.hadRedactions).toBe(true);
    const toolResult = result.messages[0].content[0];
    if (toolResult.type === 'tool_result') {
      expect(toolResult.output).toContain('[REDACTED:');
      expect(toolResult.output).not.toContain('sk-proj-');
    }
  });
});

describe('CSF Record Validation', () => {
  it('validates a session record', () => {
    const record = { version: 1, type: 'session' as const, data: createTestSession() };
    const result = validateRecord(record);
    expect(result.valid).toBe(true);
  });

  it('rejects record with future version', () => {
    const record = { version: 99, type: 'session' as const, data: createTestSession() };
    const result = validateRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('newer than supported');
  });
});
