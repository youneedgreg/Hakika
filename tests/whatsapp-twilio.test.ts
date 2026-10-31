// Twilio's signature check, form parsing and media rules, plus the webhook and simulator routes.

import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as simulate } from "@/app/api/judge/simulate/route";
import { POST as webhook } from "@/app/api/webhooks/twilio/route";
import { MAX_MEDIA_BYTES, readMediaResponse } from "@/server/whatsapp/media";
import { renderTemplate } from "@/server/whatsapp/templates";
import {
  fetchTwilioMedia, isValidTwilioSignature, parseTwilioMessage, sendWhatsApp,
} from "@/server/whatsapp/twilio";

const scheduled = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (work: () => unknown) => scheduled.push(work),
}));

const URL_ = "https://hakika.example/api/webhooks/twilio";
const TOKEN = "test-auth-token";

function sign(params: Record<string, string>, url = URL_, token = TOKEN) {
  const text = Object.keys(params).sort().reduce((all, name) => all + name + params[name], url);
  return createHmac("sha1", token).update(text).digest("base64");
}

function webhookRequest(params: Record<string, string>, signature?: string) {
  return new NextRequest(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(signature ? { "X-Twilio-Signature": signature } : {}),
    },
    body: new URLSearchParams(params),
  });
}

const textMessage = { MessageSid: "SM1", From: "whatsapp:+254700000999", Body: "Tunahitaji saruji" };

beforeEach(() => {
  scheduled.length = 0;
  vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886");
  vi.stubEnv("TWILIO_WEBHOOK_URL", URL_);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isValidTwilioSignature", () => {
  // The worked example from https://www.twilio.com/docs/usage/security
  const url = "https://example.com/myapp.php?foo=1&bar=2";
  const params = {
    Digits: "1234", To: "+18005551212", From: "+14158675310",
    Caller: "+14158675310", CallSid: "CA1234567890ABCDE",
  };

  it("matches Twilio's published example", () => {
    expect(isValidTwilioSignature("12345", "L/OH5YylLD5NRKLltdqwSvS0BnU=", url, params)).toBe(true);
  });

  it("rejects a wrong token, URL, field or malformed signature", () => {
    const good = "L/OH5YylLD5NRKLltdqwSvS0BnU=";
    expect(isValidTwilioSignature("54321", good, url, params)).toBe(false);
    expect(isValidTwilioSignature("12345", good, `${url}&x=1`, params)).toBe(false);
    expect(isValidTwilioSignature("12345", good, url, { ...params, Digits: "9999" })).toBe(false);
    expect(isValidTwilioSignature("12345", "short", url, params)).toBe(false);
  });
});

describe("parseTwilioMessage", () => {
  it("reads a text message and strips the whatsapp: prefix", () => {
    expect(parseTwilioMessage(textMessage)).toEqual({
      twilioSid: "SM1", from: "+254700000999", kind: "text", text: "Tunahitaji saruji", unsupported: false,
    });
  });

  it("reads photos with captions and voice notes", () => {
    const media = { ...textMessage, Body: "Quote", NumMedia: "1", MediaUrl0: "https://api.twilio.com/m" };
    expect(parseTwilioMessage({ ...media, MediaContentType0: "image/jpeg" })).toMatchObject({
      kind: "image", text: "Quote", media: { url: "https://api.twilio.com/m" }, unsupported: false,
    });
    expect(parseTwilioMessage({ ...media, Body: "", MediaContentType0: "audio/ogg" })).toMatchObject({
      kind: "voice", media: { url: "https://api.twilio.com/m" },
    });
  });

  it("reads a location pin and refuses impossible coordinates", () => {
    const pin = { MessageSid: "SM2", From: "whatsapp:+254700000999", Body: "" };
    expect(parseTwilioMessage({ ...pin, Latitude: "-0.42", Longitude: "36.94" })).toMatchObject({
      kind: "location", location: { lat: -0.42, lng: 36.94 }, unsupported: false,
    });
    expect(parseTwilioMessage({ ...pin, Latitude: "95", Longitude: "36.94" })).toMatchObject({ unsupported: true });
  });

  it("marks files and empty messages it can't read", () => {
    const video = parseTwilioMessage({
      ...textMessage, NumMedia: "1", MediaUrl0: "https://api.twilio.com/m", MediaContentType0: "video/mp4",
    });
    expect(video).toMatchObject({ unsupported: true });
    expect(video?.media).toBeUndefined();
    expect(parseTwilioMessage({ ...textMessage, Body: "" })).toMatchObject({ unsupported: true });
  });

  it("returns null for anything that is not an inbound WhatsApp message", () => {
    expect(parseTwilioMessage({ MessageSid: "SM3", From: "+254700000999", Body: "SMS" })).toBeNull();
    expect(parseTwilioMessage({ From: "whatsapp:+254700000999" })).toBeNull();
  });
});

