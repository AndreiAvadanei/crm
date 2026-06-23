// Pure, client-safe password rules (no native deps).
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export function isStrongPassword(pw: string): boolean {
  return PASSWORD_RE.test(pw);
}

export const PASSWORD_RULE_TEXT =
  "At least 8 characters, including upper and lower case letters and a number.";
