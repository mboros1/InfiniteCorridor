import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { APP_ERROR_CODE, appError } from '../errors/appError.js';

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const DEFAULT_WORLD_DB_PATH = path.join(os.homedir(), '.infinite_corridor', 'server', 'world.db');

const RuntimeConfigSchema = z.object({
  port: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : value;
    },
    z.number().int().positive().default(3000)
  ),

  tickMs: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : value;
    },
    z.number().int().positive().default(200)
  ),

  worldDbPath: z.preprocess(
    (value) => nonEmptyString(typeof value === 'string' ? value : undefined),
    z.string().min(1).default(DEFAULT_WORLD_DB_PATH)
  ),

  anthropicApiKey: z.string().optional().transform(nonEmptyString),
  anthropicModel: z.string().optional().transform(nonEmptyString),

  openRouterApiKey: z.string().optional().transform(nonEmptyString),
  openRouterModel: z.string().optional().transform(nonEmptyString),
  openRouterSiteUrl: z.string().optional().transform(nonEmptyString),
  openRouterSiteName: z.string().optional().transform(nonEmptyString),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function loadRuntimeConfig(env = process.env): RuntimeConfig {
  const parsed = RuntimeConfigSchema.safeParse({
    port: env.PORT,
    tickMs: env.TICK_MS,
    worldDbPath: env.WORLD_DB_PATH,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    openRouterApiKey: env.OPENROUTER_API_KEY,
    openRouterModel: env.OPENROUTER_MODEL,
    openRouterSiteUrl: env.OPENROUTER_SITE_URL,
    openRouterSiteName: env.OPENROUTER_SITE_NAME,
  });

  if (!parsed.success) {
    throw appError(APP_ERROR_CODE.ConfigInvalid, 'Invalid runtime configuration', {
      cause: parsed.error,
      context: { validationErrors: parsed.error.format() },
    });
  }

  return Object.freeze(parsed.data);
}

export const RUNTIME_CONFIG = loadRuntimeConfig();
