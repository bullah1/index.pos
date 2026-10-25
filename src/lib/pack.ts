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

/** "126" → 126 pieces; for box items "4+6" → 4 boxes + 6 pieces. Returns null when not a valid number. */
export function parseCount(text: string, pack: number): number | null {
  const s = text.trim();
  if (s === "") return null;
  const parts = s.split("+").map((x) => x.trim());
  if (parts.length > 2 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null;
  if (parts.length === 2) return Number(parts[0]) * pack + Number(parts[1]);
  return Number(parts[0]);
}

/** Suggested order in boxes: enough for `cover` days of sales, minus what is on the shelf; never below 1 box when out of stock but selling. */
export function suggestBoxes(stock: number, soldPerDay: number, pack: number, cover: number) {
  const need = soldPerDay * cover - stock;
  if (need <= 0) return stock <= 0 && soldPerDay > 0 ? 1 : 0;
  return Math.ceil(need / pack);
}
