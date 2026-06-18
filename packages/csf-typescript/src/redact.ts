/**
 * CSF Redaction — strips secrets from session content before storage
 *
 * Uses @sanity-labs/secret-scan (1,100+ patterns, built-in redact())
 */

import { scan, redact } from '@sanity-labs/secret-scan';
import type { ContentItem, Message, Session } from './types.js';

export interface RedactionResult {
  /** The redacted content items */
  content: ContentItem[];
  /** True if any secrets were found and redacted */
  hadRedactions: boolean;
  /** List of secret rule names that were redacted (never the secret values) */
  redactedTypes: string[];
}

/**
 * Redact secrets from a single ContentItem.
 * Returns the redacted item and whether redaction occurred.
 */
export function redactContentItem(item: ContentItem): { item: ContentItem; redacted: boolean; types: string[] } {
  // Only redact text-bearing items — check by type discriminator
  if (item.type === 'text' || item.type === 'input_text') {
    const secrets = scan(item.text);
    if (secrets.length > 0) {
      const redactedText = redact(item.text, (secret: { rule: string }) => `[REDACTED:${secret.rule}]`);
      return {
        item: { ...item, text: redactedText } as ContentItem,
        redacted: true,
        types: secrets.map(s => s.rule),
      };
    }
  }

  if (item.type === 'reasoning') {
    const secrets = scan(item.text);
    if (secrets.length > 0) {
      const redactedText = redact(item.text, (secret: { rule: string }) => `[REDACTED:${secret.rule}]`);
      return {
        item: { ...item, text: redactedText } as ContentItem,
        redacted: true,
        types: secrets.map(s => s.rule),
      };
    }
  }

  // Also scan tool_result output
  if (item.type === 'tool_result' && typeof item.output === 'string') {
    const secrets = scan(item.output);
    if (secrets.length > 0) {
      const redactedOutput = redact(item.output, (secret: { rule: string }) => `[REDACTED:${secret.rule}]`);
      return {
        item: { ...item, output: redactedOutput } as ContentItem,
        redacted: true,
        types: secrets.map(s => s.rule),
      };
    }
  }

  return { item, redacted: false, types: [] };
}

/**
 * Redact secrets from a message's content items.
 * Returns the redacted message and a summary of what was redacted.
 */
export function redactMessage(message: Message): { message: Message; redacted: boolean; types: string[] } {
  const allTypes: string[] = [];
  let anyRedacted = false;

  const redactedContent = message.content.map(item => {
    const result = redactContentItem(item);
    if (result.redacted) {
      anyRedacted = true;
      allTypes.push(...result.types);
    }
    return result.item;
  });

  return {
    message: { ...message, content: redactedContent },
    redacted: anyRedacted,
    types: allTypes,
  };
}

/**
 * Redact secrets from a full session's messages.
 * Updates the session's hasRedactions and redactionSummary fields.
 */
export function redactSessionMessages(
  session: Session,
  messages: Message[]
): { session: Session; messages: Message[]; hadRedactions: boolean; redactedTypes: string[] } {
  const allTypes: string[] = [];
  let anyRedacted = false;

  const redactedMessages = messages.map(msg => {
    const result = redactMessage(msg);
    if (result.redacted) {
      anyRedacted = true;
      allTypes.push(...result.types);
    }
    return result.message;
  });

  // Deduplicate types
  const uniqueTypes = [...new Set(allTypes)];

  const updatedSession: Session = {
    ...session,
    hasRedactions: anyRedacted,
    redactionSummary: anyRedacted ? uniqueTypes : null,
  };

  return {
    session: updatedSession,
    messages: redactedMessages,
    hadRedactions: anyRedacted,
    redactedTypes: uniqueTypes,
  };
}
