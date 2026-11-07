// The proof review the owner's page shows (checks, evidence, outcome), and the proof photo itself.
//
// There's no owner sign-in yet, so like the rest of the API these are served to anyone holding the
// proof's ID (96 random bits, so it can't be guessed). The owner check goes here when sign-in lands.

import { eq } from "drizzle-orm";
import type { ProofReview } from "@/shared/types";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { ProofDeps } from "./requests";
import { proofImageUrl, verifyProof } from "./verdicts";

// A proof ID as newId("prf") makes it. Anything else is refused before a database lookup.
export function isWellFormedProofId(id: string): boolean {
  return /^prf_[A-Za-z0-9_-]{16}$/.test(id);
}

export async function loadProofReview(deps: ProofDeps, proofId: string): Promise<ProofReview | null> {
  const { db } = deps;
  const [row] = await db.select({
    proof: s.proofs,
    site: { lat: s.projects.siteLat, lng: s.projects.siteLng, radiusM: s.projects.siteRadiusM },
  }).from(s.proofs)
    .innerJoin(s.projects, eq(s.projects.id, s.proofs.projectId))
    .where(eq(s.proofs.id, proofId));
  if (!row) return null;

  let [verdict] = await db.select().from(s.verdicts).where(eq(s.verdicts.proofId, proofId));
  if (!verdict) {
    // The check failed when the photo arrived (it's logged, not retried); run it now.
    if (!(await verifyProof(deps, proofId))) return null;
    [verdict] = await db.select().from(s.verdicts).where(eq(s.verdicts.proofId, proofId));
  }

  const { proof, site } = row;
  const review: ProofReview = {
    proofId: proof.id,
    imageUrl: proofImageUrl(proof.id),
    receivedAt: proof.receivedAt.toISOString(),
    site,
    checks: verdict.checks,
    outcome: verdict.outcome,
    explanation: verdict.explanation,
  };
  if (proof.captureLat != null && proof.captureLng != null) {
    // A WhatsApp pin has no accuracy; the contract needs a number, so 0 stands for "none reported".
    review.capture = { lat: proof.captureLat, lng: proof.captureLng, accuracyM: proof.accuracyM ?? 0 };
  }
  return review;
}

export type BlobReader = (path: string) => Promise<ReadableStream<Uint8Array> | null>;

// The photo, streamed from private storage. Never cached by shared caches, and never sniffed.
export async function proofImageResponse(db: AnyDb, proofId: string, read: BlobReader): Promise<Response | null> {
  const [proof] = await db.select({ blobPath: s.proofs.blobPath, contentType: s.proofs.contentType })
    .from(s.proofs).where(eq(s.proofs.id, proofId));
  if (!proof) return null;
  const stream = await read(proof.blobPath);
  if (!stream) return null;
  return new Response(stream, {
    headers: {
      "content-type": proof.contentType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
