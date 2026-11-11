// Fixed messages to people on site. The model never writes free text to a foreman, fundi or supplier.
// Fixed English and Swahili copy for owner-approved payments and proof requests.
//
// A {slot} is filled only with values the server takes from the database (an amount, a supplier's
// name), never with model output or anything a message said.

import type { LANGUAGES } from "@/server/db/enums";

type Language = (typeof LANGUAGES)[number];

const TEMPLATES = {
  request_received: {
    en: "Hakika: we received your message. We will get back to you soon.",
    sw: "Hakika: tumepokea ujumbe wako. Tutakujibu hivi karibuni.",
  },
  needs_info: {
    en: "Hakika: we could not read that. Please send a photo, a voice note or a text message.",
    sw: "Hakika: hatukuweza kusoma hilo. Tafadhali tuma picha, ujumbe wa sauti au ujumbe wa maandishi.",
  },
  quote_needed: {
    en: "Hakika: please send a photo of the quote for these materials.",
    sw: "Hakika: tafadhali tuma picha ya nukuu ya bei ya vifaa hivi.",
  },
  // To the foreman who asked for the materials.
  materials_paid_foreman: {
    en: "Hakika: the owner has paid {supplier} {amount} through PayPal for your materials request. {supplier} will arrange the delivery. When it arrives, reply PROOF to get your proof code.",
    sw: "Hakika: mmiliki wa mradi amelipa {supplier} kiasi cha {amount} kupitia PayPal kwa ombi lako la vifaa. {supplier} atapanga usafirishaji. Mzigo ukifika, jibu THIBITISHA upate nambari ya uthibitisho.",
  },
  // To the supplier's own contact.
  materials_paid_supplier: {
    en: "Hakika: {amount} has been paid to {supplier} through PayPal for a materials order. Please arrange the delivery to the site.",
    sw: "Hakika: kiasi cha {amount} kimelipwa kwa {supplier} kupitia PayPal kwa oda ya vifaa. Tafadhali panga usafirishaji hadi eneo la ujenzi.",
  },
  // The one-time code and capture link. {link} is the only place the link's token appears; the copy
  // stored in messages has it hidden.
  proof_request: {
    en: "Hakika: your proof code for {milestone} is {code}. Write it on paper or on the delivered goods, then take the photo at the site with this link: {link} The code expires in 30 minutes. If the link does not open, send the photo here, then share your location.",
    sw: "Hakika: nambari yako ya uthibitisho kwa {milestone} ni {code}. Iandike kwenye karatasi au kwenye mzigo uliofika, kisha piga picha ukiwa eneo la ujenzi kupitia kiungo hiki: {link} Nambari itaisha baada ya dakika 30. Kiungo kisipofunguka, tuma picha hapa WhatsApp, kisha tuma eneo ulipo.",
  },
  // A proof photo sent in the chat (for people who can't open the link), with no location pin yet.
  proof_photo_received: {
    en: "Hakika: we received your proof photo. Please share your location now.",
    sw: "Hakika: tumepokea picha yako ya uthibitisho. Tafadhali tuma mahali ulipo sasa.",
  },
  // A proof photo sent in the chat just after a location pin.
  proof_photo_and_location_received: {
    en: "Hakika: we received your proof photo and your location.",
    sw: "Hakika: tumepokea picha yako ya uthibitisho na mahali ulipo.",
  },
  // A location pin shared just after a proof photo.
  proof_location_received: {
    en: "Hakika: we received your location for the proof photo.",
    sw: "Hakika: tumepokea mahali ulipo kwa ajili ya picha ya uthibitisho.",
  },
  // A PROOF reply when nothing is waiting for proof.
  no_proof_due: {
    en: "Hakika: there is no delivery waiting for proof right now.",
    sw: "Hakika: hakuna mzigo unaosubiri uthibitisho kwa sasa.",
  },
  // A DONE reply when no milestone is in progress.
  no_milestone_due: {
    en: "Hakika: there is no work waiting for proof right now.",
    sw: "Hakika: hakuna kazi inayosubiri uthibitisho kwa sasa.",
  },
  // A new code after a proof photo could not be confirmed. Neutral on purpose: it says what is
  // needed, never why the last photo failed, and never accuses anyone.
  fresh_proof_request: {
    en: "Hakika: we need a new proof photo for {milestone}. Your new code is {code}. Write it on paper, then take the photo at the site with this link: {link} The code expires in 30 minutes. If the link does not open, send the photo here, then share your location.",
    sw: "Hakika: tunahitaji picha mpya ya uthibitisho kwa {milestone}. Nambari mpya ya uthibitisho ni {code}. Iandike kwenye karatasi, kisha piga picha ukiwa eneo la ujenzi kupitia kiungo hiki: {link} Nambari itaisha baada ya dakika 30. Kiungo kisipofunguka, tuma picha hapa WhatsApp, kisha tuma eneo ulipo.",
  },
  // To the foreman whose request the owner declined. No slots on purpose: the owner's reason is
  // their own words, and the supplier's name on a quote was read by a model.
  request_declined: {
    en: "Hakika: the owner did not approve your latest materials request. Nothing was paid. If the materials are still needed, send a new quote.",
    sw: "Hakika: mmiliki wa mradi hakuidhinisha ombi lako la hivi karibuni la vifaa. Hakuna kilicholipwa. Ikiwa vifaa bado vinahitajika, tuma nukuu mpya ya bei.",
  },
  // To the fundi, once the owner has paid their labour for a verified milestone.
  labour_paid: {
    en: "Hakika: the owner has paid you {amount} through PayPal for {milestone}. Thank you.",
    sw: "Hakika: mmiliki wa mradi amekulipa {amount} kupitia PayPal kwa kazi ya {milestone}. Asante.",
  },
} as const satisfies Record<string, Record<Language, string>>;

