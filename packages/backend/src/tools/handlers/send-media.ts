/**
 * send_media handler — send media files to the triggering contact.
 *
 * Mind-only tool. Sends media through the channel router for full delivery
 * (adapter.send() -> message storage -> event emission). The media is
 * delivered immediately during the mind query, before the text reply.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import type { ChannelType } from '@animus/shared';
import { sendMediaDef } from '@animus/shared';

type SendMediaInput = z.infer<typeof sendMediaDef.inputSchema>;

/** Map file extension to media type. */
const EXT_TYPE_MAP: Record<string, 'image' | 'audio' | 'video' | 'file'> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
  '.webp': 'image', '.svg': 'image', '.bmp': 'image', '.ico': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.flac': 'audio',
  '.aac': 'audio', '.m4a': 'audio', '.wma': 'audio', '.opus': 'audio',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.avi': 'video',
  '.mkv': 'video', '.m4v': 'video',
  '.pdf': 'file', '.doc': 'file', '.docx': 'file', '.txt': 'file',
  '.csv': 'file', '.json': 'file', '.zip': 'file', '.tar': 'file',
};

function inferMediaType(filePath: string): 'image' | 'audio' | 'video' | 'file' {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TYPE_MAP[ext] ?? 'file';
}

export const sendMediaHandler: ToolHandler<SendMediaInput> = async (
  input,
  context
): Promise<ToolResult> => {
  // Guard: mind-only tool (needs channel router)
  if (!context.stores.channels) {
    return {
      content: [{ type: 'text', text: 'send_media is only available to the mind session.' }],
      isError: true,
    };
  }

  // Guard: must have a triggering contact
  if (!context.contactId) {
    return {
      content: [{
        type: 'text',
        text: 'No active contact to send media to. Use send_proactive_message for interval/scheduled ticks.',
      }],
      isError: true,
    };
  }

  // Validate all files exist before sending
  const missing: string[] = [];
  for (const file of input.files) {
    if (!fs.existsSync(file.path)) {
      missing.push(file.path);
    }
  }
  if (missing.length > 0) {
    return {
      content: [{
        type: 'text',
        text: `File(s) not found: ${missing.join(', ')}. Ensure the file paths are correct and the files exist on disk.`,
      }],
      isError: true,
    };
  }

  // Build media array with type inference
  const media = input.files.map((file: { path: string; type?: 'image' | 'audio' | 'video' | 'file' }) => ({
    type: file.type ?? inferMediaType(file.path),
    path: file.path,
    filename: path.basename(file.path),
  }));

  // Send through channel router
  const result = await context.stores.channels.sendOutbound({
    contactId: context.contactId,
    channel: context.sourceChannel as ChannelType,
    content: input.caption ?? '',
    media,
  });

  if (!result) {
    return {
      content: [{
        type: 'text',
        text: `Failed to send media via ${context.sourceChannel}. The channel adapter may be unavailable.`,
      }],
      isError: true,
    };
  }

  const fileDesc = media.length === 1
    ? `1 ${media[0]!.type} file`
    : `${media.length} files`;

  return {
    content: [{
      type: 'text',
      text: `Sent ${fileDesc} to ${context.sourceChannel} channel (message ID: ${result.id}).`,
    }],
  };
};
