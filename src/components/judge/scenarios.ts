import { DEMO_PROOF_SUSPICIOUS_ID, DEMO_PROOF_VERIFIED_ID, DEMO_REQUEST_ID } from "@/lib/demo-ids";
import type { SimulateBody } from "@/shared/api";

// mediaPath is a file the app serves itself (for example /mock/...). It is resolved against the page origin when the scenario runs.
export type ScenarioStep = Omit<SimulateBody, "projectId" | "mediaUrl"> & { mediaPath?: string };

export type Scenario = {
  id: string;
  title: string;
  summary: string;
  steps: ScenarioStep[];
  result: { label: string; href: string };
};

// Both points are fictional. The site pin is -0.4201, 36.9476 with a 150 m radius.
const AT_SITE = { lat: -0.42016, lng: 36.94771 };
const FAR_FROM_SITE = { lat: -0.0917, lng: 37.0062 };

export const scenarios: Scenario[] = [
  {
    id: "cement-request",
    title: "Peter asks for cement",
    summary: "The foreman sends a quote request by WhatsApp. Hakika reads it and prepares an approval card.",
    steps: [
      {
        from: "peter",
        kind: "text",
        text: "Need 50 bags of cement and 2 loads of ballast for the foundation. Delivery Thursday morning.",
      },
    ],
    result: { label: "Open the cement request", href: `/requests/${DEMO_REQUEST_ID}` },
  },
  {
    id: "verified-delivery",
    title: "Otieno proves a delivery",
    summary: "The fundi sends a delivery photo from the site. Every hard check passes.",
    steps: [
      {
        from: "otieno",
        kind: "image",
        mediaPath: "/mock/proof-cement-delivery.jpg",
        location: AT_SITE,
      },
    ],
    result: { label: "Open the verified proof", href: `/proofs/${DEMO_PROOF_VERIFIED_ID}` },
  },
  {
    id: "suspicious-progress",
    title: "A suspicious progress photo",
    summary: "A recycled photo arrives from far away. Code, location and duplicate checks fail, and the proof is held.",
    steps: [
      {
        from: "otieno",
        kind: "image",
        mediaPath: "/mock/proof-foundation-recycled.jpg",
        location: FAR_FROM_SITE,
      },
    ],
    result: { label: "Open the suspicious proof", href: `/proofs/${DEMO_PROOF_SUSPICIOUS_ID}` },
  },
];

export function buildSimulateBody(projectId: string, step: ScenarioStep, origin: string): SimulateBody {
  const { mediaPath, ...rest } = step;
  return {
    projectId,
    ...rest,
    ...(mediaPath ? { mediaUrl: new URL(mediaPath, origin).toString() } : {}),
  };
}
