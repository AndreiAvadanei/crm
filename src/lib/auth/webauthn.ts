import "server-only";
import { headers } from "next/headers";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma";
import { APP_NAME } from "@/lib/app-constants";

const rpName = process.env.WEBAUTHN_RP_NAME || APP_NAME;

/**
 * WebAuthn verification requires the RP ID and origin to match the URL the
 * browser actually used. Deriving them from the incoming request host keeps
 * passkeys working regardless of the port/domain the app is served on (e.g.
 * behind a Docker port mapping), and falls back to env vars when no request
 * context is available.
 */
async function resolveRp(): Promise<{ rpID: string; origin: string }> {
  const h = await headers();
  const host = h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
    return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
  }
  return {
    rpID: process.env.WEBAUTHN_RP_ID || "localhost",
    origin: process.env.WEBAUTHN_ORIGIN || "http://localhost:3000",
  };
}

export async function buildRegistrationOptions(user: User) {
  const { rpID } = await resolveRp();
  const creds = await prisma.webAuthnCredential.findMany({ where: { userId: user.id } });
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: creds.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: options.challenge } });
  return options;
}

export async function confirmRegistration(
  user: User,
  response: RegistrationResponseJSON,
  deviceName: string
): Promise<boolean> {
  if (!user.currentChallenge) return false;
  const { rpID, origin } = await resolveRp();
  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return false;
  }
  if (!verification.verified || !verification.registrationInfo) return false;

  const { credential } = verification.registrationInfo;
  await prisma.webAuthnCredential.create({
    data: {
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      deviceName: deviceName || "Passkey",
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { currentChallenge: null, twoFactorEnabled: true },
  });
  return true;
}

export async function buildAuthenticationOptions(user: User) {
  const { rpID } = await resolveRp();
  const creds = await prisma.webAuthnCredential.findMany({ where: { userId: user.id } });
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransport[]) : undefined,
    })),
    userVerification: "preferred",
  });
  await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: options.challenge } });
  return options;
}

export async function confirmAuthentication(
  user: User,
  response: AuthenticationResponseJSON
): Promise<boolean> {
  if (!user.currentChallenge) return false;
  const cred = await prisma.webAuthnCredential.findUnique({ where: { credentialId: response.id } });
  if (!cred || cred.userId !== user.id) return false;

  const { rpID, origin } = await resolveRp();
  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: Number(cred.counter),
        transports: cred.transports ? (JSON.parse(cred.transports) as AuthenticatorTransport[]) : undefined,
      },
    });
  } catch {
    return false;
  }
  if (!verification.verified) return false;

  await prisma.webAuthnCredential.update({
    where: { id: cred.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: null } });
  return true;
}
