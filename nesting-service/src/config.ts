import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional()
);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z
    .string({
      required_error: 'DATABASE_URL is required. Set it in .env, for example postgresql://user:pass@host:5432/crm_db?schema=nesting',
    })
    .min(1, 'DATABASE_URL is required. Set it in .env.'),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  OUTPUT_DIR: z.string().min(1).default('./output'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(500),
  UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  CORS_ORIGIN: z.string().min(1).default('*'),
  ANTHROPIC_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODEL: optionalString,
  OPENROUTER_BASE_URL: optionalString,
  AI_SETTINGS_ENCRYPTION_KEY: optionalString,
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n- ');

  throw new Error(`Invalid environment configuration:\n- ${details}`);
}

export const config = parsedEnv.data;
export type AppConfig = typeof config;
