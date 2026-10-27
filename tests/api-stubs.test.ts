// The stub API routes: right shapes, right status codes, and the money rule (the browser
// can't send an amount). Handlers are called directly, without a server.

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET as getProject } from "@/app/api/projects/[id]/route";
import { GET as getOverview } from "@/app/api/projects/[id]/overview/route";
import { GET as getGantt } from "@/app/api/projects/[id]/gantt/route";
import { GET as getRequest } from "@/app/api/requests/[id]/route";
import { POST as declineRequest } from "@/app/api/requests/[id]/decline/route";
import { POST as createOrder } from "@/app/api/payments/orders/route";
import { POST as captureOrder } from "@/app/api/payments/orders/[orderId]/capture/route";
import { GET as getProofLink, POST as uploadProof } from "@/app/api/proof/[token]/route";
import { GET as getProof } from "@/app/api/proofs/[id]/route";
import { POST as overrideProof } from "@/app/api/proofs/[id]/override/route";
import { POST as chat } from "@/app/api/agent/chat/route";
import { GET as getLedger } from "@/app/api/ledger/route";
import { POST as simulate } from "@/app/api/judge/simulate/route";
import { POST as reset } from "@/app/api/judge/reset/route";
import { POST as twilioWebhook } from "@/app/api/webhooks/twilio/route";
import { POST as paypalWebhook } from "@/app/api/webhooks/paypal/route";
import {
  DEMO_PROJECT_ID, DEMO_PROOF_IDS, DEMO_PROOF_TOKEN, DEMO_REQUEST_ID,
} from "@/server/mocks/demo";

const BASE = "http://localhost:3000";

function get(path: string) {
  return new NextRequest(`${BASE}${path}`);
}

