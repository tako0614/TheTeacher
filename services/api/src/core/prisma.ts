import type { D1Database } from "@cloudflare/workers-types";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client/edge";
import { prismaMigrations } from "../prisma-migrations";

export const nowIso = () => new Date().toISOString();

const PRISMA_MIGRATIONS_TABLE = "_prisma_migrations";
const prismaClientCache = new WeakMap<D1Database, PrismaClient>();
let prismaSchemaReady: Promise<void> | null = null;

const toHexString = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hashString = async (value: string) => {
  const data = new TextEncoder().encode(value);
  if (typeof crypto?.subtle !== "undefined") {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return toHexString(digest);
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
};

const runPrismaStatements = async (prisma: PrismaClient, sql: string) => {
  const statements = sql
    .split(/;\s*\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
};

const ensurePrismaMigrationsTable = async (prisma: PrismaClient) => {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${PRISMA_MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      finished_at TEXT,
      migration_name TEXT NOT NULL,
      logs TEXT,
      rolled_back_at TEXT,
      started_at TEXT,
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    )`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_prisma_migrations_name ON ${PRISMA_MIGRATIONS_TABLE}(migration_name)`,
  );
};

const loadAppliedPrismaMigrations = async (prisma: PrismaClient) => {
  await ensurePrismaMigrationsTable(prisma);
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT migration_name FROM ${PRISMA_MIGRATIONS_TABLE}`,
  )) as { migration_name?: string | null }[];
  const applied = new Set<string>();
  for (const row of rows ?? []) {
    if (row?.migration_name) {
      applied.add(row.migration_name);
    }
  }
  return applied;
};

const applyPrismaMigrations = async (prisma: PrismaClient) => {
  await ensurePrismaMigrationsTable(prisma);
  const applied = await loadAppliedPrismaMigrations(prisma);
  for (const migration of prismaMigrations) {
    if (applied.has(migration.name)) continue;
    const startedAt = nowIso();
    try {
      await runPrismaStatements(prisma, migration.sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed_to_apply_migration:${migration.name}:${message}`);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${PRISMA_MIGRATIONS_TABLE}
        (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      await hashString(migration.sql),
      nowIso(),
      migration.name,
      null,
      null,
      startedAt,
      1,
    );
  }
};

export const getPrismaClient = (db: D1Database) => {
  let client = prismaClientCache.get(db);
  if (!client) {
    const adapter = new PrismaD1(db);
    client = new PrismaClient({ adapter });
    prismaClientCache.set(db, client);
  }
  return client;
};

export const ensurePrismaSchema = (db?: D1Database) => {
  if (!db) return Promise.resolve();
  if (!prismaSchemaReady) {
    const prisma = getPrismaClient(db);
    prismaSchemaReady = applyPrismaMigrations(prisma).catch((error) => {
      prismaSchemaReady = null;
      throw error;
    });
  }
  return prismaSchemaReady;
};

export const ensureUserTables = (db?: D1Database) => ensurePrismaSchema(db);
export const ensureCoreTables = (db?: D1Database) => ensurePrismaSchema(db);
export const ensureMaterialTables = (db?: D1Database) => ensurePrismaSchema(db);
export { toHexString };
