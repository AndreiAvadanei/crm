"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { hashPassword, verifyPassword, isStrongPassword } from "@/lib/auth/password";
import {
  createSession,
  destroySession,
  getSession,
  markSessionTwoFactorOk,
  authStage,
} from "@/lib/auth/session";
import { generateTotpSecret, totpQrDataUrl, verifyTotp } from "@/lib/auth/totp";
import {
  buildRegistrationOptions,
  confirmRegistration,
  buildAuthenticationOptions,
  confirmAuthentication,
} from "@/lib/auth/webauthn";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";

type ActionResult = { error?: string; ok?: boolean };

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function stagePath(stage: ReturnType<typeof authStage>): string {
  switch (stage) {
    case "need-password":
      return "/onboarding/password";
    case "need-2fa-enroll":
      return "/onboarding/2fa";
    case "need-2fa-verify":
      return "/login/verify";
    case "authenticated":
      return "/dashboard";
    default:
      return "/login";
  }
}

export async function loginAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || user.status === "DISABLED") return { error: "Invalid credentials." };

  const ok = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!ok) return { error: "Invalid credentials." };

  const h = await headers();
  await createSession(user.id, {
    userAgent: h.get("user-agent") ?? undefined,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });

  await logActivity({ actorId: user.id, action: "user_logged_in", entity: "User", entityId: user.id });

  // Decide where to send the user.
  const stage = authStage({
    session: { id: "", twoFactorOk: false },
    user,
  });
  redirect(stagePath(stage));
}

export async function logoutAction(): Promise<void> {
  const s = await getSession();
  if (s) {
    await logActivity({ actorId: s.user.id, action: "user_logged_out", entity: "User", entityId: s.user.id });
  }
  await destroySession();
  redirect("/login");
}

const passwordSchema = z
  .object({
    current: z.string().optional(),
    next: z.string(),
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, { message: "Passwords do not match." });

export async function changePasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { error: "Session expired. Please log in again." };

  const parsed = passwordSchema.safeParse({
    current: formData.get("current") ?? undefined,
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  if (!isStrongPassword(parsed.data.next))
    return { error: "Password too weak: min 8 chars with upper, lower and a number." };

  // If the account is past first-login, require the current password.
  if (!s.user.mustChangePassword) {
    const valid = parsed.data.current
      ? await verifyPassword(s.user.passwordHash, parsed.data.current)
      : false;
    if (!valid) return { error: "Current password is incorrect." };
  }

  const passwordHash = await hashPassword(parsed.data.next);
  await prisma.user.update({
    where: { id: s.user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  await logActivity({ actorId: s.user.id, action: "password_changed", entity: "User", entityId: s.user.id });

  const updated = await getSession();
  redirect(stagePath(authStage(updated)));
}

// --- TOTP enrollment ---
export async function startTotpEnrollAction(): Promise<{ secret: string; qr: string } | { error: string }> {
  const s = await getSession();
  if (!s) return { error: "Session expired." };
  const secret = generateTotpSecret();
  // Store provisional secret; not enabled until confirmed.
  await prisma.user.update({ where: { id: s.user.id }, data: { totpSecret: secret } });
  const qr = await totpQrDataUrl(s.user.email, secret);
  return { secret, qr };
}

export async function confirmTotpEnrollAction(token: string): Promise<ActionResult> {
  const s = await getSession();
  if (!s || !s.user.totpSecret) return { error: "Session expired or no secret." };
  if (!(await verifyTotp(token, s.user.totpSecret))) return { error: "Invalid code. Try again." };
  await prisma.user.update({ where: { id: s.user.id }, data: { twoFactorEnabled: true } });
  await markSessionTwoFactorOk();
  await logActivity({
    actorId: s.user.id,
    action: "twofactor_enrolled",
    entity: "User",
    entityId: s.user.id,
    meta: { method: "totp" },
  });
  return { ok: true };
}

// --- TOTP verification at login ---
export async function verifyLoginTotpAction(token: string): Promise<ActionResult> {
  const s = await getSession();
  if (!s || !s.user.totpSecret) return { error: "Session expired." };
  if (!(await verifyTotp(token, s.user.totpSecret))) return { error: "Invalid code." };
  await markSessionTwoFactorOk();
  return { ok: true };
}

// --- Passkey registration (enrollment) ---
export async function passkeyRegisterOptionsAction() {
  const s = await getSession();
  if (!s) return { error: "Session expired." };
  return buildRegistrationOptions(s.user);
}

export async function passkeyRegisterConfirmAction(
  response: RegistrationResponseJSON,
  deviceName: string
): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { error: "Session expired." };
  const ok = await confirmRegistration(s.user, response, deviceName);
  if (!ok) return { error: "Could not register passkey." };
  await markSessionTwoFactorOk();
  await logActivity({
    actorId: s.user.id,
    action: "twofactor_enrolled",
    entity: "User",
    entityId: s.user.id,
    meta: { method: "passkey" },
  });
  return { ok: true };
}

// --- Passkey authentication (login verify) ---
export async function passkeyAuthOptionsAction() {
  const s = await getSession();
  if (!s) return { error: "Session expired." };
  return buildAuthenticationOptions(s.user);
}

export async function passkeyAuthConfirmAction(response: AuthenticationResponseJSON): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { error: "Session expired." };
  const ok = await confirmAuthentication(s.user, response);
  if (!ok) return { error: "Passkey verification failed." };
  await markSessionTwoFactorOk();
  return { ok: true };
}

// --- Manage passkeys from the account page ---
export async function removePasskeyAction(credentialId: string): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { error: "Session expired." };
  const cred = await prisma.webAuthnCredential.findUnique({ where: { id: credentialId } });
  if (!cred || cred.userId !== s.user.id) return { error: "Not found." };

  // Keep 2FA enforceable: don't allow removing the last factor.
  const passkeys = await prisma.webAuthnCredential.count({ where: { userId: s.user.id } });
  if (passkeys <= 1 && !s.user.totpSecret) {
    return { error: "Add an authenticator app before removing your only passkey." };
  }
  await prisma.webAuthnCredential.delete({ where: { id: credentialId } });
  await logActivity({
    actorId: s.user.id,
    action: "passkey_removed",
    entity: "User",
    entityId: s.user.id,
    meta: { deviceName: cred.deviceName },
  });
  revalidatePath("/account/security");
  return { ok: true };
}
