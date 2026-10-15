// Pure POS math. All money handled in paisa (integers) to avoid float drift.
export type PayMethod = "cash" | "bkash" | "nagad" | "rocket" | "bank";
export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
  { value: "bank", label: "Bank" },
];

export interface CartLine {
  medicine_id: string;
  name: string;
  qty: number;
  unit_price: number;
  discount: number; // line discount in taka
  available: number; // sellable (non-expired) stock
  /** Exact line amount before discount when FEFO splits the qty across batches with different prices. */
  gross?: number | undefined;
  /** Price typed at the counter; replaces the batch price for every unit of this line. */
  price?: number | undefined;
}

export interface Payment {
  method: PayMethod;
  amount: number;
}

const p = (n: number) => Math.round((Number(n) || 0) * 100);
const t = (n: number) => n / 100;

/** Line amount before discount, in paisa. */
function grossP(l: CartLine) {
  return l.gross != null ? p(l.gross) : p(l.qty * l.unit_price);
}

export function lineTotal(l: CartLine) {
  return t(grossP(l) - p(l.discount));
}

export function computeTotals(lines: CartLine[], billDiscount: number, payments: Payment[]) {
  const subtotal = lines.reduce((s, l) => s + grossP(l), 0);
  const itemDiscount = lines.reduce((s, l) => s + p(l.discount), 0);
  const payable = subtotal - itemDiscount - p(billDiscount);
  const paid = payments.reduce((s, x) => s + Math.max(0, p(x.amount)), 0);
  const cash = payments.filter((x) => x.method === "cash").reduce((s, x) => s + Math.max(0, p(x.amount)), 0);
  const over = Math.max(0, paid - payable);
  return {
    subtotal: t(subtotal),
    itemDiscount: t(itemDiscount),
    billDiscount: t(p(billDiscount)),
    payable: t(payable),
    paid: t(paid),
    due: t(Math.max(0, payable - paid)),
    overpaid: t(over),
    /** Cash to hand back. Only cash can be over-tendered; mobile/bank must be exact. */
    change: t(over > 0 && cash >= over ? over : 0),
  };
}

export function validateCart(lines: CartLine[], billDiscount: number, payments: Payment[], hasCustomer: boolean): string | null {
  if (lines.length === 0) return "Cart is empty";
  for (const l of lines) {
    if (!(l.qty > 0)) return `Quantity must be positive for ${l.name}`;
    if (l.qty > l.available) return `Only ${l.available} in stock for ${l.name}`;
    if (!(l.discount >= 0) || p(l.discount) > grossP(l)) return `Invalid discount for ${l.name}`;
  }
  if (!(billDiscount >= 0)) return "Invalid bill discount";
  if (payments.some((x) => !(x.amount >= 0))) return "Invalid payment amount";
  const tot = computeTotals(lines, billDiscount, payments);
  if (tot.payable < 0) return "Discount exceeds bill amount";
  if (tot.overpaid > 0 && tot.change === 0) return "Paid amount is more than payable (only cash can be more — change is returned)";
  if (tot.due > 0 && !hasCustomer) return "Select a customer for due/credit sales";
  return null;
}

/** Payments to save: drops zero rows and keeps only the cash that stays in the drawer (change handed back). */
export function settlePayments(payments: Payment[], change: number): Payment[] {
  let left = p(change);
  const out: Payment[] = [];
  for (const x of [...payments].reverse()) {
    let amt = Math.max(0, p(x.amount));
    if (x.method === "cash" && left > 0) {
      const cut = Math.min(left, amt);
      amt -= cut;
      left -= cut;
    }
    if (amt > 0) out.unshift({ method: x.method, amount: t(amt) });
  }
  return out;
}

export interface BatchLite {
  id: string;
  batch_no: string;
  expiry_date: string; // YYYY-MM-DD
  qty_on_hand: number;
  sale_price: number;
  created_at?: string;
  unit_cost?: number;
}

/** First-Expiry-First-Out allocation preview. Mirrors the database rule. */
export function fefoAllocate(batches: BatchLite[], qty: number, today: string) {
  const usable = batches
    .filter((b) => b.expiry_date > today && Number(b.qty_on_hand) > 0)
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const out: { batch: BatchLite; qty: number }[] = [];
  let need = qty;
  for (const b of usable) {
    if (need <= 0) break;
    const take = Math.min(need, Number(b.qty_on_hand));
    out.push({ batch: b, qty: take });
    need -= take;
  }
  return { allocations: out, shortBy: Math.max(0, need) };
}

/** Exact amount for qty under FEFO (each batch at its own price, or the counter price), matching post_sale rounding. */
export function fefoGross(batches: BatchLite[], qty: number, today: string, price?: number) {
  const { allocations } = fefoAllocate(batches, qty, today);
  return t(allocations.reduce((s, a) => s + p(a.qty * (price ?? Number(a.batch.sale_price))), 0));
}

export function sellableStock(batches: BatchLite[], today: string) {
  return batches.filter((b) => b.expiry_date > today).reduce((s, b) => s + Number(b.qty_on_hand), 0);
}

/** Refund value of returned qty; mirrors return_sale (bill discount shared pro-rata). */
export function returnValue(
  sale: { subtotal: number; item_discount: number; bill_discount: number },
  lines: { line_total: number; qty: number; returnQty: number }[],
) {
  const net = Number(sale.subtotal) - Number(sale.item_discount);
  const f = net > 0 ? (net - Number(sale.bill_discount)) / net : 0;
  return lines.reduce((s, l) => s + (l.returnQty > 0 ? Math.round((Number(l.line_total) * l.returnQty / Number(l.qty)) * f * 100) : 0), 0) / 100;
}

/** Return value goes to clearing due first, rest is refunded. */
export function splitRefund(value: number, due: number) {
  const d = Math.min(Number(due), value);
  return { dueReduced: d, refund: Math.round((value - d) * 100) / 100 };
}
