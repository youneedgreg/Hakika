// Voice note translation against a fake Groq, using the segment fields from Groq's published example
// (https://console.groq.com/docs/speech-to-text). No real calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationFailed, translateVoiceNote } from "@/server/ai/translate";
import type { MediaFile } from "@/server/whatsapp/media";

const voice: MediaFile = { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/ogg", extension: "ogg" };

const segment = (overrides: Record<string, number> = {}) => ({
  id: 8, seek: 3000, start: 43.92, end: 50.16,
  text: " We need ten bags of cement.",
  tokens: [51061],
  temperature: 0,
  avg_logprob: -0.097569615,
  compression_ratio: 1.6637554,
  no_speech_prob: 0.012814695,
  ...overrides,
});

const answer = (text: string, segments: unknown[] = [segment()]) =>
  new Response(JSON.stringify({ task: "translate", language: "English", duration: 6.24, text, segments }));

const fakeGroq = (...responses: Response[]) => {
  const fetchFn = vi.fn<typeof fetch>();
  for (const response of responses) fetchFn.mockResolvedValueOnce(response);
  return fetchFn;
};

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a clear voice note", () => {
  it("comes back as trimmed English text with its quality", async () => {
    const result = await translateVoiceNote(voice, { fetchFn: fakeGroq(answer(" We need ten bags of cement. ")) });
    expect(result).toMatchObject({
      outcome: "translated",
      text: "We need ten bags of cement.",
      model: "whisper-large-v3",
      quality: { durationSeconds: 6.24 },
    });
  });

  it("sends the file to the translations endpoint with the key and model", async () => {
    const fetchFn = fakeGroq(answer("Ten bags."));
    await translateVoiceNote(voice, { fetchFn });

    const [url, init] = fetchFn.mock.calls[0];
    const form = init?.body as FormData;
    expect(url).toBe("https://api.groq.com/openai/v1/audio/translations");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key" });
    expect(form.get("model")).toBe("whisper-large-v3");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("prompt")).toContain("Mifuko means bags.");
    expect((form.get("file") as File).name).toBe("voice.ogg");
    expect((form.get("file") as File).size).toBe(3);
  });
});

describe("a voice note that can't be used", () => {
  it("is empty when nothing came back", async () => {
    const result = await translateVoiceNote(voice, { fetchFn: fakeGroq(answer("   ", [])) });
    expect(result).toMatchObject({ outcome: "unreadable", reason: "empty" });
  });

  it("isn't speech when the no-speech probability is high", async () => {
    const result = await translateVoiceNote(voice, {
      fetchFn: fakeGroq(answer("Thank you.", [segment({ no_speech_prob: 0.9 })])),
    });
    expect(result).toMatchObject({ outcome: "unreadable", reason: "no_speech" });
  });

  it("is garbled when confidence is very low", async () => {
    const result = await translateVoiceNote(voice, {
      fetchFn: fakeGroq(answer("Something odd.", [segment({ avg_logprob: -1.4 })])),
    });
    expect(result).toMatchObject({ outcome: "unreadable", reason: "garbled" });
  });

  it("isn't sunk by one short bad segment in a long clear message", async () => {
    const result = await translateVoiceNote(voice, {
      fetchFn: fakeGroq(answer("Ten bags of cement.", [
        segment({ start: 0, end: 20 }),
        segment({ start: 20, end: 21, avg_logprob: -3, no_speech_prob: 0.95 }),
      ])),
    });
    expect(result.outcome).toBe("translated");
  });

  it("isn't sent when Groq can't read its format", async () => {
    const fetchFn = fakeGroq();
    const result = await translateVoiceNote({ ...voice, contentType: "audio/amr", extension: "amr" }, { fetchFn });
    expect(result).toEqual({ outcome: "unreadable", reason: "unsupported_format" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("when Groq fails", () => {
  const limited = (retryAfter?: string) =>
    new Response("{}", { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });

  it("waits as long as Groq asks, then retries a 429", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await translateVoiceNote(voice, { fetchFn: fakeGroq(limited("2"), answer("Ten bags.")), sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result.outcome).toBe("translated");
  });

  it("backs off on a server error when no wait is given", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchFn = fakeGroq(new Response("", { status: 503 }), new Response("", { status: 503 }), answer("Ten bags."));
    await translateVoiceNote(voice, { fetchFn, sleep });
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it("gives up after two retries", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchFn = fakeGroq(limited("1"), limited("1"), limited("1"));
    await expect(translateVoiceNote(voice, { fetchFn, sleep })).rejects.toThrow("HTTP 429");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("doesn't wait out a daily limit", async () => {
    const sleep = vi.fn();
    await expect(translateVoiceNote(voice, { fetchFn: fakeGroq(limited("3600")), sleep })).rejects.toThrow(TranslationFailed);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("doesn't retry a request Groq rejects", async () => {
    const fetchFn = fakeGroq(new Response("", { status: 400 }));
    await expect(translateVoiceNote(voice, { fetchFn })).rejects.toThrow("HTTP 400");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer in the wrong shape", async () => {
    await expect(translateVoiceNote(voice, { fetchFn: fakeGroq(new Response("{\"nope\":1}")) }))
      .rejects.toThrow("expected shape");
  });

  it("needs the key", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(translateVoiceNote(voice, { fetchFn: fakeGroq() })).rejects.toThrow("GROQ_API_KEY");
  });
});