describe("POST /api/webhooks/twilio", () => {
  it("rejects a missing or wrong signature and schedules nothing", async () => {
    expect((await webhook(webhookRequest(textMessage))).status).toBe(403);
    expect((await webhook(webhookRequest(textMessage, sign(textMessage, URL_, "wrong")))).status).toBe(403);
    expect(scheduled).toHaveLength(0);
  });

  it("refuses to run without its configuration", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    expect((await webhook(webhookRequest(textMessage, sign(textMessage)))).status).toBe(500);
    expect(scheduled).toHaveLength(0);
  });

  it("answers at once with empty TwiML and leaves the work for after the response", async () => {
    const res = await webhook(webhookRequest(textMessage, sign(textMessage)));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(await res.text()).toBe("<Response/>");
    expect(scheduled).toHaveLength(1);
  });

  it("signs the configured URL, not the one the request arrived on", async () => {
    const internal = new NextRequest("https://internal.vercel.example/api/webhooks/twilio", {
      method: "POST",
      headers: { "X-Twilio-Signature": sign(textMessage) },
      body: new URLSearchParams(textMessage),
    });
    expect((await webhook(internal)).status).toBe(200);
  });
});

describe("POST /api/judge/simulate", () => {
  const post = (body: unknown) => new NextRequest("https://hakika.example/api/judge/simulate", {
    method: "POST", body: JSON.stringify(body),
  });
  const base = { projectId: "demo-nyeri", from: "peter" };

  it("accepts a message for the pipeline without the mock header", async () => {
    const res = await simulate(post({ ...base, kind: "text", text: "Tunahitaji saruji" }));
    expect(res.status).toBe(202);
    expect(res.headers.get("x-hakika-mock")).toBeNull();
    expect((await res.json()).messageId).toMatch(/^msg_/);
    expect(scheduled).toHaveLength(1);
  });

  it("only fetches media from the app's own origin", async () => {
    const outside = await simulate(post({ ...base, kind: "image", mediaUrl: "http://169.254.169.254/latest" }));
    expect(outside.status).toBe(400);
    expect(scheduled).toHaveLength(0);
    const own = await simulate(post({ ...base, kind: "image", mediaUrl: "https://hakika.example/judge/quote.jpg" }));
    expect(own.status).toBe(202);
  });

  it("refuses a project other than the demo", async () => {
    expect((await simulate(post({ ...base, projectId: "other", kind: "text", text: "hi" }))).status).toBe(404);
  });
});

describe("Twilio calls", () => {
  it("sends a WhatsApp message with the sandbox sender", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => Response.json({ sid: "SMout" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendWhatsApp("+254700000999", "Hello")).toBe("SMout");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      From: "whatsapp:+14155238886", To: "whatsapp:+254700000999", Body: "Hello",
    });
  });

  it("keeps the phone number out of the error when Twilio refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 63015 }, { status: 400 })));
    const error = await sendWhatsApp("+254700000999", "Hello").catch((e: Error) => e);
    expect((error as Error).message).toContain("63015");
    expect((error as Error).message).not.toContain("254700000999");
  });

  it("never sends the credentials to a host other than Twilio's API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTwilioMedia("https://evil.example/media")).rejects.toThrow("api.twilio.com");
    await expect(fetchTwilioMedia("http://api.twilio.com/media")).rejects.toThrow("api.twilio.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("media and templates", () => {
  const response = (type: string, size = 3) =>
    new Response(new Uint8Array(size), { headers: { "Content-Type": type } });

  it("accepts expected photos and voice notes, including codec parameters", async () => {
    expect((await readMediaResponse(response("image/jpeg"))).extension).toBe("jpg");
    expect(await readMediaResponse(response("audio/ogg; codecs=opus"))).toMatchObject({
      contentType: "audio/ogg", extension: "ogg",
    });
  });

  it("rejects other file types and oversized files", async () => {
    await expect(readMediaResponse(response("image/svg+xml"))).rejects.toThrow("Unsupported");
    await expect(readMediaResponse(response("image/png", MAX_MEDIA_BYTES + 1))).rejects.toThrow("too large");
  });

  it("has every template in both languages", () => {
    for (const key of ["request_received", "needs_info"] as const) {
      expect(renderTemplate(key, "en")).toMatch(/^Hakika:/);
      expect(renderTemplate(key, "sw")).toMatch(/^Hakika:/);
      expect(renderTemplate(key, "en")).not.toBe(renderTemplate(key, "sw"));
    }
  });
});
