# Handoff: Juliet to Greg (J1 material)

| File | What |
|---|---|
| [price-sheet.ts.md](./price-sheet.ts.md) | `HAKIKA_PRICE_SHEET`, 31 items (materials, labour, equipment, permits) |
| [template-copy.md](./template-copy.md) | EN and SW template copy |

## Quote images (test fixtures, not public assets)

The six files are in `tests/fixtures/quotes/` and are not served by the app. Each is a synthetic fixture, not a real supplier document.

| File | Content | Check |
|---|---|---|
| `price-sheet.png` | Printed price sheet, 31 items | AI-generated mock document for this demo; matches `HAKIKA_PRICE_SHEET` |
| `handwritten-price-list.png` | Handwritten unit prices, first 20 items | AI-generated mock document for this demo; matches the sheet |
| `receipt-materials.png` | Receipt, 10 items, VAT 16%, total KES 1,300,476 | AI-generated mock document for this demo; subtotal (1,121,100) and VAT (179,376) add up |
| `supplier-invoice.png` | Invoice, 30 lines, "INVOICE TOTAL 2,008,300" | AI-generated mock document for this demo; **lines add up to 1,918,300, so the total is overstated by 90,000** |
| `simba-receipt.jpg` | Nyeri steel invoice with the grand-total field intentionally blank | Created in-project as a synthetic fixture; deliberate negative test for missing-total extraction |
| `ujenzi-yetu-receipt.jpg` | Fictional Ujenzi Yetu cement receipt, 200 bags at KES 1,100 each | Created in-project as a synthetic fixture; total KES 220,000 |

The AI-generated quote mock documents have no external source and do not represent real suppliers. The supplier-invoice discrepancy may be deliberate (a tamper test) or a typo. The cement and Y12 receipt amounts agree with the price sheet.

The price sheet, demo reference price, and both seeded suppliers use KES 1,100 per bag for cement. The demo approval card compares a KES 1,300 quote with Kiawara Builders Supplies' KES 1,100 price; both verified suppliers share that price.

## Proof photos

Proof images are served from `public/mock/proof/`:

| File | Use |
|---|---|
| `proof-cement-delivery.jpg` | Verified delivery scenario; AI-generated synthetic illustration showing cement bags, not evidence of a real delivery |
| `proof-foundation-recycled.png` | Suspicious scenario; exact PNG format re-save of `foundation-2.jpg`, same 355 x 579 dimensions |
| `foundation-2.jpg` | AI-generated synthetic foundation-site photo used as the duplicate-match reference |
| `excavation.jpg` | Unsplash construction photo |

`proof-cement-delivery.jpg` and `foundation-2.jpg` are original AI-generated images made for the Hakika demo; they have no external source. The recycled proof is saved from the decoded JPEG as PNG without cropping or other image edits, so it remains the same picture at 355 x 579 pixels. `excavation.jpg` is from Unsplash under the [Unsplash License](https://unsplash.com/license): [photo 1541888946425-d81bb19240f5](https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1200&q=85).
