// The price check's rules, each at its limits, plus the demo story's numbers from the mock card.

import { describe, expect, it } from "vitest";
import { approvalCard } from "@/server/mocks/demo";
import { checkPrices, type PriceCheckInput, type QuotedLine } from "@/server/pricing/engine";
import { centsToAmount, formatKes, kesCentsToUsdCents } from "@/server/pricing/money";

const cement = (kes: number, qty: number | null = 50): QuotedLine => ({
  itemKey: "cement_50kg", description: "Cement, 50 kg bag", qty, unit: "bag", unitPriceKesCents: kes * 100,
});

const baraka = { id: null, name: "Baraka Hardware", verified: false };
const mlima = { id: "s-mlima", name: "Mlima Hardware", verified: true };

function input(overrides: Partial<PriceCheckInput> = {}): PriceCheckInput {
  return {
    lines: [cement(780)],
    quotedSupplier: mlima,
    statedTotalKesCents: null,
    references: [{ itemKey: "cement_50kg", unit: "bag", medianKesCents: 78_000 }],
    planRemaining: [{ itemKey: "cement_50kg", qty: 100, unit: "bag" }],
    verifiedSuppliers: [
      { id: "s-mlima", name: "Mlima Hardware", prices: [{ itemKey: "cement_50kg", unit: "bag", unitPriceKesCents: 79_000 }] },
      { id: "s-kiawara", name: "Kiawara Builders Supplies", prices: [{ itemKey: "cement_50kg", unit: "bag", unitPriceKesCents: 82_000 }] },
    ],
    ...overrides,
  };
}

const ofType = (result: ReturnType<typeof checkPrices>, type: string) => result.findings.filter((f) => f.type === type);

// Nova wrote "bags" on a real quote through production, and the catalog says "bag".
describe("a unit written in the plural", () => {
  const bags = (kes: number, qty: number, unit = "bags"): QuotedLine => ({ ...cement(kes, qty), unit });

  it("passes the quote Nova read on production with no findings", () => {
    const result = checkPrices(input({ lines: [bags(790, 10)], statedTotalKesCents: 790_000 }));
    expect(result.lines[0].referenceUnitPriceKesCents).toBe(78_000);
    expect(result.findings).toEqual([]);
    expect(result.recommended).toMatchObject({ supplierId: "s-mlima", totalKesCents: 790_000 });
  });

  it("still checks the price against the median, and words the unit in the singular", () => {
    const [finding] = ofType(checkPrices(input({ lines: [bags(1000, 10)] })), "price_above_market");
    expect(finding.severity).toBe("warn");
    expect(finding.message).toContain("a bag,");
  });

  it("still checks the quantity against the plan", () => {
    const [finding] = ofType(checkPrices(input({ lines: [bags(790, 200)] })), "qty_above_plan");
    expect(finding.data).toMatchObject({ ordered: 200, remaining: 100 });
    expect(finding.message).toContain("100 bags remain");
  });

  it("still offers a cheaper verified supplier", () => {
    const result = checkPrices(input({ lines: [bags(900, 10)] }));
    expect(result.recommended).toMatchObject({ supplierId: "s-kiawara", totalKesCents: 820_000 });
    expect(ofType(result, "cheaper_verified_supplier")).toHaveLength(1);
  });

  it("still finds an alternative to an unverified supplier", () => {
    const result = checkPrices(input({ lines: [bags(790, 10)], quotedSupplier: baraka }));
    expect(result.recommended).toMatchObject({ supplierId: "s-mlima", totalKesCents: 790_000 });
  });

  it("ignores case and spaces around the plural", () => {
    const result = checkPrices(input({ lines: [bags(790, 10, " BAGS ")] }));
    expect(result.lines[0].referenceUnitPriceKesCents).toBe(78_000);
  });

  it("matches a plural in the reference or plan as well as on the quote", () => {
    const result = checkPrices(input({
      lines: [cement(790, 10)],
      references: [{ itemKey: "cement_50kg", unit: "bags", medianKesCents: 78_000 }],
      planRemaining: [{ itemKey: "cement_50kg", qty: 100, unit: "bags" }],
    }));
    expect(result.findings).toEqual([]);
  });

  it("doesn't treat a different unit in the plural as the same unit", () => {
    const result = checkPrices(input({ lines: [bags(5000, 10, "tonnes")], planRemaining: [] }));
    expect(result.lines[0].referenceUnitPriceKesCents).toBeNull();
    expect(ofType(result, "price_above_market")).toEqual([]);
  });

  it("doesn't cut a word that only ends in a double s", () => {
    const result = checkPrices(input({
      lines: [bags(790, 10, "glass")],
      references: [{ itemKey: "cement_50kg", unit: "glas", medianKesCents: 78_000 }],
    }));
    expect(result.lines[0].referenceUnitPriceKesCents).toBeNull();
  });
});

