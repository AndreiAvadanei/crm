import "server-only";
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

const rpID = process.env.WEBAUTHN_RP_ID || "localhost";
const rpName = process.env.WEBAUTHN_RP_NAME || "CRM";
const origin = process.env.WEBAUTHN_ORIGIN || "http://localhost:3000";

export async function buildRegistrationOptions(user: User) {
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
