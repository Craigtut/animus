/**
 * SMS Channel Adapter (Twilio)
 *
 * Receives SMS/MMS via Twilio webhooks and sends outbound via Twilio REST API.
 * Runs in an isolated child process -- communicates with engine via AdapterContext.
 *
 * No npm dependencies: uses Node.js built-in fetch and crypto only.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  AdapterContext,
  ChannelAdapter,
  RouteRequest,
  RouteResponse,
} from '@animus/channel-sdk';

/**
 * Validate Twilio request signature (HMAC-SHA1).
 *
 * Twilio computes the signature by:
 * 1. Taking the full webhook URL
 * 2. Sorting the POST params alphabetically by key
 * 3. Concatenating key+value for each param, appending to URL
 * 4. Computing HMAC-SHA1 with the auth token, then base64-encoding
 */
function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = createHmac('sha1', authToken).update(data).digest('base64');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const sigBuf = Buffer.from(signature, 'utf-8');
    const expectedBuf = Buffer.from(expected, 'utf-8');
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Parse URL-encoded form body (Twilio sends application/x-www-form-urlencoded).
 * Handles both string body and pre-parsed object body.
 */
function parseFormBody(body: unknown): Record<string, string> {
  if (typeof body === 'string') {
    const params: Record<string, string> = {};
    const pairs = body.split('&');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) {
        params[decodeURIComponent(pair)] = '';
      } else {
        const key = decodeURIComponent(pair.substring(0, eqIdx));
        const value = decodeURIComponent(pair.substring(eqIdx + 1));
        params[key] = value;
      }
    }
    return params;
  }
  if (body && typeof body === 'object') {
    return body as Record<string, string>;
  }
  return {};
}

/**
 * Determine media type category from a MIME type string.
 */
function classifyMimeType(mimeType: string): 'image' | 'audio' | 'video' | 'file' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

export default function createAdapter(ctx: AdapterContext): ChannelAdapter {
  const accountSid = ctx.config['accountSid'] as string;
  const authToken = ctx.config['authToken'] as string;
  const phoneNumber = ctx.config['phoneNumber'] as string;

  return {
    async start(): Promise<void> {
      // Register the inbound webhook route
      ctx.registerRoute({
        method: 'POST',
        path: '/webhook',
        handler: async (request: RouteRequest): Promise<RouteResponse> => {
          ctx.log.debug('Received Twilio webhook');

          // Parse form body (Twilio sends application/x-www-form-urlencoded)
          const params = parseFormBody(request.body);

          // Validate Twilio signature if present
          const signature = request.headers['x-twilio-signature'];
          if (signature) {
            const webhookUrl = ctx.config['webhookUrl'] as string | undefined;
            if (webhookUrl) {
              const valid = validateTwilioSignature(authToken, signature, webhookUrl, params);
              if (!valid) {
                ctx.log.warn('Invalid Twilio signature — rejecting request');
                return { status: 403, body: 'Invalid signature' };
              }
            }
          }

          // Extract message fields
          const from = params['From']; // E.164 phone number
          const content = params['Body'] || '';
          const numMedia = parseInt(params['NumMedia'] || '0', 10);

          if (!from) {
            ctx.log.warn('Webhook missing From field');
            return {
              status: 400,
              headers: { 'content-type': 'text/xml' },
              body: '<Response/>',
            };
          }

          // Handle MMS media attachments
          const media: Array<{
            type: 'image' | 'audio' | 'video' | 'file';
            mimeType: string;
            url: string;
            filename?: string;
          }> = [];

          for (let i = 0; i < numMedia; i++) {
            const mediaUrl = params[`MediaUrl${i}`];
            const mediaType = params[`MediaContentType${i}`];
            if (mediaUrl && mediaType) {
              const ext = mediaType.split('/')[1] || 'bin';
              media.push({
                type: classifyMimeType(mediaType),
                mimeType: mediaType,
                url: mediaUrl,
                filename: `media_${i}.${ext}`,
              });
            }
          }

          // Download media through the engine (main process handles filesystem writes)
          for (const m of media) {
            try {
              const downloadParams: Parameters<typeof ctx.downloadMedia>[0] = {
                url: m.url,
                mimeType: m.mimeType,
                auth: { type: 'basic', username: accountSid, password: authToken },
              };
              if (m.filename) downloadParams.filename = m.filename;
              const result = await ctx.downloadMedia(downloadParams);
              // Update media entry with local path from engine
              m.url = result.localPath;
            } catch (err) {
              ctx.log.error(`Failed to download media: ${m.url}`, err);
              // Keep original URL as fallback
            }
          }

          // Report the incoming message to the engine
          const incomingParams: Parameters<typeof ctx.reportIncoming>[0] = {
            identifier: from,
            content,
            conversationId: from, // One conversation per phone number
          };
          if (media.length > 0) incomingParams.media = media;
          incomingParams.metadata = {
            messageSid: params['MessageSid'],
            accountSid: params['AccountSid'],
            from,
            to: params['To'],
            numMedia,
          };
          ctx.reportIncoming(incomingParams);

          // Respond with empty TwiML (replies sent separately via API)
          return {
            status: 200,
            headers: { 'content-type': 'text/xml' },
            body: '<Response/>',
          };
        },
      });

      ctx.log.info('SMS adapter started -- webhook route registered');
    },

    async stop(): Promise<void> {
      ctx.log.info('SMS adapter stopped');
    },

    async send(contactId: string, content: string, _metadata?: Record<string, unknown>): Promise<void> {
      // SMS has a practical limit of ~1600 characters
      // Twilio handles segmentation, but warn on very long messages
      if (content.length > 1600) {
        ctx.log.warn(`SMS content exceeds 1600 chars (${content.length}), Twilio will segment`);
      }

      // Resolve the contact's phone number
      const contact = await ctx.resolveContact(contactId);
      if (!contact) {
        ctx.log.error(`Cannot send SMS: contact ${contactId} not found`);
        return;
      }

      // Send via Twilio REST API
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const body = new URLSearchParams({
        To: contact.identifier,
        From: phoneNumber,
        Body: content,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        ctx.log.error(`Twilio API error (${response.status}): ${errorBody}`);
        throw new Error(`Twilio send failed: ${response.status}`);
      }

      ctx.log.info(`SMS sent to ${contact.identifier}`);
    },
  };
}
