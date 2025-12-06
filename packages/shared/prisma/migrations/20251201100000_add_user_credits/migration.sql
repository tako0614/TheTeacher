-- Add credits column to users for credit-based billing
ALTER TABLE "User" ADD COLUMN "credits" INTEGER NOT NULL DEFAULT 0;
