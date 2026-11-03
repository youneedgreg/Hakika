export interface PriceItem {
  id: string;
  category: "Materials" | "Labor" | "Equipment" | "Permits & Fees";
  itemName: string;
  itemNameSw: string;
  vendorName: string;
  vendorContact: string;
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
    vendorContact: "+254 711 000 111",
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
    vendorName: "Simba Steel Mills",
    vendorContact: "+254 722 111 222",
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
    vendorName: "Simba Steel Mills",
    vendorContact: "+254 722 111 222",
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
    vendorName: "Ruiru Quarry Suppliers",
    vendorContact: "+254 733 222 333",
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
    vendorName: "Athi River Sand Dealers",
    vendorContact: "+254 744 333 444",
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
    vendorName: "Crusher & Aggregates Ltd",
    vendorContact: "+254 755 444 555",
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
    vendorName: "Hardware & Tools Emporium",
    vendorContact: "+254 766 555 666",
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
    vendorName: "Polymer Industries Kenya",
    vendorContact: "+254 777 666 777",
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
    vendorName: "Highland Timber Millers",
    vendorContact: "+254 788 777 888",
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
    vendorName: "Highland Timber Millers",
    vendorContact: "+254 788 777 888",
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
    vendorName: "Mabati Rolling Mills",
    vendorContact: "+254 799 888 999",
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
    vendorName: "Hardware & Tools Emporium",
    vendorContact: "+254 766 555 666",
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
    vendorName: "Ceramics & Decor Ltd",
    vendorContact: "+254 712 345 678",
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
    vendorName: "Basco Paints & Adhesives",
    vendorContact: "+254 723 456 789",
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
    vendorName: "Crown Paints Kenya",
    vendorContact: "+254 734 567 890",
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
    vendorName: "Super Pipes Ltd",
    vendorContact: "+254 745 678 901",
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
    vendorName: "Super Pipes Ltd",
    vendorContact: "+254 745 678 901",
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
    vendorName: "East African Cables",
    vendorContact: "+254 756 789 012",
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
    vendorName: "East African Cables",
    vendorContact: "+254 756 789 012",
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
    vendorName: "Metro Electricals",
    vendorContact: "+254 767 890 123",
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
    vendorName: "Independent Contractors Guild",
    vendorContact: "+254 710 111 222",
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
    vendorName: "Local Labor Pool",
    vendorContact: "+254 720 222 333",
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
    vendorName: "VoltMaster Electrical Services",
    vendorContact: "+254 730 333 444",
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
    vendorName: "FlowFix Plumbing Experts",
    vendorContact: "+254 740 444 555",
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
    vendorName: "Independent Contractors Guild",
    vendorContact: "+254 710 111 222",
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
    vendorName: "Machinery Rentals Africa",
    vendorContact: "+254 750 555 666",
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
    vendorName: "Machinery Rentals Africa",
    vendorContact: "+254 750 555 666",
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
    vendorName: "SafeAccess Scaffolding",
    vendorContact: "+254 760 666 777",
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
    vendorName: "County Government Revenue Office",
    vendorContact: "+254 200 000 000",
    unit: "Fixed",
    unitPriceUSD: 230.00,
    unitPriceKES: 30000,
    standardQuantity: 1,
    notes: "Official municipal architectural plan approval"
  },
  {
    id: "PMT-002",
    category: "Permits & Fees",
    itemName: "NEMA Environmental Impact Assessment",
    itemNameSw: "Cheti cha Tathmini ya Mazingira (NEMA)",
    vendorName: "NEMA Kenya Compliance",
    vendorContact: "+254 201 111 111",
    unit: "Fixed",
    unitPriceUSD: 154.00,
    unitPriceKES: 20000,
    standardQuantity: 1,
    notes: "Mandatory environmental audit clearance"
  },
  {
    id: "PMT-003",
    category: "Permits & Fees",
    itemName: "NCA Project Registration Fee",
    itemNameSw: "Usajili wa Mradi wa NCA",
    vendorName: "National Construction Authority",
    vendorContact: "+254 202 222 222",
    unit: "Fixed",
    unitPriceUSD: 115.00,
    unitPriceKES: 15000,
    standardQuantity: 1,
    notes: "Builder compliance and site worker insurance levy"
  }
];