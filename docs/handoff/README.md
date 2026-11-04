# Handoff: Juliet to Greg (J1 material)

| File | What |
|---|---|
| [price-sheet.ts.md](./price-sheet.ts.md) | `HAKIKA_PRICE_SHEET`, 31 items (materials, labour, equipment, permits) |
| [template-copy.md](./template-copy.md) | EN and SW template copy |

## Quote images (updated 2 Nov, match the price sheet)

In `public/mock/quotes/`, for Nova quote-reading tests:

| File | Content | Check |
|---|---|---|
| `price-sheet.png` | Printed price sheet, 31 items | matches `HAKIKA_PRICE_SHEET` |
| `handwritten-price-list.png` | Handwritten unit prices, first 20 items | matches the sheet |
| `receipt-materials.png` | Receipt, 10 items, VAT 16%, total KES 1,300,476 | all lines, subtotal (1,121,100) and VAT (179,376) add up |
| `supplier-invoice.png` | Invoice, 30 lines, "INVOICE TOTAL 2,008,300" | **lines add up to 1,918,300, so the total is overstated by 90,000** |
| `simba-receipt.jpg` | Steel invoice with the grand-total field intentionally blank | Deliberate negative test for missing-total extraction; keep the blank total |
| `twiga-receipt.jpg` | Cement receipt, 200 bags at KES 1,100 each | Total KES 220,000 |

The supplier-invoice discrepancy may be deliberate (a tamper test) or a typo. The cement and Y12 receipt amounts agree with the price sheet.

The reference price sheet keeps cement at KES 1,100 per bag from Twiga. The demo approval card uses a separate Mlima quote; reconcile those prices after the final supplier decision.

## Proof photos

Proof images are served from `public/mock/proof/`:

| File | Use |
|---|---|
| `proof-cement-delivery.jpg` | Verified delivery scenario |
| `proof-foundation-recycled.png` | Suspicious scenario; a cropped, re-saved variant of `foundation-2.jpg` |
| `foundation-2.jpg` | Earlier foundation photo used as the duplicate-match reference |
| `excavation.jpg` | Replacement Unsplash construction photo |

`proof-cement-delivery.jpg` and `excavation.jpg` are Unsplash images used under the [Unsplash License](https://unsplash.com/license): [photo 1504307651254-35680f356dfd](https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1200&q=85) and [photo 1541888946425-d81bb19240f5](https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1200&q=85), respectively.
