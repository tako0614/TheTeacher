import type {
  GeneratedContent,
  Learning,
  Material,
  PracticeSession,
  User,
  UserSession,
} from "@theteacher/shared";

export type LearningSummary = Learning & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
  lastStudiedAt?: string;
};

export type SnapshotPayload = {
  learnings: Learning[];
  materials: Material[];
  generatedContents: GeneratedContent[];
  practiceSessions: PracticeSession[];
};

export type AuthSessionState = {
  user: User;
  session: UserSession | null;
};

export type BillingPricing = {
  currency: string;
  unitAmount: number;
  creditsPerPack: number;
  effectiveCreditsPerPack: number;
  minPricePerCredit: number;
  priceId?: string;
  label: string;
};
