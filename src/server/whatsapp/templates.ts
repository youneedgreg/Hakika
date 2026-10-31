// Fixed messages to people on site. The model never writes free text to a foreman, fundi or supplier.
// This copy is a placeholder until Juliet's English and Swahili templates arrive.

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
} as const satisfies Record<string, Record<Language, string>>;

export type TemplateKey = keyof typeof TEMPLATES;

export function renderTemplate(key: TemplateKey, language: Language): string {
  return TEMPLATES[key][language];
}