export type TemplateKey = keyof typeof TEMPLATES;

// The {slot} names in a template, read from its English text.
type Slots<T extends string> = T extends `${string}{${infer Slot}}${infer Rest}` ? Slot | Slots<Rest> : never;
export type TemplateParams<K extends TemplateKey> = Record<Slots<(typeof TEMPLATES)[K]["en"]>, string>;
// Templates with no slots: the intake replies.
export type PlainTemplateKey = {
  [K in TemplateKey]: [Slots<(typeof TEMPLATES)[K]["en"]>] extends [never] ? K : never;
}[TemplateKey];

export function renderTemplate<K extends TemplateKey>(
  key: K,
  language: Language,
  ...[params]: [Slots<(typeof TEMPLATES)[K]["en"]>] extends [never] ? [] : [TemplateParams<K>]
): string {
  const values: Record<string, string> = params ?? {};
  return TEMPLATES[key][language].replace(/\{(\w+)\}/g, (_, slot: string) => {
    const value = values[slot];
    if (value === undefined) throw new Error(`Template ${key} needs {${slot}}.`);
    return value;
  });
}

// The same message in another language, for Judge Mode, whose judges may not read Swahili. The
// slot values are read back out of the stored text by matching it against its own template, so
// nothing is translated by a model. Null when the text doesn't match its template.
export function translateTemplate(key: string, from: Language, body: string, to: Language): string | null {
  if (!Object.hasOwn(TEMPLATES, key)) return null;
  if (from === to) return body;
  const template = TEMPLATES[key as TemplateKey];
  const seen = new Set<string>();
  const pattern = template[from].split(/(\{\w+\})/).map((part) => {
    const slot = /^\{(\w+)\}$/.exec(part)?.[1];
    if (!slot) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (seen.has(slot)) return `\\k<${slot}>`;
    seen.add(slot);
    return `(?<${slot}>[\\s\\S]+?)`;
  }).join("");
  const match = new RegExp(`^${pattern}$`).exec(body);
  if (!match) return null;
  const values = match.groups ?? {};
  return template[to].replace(/\{(\w+)\}/g, (_, slot: string) => values[slot] ?? `{${slot}}`);
}

// For tests: every key, and the slots each language uses.
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];
export function templateSlots(key: TemplateKey, language: Language): string[] {
  return [...TEMPLATES[key][language].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}
