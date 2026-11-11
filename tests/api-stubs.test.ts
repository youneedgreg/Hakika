// The stub API routes: right shapes, right status codes, and the money rule (the browser
// can't send an amount). Handlers are called directly, without a server.

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { GET as getProject } from "@/app/api/projects/[id]/route";
import { GET as getRequest } from "@/app/api/requests/[id]/route";
import { POST as declineRequest } from "@/app/api/requests/[id]/decline/route";
import { POST as createOrder } from "@/app/api/payments/orders/route";
import { POST as captureOrder } from "@/app/api/payments/orders/[orderId]/capture/route";
import { GET as getPayPalConfig } from "@/app/api/payments/config/route";
import { GET as getProofLink, POST as uploadProof } from "@/app/api/proof/[token]/route";
import { GET as getProof } from "@/app/api/proofs/[id]/route";
import { GET as getProofImage } from "@/app/api/proofs/[id]/image/route";
import { POST as overrideProof } from "@/app/api/proofs/[id]/override/route";
import { POST as chat } from "@/app/api/agent/chat/route";
import { GET as getLedger } from "@/app/api/ledger/route";
import { POST as simulate } from "@/app/api/judge/simulate/route";
import { POST as reset } from "@/app/api/judge/reset/route";
import { POST as runScenarioRoute } from "@/app/api/judge/scenarios/[id]/route";
import { GET as judgeChat } from "@/app/api/judge/chat/route";
import { GET as judgeImage } from "@/app/api/judge/messages/[id]/image/route";
import { POST as paypalWebhook } from "@/app/api/webhooks/paypal/route";
import {
  DEMO_PROJECT_ID, DEMO_PROOF_IDS, DEMO_PROOF_TOKEN, DEMO_REQUEST_ID,
} from "@/server/mocks/demo";

