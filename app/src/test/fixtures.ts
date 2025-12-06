import { mockData } from "../lib/mock-data";
import type { LearningSummary, SnapshotPayload } from "../lib/types";

const [learningSummary] = mockData.learningSummaries;

export const fixtures = {
  now: mockData.now,
  user: mockData.user,
  userSession: mockData.userSession,
  learning: mockData.learningMath,
  learningSummary: learningSummary as LearningSummary,
  material: mockData.materialPdf,
  generatedContent: mockData.generatedSummary,
  practiceSession: mockData.practiceSession,
  libraryEntry: mockData.libraryEntries[0],
  snapshot: mockData.snapshot as SnapshotPayload,
  authResponse: mockData.authResponse,
  presets: mockData.presets,
  semanticMatches: mockData.semanticMatches,
};
