// Day 11: the verification engine's fixed checks and outcome rule. Photos are made with sharp, so
// the duplicate check runs on real dHashes.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { ProofCheck } from "@/shared/types";
import { dHash } from "@/server/proofs/dhash";
import {
  accuracyCredit, codeCheck, decideOutcome, distanceMetres, duplicateCheck, explainOutcome, freshnessCheck,
  locationCheck, normaliseCode, notInspectedChecks, type EarlierProof,
} from "@/server/proofs/verify";

const SITE = { lat: -0.42016, lng: 36.94771, radiusM: 60 };
// About 111.2 m per 0.001 degree of latitude.
const north = (m: number) => ({ lat: SITE.lat + m / 111_195, lng: SITE.lng });

const issuedAt = new Date("2026-11-07T08:00:00Z");
const minutes = (n: number) => new Date(issuedAt.getTime() + n * 60_000);

// A 64×48 test photo: brightness rising away from a point that `seed` moves.
async function photo(seed: number) {
  const raw = Buffer.alloc(64 * 48);
  const cx = 16 + seed * 5;
  const cy = 12 + seed * 3;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) raw[y * 64 + x] = Math.min(255, Math.hypot(x - cx, y - cy) * 5);
  return new Uint8Array(await sharp(raw, { raw: { width: 64, height: 48, channels: 1 } }).jpeg({ quality: 90 }).toBuffer());
}

const earlier = (proofId: string, dhash: string, receivedAt = new Date("2026-10-05T09:00:00Z")): EarlierProof => ({
  proofId, dhash, receivedAt, imageUrl: `/api/proofs/${proofId}/image`,
});

describe("code check", () => {
  it("passes the issued code, ignoring case and spaces", () => {
    expect(codeCheck("H4RK", "h4 rk").result).toBe("pass");
    expect(normaliseCode(" h 4r k ")).toBe("H4RK");
  });

  it("fails a different code or none, and is unknown until something reads it", () => {
    expect(codeCheck("H4RK", "H4RX")).toMatchObject({ result: "fail", hard: true, detail: expect.stringContaining("H4RX") });
    expect(codeCheck("H4RK", null).result).toBe("fail");
    expect(codeCheck("H4RK", "  ").result).toBe("fail");
    expect(codeCheck("H4RK", undefined).result).toBe("unknown");
  });

  it("doesn't forgive look-alike characters", () => {
    expect(codeCheck("H4RK", "H4RX").result).toBe("fail");
    expect(codeCheck("AC3E", "ACBE").result).toBe("fail");
  });
});

describe("freshness check", () => {
  it("passes up to 30 minutes after the code was issued", () => {
    expect(freshnessCheck(issuedAt, minutes(6))).toMatchObject({ result: "pass", detail: "Uploaded 6 minutes after the code was issued." });
    expect(freshnessCheck(issuedAt, minutes(1)).detail).toBe("Uploaded 1 minute after the code was issued.");
    expect(freshnessCheck(issuedAt, minutes(30)).result).toBe("pass");
  });

  it("fails later than 30 minutes, or before the code existed", () => {
    expect(freshnessCheck(issuedAt, new Date(minutes(30).getTime() + 1)).result).toBe("fail");
    expect(freshnessCheck(issuedAt, minutes(45)).detail).toContain("45 minutes");
    expect(freshnessCheck(issuedAt, minutes(-1)).result).toBe("fail");
  });
});

describe("duplicate check", () => {
  it("passes the project's first photo", () => {
    expect(duplicateCheck("0123456789abcdef", [])).toMatchObject({ result: "pass", detail: expect.stringContaining("first") });
  });

  it("fails at 8 bits or fewer from an earlier proof, pointing at the closest one", () => {
    const check = duplicateCheck("0000000000000000", [
      earlier("prf_far", "ffffffffffffffff"),
      earlier("prf_near", "00000000000000ff"),
      earlier("prf_nearest", "0000000000000007"),
    ]);
    expect(check).toMatchObject({
      result: "fail", hard: true, detail: "Matches a proof sent on 5 October (3 bits apart).",
      evidence: { hamming: 3, matchImageUrl: "/api/proofs/prf_nearest/image" },
    });
    expect(duplicateCheck("0000000000000000", [earlier("p", "00000000000000ff")]).result).toBe("fail");
    expect(duplicateCheck("0000000000000000", [earlier("p", "00000000000001ff")])).toMatchObject({ result: "pass", evidence: { hamming: 9 } });
  });

  it("catches a reused photo re-saved smaller, and passes a different photo", async () => {
    const original = await photo(1);
    const resaved = new Uint8Array(await sharp(original).resize(48).jpeg({ quality: 55 }).toBuffer());
    const other = await photo(5);
    const before = [earlier("prf_old", await dHash(original))];
    expect(duplicateCheck(await dHash(resaved), before).result).toBe("fail");
    expect(duplicateCheck(await dHash(other), before).result).toBe("pass");
  });
});

