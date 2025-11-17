import {
  type AppSettings,
  type BackupSnapshot,
  type Preset,
  type LocalDbSnapshot,
  backupSnapshotSchema,
} from "@theteacher/shared";

import { type SnapshotPayload } from "./api-client";

export const buildBackupSnapshot = (
  db: SnapshotPayload | LocalDbSnapshot,
  settings: AppSettings,
  presets: Preset[],
): BackupSnapshot => ({
  version: "v1",
  takenAt: new Date().toISOString(),
  settings,
  presets,
  db: {
    learnings: db.learnings,
    materials: db.materials,
    generatedContents: db.generatedContents,
    practiceSessions: db.practiceSessions,
  },
});

export const serializeSnapshot = (snapshot: BackupSnapshot) =>
  JSON.stringify(snapshot, null, 2);

export const createBackupFilename = (takenAt = new Date()) => {
  const safe = takenAt.toISOString().replace(/[:.]/g, "-");
  return `theteacher-backup-${safe}.json`;
};

export const downloadSnapshot = async (
  snapshot: BackupSnapshot,
  fileName = createBackupFilename(new Date(snapshot.takenAt)),
) => {
  const blob = new Blob([serializeSnapshot(snapshot)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });

export const parseSnapshotText = (text: string): BackupSnapshot =>
  backupSnapshotSchema.parse(JSON.parse(text));

export const parseSnapshotFile = async (file: File) =>
  parseSnapshotText(await readFileAsText(file));
