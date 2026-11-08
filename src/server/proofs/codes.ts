// Proof codes and proof links.
//
// A code is 4 characters someone on site writes on paper or on the delivered goods. It leaves out
// characters that are easy to misread in a photo of handwriting: 0/O/Q/D, 1/I/L/T, 2/Z, 5/S, 8/B,
// 6/G and U/V.
// A link carries a random 32-byte token. Only its SHA-256 hash is stored, so the database alone
// can't be used to open a proof link.

import { createHash, randomBytes, randomInt } from "node:crypto";

export const CODE_ALPHABET = "ACEFHJKMNPRWXY3479";
export const CODE_LENGTH = 4;
export const PROOF_LINK_TTL_MS = 30 * 60 * 1000;

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// A token as generateToken makes it: 43 base64url characters. Anything else is refused before a
// database lookup.
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

// The words a foreman replies with when a delivery arrives, in English and Swahili. Matched
// exactly (ignoring case, spaces and trailing punctuation), never read by a model.
const PROOF_KEYWORDS = new Set(["PROOF", "THIBITISHA"]);

// The words a foreman replies with when a milestone's work is finished.
const DONE_KEYWORDS = new Set(["DONE", "IMEKAMILIKA"]);

function keyword(text: string | undefined): string | null {
  return text ? text.trim().replace(/[.!?]+$/, "").trim().toUpperCase() : null;
}

export function isProofKeyword(text: string | undefined): boolean {
  const word = keyword(text);
  return word !== null && PROOF_KEYWORDS.has(word);
}

export function isDoneKeyword(text: string | undefined): boolean {
  const word = keyword(text);
  return word !== null && DONE_KEYWORDS.has(word);
}
