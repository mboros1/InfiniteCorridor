import { z } from 'zod';

const RequestIdSchema = z.string().min(1);

export const DirectionSchema = z.enum(['Up', 'Down', 'Left', 'Right']);

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('Move'), direction: DirectionSchema }),
  z.object({ kind: z.literal('Wait') }),
  z.object({ kind: z.literal('Attack'), direction: DirectionSchema }),
  z.object({ kind: z.literal('Transition') }),
  z.object({ kind: z.literal('Command'), text: z.string().min(1).max(500) }),
]);

export const WsStartRunSchema = z.object({
  type: z.literal('startRun'),
  requestId: RequestIdSchema,
  playerId: z.string().uuid(),
  playerName: z.string().min(1).max(50).optional(),
  themePrompt: z.string().min(1),
  seed: z.string().min(1),
  difficulty: z.enum(['Easy', 'Normal', 'Hard']).optional(),
  rulesVersion: z.string().min(1).optional(),
});

export const WsJoinSchema = z.object({
  type: z.literal('join'),
  requestId: RequestIdSchema,
  gameId: z.string().min(1),
  playerId: z.string().uuid(),
  playerName: z.string().min(1).max(50).optional(),
});

export const WsLeaveSchema = z.object({
  type: z.literal('leave'),
  requestId: RequestIdSchema,
  gameId: z.string().min(1).optional(),
});

export const WsLogoutSchema = z.object({
  type: z.literal('logout'),
  requestId: RequestIdSchema,
});

export const WsActionSchema = z.object({
  type: z.literal('action'),
  requestId: RequestIdSchema,
  gameId: z.string().min(1),
  playerId: z.string().uuid(),
  playerName: z.string().min(1).max(50).optional(),
  action: ActionSchema,
});

export const WsListPlayersSchema = z.object({
  type: z.literal('listPlayers'),
  requestId: RequestIdSchema,
  limit: z.number().int().positive().max(100).optional(),
});

export const WsGetPlayerProfileSchema = z.object({
  type: z.literal('getPlayerProfile'),
  requestId: RequestIdSchema,
  playerId: z.string().uuid(),
});

export const WsCreatePlayerProfileSchema = z.object({
  type: z.literal('createPlayerProfile'),
  requestId: RequestIdSchema,
  playerId: z.string().uuid().optional(),
  prompt: z.string().min(1).max(500),
});

export const WsListWorldsSchema = z.object({
  type: z.literal('listWorlds'),
  requestId: RequestIdSchema,
  playerId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  WsStartRunSchema,
  WsJoinSchema,
  WsLeaveSchema,
  WsActionSchema,
  WsLogoutSchema,
  WsListPlayersSchema,
  WsGetPlayerProfileSchema,
  WsCreatePlayerProfileSchema,
  WsListWorldsSchema,
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const PublicErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
  details: z.unknown().optional(),
});

export type PublicError = z.infer<typeof PublicErrorSchema>;

export const WsResponseOkSchema = z.object({
  type: z.literal('response'),
  requestId: RequestIdSchema,
  ok: z.literal(true),
  data: z.unknown().optional(),
});

export const WsResponseErrorSchema = z.object({
  type: z.literal('response'),
  requestId: RequestIdSchema,
  ok: z.literal(false),
  error: PublicErrorSchema,
});

export const WsResponseSchema = z.union([WsResponseOkSchema, WsResponseErrorSchema]);
export type WsResponse = z.infer<typeof WsResponseSchema>;

export const PlayerProfilePublicSchema = z.object({
  playerId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  tokenChar: z.string().min(1),
});

export type PlayerProfilePublic = z.infer<typeof PlayerProfilePublicSchema>;

export const PlayerProfileSummarySchema = z.object({
  playerId: z.string().uuid(),
  name: z.string().min(1),
  tokenChar: z.string().min(1),
  lastUsedAt: z.number().int().nonnegative(),
});

export type PlayerProfileSummary = z.infer<typeof PlayerProfileSummarySchema>;

export const WorldSummarySchema = z.object({
  gameId: z.string().min(1),
  themePrompt: z.string().nullable().optional(),
  seed: z.string().nullable().optional(),
  difficulty: z.string().nullable().optional(),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative().optional(),
});

export type WorldSummary = z.infer<typeof WorldSummarySchema>;

export const WsStateSchema = z.object({
  type: z.literal('state'),
  gameId: z.string().min(1),
  state: z.unknown(),
  gameStatus: z.enum(['active', 'gameOver']),
});

export type WsState = z.infer<typeof WsStateSchema>;

export const WsServerMessageSchema = z.union([WsResponseSchema, WsStateSchema]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
