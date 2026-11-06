// Fixed messages to people on site. The model never writes free text to a foreman, fundi or supplier.
// This copy is a placeholder until Juliet's English and Swahili templates arrive; the payment
// confirmations' Swahili still needs her check.
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
    en: "Hakika: the owner has paid {supplier} {amount} through PayPal for your materials request. {supplier} will arrange the delivery.",
    sw: "Hakika: mwenye nyumba amelipa {supplier} {amount} kupitia PayPal kwa ombi lako la vifaa. {supplier} watapanga usafirishaji.",
  },
  // To the supplier's own contact.
  materials_paid_supplier: {
    en: "Hakika: {amount} has been paid to {supplier} through PayPal for a materials order. Please arrange the delivery to the site.",
    sw: "Hakika: {amount} zimelipwa kwa {supplier} kupitia PayPal kwa oda ya vifaa. Tafadhali panga usafirishaji hadi eneo la ujenzi.",
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

// For tests: every key, and the slots each language uses.
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];
export function templateSlots(key: TemplateKey, language: Language): string[] {
  return [...TEMPLATES[key][language].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}
