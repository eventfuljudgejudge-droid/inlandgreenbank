import { SignJWT, jwtVerify } from "jose";

/**
 * Edge-safe JWT helpers. This module must NOT import Prisma (or any other
 * Node/server-only dependency) because it is loaded by the Next.js middleware,
 * which runs in Netlify's Edge Runtime where Prisma and arbitrary env reads are
 * unavailable. The key is derived lazily so module import never touches env.
 */

export function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production.");
    }
    return "development-only-secret";
  }
  return secret;
}

let secret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (!secret) {
    secret = new TextEncoder().encode(getJWTSecret());
  }
  return secret;
}

export interface TokenPayload {
  sub: string;
  role: string;
  name: string;
  email: string;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({
    sub: payload.sub,
    role: payload.role,
    name: payload.name,
    email: payload.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(getSecret());
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}
