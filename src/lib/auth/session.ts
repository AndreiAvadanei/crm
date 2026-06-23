import "server-only";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma";

const COOKIE = process.env.SESSION_COOKIE_NAME || "crm_session";
const SESSION_TTL_DAYS = 7;

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function createSession(userId: string, opts?: { userAgent?: string; ip?: string }) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId, tokenHash, twoFactorOk: false, expiresAt, userAgent: opts?.userAgent, ip: opts?.ip },
  });

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function markSessionTwoFactorOk() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return;
  await prisma.session.updateMany({
    where: { tokenHash: sha256(token) },
    data: { twoFactorOk: true },
  });
}

export type SessionWithUser = {
  session: { id: string; twoFactorOk: boolean };
  user: User;
};

export async function getSession(): Promise<SessionWithUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status === "DISABLED") return null;
  return { session: { id: session.id, twoFactorOk: session.twoFactorOk }, user: session.user };
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } }).catch(() => {});
  }
  store.delete(COOKIE);
}

/** Auth status used by guards to decide where to route the user. */
export type AuthStage = "anonymous" | "need-password" | "need-2fa-enroll" | "need-2fa-verify" | "authenticated";

export function authStage(s: SessionWithUser | null): AuthStage {
  if (!s) return "anonymous";
  if (s.user.mustChangePassword) return "need-password";
  if (!s.user.twoFactorEnabled) return "need-2fa-enroll";
  if (!s.session.twoFactorOk) return "need-2fa-verify";
  return "authenticated";
}
