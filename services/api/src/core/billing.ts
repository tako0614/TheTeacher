import type { D1Database } from "@cloudflare/workers-types";
import type { AppBindings } from "./types";
import { getPrismaClient } from "./prisma";
import { mapUser, type UserRow } from "../db";

const DEFAULT_PACK_CREDITS = 120;
const DEFAULT_PACK_AMOUNT = 1200; // JPY (unitAmount per pack)
const DEFAULT_CURRENCY = "jpy";
const DEFAULT_MIN_PRICE_PER_CREDIT = 12; // JPY per credit floor to ensure margin

export interface Pricing {
  currency: string;
  unitAmount: number;
  creditsPerPack: number;
  effectiveCreditsPerPack: number;
  minPricePerCredit: number;
  priceId?: string;
  label: string;
}

export const resolvePricing = (env?: AppBindings): Pricing => {
  const creditsPerPack = Number(env?.CREDITS_PER_PACK ?? DEFAULT_PACK_CREDITS);
  const unitAmount = Number(env?.STRIPE_PRICE_AMOUNT ?? DEFAULT_PACK_AMOUNT);
  const currency = env?.STRIPE_PRICE_CURRENCY?.toLowerCase() || DEFAULT_CURRENCY;
  const priceId = env?.STRIPE_PRICE_ID?.trim() || undefined;
  const minPricePerCredit = Number(env?.MIN_PRICE_PER_CREDIT ?? DEFAULT_MIN_PRICE_PER_CREDIT);
  const effectiveCreditsPerPack = Math.max(
    1,
    Math.min(creditsPerPack, Math.floor(unitAmount / Math.max(1, minPricePerCredit))),
  );
  return {
    currency,
    unitAmount,
    creditsPerPack,
    effectiveCreditsPerPack,
    minPricePerCredit,
    priceId,
    label: `${effectiveCreditsPerPack} credits / ${currency.toUpperCase()} ${(unitAmount / 100).toFixed(2)}`,
  };
};

export const getUserCredits = async (db: D1Database, userId: string) => {
  const prisma = getPrismaClient(db);
  const user = (await prisma.user.findUnique({ where: { id: userId } })) as UserRow | null;
  return user?.credits ?? 0;
};

export const addUserCredits = async (db: D1Database, userId: string, delta: number) => {
  if (delta === 0) return getUserCredits(db, userId);
  const prisma = getPrismaClient(db);
  await prisma.user.update({
    where: { id: userId },
    data: {
      credits: {
        increment: delta,
      },
      updatedAt: new Date().toISOString(),
    },
  });
  return getUserCredits(db, userId);
};

export const consumeUserCredits = async (
  db: D1Database,
  userId: string,
  cost: number,
): Promise<number> => {
  if (cost <= 0) return getUserCredits(db, userId);
  const prisma = getPrismaClient(db);
  const updated = (await prisma.user.update({
    where: { id: userId },
    data: {
      credits: {
        decrement: cost,
      },
      updatedAt: new Date().toISOString(),
    },
    select: { credits: true },
  })) as { credits: number };
  if (updated.credits < 0) {
    // rollback decrement to avoid negative credits
    await prisma.user.update({
      where: { id: userId },
      data: {
        credits: {
          increment: cost,
        },
      },
    });
    throw new Error("insufficient_credits");
  }
  return updated.credits;
};

const subtleEquals = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
};

const hmacSha256 = async (secret: string, payload: ArrayBuffer) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return new Uint8Array(signature);
};

export const verifyStripeSignature = async (
  secret: string,
  signatureHeader: string | null,
  payload: ArrayBuffer,
): Promise<boolean> => {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",").map((item) => item.trim());
  const timestamp = parts
    .find((item) => item.startsWith("t="))
    ?.slice(2)
    ?.trim();
  const sig = parts
    .find((item) => item.startsWith("v1="))
    ?.slice(3)
    ?.trim();
  if (!timestamp || !sig) return false;
  const signedPayload = new TextEncoder().encode(`${timestamp}.${new TextDecoder().decode(payload)}`);
  const expected = await hmacSha256(secret, signedPayload.buffer);
  const actual = new Uint8Array(
    sig.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
  );
  return subtleEquals(expected, actual);
};

export const createStripeCheckoutSession = async (
  env: AppBindings,
  params: {
    quantity: number;
    userId: string;
    successUrl: string;
    cancelUrl: string;
  },
) => {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  const pricing = resolvePricing(env);
  if (!pricing.priceId) {
    throw new Error("STRIPE_PRICE_ID is not configured");
  }
  const quantity = Math.max(1, Math.min(50, params.quantity || 1));
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][price]", pricing.priceId);
  form.set("line_items[0][quantity]", String(quantity));
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);
  form.set("client_reference_id", params.userId);
  form.set("metadata[userId]", params.userId);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`stripe_checkout_failed:${res.status}:${detail}`);
  }
  return (await res.json()) as { url?: string; id?: string };
};

export const creditsForCheckout = (
  quantity: number,
  env?: AppBindings,
  unitAmountOverride?: number,
) => {
  const pricing = resolvePricing(env);
  const unitAmount = typeof unitAmountOverride === "number" ? unitAmountOverride : pricing.unitAmount;
  const effectivePerPack = Math.max(
    1,
    Math.min(
      pricing.creditsPerPack,
      Math.floor(unitAmount / Math.max(1, pricing.minPricePerCredit)),
    ),
  );
  const packs = Math.max(1, Math.min(50, quantity || 1));
  return packs * effectivePerPack;
};

export const mapUserRowWithCredits = (row: UserRow) =>
  mapUser(row as UserRow & { credits?: number });
