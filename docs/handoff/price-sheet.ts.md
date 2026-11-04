```ts
export interface PriceItem {
  id: string;
  category: "Materials" | "Labor" | "Equipment" | "Permits & Fees";
  itemName: string;
  itemNameSw: string;
  vendorName: string;
  unit: string;
  unitPriceUSD: number;
  unitPriceKES: number;
  standardQuantity: number;
  notes: string;
}

export const HAKIKA_PRICE_SHEET: PriceItem[] = [
  // Materials - Foundation & Masonry
  {
    id: "MAT-001",
    category: "Materials",
    itemName: "Portland Cement (50kg bag)",
    itemNameSw: "Saruji ya Portland (Mfuko wa kilo 50)",
    vendorName: "Twiga Cement Ltd",
    unit: "Bag",
    unitPriceUSD: 8.50,
    unitPriceKES: 1100,
    standardQuantity: 200,
    notes: "Standard grade for foundation and block work"
  },
  {
    id: "MAT-002",
    category: "Materials",
    itemName: "Deformed Steel Bars (Y12 - 12mm)",
    itemNameSw: "Nondo za Vyuma (Y12 - 12mm)",
    vendorName: "Kifaru Steelworks",
    unit: "Piece (12m)",
    unitPriceUSD: 11.20,
    unitPriceKES: 1450,
    standardQuantity: 150,
    notes: "High yield structural reinforcement bars"
  },
  {
    id: "MAT-003",
    category: "Materials",
    itemName: "Deformed Steel Bars (Y16 - 16mm)",
    itemNameSw: "Nondo za Vyuma (Y16 - 16mm)",
    vendorName: "Kifaru Steelworks",
    unit: "Piece (12m)",
    unitPriceUSD: 19.80,
    unitPriceKES: 2570,
    standardQuantity: 80,
    notes: "Heavy duty structural columns and beams"
  },
  {
    id: "MAT-004",
    category: "Materials",
    itemName: "Machine Cut Quarry Stones (9x9x18)",
    itemNameSw: "Mawe ya Mchanga ya Mashine (9x9x18)",
    vendorName: "Mwangaza Quarry Co.",
    unit: "Piece",
    unitPriceUSD: 0.45,
    unitPriceKES: 60,
    standardQuantity: 3000,
    notes: "Used for perimeter wall and superstructure"
  },
  {
    id: "MAT-005",
    category: "Materials",
    itemName: "River Sand (Per Ton)",
    itemNameSw: "Mchanga wa Mto (Kwa Tani)",
    vendorName: "Kijani Sand Supply",
    unit: "Ton",
    unitPriceUSD: 23.00,
    unitPriceKES: 3000,
    standardQuantity: 30,
    notes: "Clean, washed river sand for plastering and concrete"
  },
  {
    id: "MAT-006",
    category: "Materials",
    itemName: "Ballast / Crushed Rock (Aggregate 20mm)",
    itemNameSw: "Kokoto (Ukubwa wa 20mm)",
    vendorName: "Jirani Aggregate Works",
    unit: "Ton",
    unitPriceUSD: 21.50,
    unitPriceKES: 2800,
    standardQuantity: 25,
    notes: "For slab casting and concrete mix"
  },
  {
    id: "MAT-007",
    category: "Materials",
    itemName: "Binding Wire (25kg Roll)",
    itemNameSw: "Waya wa Kufungia Nondo (Roli ya kilo 25)",
    vendorName: "Ujenzi Supply House",
    unit: "Roll",
    unitPriceUSD: 31.00,
    unitPriceKES: 4000,
    standardQuantity: 4,
    notes: "For tying reinforcement steel mesh"
  },
  {
    id: "MAT-008",
    category: "Materials",
    itemName: "DPC Damp Proof Course (1000 gauge)",
    itemNameSw: "Plastiki ya Kuzuia Unyevu (DPC)",
    vendorName: "Safi Polymer Works",
    unit: "Roll (30m)",
    unitPriceUSD: 15.40,
    unitPriceKES: 2000,
    standardQuantity: 6,
    notes: "Foundation moisture barrier"
  },
  {
    id: "MAT-009",
    category: "Materials",
    itemName: "Timber - Cypress (2x4 by 14ft)",
    itemNameSw: "Mbao za Cypress (2x4 kwa futi 14)",
    vendorName: "Miti Ridge Timber",
    unit: "Piece",
    unitPriceUSD: 6.20,
    unitPriceKES: 800,
    standardQuantity: 100,
    notes: "Roof trusses and formwork framing"
  },
  {
    id: "MAT-010",
    category: "Materials",
    itemName: "Timber - Blue Gum / Eucalyptus (Posts)",
    itemNameSw: "Mbao za Nguzo za Eucalyptus",
    vendorName: "Miti Ridge Timber",
    unit: "Piece",
    unitPriceUSD: 4.60,
    unitPriceKES: 600,
    standardQuantity: 50,
    notes: "Scaffolding and site props"
  },

  // Materials - Roofing & Finishing
  {
    id: "MAT-011",
    category: "Materials",
    itemName: "Box Profile Iron Sheets (Gauge 28 - Coloured)",
    itemNameSw: "Mabati ya Rangi ya Box Profile (Gauge 28)",
    vendorName: "Kivuli Roofing Works",
    unit: "Linear Meter",
    unitPriceUSD: 7.70,
    unitPriceKES: 1000,
    standardQuantity: 120,
    notes: "Roof covering material"
  },
  {
    id: "MAT-012",
    category: "Materials",
    itemName: "Roofing Nails (Per Kg)",
    itemNameSw: "Misumari ya Mabati (Kwa Kilo)",
    vendorName: "Ujenzi Supply House",
    unit: "Kg",
    unitPriceUSD: 2.30,
    unitPriceKES: 300,
    standardQuantity: 15,
    notes: "With rubber washers for leakproof roofing"
  },
  {
    id: "MAT-013",
    category: "Materials",
    itemName: "Ceramic Floor Tiles (60x60cm - Matt)",
    itemNameSw: "Tiles za Sakafu (60x60cm)",
    vendorName: "Taarifa Tile House",
    unit: "Box (1.44 sqm)",
    unitPriceUSD: 13.80,
    unitPriceKES: 1800,
    standardQuantity: 45,
    notes: "Living room and bedroom flooring"
  },
  {
    id: "MAT-014",
    category: "Materials",
    itemName: "Tile Adhesive (25kg bag)",
    itemNameSw: "Gundi ya Tiles (Mfuko wa kilo 25)",
    vendorName: "RangiCraft Adhesives",
    unit: "Bag",
    unitPriceUSD: 9.20,
    unitPriceKES: 1200,
    standardQuantity: 20,
    notes: "High bond polymer tile mortar"
  },
  {
    id: "MAT-015",
    category: "Materials",
    itemName: "Emulsion Paint (20L - Silk Vinyl)",
    itemNameSw: "Rangi ya Kuta (20L - Silk Vinyl)",
    vendorName: "Imara Coatworks",
    unit: "Bucket (20L)",
    unitPriceUSD: 65.00,
    unitPriceKES: 8450,
    standardQuantity: 6,
    notes: "Interior and exterior washable wall finish"
  },

  // Plumbing & Electrical
  {
    id: "MAT-016",
    category: "Materials",
    itemName: "PVC Pressure Pipes (2 inch)",
    itemNameSw: "Mabomba ya Maji ya PVC (Inchi 2)",
    vendorName: "MajiFlow Pipeworks",
    unit: "Piece (6m)",
    unitPriceUSD: 11.50,
    unitPriceKES: 1500,
    standardQuantity: 25,
    notes: "Main water supply line plumbing"
  },
  {
    id: "MAT-017",
    category: "Materials",
    itemName: "PVC Drainage Pipes (4 inch)",
    itemNameSw: "Mabomba ya Taka ya PVC (Inchi 4)",
    vendorName: "MajiFlow Pipeworks",
    unit: "Piece (6m)",
    unitPriceUSD: 18.50,
    unitPriceKES: 2400,
    standardQuantity: 15,
    notes: "Sanitary drainage and sewage lines"
  },
  {
    id: "MAT-018",
    category: "Materials",
    itemName: "Electrical Copper Cable (1.5mm - 100m)",
    itemNameSw: "Waya wa Umeme (1.5mm - 100m)",
    vendorName: "SafiCore Cables",
    unit: "Roll",
    unitPriceUSD: 38.50,
    unitPriceKES: 5000,
    standardQuantity: 4,
    notes: "Lighting circuit wiring"
  },
  {
    id: "MAT-019",
    category: "Materials",
    itemName: "Electrical Copper Cable (2.5mm - 100m)",
    itemNameSw: "Waya wa Umeme (2.5mm - 100m)",
    vendorName: "SafiCore Cables",
    unit: "Roll",
    unitPriceUSD: 57.70,
    unitPriceKES: 7500,
    standardQuantity: 5,
    notes: "Socket outlets and heavy appliance wiring"
  },
  {
    id: "MAT-020",
    category: "Materials",
    itemName: "Distribution Board (12 Way Complete)",
    itemNameSw: "Sanduku la Umeme la Vichocheo (12 Way)",
    vendorName: "Mwangaza Electricals",
    unit: "Unit",
    unitPriceUSD: 46.20,
    unitPriceKES: 6000,
    standardQuantity: 1,
    notes: "Main circuit breaker housing with MCBs"
  },

  // Labor Costs
  {
    id: "LAB-001",
    category: "Labor",
    itemName: "Master Mason / Fundi Mkuu",
    itemNameSw: "Fundi Mkuu wa Ujenzi",
    vendorName: "Jenga Crew Collective",
    unit: "Day",
    unitPriceUSD: 15.40,
    unitPriceKES: 2000,
    standardQuantity: 45,
    notes: "Skilled supervision for masonry and concrete work"
  },
  {
    id: "LAB-002",
    category: "Labor",
    itemName: "Construction Assistant / Kibarua",
    itemNameSw: "Msaidizi wa Ujenzi / Kibarua",
    vendorName: "Site Support Crew",
    unit: "Day",
    unitPriceUSD: 6.20,
    unitPriceKES: 800,
    standardQuantity: 90,
    notes: "General site clearing, mixing, and material hauling"
  },
  {
    id: "LAB-003",
    category: "Labor",
    itemName: "Licensed Electrician",
    itemNameSw: "Fundi wa Umeme Aliyeidhinishwa",
    vendorName: "Mwangaza Electrical Services",
    unit: "Day",
    unitPriceUSD: 23.00,
    unitPriceKES: 3000,
    standardQuantity: 10,
    notes: "Wiring installation and safety testing"
  },
  {
    id: "LAB-004",
    category: "Labor",
    itemName: "Licensed Plumber",
    itemNameSw: "Fundi Mabomba Aliyeidhinishwa",
    vendorName: "SafiFlow Plumbing",
    unit: "Day",
    unitPriceUSD: 23.00,
    unitPriceKES: 3000,
    standardQuantity: 10,
    notes: "Water pipe fitting and sanitary drainage setup"
  },
  {
    id: "LAB-005",
    category: "Labor",
    itemName: "Steel Fixer / Fundi wa Nondo",
    itemNameSw: "Fundi wa Kupinda na Kufunga Nondo",
    vendorName: "Jenga Crew Collective",
    unit: "Day",
    unitPriceUSD: 15.40,
    unitPriceKES: 2000,
    standardQuantity: 15,
    notes: "Specialist steel reinforcement installation"
  },

  // Equipment & Machinery Rental
  {
    id: "EQP-001",
    category: "Equipment",
    itemName: "Concrete Mixer Machine (Diesel Powered)",
    itemNameSw: "Mashine ya Kuchanganya Kokoto na Saruji",
    vendorName: "Jirani Equipment Hire",
    unit: "Day",
    unitPriceUSD: 38.50,
    unitPriceKES: 5000,
    standardQuantity: 6,
    notes: "Includes operator fuel and basic maintenance"
  },
  {
    id: "EQP-002",
    category: "Equipment",
    itemName: "Plate Compactor / Wacker Packer",
    itemNameSw: "Mashine ya Kukandamiza Udongo (Compactor)",
    vendorName: "Jirani Equipment Hire",
    unit: "Day",
    unitPriceUSD: 23.00,
    unitPriceKES: 3000,
    standardQuantity: 3,
    notes: "Foundation earth compaction"
  },
  {
    id: "EQP-003",
    category: "Equipment",
    itemName: "Scaffolding Set (Steel Pipes & Planks)",
    itemNameSw: "Vifaa vya Kukandia na Kupanda (Scaffolding)",
    vendorName: "Imara Access Hire",
    unit: "Week",
    unitPriceUSD: 46.20,
    unitPriceKES: 6000,
    standardQuantity: 4,
    notes: "For upper walling and roof installation access"
  },

  // Permits & Administrative Fees
  {
    id: "PMT-001",
    category: "Permits & Fees",
    itemName: "County Construction Approval Permit",
    itemNameSw: "Kibali cha Ujenzi cha Kaunti",
    vendorName: "Kijiji Permit Office",
    unit: "Fixed",
    unitPriceUSD: 230.00,
    unitPriceKES: 30000,
    standardQuantity: 1,
    notes: "Official municipal architectural plan approval"
  },
  {
    id: "PMT-002",
    category: "Permits & Fees",
    itemName: "Environmental Review Permit",
    itemNameSw: "Kibali cha Ukaguzi wa Mazingira",
    vendorName: "Kijiji Environment Office",
    unit: "Fixed",
    unitPriceUSD: 154.00,
    unitPriceKES: 20000,
    standardQuantity: 1,
    notes: "Mandatory environmental audit clearance"
  },
  {
    id: "PMT-003",
    category: "Permits & Fees",
    itemName: "Project Site Registration Fee",
    itemNameSw: "Ada ya Usajili wa Eneo la Mradi",
    vendorName: "Kijiji Works Registry",
    unit: "Fixed",
    unitPriceUSD: 115.00,
    unitPriceKES: 15000,
    standardQuantity: 1,
    notes: "Builder compliance and site worker insurance levy"
  }
];
```