describe("location check", () => {
  it("measures distance on the globe", () => {
    expect(distanceMetres(SITE, SITE)).toBe(0);
    expect(distanceMetres(SITE, north(100))).toBeCloseTo(100, 0);
    // Nairobi CBD to Thika is about 40 km.
    expect(distanceMetres({ lat: -1.2864, lng: 36.8172 }, { lat: -1.0333, lng: 37.0693 }) / 1000).toBeCloseTo(39.7, 0);
  });

  it("passes inside the radius plus the reported accuracy", () => {
    expect(locationCheck(SITE, { ...north(14), accuracyM: 12 })).toMatchObject({
      result: "pass", detail: "Taken 14 m from the site pin, within the 60 m site radius plus 12 m GPS accuracy.", evidence: { distanceM: 14 },
    });
    expect(locationCheck(SITE, { ...north(90), accuracyM: 35 }).result).toBe("pass");
    expect(locationCheck(SITE, { ...north(90), accuracyM: 25 }).result).toBe("fail");
  });

  it("counts accuracy up to 100 m only", () => {
    expect(accuracyCredit(400)).toBe(100);
    expect(locationCheck(SITE, { ...north(170), accuracyM: 400 }).result).toBe("fail");
    expect(locationCheck(SITE, { ...north(150), accuracyM: 400 }).result).toBe("pass");
  });

  it("gives a WhatsApp pin (no accuracy) only the radius itself", () => {
    expect(locationCheck(SITE, { ...north(55), accuracyM: null })).toMatchObject({
      result: "pass", detail: "Taken 55 m from the site pin, within the 60 m site radius.",
    });
    expect(locationCheck(SITE, { ...north(65), accuracyM: null }).result).toBe("fail");
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(accuracyCredit(bad)).toBe(0);
  });

  it("reports far-away photos in km, and no location as unknown", () => {
    expect(locationCheck(SITE, { lat: -0.0917, lng: 37.0062, accuracyM: 20 })).toMatchObject({
      result: "fail", hard: true, detail: "Taken 37.1 km from the site pin, outside the 60 m site radius plus 20 m GPS accuracy.",
    });
    expect(locationCheck(SITE, null)).toMatchObject({ result: "unknown", hard: true });
  });
});

describe("outcome rule", () => {
  const pass = (name: ProofCheck["name"], hard = true): ProofCheck => ({ name, result: "pass", hard, detail: `${name} ok.` });
  const allPass = [pass("code"), pass("freshness"), pass("duplicate"), pass("location"),
    pass("screen_or_print", false), pass("expected_items", false), pass("consistency", false)];

  it("is Verified only when every check passes", () => {
    expect(decideOutcome(allPass)).toBe("verified");
    expect(explainOutcome("verified", allPass)).toBe("Every check passed.");
    expect(decideOutcome([])).toBe("needs_fresh_proof");
  });

  it("is Suspicious on any hard fail, even with unknowns", () => {
    const checks = [codeCheck("H4RK", undefined), freshnessCheck(issuedAt, minutes(5)),
      duplicateCheck("0000000000000000", [earlier("p", "0000000000000001")]), locationCheck(SITE, null), ...notInspectedChecks()];
    expect(decideOutcome(checks)).toBe("suspicious");
    expect(explainOutcome("suspicious", checks)).toBe("Suspicious. Matches a proof sent on 5 October (1 bit apart).");
  });

  it("needs fresh proof on a soft fail or any unknown", () => {
    const soft = allPass.map((c) => (c.name === "expected_items" ? { ...c, result: "fail" as const, detail: "No cement bags visible." } : c));
    expect(decideOutcome(soft)).toBe("needs_fresh_proof");
    expect(explainOutcome("needs_fresh_proof", soft)).toBe("Fresh proof needed. No cement bags visible.");

    const unread = [codeCheck("H4RK", undefined), ...allPass.slice(1, 4), ...notInspectedChecks()];
    expect(decideOutcome(unread)).toBe("needs_fresh_proof");
    expect(explainOutcome("needs_fresh_proof", unread)).toBe(
      "Fresh proof needed. Not yet confirmed: the code, that it isn't a photo of a screen or print, the items delivered and that it matches the site.",
    );
  });
});
