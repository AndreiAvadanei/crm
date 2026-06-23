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

/** Returns the session user for actions, or null. Does not redirect. */
export async function currentUser(): Promise<User | null> {
  const s = await getSession();
  return s?.user ?? null;
}

/** Like currentUser but throws (for server actions that must be authed). */
export async function requireUser(): Promise<User> {
  const s = await getSession();
  if (!s) throw new Error("Unauthorized");
  return s.user;
}
