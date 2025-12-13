import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const worlds = sqliteTable('worlds', {
  id: text('id').primaryKey(), // e.g. gameId
  themePrompt: text('theme_prompt'),
  seed: text('seed'),
  difficulty: text('difficulty'),
  stateJson: text('state_json'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
});

export const players = sqliteTable(
  'players',
  {
    playerId: text('player_id').primaryKey(), // UUID
    prompt: text('prompt'),
    name: text('name').notNull(),
    description: text('description').notNull(),
    tokenChar: text('token_char').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    lastUsedIdx: index('players_last_used_idx').on(table.lastUsedAt),
  })
);

export const worldPlayers = sqliteTable(
  'world_players',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.playerId, { onDelete: 'cascade' }),
    joinedAt: integer('joined_at', { mode: 'number' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    worldPlayerUnique: uniqueIndex('world_players_world_player_unique').on(table.worldId, table.playerId),
    byPlayerRecent: index('world_players_player_recent_idx').on(table.playerId, table.lastSeenAt),
    byWorldRecent: index('world_players_world_recent_idx').on(table.worldId, table.lastSeenAt),
  })
);

export const levels = sqliteTable(
  'levels',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    coordX: integer('coord_x').notNull(),
    coordY: integer('coord_y').notNull(),
    depth: integer('depth').notNull(),
    width: integer('width'),
    height: integer('height'),
    stateJson: text('state_json').notNull(), // serialized LevelState without player
    tileFlavorsJson: text('tile_flavors_json'),
    enemyFlavorsJson: text('enemy_flavors_json'),
    roomDescription: text('room_description'),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    worldCoordIdx: uniqueIndex('levels_world_coord_idx').on(
      table.worldId,
      table.coordX,
      table.coordY
    ),
  })
);

export const edges = sqliteTable(
  'edges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    fromLevelId: text('from_level_id')
      .notNull()
      .references(() => levels.id, { onDelete: 'cascade' }),
    toLevelId: text('to_level_id')
      .notNull()
      .references(() => levels.id, { onDelete: 'cascade' }),
    fromX: integer('from_x').notNull(),
    fromY: integer('from_y').notNull(),
    toX: integer('to_x').notNull(),
    toY: integer('to_y').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    fromToUnique: uniqueIndex('edge_from_unique').on(
      table.worldId,
      table.fromLevelId,
      table.fromX,
      table.fromY,
      table.toLevelId
    ),
    fromLookup: index('edge_from_lookup').on(table.worldId, table.fromLevelId, table.fromX, table.fromY),
  })
);
