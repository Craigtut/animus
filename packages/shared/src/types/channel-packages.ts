/**
 * Channel Packages — TypeScript types derived from Zod schemas via z.infer<>.
 *
 * DO NOT define types manually here — derive them from schemas.
 */

import { z } from 'zod';
import type {
  channelManifestAuthorSchema,
  channelIdentitySchema,
  channelCapabilitySchema,
  channelPermissionsSchema,
  channelStoreMetadataSchema,
  channelManifestSchema,
  configFieldTypeSchema,
  configFieldOptionSchema,
  configFieldSchema,
  configFieldHelpLinkSchema,
  configSchemaSchema,
  setupGuideSchema,
  setupGuideStepSchema,
  setupGuideLinkSchema,
  channelPackageStatusSchema,
  channelPackageSchema,
  channelInfoSchema,
  ipcMessageTypeSchema,
  ipcMessageBaseSchema,
  channelStatusEventSchema,
} from '../schemas/channel-packages.js';

// ============================================================================
// Channel Manifest
// ============================================================================

export type ChannelManifestAuthor = z.infer<typeof channelManifestAuthorSchema>;
export type ChannelIdentity = z.infer<typeof channelIdentitySchema>;
export type ChannelCapability = z.infer<typeof channelCapabilitySchema>;
export type ChannelPermissions = z.infer<typeof channelPermissionsSchema>;
export type ChannelStoreMetadata = z.infer<typeof channelStoreMetadataSchema>;
export type ChannelManifest = z.infer<typeof channelManifestSchema>;

// ============================================================================
// Config Schema
// ============================================================================

export type ConfigFieldType = z.infer<typeof configFieldTypeSchema>;
export type ConfigFieldOption = z.infer<typeof configFieldOptionSchema>;
export type ConfigFieldHelpLink = z.infer<typeof configFieldHelpLinkSchema>;
export type ConfigField = z.infer<typeof configFieldSchema>;
export type ConfigSchema = z.infer<typeof configSchemaSchema>;
export type SetupGuide = z.infer<typeof setupGuideSchema>;
export type SetupGuideStep = z.infer<typeof setupGuideStepSchema>;
export type SetupGuideLink = z.infer<typeof setupGuideLinkSchema>;

// ============================================================================
// Channel Package
// ============================================================================

export type ChannelPackageStatus = z.infer<typeof channelPackageStatusSchema>;
export type ChannelPackage = z.infer<typeof channelPackageSchema>;

// ============================================================================
// Channel Info (frontend)
// ============================================================================

export type ChannelInfo = z.infer<typeof channelInfoSchema>;

// ============================================================================
// IPC Messages
// ============================================================================

export type IpcMessageType = z.infer<typeof ipcMessageTypeSchema>;
export type IpcMessageBase = z.infer<typeof ipcMessageBaseSchema>;

// ============================================================================
// Channel Status Event
// ============================================================================

export type ChannelStatusEvent = z.infer<typeof channelStatusEventSchema>;
