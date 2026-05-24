/**
 * Tests for injectChannelEnum — narrows a tool's dynamic `channel` field to the
 * set of channels actually installed on this instance, so the model is offered
 * the real channels (e.g. web, slack) instead of a stale hardcoded list.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod/v3';
import {
  sendProactiveMessageDef,
  lookupContactsDef,
  readMemoryDef,
} from '@animus-labs/shared';
import { injectChannelEnum } from '../../src/heartbeat/cortex-mind.js';

const VALID_UUID = '00000000-0000-0000-0000-000000000000';

describe('injectChannelEnum', () => {
  it('accepts an installed channel and rejects a non-installed one (required field)', () => {
    const schema = injectChannelEnum(sendProactiveMessageDef.inputSchema, ['web', 'slack']);

    expect(
      schema.safeParse({ contactId: VALID_UUID, channel: 'slack', content: 'hi' }).success,
    ).toBe(true);
    // 'sms' is not installed on this instance — must be rejected now.
    expect(
      schema.safeParse({ contactId: VALID_UUID, channel: 'sms', content: 'hi' }).success,
    ).toBe(false);
  });

  it('preserves optionality (lookup_contacts.channel is optional)', () => {
    const schema = injectChannelEnum(lookupContactsDef.inputSchema, ['web', 'slack']);

    // Omitted is fine.
    expect(schema.safeParse({}).success).toBe(true);
    // Installed channel is fine.
    expect(schema.safeParse({ channel: 'web' }).success).toBe(true);
    // Non-installed channel is rejected.
    expect(schema.safeParse({ channel: 'discord' }).success).toBe(false);
  });

  it('reflects exactly the channels passed in', () => {
    const schema = injectChannelEnum(sendProactiveMessageDef.inputSchema, ['web']);

    expect(
      schema.safeParse({ contactId: VALID_UUID, channel: 'web', content: 'hi' }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ contactId: VALID_UUID, channel: 'slack', content: 'hi' }).success,
    ).toBe(false);
  });

  it('preserves the field description', () => {
    const schema = injectChannelEnum(
      sendProactiveMessageDef.inputSchema,
      ['web', 'slack'],
    ) as z.ZodObject<z.ZodRawShape>;

    expect(schema.shape['channel']?.description).toBe('Channel to send through');
  });

  it('falls back to the original schema when no channels are installed', () => {
    const schema = injectChannelEnum(sendProactiveMessageDef.inputSchema, []);

    // Original schema is a plain string, so any non-empty channel passes.
    expect(
      schema.safeParse({ contactId: VALID_UUID, channel: 'anything', content: 'hi' }).success,
    ).toBe(true);
  });

  it('returns the schema unchanged when there is no channel field', () => {
    const result = injectChannelEnum(readMemoryDef.inputSchema, ['web', 'slack']);
    expect(result).toBe(readMemoryDef.inputSchema);
  });
});
