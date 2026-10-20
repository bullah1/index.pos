/**
 * Pack helpers. Capsules/tablets are stocked and sold per piece, but staff think in boxes.
 * The box size is read from the medicine's strength text, e.g. "30 cap" or "10 tab" → 30 / 10.
 */
type PackInfo = { strength?: string | null; sale_unit?: string | null };

const PACK_RE = /^\s*(\d+)\s*(cap|caps|capsule|capsules|tab|tabs|tablet|tablets|pcs|pc)\s*$/i;

/** Pieces in one box, or 1 when the item is not sold by the piece. */
export function packSize(m: PackInfo): number {
  const hit = m.strength?.match(PACK_RE);
  const n = hit ? Number(hit[1]) : 1;
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** "4 box + 6 cap", "6 bottle", "0 cap". */
export function stockLabel(qty: number, m: PackInfo): string {
  const unit = m.sale_unit || "pcs";
  const pack = packSize(m);
  const q = Math.max(0, Math.round(qty * 1000) / 1000);
  if (pack <= 1) return `${q} ${unit}`;
  const boxes = Math.floor(q / pack);
  const loose = Math.round((q - boxes * pack) * 1000) / 1000;
  if (boxes === 0) return `${loose} ${unit}`;
  return loose > 0 ? `${boxes} box + ${loose} ${unit}` : `${boxes} box`;
}

/** Low stock is judged in boxes for pack items, so syrups and capsules use the same threshold. */
export function isLowStock(qty: number, m: PackInfo, threshold: number): boolean {
  return qty / packSize(m) <= threshold;
}
