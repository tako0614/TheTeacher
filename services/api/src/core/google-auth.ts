import { createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export interface GoogleProfile {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  emailVerified?: boolean;
}

export const verifyGoogleIdToken = async (idToken: string, clientId: string): Promise<GoogleProfile> => {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUER,
    audience: clientId,
  });

  return {
    sub: String(payload.sub ?? ""),
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
    emailVerified: payload.email_verified === true,
  };
};
