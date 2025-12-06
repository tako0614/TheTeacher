import migrationInit from "@theteacher/shared/prisma/migrations/20251116180839_init/migration.sql?raw";
import migrationUsers from "@theteacher/shared/prisma/migrations/20251123120000_user_and_sessions/migration.sql?raw";
import migrationMaterialLibrary from "@theteacher/shared/prisma/migrations/20251124120000_material_library/migration.sql?raw";
import migrationUserCredits from "@theteacher/shared/prisma/migrations/20251201100000_add_user_credits/migration.sql?raw";

export interface PrismaMigration {
  name: string;
  sql: string;
}

export const prismaMigrations: PrismaMigration[] = [
  { name: "20251116180839_init", sql: migrationInit },
  { name: "20251123120000_user_and_sessions", sql: migrationUsers },
  { name: "20251124120000_material_library", sql: migrationMaterialLibrary },
  { name: "20251201100000_add_user_credits", sql: migrationUserCredits },
];
