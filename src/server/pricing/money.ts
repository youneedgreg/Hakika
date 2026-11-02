// Money arithmetic in integer cents. The rate is kept as a decimal string, so converting never
// goes through a floating point number.

const RATE_SCALE = BigInt(1_000_000);
const TWO = BigInt(2);

export function centsToAmount(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const part = Math.abs(cents % 100).toString().padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${Math.abs(whole)}.${part}`;
}

// "KES 39,500", or "KES 39,500.50" when there are cents to show.
export function formatKes(cents: number): string {
  const [whole, part] = centsToAmount(cents).split(".");
  return `KES ${whole.replace(/\B(?=(\d{3})+$)/g, ",")}${part === "00" ? "" : `.${part}`}`;
}

// Rounds to the nearest US cent, half up. kesPerUsd has at most six decimals, as fx_rates stores it.
export function kesCentsToUsdCents(kesCents: number, kesPerUsd: string): number {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(kesPerUsd);
  if (!match) throw new Error("The exchange rate is not a decimal number.");
  const rate = BigInt(match[1]) * RATE_SCALE + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (rate === BigInt(0)) throw new Error("The exchange rate is zero.");
  return Number((BigInt(kesCents) * RATE_SCALE * TWO + rate) / (rate * TWO));
}
