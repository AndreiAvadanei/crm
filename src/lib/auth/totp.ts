import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpKeyUri(email: string, secret: string): string {
  const issuer = process.env.WEBAUTHN_RP_NAME || "CRM";
  return generateURI({ strategy: "totp", issuer, label: email, secret });
}

export async function totpQrDataUrl(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(totpKeyUri(email, secret));
}

export async function verifyTotp(token: string, secret: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token: token.replace(/\s+/g, ""), epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}
