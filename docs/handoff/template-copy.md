# Template copy from Juliet (EN and SW)

Final copy, updated 2 Nov. Source for `src/server/whatsapp/templates.ts` and the proof and approval screens. Not yet wired in; that file is Greg's.

| Key | English | Swahili |
|---|---|---|
| verification_prompt | Please upload a clear photo of the site or item along with the corresponding receipt to verify this milestone. | Tafadhali pakia picha wazi ya eneo au bidhaa pamoja na risiti husika ili kuthibitisha hatua hii. |
| item_description | Delivery and installation of general building materials, verified against project milestone specifications. | Usafirishaji na ufungaji wa vifaa vya ujenzi, vilivyothibitishwa kulingana na maelezo ya mradi. |
| status_pending_review | Pending Review: We have received your proof; awaiting review by the owner. | Inasubiri Ukaguzi: Tumepokea uthibitisho wako; unasubiri ukaguzi wa mmiliki. |
| status_approved | Approved: Milestone successfully verified and payment can proceed. | Imethibitishwa: Hatua imefanikiwa kukaguliwa na malipo yanaweza kufanyika. |
| status_flagged | Flagged: Discrepancy detected in the submitted proof. Please re-upload. | Imewekewa Alama: Hitilafu imegunduliwa kwenye uthibitisho uliowasilishwa. Tafadhali pakia upya. |

## Notes for wiring

1. Plain text, no bold markers. If WhatsApp bold is wanted, use `*Pending Review:*`.
2. Fixed templates only. No model-written text goes to people on site.
3. "Approved" means the owner can now pay. Only the owner's PayPal approval moves money.
4. "unasubiri ukaguzi wa mmiliki" literally says "you are awaiting the owner's review". A more natural wording is "inasubiri ukaguzi wa mmiliki" (it is awaiting). Juliet to confirm.
