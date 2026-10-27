// Typed mock data for the demo project, served by the stub API routes until each route goes live.
// It shows every state the UI needs at once (a pending approval, a verified proof, a held payment),
// so it is a showcase, not one moment of the story. All people and businesses are fictional.

import type {
  ChatResult, GanttData, LedgerRow, ProjectDetails, ProjectOverview, ProofCapture,
} from "@/shared/api";
import type { ApprovalCard, ProofReview } from "@/shared/types";

export const DEMO_PROJECT_ID = "demo-nyeri";
export const DEMO_REQUEST_ID = "req-cement-foundation";
export const DEMO_PROOF_TOKEN = "demo-proof-token";
export const DEMO_PROOF_IDS = {
  verified: "proof-cement-delivery",
  suspicious: "proof-foundation-recycled",
} as const;

const SITE = { lat: -0.4201, lng: 36.9476, radiusM: 150 };

export const projectDetails: ProjectDetails = {
  id: DEMO_PROJECT_ID,
  name: "Three-bedroom house, Nyeri",
  owner: { name: "Wanjiru Kamau", location: "Dallas, Texas" },
  site: { label: "Family land, Nyeri", ...SITE },
  budget: { amount: "4500000.00", currency: "KES" },
  milestones: [
    {
      id: "m1", name: "Setting out and excavation", status: "paid",
      plannedStart: "2026-09-21", plannedEnd: "2026-10-03",
      plannedMaterials: [],
    },
    {
      id: "m2", name: "Foundation", status: "held",
      plannedStart: "2026-10-05", plannedEnd: "2026-10-31",
      plannedMaterials: [
        { itemKey: "cement_50kg", description: "Cement, 50 kg bag", qty: 120, unit: "bag" },
        { itemKey: "steel_y12", description: "Y12 steel bar", qty: 60, unit: "bar" },
        { itemKey: "ballast", description: "Ballast", qty: 14, unit: "tonne" },
      ],
    },
    {
      id: "m3", name: "Walling up to ring beam", status: "planned",
      plannedStart: "2026-11-02", plannedEnd: "2026-12-05",
      plannedMaterials: [
        { itemKey: "stone_machine_cut", description: "Machine-cut stone", qty: 2400, unit: "piece" },
      ],
    },
    {
      id: "m4", name: "Roofing", status: "planned",
      plannedStart: "2026-12-07", plannedEnd: "2027-01-09",
      plannedMaterials: [
        { itemKey: "roofing_sheet", description: "Roofing sheet", qty: 90, unit: "sheet" },
      ],
    },
    {
      id: "m5", name: "Plaster and finishes", status: "planned",
      plannedStart: "2027-01-11", plannedEnd: "2027-02-27",
      plannedMaterials: [],
    },
  ],
  contacts: [
    { id: "c-peter", name: "Peter Mwangi", role: "foreman", language: "sw" },
    { id: "c-otieno", name: "Otieno", role: "fundi", language: "sw" },
    { id: "c-grace", name: "Grace Wambui", role: "supplier", language: "en" },
  ],
  suppliers: [
    { id: "s-mlima", name: "Mlima Hardware", area: "Nyeri town", verified: true },
    { id: "s-kiawara", name: "Kiawara Builders Supplies", area: "Kiawara", verified: true },
  ],
};

export const approvalCard: ApprovalCard = {
  requestId: DEMO_REQUEST_ID,
  status: "awaiting_approval",
  milestone: { id: "m2", name: "Foundation" },
  requestedBy: { name: "Peter Mwangi", role: "Foreman" },
  lines: [
    {
      itemKey: "cement_50kg", description: "Cement, 50 kg bag",
      qty: 50, unit: "bag",
      unitPrice: { amount: "950.00", currency: "KES" },
      referenceUnitPrice: { amount: "780.00", currency: "KES" },
    },
  ],
  quotedTotal: { amount: "47500.00", currency: "KES" },
  recommended: {
    supplierId: "s-mlima",
    supplierName: "Mlima Hardware",
    total: { amount: "39500.00", currency: "KES" },
    totalUsd: { amount: "305.73", currency: "USD" },
    fxRate: 129.2,
  },
  findings: [
    {
      type: "price_above_market", severity: "warn",
      message: "Cement is quoted at KES 950 a bag, 22% above the verified median of KES 780.",
      data: { itemKey: "cement_50kg", quoted: "950.00", median: "780.00", percentAbove: 22 },
    },
    {
      type: "unverified_supplier", severity: "warn",
      message: "Baraka Hardware, on the quote, is not a verified supplier.",
      data: { supplierName: "Baraka Hardware" },
    },
    {
      type: "cheaper_verified_supplier", severity: "info",
      message: "Mlima Hardware, a verified supplier, sells the same order for KES 39,500, KES 8,000 less.",
      data: { supplierId: "s-mlima", total: "39500.00", saving: "8000.00" },
    },
  ],
  summary:
    "Peter asked for 50 bags of cement for the foundation. The quote is 22% above the market median " +
    "and comes from an unverified supplier. Mlima Hardware, a verified supplier, can supply the same " +
    "order for KES 39,500 (USD 305.73).",
};

