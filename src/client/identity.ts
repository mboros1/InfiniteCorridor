import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';

export interface ClientIdentity {
  playerId: string;
  playerName?: string;
  lastGameId?: string;
}

const ClientIdentitySchema = z
  .object({
    playerId: z.string().uuid(),
    playerName: z.string().min(1).max(50).optional(),
    lastGameId: z.string().min(1).optional(),
  })
  .passthrough();

function identityPath(): string {
  const override = process.env.IC_CLIENT_IDENTITY_PATH?.trim();
  if (override) return override;
  return path.join(os.homedir(), '.infinite_corridor', 'game', 'client.json');
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

export async function loadOrCreateClientIdentity(): Promise<ClientIdentity> {
  const filePath = identityPath();
  const raw = await readJsonFile(filePath);
  const parsed = ClientIdentitySchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const created: ClientIdentity = { playerId: crypto.randomUUID() };
  await saveClientIdentity(created);
  return created;
}

export async function saveClientIdentity(identity: ClientIdentity): Promise<void> {
  const filePath = identityPath();
  await ensureParentDir(filePath);
  const json = JSON.stringify(identity, null, 2);
  await fs.writeFile(filePath, json, 'utf8');
}
