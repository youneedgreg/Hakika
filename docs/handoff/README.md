# Handoff: Juliet to Greg (J1 material)

| File | What | Fix list |
|---|---|---|
| [price-sheet.ts.md](./price-sheet.ts.md) | `HAKIKA_PRICE_SHEET`, 30 items (materials, labour, equipment, permits) | below |
| [template-copy.md](./template-copy.md) | EN and SW template copy | in file |

## Quote images (updated 2 Nov, match the price sheet)

In `public/mock/quotes/`, for Nova quote-reading tests:

| File | Content | Check |
|---|---|---|
| `price-sheet.png` | Printed price sheet, 30 items | matches `HAKIKA_PRICE_SHEET` |
| `handwritten-price-list.png` | Handwritten unit prices, first 20 items | matches the sheet |
| `receipt-materials.png` | Receipt, 10 items, VAT 16%, total KES 1,300,476 | all lines, subtotal (1,121,100) and VAT (179,376) add up |
| `supplier-invoice.png` | Invoice, 30 lines, "INVOICE TOTAL 2,008,300" | **lines add up to 1,918,300, so the total is overstated by 90,000** |

The invoice error may be deliberate (a tamper test) or a typo. Items 1 to 3 of the price sheet fix list above are now resolved: the photos agree with the sheet (cement 1,100, Y12 1,450). Only the database seed still needs updating.

Demo proof photos are in `public/mock/` as PNG: `proof-cement-delivery.png` (verified scenario) and `proof-foundation-recycled.png` (aggregate stockpile, used for the suspicious scenario). `proof-excavation.jpg`, the earlier photo the recycled one is matched against, is still missing.
