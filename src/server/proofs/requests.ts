// Proof requests: a one-time code and capture link, single use, expiring 30 minutes after issue.
// Expiry is checked whenever a link is opened or a proof arrives, so no timer is needed.
//
// A proof is stored here with its location and times; whether it passes is the verification
// engine's job (Day 11), so nothing in this file moves a request or milestone past awaiting_proof.

import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { ProofVision } from "@/server/ai/proof-vision";
import type { ProofCapture } from "@/shared/api";
import type { AnyDb } from "@/server/db/client";
import type { PROOF_PURPOSES, PROOF_SOURCES } from "@/server/db/enums";
import { newId } from "@/server/db/ids";
import * as s from "@/server/db/schema";
import { milestoneMachine, proofRequestMachine, requestMachine } from "@/server/state/machines";
import { generateCode, generateToken, hashToken, isWellFormedToken, PROOF_LINK_TTL_MS } from "./codes";

type Purpose = (typeof PROOF_PURPOSES)[number];
type Source = (typeof PROOF_SOURCES)[number];
type ProofRequest = typeof s.proofRequests.$inferSelect;
type Contact = typeof s.siteContacts.$inferSelect;
type Tx = Parameters<Parameters<AnyDb["transaction"]>[0]>[0];

// `vision` is how a proof photo is inspected. Without it, the code and vision checks stay unknown.
export type ProofDeps = { db: AnyDb; now?: () => Date; vision?: ProofVision };
const clock = (deps: ProofDeps) => (deps.now ?? (() => new Date()))();

export type IssuedProofRequest = { id: string; code: string; token: string; expiresAt: Date; milestoneName: string };

// Issues a new code and link. Any other open request for the same delivery (or, for progress, the
// same milestone) is superseded, so only the newest link works. The token is returned once, to be
// sent; only its hash is stored. A progress code moves its milestone to awaiting_proof.
export async function issueProofRequest(deps: ProofDeps, input: {
  projectId: string;
  milestoneId: string;
  purpose: Purpose;
  paymentId?: string | null;
  contactId?: string | null;
  replacesId?: string | null;
}): Promise<IssuedProofRequest> {
  const issuedAt = clock(deps);
  const expiresAt = new Date(issuedAt.getTime() + PROOF_LINK_TTL_MS);
  const token = generateToken();
  const code = generateCode();

  return deps.db.transaction(async (tx) => {
    const [milestone] = await tx.select().from(s.milestones).where(eq(s.milestones.id, input.milestoneId));
    if (!milestone || milestone.projectId !== input.projectId) throw new Error("The milestone is not on this project.");

    const sameTarget = input.paymentId
      ? eq(s.proofRequests.paymentId, input.paymentId)
      : and(eq(s.proofRequests.milestoneId, input.milestoneId), isNull(s.proofRequests.paymentId));
    const open = await tx.select().from(s.proofRequests)
      .where(and(sameTarget, eq(s.proofRequests.purpose, input.purpose), eq(s.proofRequests.status, "issued")))
      .for("update");
    for (const old of open) {
      await tx.update(s.proofRequests).set({ status: proofRequestMachine.transition(old.status, "superseded") })
        .where(eq(s.proofRequests.id, old.id));
    }

    const [row] = await tx.insert(s.proofRequests).values({
      id: newId("prq"),
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      paymentId: input.paymentId ?? null,
      contactId: input.contactId ?? null,
      purpose: input.purpose,
      code,
      tokenHash: hashToken(token),
      replacesId: input.replacesId ?? open.at(-1)?.id ?? null,
      issuedAt,
      expiresAt,
    }).returning();

    let requestId: string | null = null;
    if (input.paymentId) {
      const [payment] = await tx.select().from(s.payments).where(eq(s.payments.id, input.paymentId));
      requestId = payment?.requestId ?? null;
      if (requestId) {
        const [request] = await tx.select().from(s.requests).where(eq(s.requests.id, requestId)).for("update");
        if (request.status === "paid") {
          await tx.update(s.requests).set({ status: requestMachine.transition(request.status, "proof_requested") })
            .where(eq(s.requests.id, request.id));
        }
      }
    }

    if (input.purpose === "progress" && milestoneMachine.can(milestone.status, "proof_requested")) {
      await tx.update(s.milestones).set({ status: milestoneMachine.transition(milestone.status, "proof_requested") })
        .where(eq(s.milestones.id, milestone.id));
    }

    const contact = input.contactId
      ? (await tx.select().from(s.siteContacts).where(eq(s.siteContacts.id, input.contactId)))[0]
      : undefined;
    await tx.insert(s.auditEvents).values({
      projectId: input.projectId,
      kind: "proof",
      action: open.length ? "proof.reissued" : "proof.requested",
      description: `Proof code ${code} sent${contact ? ` to ${contact.name}` : ""} for ${milestone.name}; it expires in 30 minutes.`,
      actor: "system",
      requestId,
      paymentId: input.paymentId ?? null,
      milestoneId: milestone.id,
      data: { proofRequestId: row.id, purpose: input.purpose, code, expiresAt: expiresAt.toISOString(), superseded: open.map((o) => o.id) },
    });

    return { id: row.id, code, token, expiresAt, milestoneName: milestone.name };
  });
}

