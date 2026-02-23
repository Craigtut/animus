/**
 * Distribution Types — TypeScript types for the .anpk package system.
 *
 * Types derived from Zod schemas via z.infer<> plus additional
 * interfaces for install/verification/rollback flows.
 */

import { z } from 'zod';
import type {
  pluginPackageManifestSchema,
  channelPackageManifestSchema,
  PackageManifestSchema,
  checksumEntrySchema,
  signatureFileSchema,
  signatureStatusSchema,
  installSourceSchema,
  packagePermissionsSchema,
  packageAuthorSchema,
  packageStoreMetadataSchema,
  packageDistributionSchema,
  pluginComponentsSchema,
  pluginDependenciesSchema,
  packageStorePricingSchema,
} from '../schemas/package-manifest.js';

// ============================================================================
// Schema-Derived Types
// ============================================================================

export type PluginPackageManifest = z.infer<typeof pluginPackageManifestSchema>;
export type ChannelPackageManifest = z.infer<typeof channelPackageManifestSchema>;
export type PackageManifest = z.infer<typeof PackageManifestSchema>;
export type ChecksumEntry = z.infer<typeof checksumEntrySchema>;
export type SignatureFile = z.infer<typeof signatureFileSchema>;
export type SignatureStatus = z.infer<typeof signatureStatusSchema>;
export type InstallSource = z.infer<typeof installSourceSchema>;
export type PackagePermissions = z.infer<typeof packagePermissionsSchema>;
export type PackageAuthor = z.infer<typeof packageAuthorSchema>;
export type PackageStoreMetadata = z.infer<typeof packageStoreMetadataSchema>;
export type PackageDistribution = z.infer<typeof packageDistributionSchema>;
export type PluginComponents = z.infer<typeof pluginComponentsSchema>;
export type PluginDependencies = z.infer<typeof pluginDependenciesSchema>;
export type PackageStorePricing = z.infer<typeof packageStorePricingSchema>;

// ============================================================================
// Verification Result
// ============================================================================

export interface VerificationResult {
  valid: boolean;
  manifest: PackageManifest | null;
  signature: {
    status: SignatureStatus;
    signedBy: string | null;
    signedAt: string | null;
  };
  checksums: {
    verified: number;
    total: number;
    failures: string[];
  };
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Install Types
// ============================================================================

export interface InstallOptions {
  source: 'local' | 'store' | 'package';
  storeChecksum?: string;
  licenseKey?: string;
  grantedPermissions?: string[];
}

export interface InstallResult {
  success: boolean;
  manifest: PackageManifest;
  needsConfig: boolean;
  verification: VerificationResult;
  installedPath: string;
}

// ============================================================================
// Rollback Types
// ============================================================================

export interface RollbackResult {
  success: boolean;
  previousVersion: string;
  restoredVersion: string;
  error?: string;
}

// ============================================================================
// Package Error Codes
// ============================================================================

export enum PackageErrorCode {
  INVALID_FORMAT = 'INVALID_FORMAT',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  SIGNATURE_MISSING = 'SIGNATURE_MISSING',
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  DOWNLOAD_INTEGRITY = 'DOWNLOAD_INTEGRITY',
  MANIFEST_INVALID = 'MANIFEST_INVALID',
  ENGINE_INCOMPATIBLE = 'ENGINE_INCOMPATIBLE',
  FORMAT_VERSION_UNSUPPORTED = 'FORMAT_VERSION_UNSUPPORTED',
  ALREADY_INSTALLED = 'ALREADY_INSTALLED',
  CHANNEL_TYPE_CONFLICT = 'CHANNEL_TYPE_CONFLICT',
  LICENSE_INVALID = 'LICENSE_INVALID',
  PERMISSIONS_DENIED = 'PERMISSIONS_DENIED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  DISK_SPACE = 'DISK_SPACE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  ROLLBACK_UNAVAILABLE = 'ROLLBACK_UNAVAILABLE',
}

// ============================================================================
// Package Info (for UI display)
// ============================================================================

export interface PackageInfo {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: PackageAuthor;
  packageType: 'plugin' | 'channel';
  signatureStatus: SignatureStatus;
  signedBy: string | null;
  permissions: PackagePermissions | undefined;
  installedFrom: InstallSource;
  previousVersion: string | null;
  hasRollback: boolean;
}
