/**
 * SMS Channel Adapter (Twilio) — STUB
 *
 * Placeholder for Twilio SMS/MMS integration.
 * Actual Twilio integration deferred — needs credentials + testing.
 *
 * See docs/architecture/channels.md — "SMS Channel (Twilio)"
 */

import type { FastifyInstance } from 'fastify';
import type { IChannelAdapter } from '../types.js';
import type { ChannelType } from '@animus/shared';

export class SmsChannelAdapter implements IChannelAdapter {
  readonly channelType: ChannelType = 'sms';
  private enabled = false;

  async start(): Promise<void> {
    // TODO: Initialize Twilio client with credentials from channel_configs
    // const config = getChannelConfig('sms');
    // if (!config) { console.warn('[SmsAdapter] No SMS config found'); return; }
    // const client = twilio(config.accountSid, config.authToken);
    this.enabled = true;
    console.log('[SmsAdapter] Started (stub mode — no actual Twilio connection)');
  }

  async stop(): Promise<void> {
    this.enabled = false;
    console.log('[SmsAdapter] Stopped');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send an SMS to a contact.
   * STUB: Logs the action but does not actually send.
   */
  async send(
    contactId: string,
    content: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    // TODO: Look up contact's phone number from contact_channels
    // TODO: Send via Twilio REST API:
    //   await client.messages.create({
    //     body: content,
    //     from: animusPhoneNumber,
    //     to: contactPhoneNumber,
    //   });
    console.log(`[SmsAdapter] Would send SMS to contact ${contactId}: "${content.substring(0, 50)}..."`);
  }

  /**
   * Register Twilio webhook routes with Fastify.
   * STUB: Registers the route but returns a placeholder response.
   */
  async registerRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.post('/webhooks/twilio/sms', async (request, reply) => {
      // TODO: Validate Twilio signature using X-Twilio-Signature header
      // TODO: Extract message content from Body parameter
      // TODO: Extract sender from From parameter (E.164)
      // TODO: Check for MMS media (NumMedia > 0)
      // TODO: Resolve identity and hand to channel router

      console.log('[SmsAdapter] Received webhook (stub — not processing)');

      // Respond with empty TwiML
      reply.type('text/xml');
      return '<Response/>';
    });

    console.log('[SmsAdapter] Webhook route registered: POST /webhooks/twilio/sms');
  }
}