// The delivery a foreman's PROOF reply is about: the newest captured materials payment on their
// project whose request is paid, or awaiting proof with no photo in yet. Null when nothing is due.
export async function findDeliveryDue(db: AnyDb, contact: Contact) {
  const candidates = await db.select({
    paymentId: s.payments.id,
    requestId: s.requests.id,
    requestStatus: s.requests.status,
    milestoneId: s.requests.milestoneId,
  }).from(s.payments)
    .innerJoin(s.requests, eq(s.requests.id, s.payments.requestId))
    .where(and(
      eq(s.payments.projectId, contact.projectId),
      eq(s.payments.kind, "materials"),
      eq(s.payments.status, "captured"),
      inArray(s.requests.status, ["paid", "awaiting_proof"]),
    ))
    .orderBy(desc(s.payments.capturedAt));

  for (const candidate of candidates) {
    if (!candidate.milestoneId) continue;
    if (candidate.requestStatus === "awaiting_proof") {
      const [latest] = await db.select({ status: s.proofRequests.status }).from(s.proofRequests)
        .where(eq(s.proofRequests.paymentId, candidate.paymentId))
        .orderBy(desc(s.proofRequests.issuedAt)).limit(1);
      if (latest?.status === "used") continue; // a photo is in; its verdict decides what happens next
    }
    return { ...candidate, milestoneId: candidate.milestoneId };
  }
  return null;
}

// The milestone a foreman's DONE reply is about: the first on their project, in plan order, whose
// work is in progress or still waiting on an accepted proof. Null when there is none.
export async function findMilestoneDue(db: AnyDb, contact: Contact) {
  const [milestone] = await db.select({ id: s.milestones.id }).from(s.milestones)
    .where(and(eq(s.milestones.projectId, contact.projectId), inArray(s.milestones.status, ["in_progress", "awaiting_proof", "held"])))
    .orderBy(s.milestones.position).limit(1);
  return milestone ? { milestoneId: milestone.id } : null;
}

// The open request a WhatsApp photo from this contact would answer, if any.
export async function openProofRequestFor(deps: ProofDeps, contactId: string): Promise<ProofRequest | null> {
  const [row] = await deps.db.select().from(s.proofRequests)
    .where(and(
      eq(s.proofRequests.contactId, contactId),
      eq(s.proofRequests.status, "issued"),
      gt(s.proofRequests.expiresAt, clock(deps)),
    ))
    .orderBy(desc(s.proofRequests.issuedAt)).limit(1);
  return row ?? null;
}

export type LinkProblem = "not_found" | "used" | "expired";

// Finds the request behind a link token. An issued request past its expiry is marked expired here.
export async function findByToken(
  deps: ProofDeps,
  token: string,
): Promise<{ request: ProofRequest } | { problem: LinkProblem }> {
  if (!isWellFormedToken(token)) return { problem: "not_found" };
  const [request] = await deps.db.select().from(s.proofRequests).where(eq(s.proofRequests.tokenHash, hashToken(token)));
  if (!request) return { problem: "not_found" };
  if (request.status === "used") return { problem: "used" };
  if (request.status !== "issued") return { problem: "expired" };
  if (request.expiresAt <= clock(deps)) {
    await deps.db.update(s.proofRequests).set({ status: proofRequestMachine.transition("issued", "expired") })
      .where(and(eq(s.proofRequests.id, request.id), eq(s.proofRequests.status, "issued")));
    return { problem: "expired" };
  }
  return { request };
}

