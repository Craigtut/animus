/**
 * Keygen Command — Generate an Ed25519 keypair for package signing.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as logger from '../utils/logger.js';

export async function keygenCommand(options: {
  output?: string | undefined;
  stdout?: boolean | undefined;
}): Promise<void> {
  logger.heading('Generating Ed25519 keypair...');
  logger.blank();

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  if (options.stdout) {
    console.log('=== PRIVATE KEY ===');
    console.log(privateKey);
    console.log('=== PUBLIC KEY ===');
    console.log(publicKey);
    return;
  }

  const outputDir = options.output
    ? path.resolve(options.output)
    : path.resolve(process.cwd(), 'keys');

  await fs.mkdir(outputDir, { recursive: true });

  const privateKeyPath = path.join(outputDir, 'animus-private.pem');
  const publicKeyPath = path.join(outputDir, 'animus-public.pem');

  await fs.writeFile(privateKeyPath, privateKey, 'utf-8');
  await fs.writeFile(publicKeyPath, publicKey, 'utf-8');

  // Set restrictive permissions on private key
  await fs.chmod(privateKeyPath, 0o600);

  logger.detail('Private key:', privateKeyPath);
  logger.detail('Public key:', publicKeyPath);
  logger.blank();
  logger.warn('Keep the private key secure!');
  logger.info('- Store in CI/CD secrets (e.g., GitHub Actions)');
  logger.info('- Never commit to version control');
  logger.info('- Never share or transmit over insecure channels');
  logger.blank();
  logger.info('The public key should be:');
  logger.info('- Embedded in the engine source (packages/shared/src/constants/)');
  logger.info('- Published at animusengine.com/.well-known/animus-signing-key.pub');
  logger.blank();
  logger.success('Keypair generated.');
}
