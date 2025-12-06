import { z } from "zod";

import { userSchema, userSessionSchema } from "./domain";

export const sessionTokenSchema = z.string().min(24).max(255);

export const bootstrapSessionRequestSchema = z.object({
  deviceName: z.string().trim().min(1).default("unknown-device"),
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
});

export const googleLoginRequestSchema = z.object({
  idToken: z.string().min(10, "idToken is required"),
  deviceName: z.string().trim().min(1).optional(),
});

export const issueSessionRequestSchema = z.object({
  deviceName: z.string().trim().min(1).optional(),
});

export const updateUserProfileRequestSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().trim().min(1).optional(),
});

export const authSessionResponseSchema = z.object({
  user: userSchema,
  session: userSessionSchema,
  token: sessionTokenSchema,
});

export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type BootstrapSessionRequest = z.infer<typeof bootstrapSessionRequestSchema>;
export type GoogleLoginRequest = z.infer<typeof googleLoginRequestSchema>;
export type IssueSessionRequest = z.infer<typeof issueSessionRequestSchema>;
export type UpdateUserProfileRequest = z.infer<typeof updateUserProfileRequestSchema>;