const INSTRUCTIONS: Record<Purpose, ProofCapture["instructions"]> = {
  delivery: {
    en: "Write this code on paper or on the delivered goods. Take one photo at the site that shows the code and the delivery.",
    sw: "Andika nambari hii kwenye karatasi au kwenye mzigo uliofika. Piga picha moja ukiwa eneo la ujenzi inayoonyesha nambari na mzigo.",
  },
  progress: {
    en: "Write this code on paper. Take one photo at the site that shows the code and the finished work.",
    sw: "Andika nambari hii kwenye karatasi. Piga picha moja ukiwa eneo la ujenzi inayoonyesha nambari na kazi iliyokamilika.",
  },
};

// What the phone capture page shows for a link.
export async function captureView(deps: ProofDeps, token: string): Promise<{ capture: ProofCapture } | { problem: LinkProblem }> {
  const found = await findByToken(deps, token);
  if ("problem" in found) return found;
  const { request } = found;
  const [milestone] = await deps.db.select({ name: s.milestones.name }).from(s.milestones).where(eq(s.milestones.id, request.milestoneId));
  return {
    capture: {
      code: request.code,
      purpose: request.purpose,
      milestoneName: milestone.name,
      instructions: INSTRUCTIONS[request.purpose],
      expiresAt: request.expiresAt.toISOString(),
    },
  };
}

export type ProofInput = {
  proofId: string;
  source: Source;
  blobPath: string;
  contentType: string;
  sizeBytes: number;
  dhash: string;
  capture?: { lat: number; lng: number; accuracyM: number | null } | null;
  clientTime?: Date | null;
};

// Stores a proof against its request and marks the request used, in one transaction holding the
// request's row. Returns the problem instead if the link was used or expired in the meantime.
export async function recordProof(
  deps: ProofDeps,
  proofRequestId: string,
  input: ProofInput,
): Promise<{ proofId: string } | { problem: Exclude<LinkProblem, "not_found"> }> {
  const now = clock(deps);
  return deps.db.transaction(async (tx) => {
    const [request] = await tx.select().from(s.proofRequests).where(eq(s.proofRequests.id, proofRequestId)).for("update");
    if (request.status === "used") return { problem: "used" as const };
    if (request.status !== "issued") return { problem: "expired" as const };
    if (request.expiresAt <= now) {
      await tx.update(s.proofRequests).set({ status: proofRequestMachine.transition("issued", "expired") })
        .where(eq(s.proofRequests.id, request.id));
      return { problem: "expired" as const };
    }

    await tx.insert(s.proofs).values({
      id: input.proofId,
      projectId: request.projectId,
      proofRequestId: request.id,
      source: input.source,
      blobPath: input.blobPath,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      dhash: input.dhash,
      captureLat: input.capture?.lat ?? null,
      captureLng: input.capture?.lng ?? null,
      accuracyM: input.capture?.accuracyM ?? null,
      clientTime: input.clientTime ?? null,
      receivedAt: now,
    });
    await tx.update(s.proofRequests)
      .set({ status: proofRequestMachine.transition(request.status, "proof_received"), usedAt: now })
      .where(eq(s.proofRequests.id, request.id));
    await writeProofAudit(tx, request, input, now);
    return { proofId: input.proofId };
  });
}

async function writeProofAudit(tx: Tx, request: ProofRequest, input: ProofInput, now: Date) {
  const [payment] = request.paymentId
    ? await tx.select({ requestId: s.payments.requestId }).from(s.payments).where(eq(s.payments.id, request.paymentId))
    : [];
  const minutes = Math.max(0, Math.round((now.getTime() - request.issuedAt.getTime()) / 60_000));
  const where = input.capture ? "with its location" : "without a location yet";
  const via = input.source === "capture_page" ? "the proof link" : "WhatsApp";
  await tx.insert(s.auditEvents).values({
    projectId: request.projectId,
    kind: "proof",
    action: "proof.received",
    description: `Proof photo for code ${request.code} received through ${via}, ${where}, ${minutes} min after the code was sent.`,
    actor: request.contactId ? `contact:${request.contactId}` : "system",
    requestId: payment?.requestId ?? null,
    paymentId: request.paymentId,
    proofId: input.proofId,
    milestoneId: request.milestoneId,
    data: { proofRequestId: request.id, source: input.source, dhash: input.dhash },
  });
}
