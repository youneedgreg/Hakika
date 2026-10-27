import { describe, expect, it } from "vitest";
import { csvCell, ledgerToCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain values alone and blanks missing ones", () => {
    expect(csvCell("Cement delivery")).toBe("Cement delivery");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("50 bags, Y12")).toBe('"50 bags, Y12"');
    expect(csvCell('the "good" cement')).toBe('"the ""good"" cement"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("defuses spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+254700000000")).toBe("'+254700000000");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});

describe("ledgerToCsv", () => {
  it("writes a header and one line per row", () => {
    const csv = ledgerToCsv([
      {
        at: "2026-10-03T15:20:00Z", kind: "payment", description: "Labour, excavation",
        amount: { amount: "60000.00", currency: "KES" }, amountUsd: { amount: "464.40", currency: "USD" },
        paypalOrderId: "ORDER1", paypalCaptureId: "CAPTURE1", link: {},
      },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "at,kind,description,amount,currency,amount_usd,paypal_order_id,paypal_capture_id,request_id,proof_id",
      '2026-10-03T15:20:00Z,payment,"Labour, excavation",60000.00,KES,464.40,ORDER1,CAPTURE1,,',
      "",
    ]);
  });
});
