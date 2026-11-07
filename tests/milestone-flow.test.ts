// Day 13: the milestone flow, on an in-memory Postgres with a fake Twilio sender. The foreman says
// DONE and gets a code to prove the milestone in progress.

import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { isDoneKeyword } from "@/server/proofs/codes";
import { findContactById, type InboundMessage, processInbound, type IntakeDeps } from "@/server/whatsapp/intake";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const LINK_BASE = "https://tryhakika.vercel.app";
const PETER_PHONE = "whatsapp:+15550000001";

let sent: { to: string; body: string }[];

const milestone = async (id = "m2") => (await db.select().from(s.milestones).where(eq(s.milestones.id, id)))[0];
const progressRequests = () => db.select().from(s.proofRequests)
  .where(and(eq(s.proofRequests.milestoneId, "m2"), eq(s.proofRequests.purpose, "progress"))).orderBy(asc(s.proofRequests.issuedAt));
const outbound = (templateKey: string) => db.select().from(s.messages)
  .where(and(eq(s.messages.direction, "outbound"), eq(s.messages.templateKey, templateKey))).orderBy(asc(s.messages.createdAt));
const tokenIn = (body: string) => body.match(/\/proof\/([A-Za-z0-9_-]{43})/)?.[1];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  vi.stubEnv("PROOF_LINK_BASE_URL", LINK_BASE);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await db.delete(s.messages);
  await resetDemo(db);
  sent = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the foreman's DONE reply", () => {
  const intakeDeps = (): IntakeDeps => ({
    db,
    loadMedia: vi.fn(),
    storeMedia: vi.fn(),
    send: vi.fn(async (to: string, body: string) => {
      sent.push({ to, body });
      return `SM${sent.length}`;
    }),
  });
  const text = (body: string): InboundMessage => ({
    channel: "whatsapp", kind: "text", text: body, replyTo: PETER_PHONE, twilioSid: `SM-in-${Math.random()}`,
  } as InboundMessage);

  it("matches DONE and IMEKAMILIKA exactly, and nothing longer", () => {
    for (const word of ["DONE", "done.", " Imekamilika! "]) expect(isDoneKeyword(word)).toBe(true);
    for (const word of ["done now", "is it done", "", undefined]) expect(isDoneKeyword(word)).toBe(false);
  });

  it("sends a progress code for the milestone in progress and makes it wait for proof", async () => {
    const peter = (await findContactById(db, DEMO.contactIds.peter))!;
    await processInbound(intakeDeps(), peter, text("done"));

    const [request] = await progressRequests();
    expect(request).toMatchObject({ purpose: "progress", status: "issued", paymentId: null, contactId: DEMO.contactIds.peter });
    expect((await milestone()).status).toBe("awaiting_proof");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain(`kwa Foundation ni ${request.code}`); // Peter's language is Swahili
    const [stored] = await outbound("proof_request");
    expect(stored.body).toContain("/proof/[link hidden]");
    expect(stored.body).not.toContain(tokenIn(sent[0].body)!);
  });

  it("answers no_milestone_due to anyone but a foreman, and when nothing is in progress", async () => {
    const otieno = (await findContactById(db, DEMO.contactIds.otieno))!;
    await processInbound(intakeDeps(), otieno, text("DONE"));
    await db.update(s.milestones).set({ status: "planned" }).where(eq(s.milestones.id, "m2"));
    const peter = (await findContactById(db, DEMO.contactIds.peter))!;
    await processInbound(intakeDeps(), peter, text("DONE"));

    expect(await progressRequests()).toEqual([]);
    expect(await outbound("no_milestone_due")).toHaveLength(2);
  });
});