describe("the price against the reference median", () => {
  const priceAt = (median: number, price: number) => checkPrices(input({
    lines: [cement(price)],
    references: [{ itemKey: "cement_50kg", unit: "bag", medianKesCents: median * 100 }],
  }));

  it("says nothing at exactly 15% above", () => {
    expect(ofType(priceAt(1000, 1150), "price_above_market")).toEqual([]);
  });

  it("warns just above 15%", () => {
    expect(ofType(priceAt(1000, 1151), "price_above_market")[0].severity).toBe("warn");
  });

  it("still warns at exactly 30% above", () => {
    expect(ofType(priceAt(1000, 1300), "price_above_market")[0].severity).toBe("warn");
  });

  it("blocks just above 30%", () => {
    expect(ofType(priceAt(1000, 1301), "price_above_market")[0].severity).toBe("block");
  });

  it("says nothing when the price is below the median", () => {
    expect(ofType(priceAt(1000, 700), "price_above_market")).toEqual([]);
  });

  it("warns when an item has no reference, rather than passing it unchecked", () => {
    const result = checkPrices(input({ references: [] }));
    expect(ofType(result, "price_above_market")).toEqual([]);
    expect(ofType(result, "missing_info")[0]).toMatchObject({ severity: "warn", data: { items: ["Cement, 50 kg bag"] } });
  });

  it("doesn't compare a price against a reference in another unit", () => {
    const result = checkPrices(input({
      lines: [{ ...cement(5000), unit: "tonne" }],
      planRemaining: [],
    }));
    expect(result.lines[0].referenceUnitPriceKesCents).toBeNull();
    expect(ofType(result, "price_above_market")).toEqual([]);
  });
});

describe("the quantity against the milestone plan", () => {
  it("says nothing at exactly 10% above what remains", () => {
    expect(ofType(checkPrices(input({ lines: [cement(780, 110)] })), "qty_above_plan")).toEqual([]);
  });

  it("isn't fooled by floating point at the limit", () => {
    const result = checkPrices(input({
      lines: [cement(780, 1.1)],
      planRemaining: [{ itemKey: "cement_50kg", qty: 1, unit: "bag" }],
    }));
    expect(ofType(result, "qty_above_plan")).toEqual([]);
  });

  it("warns just above 10%", () => {
    const [finding] = ofType(checkPrices(input({ lines: [cement(780, 111)] })), "qty_above_plan");
    expect(finding).toMatchObject({ severity: "warn", data: { ordered: 111, remaining: 100 } });
  });

  it("adds up lines for the same item", () => {
    const result = checkPrices(input({ lines: [cement(780, 60), cement(780, 60)] }));
    expect(ofType(result, "qty_above_plan")[0].data).toMatchObject({ ordered: 120, remaining: 100 });
  });

  it("warns when the item isn't in the plan at all", () => {
    const result = checkPrices(input({ planRemaining: [] }));
    expect(ofType(result, "qty_above_plan")[0].message).toContain("not in this milestone's plan");
  });

  it("warns when nothing remains", () => {
    const result = checkPrices(input({ planRemaining: [{ itemKey: "cement_50kg", qty: 0, unit: "bag" }] }));
    expect(ofType(result, "qty_above_plan")).toHaveLength(1);
  });
});

describe("the supplier", () => {
  it("warns about an unverified supplier and names the cheapest verified alternative", () => {
    const result = checkPrices(input({ quotedSupplier: baraka }));
    const [finding] = ofType(result, "unverified_supplier");
    expect(finding.severity).toBe("warn");
    expect(finding.message).toContain("Mlima Hardware at KES 39,500");
    expect(finding.data.alternativeSupplierId).toBe("s-mlima");
  });

  it("recommends the alternative even when it costs more, because money only goes to verified suppliers", () => {
    const result = checkPrices(input({ lines: [cement(700)], quotedSupplier: baraka }));
    expect(ofType(result, "cheaper_verified_supplier")).toEqual([]);
    expect(result.recommended?.supplierId).toBe("s-mlima");
  });

  it("recommends nobody when no verified supplier can supply the whole order", () => {
    const steel: QuotedLine = { itemKey: "steel_y12", description: "Y12 steel bar", qty: 10, unit: "bar", unitPriceKesCents: 115_000 };
    const result = checkPrices(input({ lines: [cement(780), steel], quotedSupplier: baraka }));
    expect(result.recommended).toBeNull();
    expect(ofType(result, "unverified_supplier")[0].message).toContain("no verified supplier");
  });

  it("recommends a verified quoted supplier when nobody is 5% cheaper", () => {
    const result = checkPrices(input({ lines: [cement(790)] }));
    expect(ofType(result, "cheaper_verified_supplier")).toEqual([]);
    expect(result.recommended).toEqual({ supplierId: "s-mlima", supplierName: "Mlima Hardware", totalKesCents: 3_950_000 });
  });

  it("recommends a verified supplier exactly 5% cheaper", () => {
    const result = checkPrices(input({
      lines: [cement(800)],
      quotedSupplier: { id: "s-kiawara", name: "Kiawara Builders Supplies", verified: true },
      verifiedSuppliers: [
        { id: "s-kiawara", name: "Kiawara Builders Supplies", prices: [{ itemKey: "cement_50kg", unit: "bag", unitPriceKesCents: 80_000 }] },
        { id: "s-mlima", name: "Mlima Hardware", prices: [{ itemKey: "cement_50kg", unit: "bag", unitPriceKesCents: 76_000 }] },
      ],
    }));
    expect(ofType(result, "cheaper_verified_supplier")[0].severity).toBe("info");
    expect(result.recommended?.supplierId).toBe("s-mlima");
  });

  it("keeps the quoted supplier when the other is just under 5% cheaper", () => {
    const result = checkPrices(input({
      lines: [cement(800)],
      quotedSupplier: { id: "s-kiawara", name: "Kiawara Builders Supplies", verified: true },
      verifiedSuppliers: [
        { id: "s-kiawara", name: "Kiawara Builders Supplies", prices: [{ itemKey: "cement_50kg", unit: "bag", unitPriceKesCents: 80_000 }] },
        { id: "s-mlima", name: "Mlima Hardware", prices: [{ itemKey: "cement_50kg", unit: "bag", unitPriceKesCents: 76_100 }] },
      ],
    }));
    expect(ofType(result, "cheaper_verified_supplier")).toEqual([]);
    expect(result.recommended?.supplierId).toBe("s-kiawara");
  });

  it("never recommends an unverified supplier", () => {
    const result = checkPrices(input({ quotedSupplier: { ...baraka, id: "s-baraka" }, verifiedSuppliers: [] }));
    expect(result.recommended).toBeNull();
  });
});

