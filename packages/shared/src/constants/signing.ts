/**
 * Signing Constants — Embedded Ed25519 public key for package verification.
 *
 * This public key is used by both the anipack CLI (for verification during
 * inspect) and the engine (for verifying packages at install time).
 *
 * The corresponding private key is stored securely and used only during
 * CI/CD package signing. See: docs/architecture/distribution-security.md
 */

/** PEM-encoded Ed25519 public key for the Animus Labs signer. */
export const ANIMUS_LABS_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0+33oVLj8oGhLpIRQduYLcl8b+dQFb5fjtLBZbYUeO4=
-----END PUBLIC KEY-----`;

/** Current package format version supported by this engine build. */
export const SUPPORTED_FORMAT_VERSION = 1;

/** Default signer identity for first-party packages. */
export const DEFAULT_SIGNER_IDENTITY = 'animus-labs';
