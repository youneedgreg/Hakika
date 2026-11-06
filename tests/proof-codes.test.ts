// Day 10: proof codes, link tokens and the photo hash. Photos are made with sharp, so dHash runs for real.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET, generateCode, generateToken, hashToken, isProofKeyword, isWellFormedToken,
} from "@/server/proofs/codes";
import { dHash, hammingDistance, UnreadableImage } from "@/server/proofs/dhash";

// A 64×48 test photo: a left-to-right gradient, or its mirror image.
async function photo(mirrored = false) {
  const raw = Buffer.alloc(64 * 48);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) raw[y * 64 + x] = (mirrored ? 63 - x : x) * 4 + (y % 7);
  return new Uint8Array(await sharp(raw, { raw: { width: 64, height: 48, channels: 1 } }).jpeg({ quality: 90 }).toBuffer());
}

describe("codes and tokens", () => {
  it("makes 4-character codes with no look-alike characters", () => {
    for (const c of "0OQD1ILT2Z5S8B6GUV") expect(CODE_ALPHABET).not.toContain(c);
    for (let i = 0; i < 500; i++) expect(generateCode()).toMatch(new RegExp(`^[${CODE_ALPHABET}]{4}$`));
  });

  it("makes unguessable tokens and stores only a SHA-256 hash", () => {
    const token = generateToken();
    expect(isWellFormedToken(token)).toBe(true);
    expect(generateToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(isWellFormedToken("demo-proof-token")).toBe(false);
    expect(isWellFormedToken(`${token}x`)).toBe(false);
  });

  it("matches the PROOF keyword exactly, in English or Swahili", () => {
    for (const text of ["PROOF", "proof", " Proof. ", "THIBITISHA", "thibitisha!"]) expect(isProofKeyword(text)).toBe(true);
    for (const text of ["proof please", "send proof", "PROOFS", "", undefined]) expect(isProofKeyword(text)).toBe(false);
  });
});

describe("dHash", () => {
  it("gives the same photo, re-saved smaller, nearly the same hash", async () => {
    const original = await photo();
    const resaved = new Uint8Array(await sharp(original).resize(40).jpeg({ quality: 60 }).toBuffer());
    const a = await dHash(original);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(a, await dHash(original))).toBe(0);
    expect(hammingDistance(a, await dHash(resaved))).toBeLessThanOrEqual(8);
  });

  it("tells different photos apart", async () => {
    expect(hammingDistance(await dHash(await photo()), await dHash(await photo(true)))).toBeGreaterThan(8);
  });

  it("refuses bytes that aren't an image", async () => {
    await expect(dHash(new Uint8Array([0xff, 0xd8, 0xff]))).rejects.toBeInstanceOf(UnreadableImage);
  });

  it("counts differing bits", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("0000000000000000", "0000000000000003")).toBe(2);
    expect(() => hammingDistance("xyz", "0000000000000000")).toThrow();
  });
});
