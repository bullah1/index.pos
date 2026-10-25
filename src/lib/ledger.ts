/**
 * Customer statement (ledger). Every money event on the customer's bills, oldest first:
 *   bill (+total), paid at the counter (−), items returned (−), cash refunded (+), due collected (−).
 * The running balance is what the customer still owes; at the end it equals the sum of their bills' due.
 */
export type LSale = { id: string; invoice_no: string; created_at: string; total: number | string; returned_amount: number | string; status: string };
export type LPay = { sale_id: string; kind: string; method: string; amount: number | string; created_at: string };
export type LReturn = { sale_id: string; amount: number | string; created_at: string; kind?: string };
export type LCollect = { amount: number | string; method: string; created_at: string; note?: string | null };
export type LedgerLine = { at: string; text: string; ref: string; debit: number; credit: number; balance: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const M: Record<string, string> = { cash: "Cash", bkash: "bKash", nagad: "Nagad", rocket: "Rocket", bank: "Bank" };

export function customerLedger(sales: LSale[], pays: LPay[], returns: LReturn[], collections: LCollect[], from: string, to: string) {
  const inv = new Map(sales.map((s) => [s.id, s.invoice_no]));
  const ev: Omit<LedgerLine, "balance">[] = [];
  for (const s of sales) ev.push({ at: s.created_at, text: "Bill", ref: s.invoice_no, debit: Number(s.total), credit: 0 });
  for (const p of pays) {
    if (p.kind === "sale") ev.push({ at: p.created_at, text: `Paid (${M[p.method] ?? p.method})`, ref: inv.get(p.sale_id) ?? "", debit: 0, credit: Number(p.amount) });
    if (p.kind === "refund") ev.push({ at: p.created_at, text: `Refund given (${M[p.method] ?? p.method})`, ref: inv.get(p.sale_id) ?? "", debit: Number(p.amount), credit: 0 });
  }
  for (const r of returns) ev.push({ at: r.created_at, text: r.kind === "cancel" ? "Bill cancelled" : "Items returned", ref: inv.get(r.sale_id) ?? "", debit: 0, credit: Number(r.amount) });
  for (const c of collections) ev.push({ at: c.created_at, text: `Due collected (${M[c.method] ?? c.method})${c.note ? ` · ${c.note}` : ""}`, ref: "", debit: 0, credit: Number(c.amount) });
  // Same moment: bill, payment, return, refund, collection — the order they happen at the counter.
  const rank = (t: string) => (t === "Bill" ? 0 : t.startsWith("Paid") ? 1 : t.startsWith("Items") || t.startsWith("Bill cancelled") ? 2 : t.startsWith("Refund") ? 3 : 4);
  ev.sort((a, b) => a.at.localeCompare(b.at) || rank(a.text) - rank(b.text));

  let opening = 0;
  const lines: LedgerLine[] = [];
  let bal = 0;
  for (const e of ev) {
    bal = r2(bal + e.debit - e.credit);
    const day = e.at.slice(0, 10);
    if (day < from) { opening = bal; continue; }
    if (day > to) break;
    lines.push({ ...e, debit: r2(e.debit), credit: r2(e.credit), balance: bal });
  }
  const billed = r2(lines.reduce((a, l) => a + l.debit, 0));
  const paid = r2(lines.reduce((a, l) => a + l.credit, 0));
  return { opening, lines, billed, paid, closing: r2(opening + billed - paid) };
}

/** Whole days between an ISO time and a Bangladesh date. */
export function daysSince(isoTime: string, today: string) {
  const d = new Date(today + "T00:00:00+06:00").getTime() - new Date(new Date(isoTime).toISOString().slice(0, 10) + "T00:00:00+06:00").getTime();
  return Math.max(0, Math.round(d / 86400000));
}
