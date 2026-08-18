import { randomInt } from "node:crypto";

import { passwordSchema } from "@/lib/validations";

const UPPERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERS = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SPECIALS = "!@#$%^&*?";
const ALL = `${UPPERS}${LOWERS}${DIGITS}${SPECIALS}`;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)] ?? alphabet[0]!;
}

function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const current = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = current;
  }
  return chars;
}

/** Crypto-secure temporary password that satisfies TenderFlow login policy. */
export function generateTemporaryPassword(length = 14): string {
  const size = Math.max(12, length);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const chars = shuffle([
      pick(UPPERS),
      pick(LOWERS),
      pick(DIGITS),
      pick(SPECIALS),
      ...Array.from({ length: size - 4 }, () => pick(ALL)),
    ]);
    const password = chars.join("");
    if (passwordSchema.safeParse(password).success) {
      return password;
    }
  }
  throw new Error("Unable to generate a valid temporary password.");
}