describe("missing or inconsistent information", () => {
  it("blocks and recommends nobody when a quantity is missing", () => {
    const result = checkPrices(input({ lines: [cement(780, null)] }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ type: "missing_info", severity: "block" });
    expect(result.quotedTotalKesCents).toBeNull();
    expect(result.recommended).toBeNull();
  });

  it("blocks when a price is missing", () => {
    const result = checkPrices(input({ lines: [{ ...cement(780), unitPriceKesCents: null }] }));
    expect(result.findings[0]).toMatchObject({ type: "missing_info", severity: "block" });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("treats a quantity of %s as missing", (qty) => {
    expect(checkPrices(input({ lines: [cement(780, qty)] })).recommended).toBeNull();
  });

  it("blocks when no lines could be read", () => {
    expect(checkPrices(input({ lines: [] })).findings[0].severity).toBe("block");
  });

  it("blocks when the written total doesn't match the lines", () => {
    const result = checkPrices(input({ statedTotalKesCents: 4_000_000 }));
    expect(ofType(result, "missing_info")[0]).toMatchObject({
      severity: "block", data: { stated: "40000.00", linesTotal: "39000.00" },
    });
  });

  it("allows a written total rounded to the nearest shilling", () => {
    const result = checkPrices(input({ statedTotalKesCents: 3_900_100 }));
    expect(ofType(result, "missing_info")).toEqual([]);
  });
});

describe("the demo story", () => {
  it("matches the numbers on the mock approval card", () => {
    const result = checkPrices(input({
      lines: [cement(950)],
      quotedSupplier: baraka,
      statedTotalKesCents: 4_750_000,
    }));
    const { recommended } = approvalCard;

    expect(centsToAmount(result.quotedTotalKesCents!)).toBe(approvalCard.quotedTotal.amount);
    expect(result.recommended?.supplierId).toBe(recommended?.supplierId);
    expect(centsToAmount(result.recommended!.totalKesCents)).toBe(recommended?.total.amount);
    expect(centsToAmount(kesCentsToUsdCents(result.recommended!.totalKesCents, String(recommended?.fxRate))))
      .toBe(recommended?.totalUsd.amount);
    expect(result.findings.map((f) => [f.type, f.severity]))
      .toEqual(approvalCard.findings.map((f) => [f.type, f.severity]));
    expect(ofType(result, "price_above_market")[0].message).toBe(approvalCard.findings[0].message);
    expect(ofType(result, "cheaper_verified_supplier")[0].message).toBe(approvalCard.findings[2].message);
  });
});

describe("money", () => {
  it("writes cents as decimal strings", () => {
    expect(centsToAmount(3_950_000)).toBe("39500.00");
    expect(centsToAmount(5)).toBe("0.05");
    expect(centsToAmount(-150)).toBe("-1.50");
  });

  it("formats shillings for messages", () => {
    expect(formatKes(3_950_000)).toBe("KES 39,500");
    expect(formatKes(95_050)).toBe("KES 950.50");
    expect(formatKes(100_000_000)).toBe("KES 1,000,000");
  });

  it("converts to US cents, rounding half up", () => {
    expect(kesCentsToUsdCents(3_950_000, "129.2")).toBe(30_573);
    expect(kesCentsToUsdCents(12_950, "129.5")).toBe(100);
    expect(kesCentsToUsdCents(65, "130")).toBe(1); // 0.5 of a US cent
    expect(kesCentsToUsdCents(64, "130")).toBe(0);
  });

  it("stays exact on amounts too large for a floating point product", () => {
    expect(kesCentsToUsdCents(100_000_000_000_000, "129.901648")).toBe(769_813_174_349);
  });

  it.each(["", "abc", "-129", "129.1234567", "0"])("refuses the rate %j", (rate) => {
    expect(() => kesCentsToUsdCents(100, rate)).toThrow();
  });
});
