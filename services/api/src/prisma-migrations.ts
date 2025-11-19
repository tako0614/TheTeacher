import migrationInit from "@theteacher/shared/prisma/migrations/20251116180839_init/migration.sql";
import migrationUsers from "@theteacher/shared/prisma/migrations/20251123120000_user_and_sessions/migration.sql";

export type PrismaMigration = {
  name: string;
  sql: string;
};

export const prismaMigrations: PrismaMigration[] = [
  { name: "20251116180839_init", sql: migrationInit },
  { name: "20251123120000_user_and_sessions", sql: migrationUsers },
];