function post(path: string, body: unknown) {
  return new NextRequest(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Route contexts are built by Next.js at runtime; in tests we pass the params ourselves.
function ctx<P extends Record<string, string>>(params: P) {
  return { params: Promise.resolve(params) };
}

describe("project routes", () => {
  it("returns the demo project, overview and Gantt", async () => {
    const project = await getProject(get(`/api/projects/${DEMO_PROJECT_ID}`), ctx({ id: DEMO_PROJECT_ID }));
    expect(project.status).toBe(200);
    expect(project.headers.get("x-hakika-mock")).toBe("1");
    expect((await project.json()).milestones).toHaveLength(5);

    const overview = await getOverview(get("/x"), ctx({ id: DEMO_PROJECT_ID }));
    expect((await overview.json()).approvals[0].requestId).toBe(DEMO_REQUEST_ID);

    const gantt = await (await getGantt(get("/x"), ctx({ id: DEMO_PROJECT_ID }))).json();
    const taskIds = new Set(gantt.tasks.map((t: { id: string }) => t.id));
    for (const d of gantt.dependencies) {
      expect(taskIds.has(d.fromTask) && taskIds.has(d.toTask)).toBe(true);
    }
  });

  it("returns 404 with an error body for an unknown project", async () => {
    const res = await getProject(get("/api/projects/nope"), ctx({ id: "nope" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Project not found." } });
  });
});

describe("request routes", () => {
  it("returns the approval card with its findings", async () => {
    const card = await (await getRequest(get("/x"), ctx({ id: DEMO_REQUEST_ID }))).json();
    expect(card.status).toBe("awaiting_approval");
    expect(card.findings.map((f: { type: string }) => f.type)).toContain("price_above_market");
  });

  it("needs a reason to decline", async () => {
    const bad = await declineRequest(post("/x", { reason: "" }), ctx({ id: DEMO_REQUEST_ID }));
    expect(bad.status).toBe(400);
    const ok = await declineRequest(post("/x", { reason: "Too expensive" }), ctx({ id: DEMO_REQUEST_ID }));
    expect(await ok.json()).toEqual({ requestId: DEMO_REQUEST_ID, status: "declined" });
  });
});

describe("payment routes", () => {
  it("creates an order from the request ID alone", async () => {
    const res = await createOrder(post("/api/payments/orders", { requestId: DEMO_REQUEST_ID }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ orderId: "MOCK0RDER00000003" });
  });

  it("rejects a body that tries to set the amount", async () => {
    for (const extra of [{ amount: "1.00" }, { total: { amount: "1.00", currency: "USD" } }, { payee: "x@example.com" }]) {
      const res = await createOrder(post("/api/payments/orders", { requestId: DEMO_REQUEST_ID, ...extra }));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_body");
    }
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await createOrder(post("/api/payments/orders", "not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
  });

  it("captures the mock order and 404s anything else", async () => {
    const ok = await captureOrder(post("/x", {}), ctx({ orderId: "MOCK0RDER00000003" }));
    expect((await ok.json()).status).toBe("paid");
    const missing = await captureOrder(post("/x", {}), ctx({ orderId: "OTHER" }));
    expect(missing.status).toBe(404);
  });
});

describe("proof routes", () => {
  it("serves the capture page data in English and Swahili", async () => {
    const data = await (await getProofLink(get("/x"), ctx({ token: DEMO_PROOF_TOKEN }))).json();
    expect(data.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(data.instructions.en).toBeTruthy();
    expect(data.instructions.sw).toBeTruthy();
    const unknown = await getProofLink(get("/x"), ctx({ token: "guess" }));
    expect(unknown.status).toBe(404);
  });

  function upload(fields: Record<string, string>, image?: File) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (image) form.set("image", image);
    return new NextRequest(`${BASE}/api/proof/${DEMO_PROOF_TOKEN}`, { method: "POST", body: form });
  }
  const fields = { latitude: "-0.4201", longitude: "36.9476", accuracy: "12", clientTime: "2026-10-24T10:12:00Z" };
  const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "proof.jpg", { type: "image/jpeg" });

  it("accepts a photo with location and time", async () => {
    const res = await uploadProof(upload(fields, photo), ctx({ token: DEMO_PROOF_TOKEN }));
    expect(res.status).toBe(201);
  });

  it("rejects a missing photo, a non-image and bad coordinates", async () => {
    expect((await uploadProof(upload(fields), ctx({ token: DEMO_PROOF_TOKEN }))).status).toBe(400);
    const pdf = new File(["%PDF"], "x.pdf", { type: "application/pdf" });
    expect((await uploadProof(upload(fields, pdf), ctx({ token: DEMO_PROOF_TOKEN }))).status).toBe(415);
    const far = { ...fields, latitude: "123" };
    expect((await uploadProof(upload(far, photo), ctx({ token: DEMO_PROOF_TOKEN }))).status).toBe(400);
  });

  it("returns both proof reviews with consistent outcomes", async () => {
    const verified = await (await getProof(get("/x"), ctx({ id: DEMO_PROOF_IDS.verified }))).json();
    expect(verified.outcome).toBe("verified");
    expect(verified.checks.every((c: { result: string }) => c.result === "pass")).toBe(true);

    const suspicious = await (await getProof(get("/x"), ctx({ id: DEMO_PROOF_IDS.suspicious }))).json();
    expect(suspicious.outcome).toBe("suspicious");
    expect(suspicious.checks.some((c: { hard: boolean; result: string }) => c.hard && c.result === "fail")).toBe(true);
  });

  it("doesn't treat object built-ins as proof IDs", async () => {
    const res = await getProof(get("/x"), ctx({ id: "constructor" }));
    expect(res.status).toBe(404);
  });

  it("needs a reason to override", async () => {
    const bad = await overrideProof(post("/x", {}), ctx({ id: DEMO_PROOF_IDS.suspicious }));
    expect(bad.status).toBe(400);
    const ok = await overrideProof(post("/x", { reason: "I visited the site myself" }), ctx({ id: DEMO_PROOF_IDS.suspicious }));
    expect((await ok.json()).overridden).toBe(true);
  });
});

describe("ledger, agent and Judge Mode routes", () => {
  it("returns ledger rows as JSON and CSV", async () => {
    const json = await (await getLedger(get(`/api/ledger?projectId=${DEMO_PROJECT_ID}`))).json();
    expect(json.rows.length).toBeGreaterThan(0);

    const csv = await getLedger(get(`/api/ledger?projectId=${DEMO_PROJECT_ID}&format=csv`));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toBe("at,kind,description,amount,currency,amount_usd,paypal_order_id,paypal_capture_id,request_id,proof_id");
    expect(lines).toHaveLength(json.rows.length + 1);

    expect((await getLedger(get("/api/ledger"))).status).toBe(400);
  });

  it("answers Ask Hakika with citations", async () => {
    const res = await chat(post("/x", { projectId: DEMO_PROJECT_ID, question: "Why was the foundation payment held?" }));
    const body = await res.json();
    expect(body.answer).toContain("held");
    expect(body.citations[0].href).toContain(DEMO_PROOF_IDS.suspicious);
  });

  it("accepts simulated messages and checks what each kind needs", async () => {
    const ok = await simulate(post("/x", { projectId: DEMO_PROJECT_ID, from: "peter", kind: "text", text: "Tunahitaji saruji" }));
    expect(ok.status).toBe(202);
    const noText = await simulate(post("/x", { projectId: DEMO_PROJECT_ID, from: "peter", kind: "text" }));
    expect(noText.status).toBe(400);
    const stranger = await simulate(post("/x", { projectId: DEMO_PROJECT_ID, from: "mallory", kind: "text", text: "hi" }));
    expect(stranger.status).toBe(400);
  });

  it("resets the demo project", async () => {
    const res = await reset(post("/x", { projectId: DEMO_PROJECT_ID }));
    expect(await res.json()).toEqual({ projectId: DEMO_PROJECT_ID, reset: true });
  });
});

describe("webhooks", () => {
  it("answer 501 until they are built", async () => {
    expect((await twilioWebhook()).status).toBe(501);
    expect((await paypalWebhook()).status).toBe(501);
  });
});
