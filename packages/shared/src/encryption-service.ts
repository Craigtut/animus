/**
 * Encryption service interface.
 * Implementation lives in the backend package.
 */
export interface IEncryptionService {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  isConfigured(): boolean;
}
