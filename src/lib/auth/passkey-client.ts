"use client";

import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export async function runPasskeyRegistration(options: PublicKeyCredentialCreationOptionsJSON) {
  return startRegistration({ optionsJSON: options });
}

export async function runPasskeyAuthentication(options: PublicKeyCredentialRequestOptionsJSON) {
  return startAuthentication({ optionsJSON: options });
}

export function passkeysSupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}
