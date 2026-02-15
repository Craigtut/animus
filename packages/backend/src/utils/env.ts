/**
 * Environment configuration
 *
 * Validates and exports environment variables with sensible defaults.
 */

import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Database paths
  DB_SYSTEM_PATH: z.string().default('./data/system.db'),
  DB_HEARTBEAT_PATH: z.string().default('./data/heartbeat.db'),
  DB_MEMORY_PATH: z.string().default('./data/memory.db'),
  DB_MESSAGES_PATH: z.string().default('./data/messages.db'),
  DB_AGENT_LOGS_PATH: z.string().default('./data/agent_logs.db'),
  DB_PERSONA_PATH: z.string().default('./data/persona.db'),
  LANCEDB_PATH: z.string().default('./data/lancedb'),

  // Auth
  JWT_SECRET: z.string().default('change-me-in-production'),
  SESSION_EXPIRY_DAYS: z.coerce.number().default(7),

  // Encryption (required — used to encrypt API keys stored in the database)
  ANIMUS_ENCRYPTION_KEY: z.string().min(1, 'ANIMUS_ENCRYPTION_KEY is required. Set any secret string to encrypt stored credentials.'),

  // Agent API keys (optional, users can configure these)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();

export type Env = z.infer<typeof envSchema>;

// Monorepo root: utils/ → src/ → backend/ → packages/ → root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