// Handlers run without a server here, so work scheduled for after the response is skipped, and
// connection() (which marks a route as per-request) has no request scope to wait on.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: vi.fn(),
  connection: vi.fn(async () => {}),
}));

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
  it("returns the demo project", async () => {
    const project = await getProject(get(`/api/projects/${DEMO_PROJECT_ID}`), ctx({ id: DEMO_PROJECT_ID }));
    expect(project.status).toBe(200);
    expect(project.headers.get("x-hakika-mock")).toBe("1");
    expect((await project.json()).milestones).toHaveLength(5);
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

  // Real orders go to the database and PayPal: tests/payments.test.ts.
  it("captures the demo's mock order", async () => {
    const ok = await captureOrder(post("/x", {}), ctx({ orderId: "MOCK0RDER00000003" }));
    expect(ok.headers.get("x-hakika-mock")).toBe("1");
    expect((await ok.json()).status).toBe("paid");
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

  it("refuses malformed proof IDs before touching the database", async () => {
    for (const id of ["prf_short", "prf_../../etc/passwd", DEMO_PROOF_IDS.verified]) {
      expect((await getProofImage(get("/x"), ctx({ id }))).status).toBe(404);
    }
    expect((await getProof(get("/x"), ctx({ id: "prf_short" }))).status).toBe(404);
  });

  it("needs a reason to override", async () => {
    const bad = await overrideProof(post("/x", {}), ctx({ id: DEMO_PROOF_IDS.suspicious }));
    expect(bad.status).toBe(400);
    const ok = await overrideProof(post("/x", { reason: "I visited the site myself" }), ctx({ id: DEMO_PROOF_IDS.suspicious }));
    expect((await ok.json()).overridden).toBe(true);
  });
});

describe("ledger, agent and Judge Mode routes", () => {
  it("asks for a project ID before reading the ledger", async () => {
    // The rows come from the database: tests/payments.test.ts.
    expect((await getLedger(get("/api/ledger"))).status).toBe(400);
  });

  it("asks for a project and a question before Ask Hakika answers", async () => {
    // Answers come from the database and Nova: tests/agent-answer.test.ts.
    expect((await chat(post("/x", { projectId: DEMO_PROJECT_ID }))).status).toBe(400);
    expect((await chat(post("/x", { projectId: DEMO_PROJECT_ID, question: "   " }))).status).toBe(400);
    expect((await chat(post("/x", { projectId: DEMO_PROJECT_ID, question: "x".repeat(1001) }))).status).toBe(400);
  });

  it("accepts simulated messages and checks what each kind needs", async () => {
    const ok = await simulate(post("/x", { projectId: DEMO_PROJECT_ID, from: "peter", kind: "text", text: "Tunahitaji saruji" }));
    expect(ok.status).toBe(202);
    const noText = await simulate(post("/x", { projectId: DEMO_PROJECT_ID, from: "peter", kind: "text" }));
    expect(noText.status).toBe(400);
    const stranger = await simulate(post("/x", { projectId: DEMO_PROJECT_ID, from: "mallory", kind: "text", text: "hi" }));
    expect(stranger.status).toBe(400);
  });

  // The reset, the scenarios and the chat run on the database: tests/judge-mode.test.ts. Here, what
  // each route refuses before it gets there.
  it("refuses a reset of anything but the demo project", async () => {
    expect((await reset(post("/x", {}))).status).toBe(400);
    expect((await reset(post("/x", { projectId: DEMO_PROJECT_ID, extra: 1 }))).status).toBe(400);
    expect((await reset(post("/x", { projectId: "someone-else" }))).status).toBe(404);
  });

  it("runs only Judge Mode's three scenarios, on the demo project", async () => {
    expect((await runScenarioRoute(post("/x", { projectId: DEMO_PROJECT_ID }), ctx({ id: "toString" }))).status).toBe(404);
    expect((await runScenarioRoute(post("/x", { projectId: "someone-else" }), ctx({ id: "recycled-photo" }))).status).toBe(404);
    expect((await runScenarioRoute(post("/x", {}), ctx({ id: "recycled-photo" }))).status).toBe(400);
  });

  it("checks the chat's query before reading it", async () => {
    expect((await judgeChat(get("/api/judge/chat"))).status).toBe(400);
    expect((await judgeChat(get(`/api/judge/chat?projectId=${DEMO_PROJECT_ID}&after=yesterday`))).status).toBe(400);
    expect((await judgeChat(get("/api/judge/chat?projectId=someone-else"))).status).toBe(404);
  });

  it("serves simulator photos only for well-formed message IDs", async () => {
    expect((await judgeImage(get("/x"), ctx({ id: "../whatsapp/x" }))).status).toBe(404);
  });
});

describe("the PayPal webhook", () => {
  const event = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} };

  it("answers 503 until PayPal and the webhook ID are set", async () => {
    vi.stubEnv("PAYPAL_ENV", "sandbox");
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    const res = await paypalWebhook(post("/api/webhooks/paypal", event));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("paypal_webhook_not_configured");
    vi.unstubAllEnvs();
  });

  it("refuses a delivery without PayPal's signature headers, before asking PayPal anything", async () => {
    vi.stubEnv("PAYPAL_ENV", "sandbox");
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH-ID");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await paypalWebhook(post("/api/webhooks/paypal", event));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("the PayPal config (GET /api/payments/config)", () => {
  async function clientIdWith(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const res = await getPayPalConfig();
    vi.unstubAllEnvs();
    expect(res.headers.get("cache-control")).toBe("no-store");
    return (await res.json()).clientId;
  }

  it("gives the public client ID when the sandbox is fully set up, and never the secret", async () => {
    const res = await clientIdWith({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "public-id", PAYPAL_CLIENT_SECRET: "the-secret" });
    expect(res).toBe("public-id");
  });

  it("gives null when the secret is missing or the environment isn't the sandbox", async () => {
    expect(await clientIdWith({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "public-id", PAYPAL_CLIENT_SECRET: "" })).toBeNull();
    expect(await clientIdWith({ PAYPAL_ENV: "live", PAYPAL_CLIENT_ID: "public-id", PAYPAL_CLIENT_SECRET: "the-secret" })).toBeNull();
  });

  it("reads the environment per request, not once at build time", async () => {
    const { connection } = await import("next/server");
    vi.mocked(connection).mockClear();
    await getPayPalConfig();
    expect(connection).toHaveBeenCalledTimes(1);
  });
});
