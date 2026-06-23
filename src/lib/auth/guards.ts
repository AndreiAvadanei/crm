import "server-only";
import { redirect } from "next/navigation";
import { getSession, authStage, type SessionWithUser } from "./session";
import type { User } from "@/generated/prisma";

/** Require a fully authenticated user (password changed + 2FA enrolled & verified). */
export async function requireFullAuth(): Promise<User> {
  const s = await getSession();
  const stage = authStage(s);
  switch (stage) {
    case "anonymous":
      redirect("/login");
    case "need-password":
      redirect("/onboarding/password");
    case "need-2fa-enroll":
      redirect("/onboarding/2fa");
    case "need-2fa-verify":
      redirect("/login/verify");
    case "authenticated":
      return (s as SessionWithUser).user;
  }
}

export async function requireAdmin(): Promise<User> {
  const user = await requireFullAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");
  return user;
}

/**
 * Returns the fully authenticated session for actions/routes, or null. This
 * intentionally rejects password-only sessions that have not passed onboarding
 * and 2FA.
 */
export async function getFullyAuthenticatedSession(): Promise<SessionWithUser | null> {
  const s = await getSession();
  return authStage(s) === "authenticated" ? (s as SessionWithUser) : null;
}

/** Returns the fully authenticated session user for actions, or null. */
export async function currentUser(): Promise<User | null> {
  const s = await getFullyAuthenticatedSession();
  return s?.user ?? null;
}

/** Like currentUser but throws (for server actions that must be authed). */
export async function requireUser(): Promise<User> {
  const s = await getFullyAuthenticatedSession();
  if (!s) throw new Error("Unauthorized");
  return s.user;
}
