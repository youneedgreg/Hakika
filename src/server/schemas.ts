// Request body schemas. Objects are strict: unknown fields are rejected, so a browser can't
// slip in an amount or a total (the server computes every amount from the database).

import { z } from "zod";

const reason = z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500);
const id = z.string().trim().min(1).max(100);

export const declineSchema = z.strictObject({ reason });

// A request (materials) or a milestone (labour); never an amount.
export const createOrderSchema = z.union([z.strictObject({ requestId: id }), z.strictObject({ milestoneId: id })]);

export const overrideSchema = z.strictObject({ reason });

export const chatSchema = z.strictObject({
  projectId: id,
  question: z.string().trim().min(1).max(1000),
});

export const simulateSchema = z.strictObject({
  projectId: id,
  from: z.enum(["peter", "otieno", "grace"]),
  kind: z.enum(["text", "image", "voice", "location"]),
  text: z.string().max(2000).optional(),
  mediaUrl: z.url().optional(),
  location: z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
});

export const resetSchema = z.strictObject({ projectId: id });

export const runScenarioSchema = z.strictObject({ projectId: id });

// GET /api/judge/chat's query string.
export const judgeChatQuerySchema = z.strictObject({
  projectId: id,
  after: z.iso.datetime({ offset: true }).optional(),
});

// Text fields of the multipart proof upload (the image is checked separately).
export const proofFieldsSchema = z.strictObject({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0),
  clientTime: z.iso.datetime(),
});
