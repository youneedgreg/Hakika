// Amazon Nova on Bedrock, the only reading model. It reads and compares; nothing it returns can move
// money. Only demo data goes to it. The IAM user behind these keys may only invoke Nova.

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LanguageModel } from "ai";

export function novaModel(): LanguageModel {
  const {
    BEDROCK_REGION: region,
    BEDROCK_MODEL_ID: modelId,
    BEDROCK_ACCESS_KEY_ID: accessKeyId,
    BEDROCK_SECRET_ACCESS_KEY: secretAccessKey,
  } = process.env;
  if (!region || !modelId || !accessKeyId || !secretAccessKey) {
    throw new Error("BEDROCK_REGION, BEDROCK_MODEL_ID, BEDROCK_ACCESS_KEY_ID and BEDROCK_SECRET_ACCESS_KEY must be set.");
  }
  return createAmazonBedrock({ region, accessKeyId, secretAccessKey })(modelId);
}

// The items Hakika has a reference for. The model picks from these; code checks that it did.
export type CatalogItem = { itemKey: string; description: string; unit: string };

export function catalogForPrompt(catalog: CatalogItem[]): string {
  return catalog.map((item) => `- ${item.itemKey}: ${item.description}, sold per ${item.unit}`).join("\n");
}

export function knownItemKey(catalog: CatalogItem[], itemKey: string | null): string | null {
  return catalog.some((item) => item.itemKey === itemKey) ? itemKey : null;
}

// A quote often leaves the unit out ("Cement 50kg 50 x 950"). A matched item's unit is the catalog's;
// a unit that is written stays as written, so the price check can see when it differs.
export function unitFor(catalog: CatalogItem[], itemKey: string | null, written: string | null): string {
  return written?.trim() || catalog.find((item) => item.itemKey === itemKey)?.unit || "";
}

export type NovaUsage = { inputTokens?: number; outputTokens?: number };