export const proofReviews: Record<string, ProofReview> = {
  [DEMO_PROOF_IDS.verified]: {
    proofId: DEMO_PROOF_IDS.verified,
    imageUrl: "/mock/proof-cement-delivery.jpg",
    receivedAt: "2026-10-24T10:12:00Z",
    capture: { lat: -0.42016, lng: 36.94771, accuracyM: 12 },
    site: SITE,
    checks: [
      { name: "code", result: "pass", hard: true, detail: "Code H4RK matches the issued code." },
      { name: "freshness", result: "pass", hard: true, detail: "Uploaded 6 minutes after the code was issued." },
      { name: "duplicate", result: "pass", hard: true, detail: "No earlier proof looks like this photo.", evidence: { hamming: 31 } },
      { name: "location", result: "pass", hard: true, detail: "Taken 14 m from the site pin.", evidence: { distanceM: 14 } },
      { name: "screen_or_print", result: "pass", hard: false, detail: "Not a photo of a screen or a print." },
      { name: "expected_items", result: "pass", hard: false, detail: "Cement bags visible, roughly 50." },
      { name: "consistency", result: "pass", hard: false, detail: "Matches the site seen in earlier proofs." },
    ],
    outcome: "verified",
    explanation: "Every check passed. The cement delivery is verified.",
  },
  [DEMO_PROOF_IDS.suspicious]: {
    proofId: DEMO_PROOF_IDS.suspicious,
    imageUrl: "/mock/proof-foundation-recycled.jpg",
    receivedAt: "2026-10-26T16:40:00Z",
    capture: { lat: -0.0917, lng: 37.0062, accuracyM: 20 },
    site: SITE,
    checks: [
      { name: "code", result: "fail", hard: true, detail: "No code is visible in the photo." },
      { name: "freshness", result: "pass", hard: true, detail: "Uploaded 11 minutes after the code was issued." },
      {
        name: "duplicate", result: "fail", hard: true,
        detail: "Matches a proof sent on 5 October.",
        evidence: { matchImageUrl: "/mock/proof-excavation.jpg", hamming: 3 },
      },
      {
        name: "location", result: "fail", hard: true,
        detail: "Taken 41 km from the site pin.",
        evidence: { distanceM: 41000 },
      },
      { name: "screen_or_print", result: "unknown", hard: false, detail: "Could not tell." },
      { name: "expected_items", result: "unknown", hard: false, detail: "Not a delivery proof." },
      { name: "consistency", result: "fail", hard: false, detail: "Does not match the site seen in earlier proofs." },
    ],
    outcome: "suspicious",
    explanation:
      "The labour payment for the foundation is held: the photo has no code, matches a photo from " +
      "5 October, and was taken 41 km from the site. Peter has been sent a new code for fresh proof.",
  },
};

export const proofCapture: ProofCapture = {
  code: "H4RK",
  purpose: "delivery",
  milestoneName: "Foundation",
  instructions: {
    en: "Write this code on a cement bag or a sheet of paper, then take a photo that shows the code and the delivery.",
    sw: "Andika nambari hii kwenye mfuko wa saruji au karatasi, kisha piga picha inayoonyesha nambari na mzigo.",
  },
  expiresAt: "2026-10-24T10:36:00Z",
};

