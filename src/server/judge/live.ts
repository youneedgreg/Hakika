// Judge Mode's real connections, for the API routes: the database, private Blob storage, the daily
// exchange rate and the committed recordings. Tests pass fakes instead.

import { getDb } from "@/server/db/client";
import type { DemoPayees } from "@/server/db/demo";
import { getDailyRate } from "@/server/pricing/fx";
import { readStoredPhoto } from "@/server/proofs/live";
import { proofLinkBase } from "@/server/proofs/whatsapp";
import { storeMedia } from "@/server/whatsapp/live";
import { readJudgeMedia } from "./media";
import recordings from "./recordings.json";
import { type JudgeRecordings, replayModels } from "./replay";
import type { JudgeDeps } from "./scenarios";

export function liveJudgeDeps(origin: string): JudgeDeps {
  const db = getDb();
  return {
    db,
    models: replayModels(recordings as JudgeRecordings),
    readMedia: (name) => readJudgeMedia(name),
    storeMedia,
    readPhoto: readStoredPhoto,
    rate: () => getDailyRate(db),
    linkBase: proofLinkBase() ?? origin,
  };
}

// PayPal sandbox emails come from the environment, never from the repo.
export function demoPayees(): DemoPayees {
  return {
    mlima: process.env.PAYPAL_SANDBOX_SUPPLIER_MLIMA,
    kiawara: process.env.PAYPAL_SANDBOX_SUPPLIER_KIAWARA,
    otieno: process.env.PAYPAL_SANDBOX_FUNDI_OTIENO,
  };
}

// A simulated message's ID, as newId makes it.
export function isWellFormedMessageId(id: string): boolean {
  return /^msg_[A-Za-z0-9_-]{16}$/.test(id);
}
