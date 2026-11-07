// 64-bit difference hash (dHash) of a photo: shrink to 9×8 grey pixels, then one bit per pair of
// side-by-side pixels (1 when the left one is brighter). Near-identical photos (re-saved, resized,
// lightly cropped) land a few bits apart; different photos land about 32 bits apart. The
// verification engine compares hashes by Hamming distance.

import sharp from "sharp";

export class UnreadableImage extends Error {}

export async function dHash(bytes: Uint8Array): Promise<string> {
  let pixels: Buffer;
  try {
    pixels = await sharp(bytes, { failOn: "error" })
      .rotate() // apply the camera's orientation first, so a sideways copy hashes the same
      .greyscale()
      .resize(9, 8, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
  } catch (error) {
    throw new UnreadableImage(error instanceof Error ? error.message : "unreadable image");
  }

  // 64 bits, row by row, written 4 bits to a hex digit.
  let hex = "";
  let nibble = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    const col = i % 8;
    nibble = (nibble << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? 1 : 0);
    if (i % 4 === 3) {
      hex += nibble.toString(16);
      nibble = 0;
    }
  }
  return hex;
}

const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// The number of bits two 16-hex-digit hashes differ by (0 to 64).
export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) throw new Error("A dHash is 16 hex digits.");
  let count = 0;
  for (let i = 0; i < 16; i++) count += NIBBLE_BITS[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return count;
}
