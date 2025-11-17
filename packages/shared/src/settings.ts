import { z } from "zod";

import {
  generatedContentSchema,
  isoDateTimeString,
  learningSchema,
  materialSchema,
  practiceSessionSchema,
  presetSchema,
} from "./domain";

export const aiSettingsSchema = z.object({
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  apiKey: z.string().optional(),
});

export const backupSettingsSchema = z.object({
  strategy: z.enum(["manual", "daily", "weekly"]).default("manual"),
  targetDirectory: z.string().min(1).optional(),
  lastBackupAt: isoDateTimeString.optional(),
});

export const appSettingsSchema = z.object({
  ai: aiSettingsSchema,
  backup: backupSettingsSchema,
});

export const localDbSnapshotSchema = z.object({
  learnings: z.array(learningSchema),
  materials: z.array(materialSchema),
  generatedContents: z.array(generatedContentSchema),
  practiceSessions: z.array(practiceSessionSchema),
});

export const backupSnapshotSchema = z.object({
  version: z.literal("v1"),
  takenAt: isoDateTimeString,
  settings: appSettingsSchema,
  presets: z.array(presetSchema),
  db: localDbSnapshotSchema,
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type BackupSettings = z.infer<typeof backupSettingsSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type LocalDbSnapshot = z.infer<typeof localDbSnapshotSchema>;
export type BackupSnapshot = z.infer<typeof backupSnapshotSchema>;
