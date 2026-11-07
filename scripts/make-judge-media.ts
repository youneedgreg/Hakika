// Makes Judge Mode's two drawn test images in public/judge. Both are synthetic: a fictional
// supplier's quote, and Juliet's AI-generated cement delivery photo with a code card drawn on it.
// Run with `npx tsx scripts/make-judge-media.ts`. It uses macOS fonts (Marker Felt, Courier New),
// so the output can differ on another machine; the committed images are the ones recorded.

import sharp from "sharp";
import { JUDGE_DELIVERY_CODE } from "../src/server/judge/media";

const OUT = "public/judge";

// Baraka Hardware is fictional and not a verified supplier. 50 bags at KES 1,300 is the inflated
// quote the "Inflated quote" scenario reads.
async function quote() {
  const rows = [
    ["Cement 50kg bag", "50", "1,300", "65,000"],
  ];
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500">
    <rect width="1200" height="1500" fill="#f6f1e4"/>
    <g font-family="Courier New, monospace" fill="#1d1d1b">
      <text x="600" y="150" font-size="64" font-weight="bold" text-anchor="middle">BARAKA HARDWARE</text>
      <text x="600" y="210" font-size="30" text-anchor="middle">Karatina Road, Nyeri town</text>
      <line x1="100" y1="260" x2="1100" y2="260" stroke="#1d1d1b" stroke-width="3"/>
      <text x="100" y="340" font-size="44" font-weight="bold">QUOTATION</text>
      <text x="1100" y="340" font-size="30" text-anchor="end">No. 0417</text>
      <text x="100" y="410" font-size="30">To: Peter Mwangi, Nyeri site</text>
      <text x="100" y="460" font-size="30">Date: 05/11/2026</text>
      <line x1="100" y1="530" x2="1100" y2="530" stroke="#1d1d1b" stroke-width="2"/>
      <text x="100" y="580" font-size="30" font-weight="bold">Item</text>
      <text x="680" y="580" font-size="30" font-weight="bold" text-anchor="end">Qty</text>
      <text x="880" y="580" font-size="30" font-weight="bold" text-anchor="end">Price</text>
      <text x="1100" y="580" font-size="30" font-weight="bold" text-anchor="end">Amount</text>
      <line x1="100" y1="605" x2="1100" y2="605" stroke="#1d1d1b" stroke-width="2"/>
      ${rows.map(([item, qty, price, amount], i) => `
      <text x="100" y="${670 + i * 70}" font-size="32">${item}</text>
      <text x="680" y="${670 + i * 70}" font-size="32" text-anchor="end">${qty}</text>
      <text x="880" y="${670 + i * 70}" font-size="32" text-anchor="end">${price}</text>
      <text x="1100" y="${670 + i * 70}" font-size="32" text-anchor="end">${amount}</text>`).join("")}
      <line x1="100" y1="${720 + rows.length * 70}" x2="1100" y2="${720 + rows.length * 70}" stroke="#1d1d1b" stroke-width="2"/>
      <text x="880" y="${790 + rows.length * 70}" font-size="36" font-weight="bold" text-anchor="end">TOTAL KES</text>
      <text x="1100" y="${790 + rows.length * 70}" font-size="36" font-weight="bold" text-anchor="end">65,000</text>
      <text x="100" y="1250" font-size="28">Prices valid for 7 days. Delivery to site included.</text>
      <text x="100" y="1300" font-size="28">Thank you for your business.</text>
      <text x="600" y="1440" font-size="22" text-anchor="middle" fill="#6b6b66">Fictional business. Sample quote for Hakika Judge Mode.</text>
    </g>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(`${OUT}/quote-baraka.jpg`);
}

// The delivery code written on a sheet of paper lying in front of the pallet.
async function delivery() {
  const card = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <g transform="translate(905 600) rotate(-7)">
      <rect x="6" y="8" width="230" height="150" rx="4" fill="#000" opacity="0.28"/>
      <rect width="230" height="150" rx="4" fill="#fbfaf6"/>
      <text x="115" y="100" font-family="Marker Felt" font-size="76" fill="#1b2a6b" text-anchor="middle">${JUDGE_DELIVERY_CODE}</text>
    </g>
  </svg>`;
  await sharp("public/mock/proof/proof-cement-delivery.jpg")
    .composite([{ input: Buffer.from(card) }])
    .jpeg({ quality: 88 })
    .toFile(`${OUT}/delivery-cement-coded.jpg`);
}

async function main() {
  await quote();
  await delivery();
  console.log(`Wrote ${OUT}/quote-baraka.jpg and ${OUT}/delivery-cement-coded.jpg`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