export const gantt: GanttData = {
  tasks: [
    { id: "m1", name: "Setting out and excavation", startDate: "2026-09-21", endDate: "2026-10-03", percentDone: 100, status: "paid", kind: "work" },
    { id: "g1", name: "Pay excavation labour", startDate: "2026-10-03", endDate: "2026-10-03", percentDone: 100, status: "paid", kind: "payment_gate" },
    { id: "m2", name: "Foundation", startDate: "2026-10-05", endDate: "2026-10-31", percentDone: 80, status: "held", kind: "work" },
    { id: "g2", name: "Pay foundation labour", startDate: "2026-10-31", endDate: "2026-10-31", percentDone: 0, status: "held", kind: "payment_gate" },
    { id: "m3", name: "Walling up to ring beam", startDate: "2026-11-02", endDate: "2026-12-05", percentDone: 0, status: "planned", kind: "work" },
    { id: "g3", name: "Pay walling labour", startDate: "2026-12-05", endDate: "2026-12-05", percentDone: 0, status: "planned", kind: "payment_gate" },
    { id: "m4", name: "Roofing", startDate: "2026-12-07", endDate: "2027-01-09", percentDone: 0, status: "planned", kind: "work" },
    { id: "g4", name: "Pay roofing labour", startDate: "2027-01-09", endDate: "2027-01-09", percentDone: 0, status: "planned", kind: "payment_gate" },
    { id: "m5", name: "Plaster and finishes", startDate: "2027-01-11", endDate: "2027-02-27", percentDone: 0, status: "planned", kind: "work" },
  ],
  dependencies: [
    { id: "d1", fromTask: "m1", toTask: "g1" },
    { id: "d2", fromTask: "g1", toTask: "m2" },
    { id: "d3", fromTask: "m2", toTask: "g2" },
    { id: "d4", fromTask: "g2", toTask: "m3" },
    { id: "d5", fromTask: "m3", toTask: "g3" },
    { id: "d6", fromTask: "g3", toTask: "m4" },
    { id: "d7", fromTask: "m4", toTask: "g4" },
    { id: "d8", fromTask: "g4", toTask: "m5" },
  ],
};

export const overview: ProjectOverview = {
  project: { id: DEMO_PROJECT_ID, name: projectDetails.name, ownerName: "Wanjiru Kamau", siteLabel: "Family land, Nyeri" },
  currentMilestone: { id: "m2", name: "Foundation", status: "held" },
  approvals: [
    {
      requestId: DEMO_REQUEST_ID, title: "50 bags of cement for the foundation",
      status: "awaiting_approval", total: { amount: "39500.00", currency: "KES" },
      createdAt: "2026-10-23T08:05:00Z",
    },
  ],
  alerts: [
    {
      id: "a-held-foundation", kind: "payment_held", severity: "block",
      message: "Otieno's foundation payment is held: the progress photo failed three checks.",
      link: { proofId: DEMO_PROOF_IDS.suspicious },
    },
    {
      id: "a-price-cement", kind: "price_warning", severity: "warn",
      message: "The cement quote is 22% above the verified median.",
      link: { requestId: DEMO_REQUEST_ID },
    },
  ],
  ledger: {
    spent: { amount: "185000.00", currency: "KES" },
    spentUsd: { amount: "1431.89", currency: "USD" },
    budget: projectDetails.budget,
    paymentsCount: 2,
  },
};

export const ledgerRows: LedgerRow[] = [
  {
    at: "2026-10-03T15:20:00Z", kind: "payment",
    description: "Excavation labour paid to Otieno",
    amount: { amount: "60000.00", currency: "KES" }, amountUsd: { amount: "464.40", currency: "USD" },
    paypalOrderId: "MOCK0RDER00000001", paypalCaptureId: "MOCKCAPTURE0000001",
    link: {},
  },
  {
    at: "2026-10-12T09:02:00Z", kind: "payment",
    description: "Ballast and Y12 steel paid to Kiawara Builders Supplies",
    amount: { amount: "125000.00", currency: "KES" }, amountUsd: { amount: "967.49", currency: "USD" },
    paypalOrderId: "MOCK0RDER00000002", paypalCaptureId: "MOCKCAPTURE0000002",
    link: {},
  },
  {
    at: "2026-10-24T10:12:00Z", kind: "verdict",
    description: "Cement delivery proof verified",
    link: { proofId: DEMO_PROOF_IDS.verified },
  },
  {
    at: "2026-10-26T16:40:00Z", kind: "verdict",
    description: "Foundation progress proof suspicious; labour payment held",
    link: { proofId: DEMO_PROOF_IDS.suspicious },
  },
];

export const chatAnswer: ChatResult = {
  answer:
    "The foundation payment is held because the progress photo failed three hard checks: it has no " +
    "code, it matches a photo from 5 October, and it was taken 41 km from the site. Peter has a new " +
    "code for fresh proof.",
  citations: [{ label: "Proof review: foundation progress", href: `/proofs/${DEMO_PROOF_IDS.suspicious}` }],
};
