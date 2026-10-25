import { bdToday } from "./format";

export type RSale = { id: string; created_at: string; total: number; returned_amount: number; due: number };
export type RItem = { sale_id: string; qty: number; returned_qty: number; unit_cost: number };
export type DayRow = { day: string; invoices: number; sales: number; cost: number; profit: number; due: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Net sales = total − returns; cost uses the batch cost saved at sale time for units not returned. */
export function dailyReport(sales: RSale[], items: RItem[]): DayRow[] {
  const cost = new Map<string, number>();
  for (const i of items) {
    cost.set(i.sale_id, (cost.get(i.sale_id) ?? 0) + Number(i.unit_cost) * (Number(i.qty) - Number(i.returned_qty)));
  }
  const days = new Map<string, DayRow>();
  for (const s of sales) {
    const day = bdToday(new Date(s.created_at));
    const d = days.get(day) ?? { day, invoices: 0, sales: 0, cost: 0, profit: 0, due: 0 };
    const net = Number(s.total) - Number(s.returned_amount);
    const c = cost.get(s.id) ?? 0;
    d.invoices += net > 0 ? 1 : 0;
    d.sales = r2(d.sales + net);
    d.cost = r2(d.cost + c);
    d.profit = r2(d.sales - d.cost);
    d.due = r2(d.due + Number(s.due));
    days.set(day, d);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export type PeriodRow = DayRow & { expenses: number };

/** Groups daily rows by month ("YYYY-MM") for a yearly view, or keeps days for a monthly view; adds expenses per bucket. */
export function periodReport(days: DayRow[], expenses: { expense_date: string; amount: number }[], by: "day" | "month"): PeriodRow[] {
  const key = (d: string) => (by === "month" ? d.slice(0, 7) : d);
  const out = new Map<string, PeriodRow>();
  const get = (k: string) => out.get(k) ?? { day: k, invoices: 0, sales: 0, cost: 0, profit: 0, due: 0, expenses: 0 };
  for (const d of days) {
    const x = get(key(d.day));
    x.invoices += d.invoices; x.sales = r2(x.sales + d.sales); x.cost = r2(x.cost + d.cost);
    x.profit = r2(x.sales - x.cost); x.due = r2(x.due + d.due);
    out.set(x.day, x);
  }
  for (const e of expenses) {
    const x = get(key(e.expense_date));
    x.expenses = r2(x.expenses + Number(e.amount));
    out.set(x.day, x);
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function toCsv(rows: (string | number)[][]) {
  return rows.map((r) => r.map((c) => { const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
}

/* ---------- Detailed reports: per sale, per customer, per product ---------- */

export type DSale = {
  id: string; invoice_no: string; created_at: string; status: string; customer_id: string | null;
  subtotal: number | string; item_discount: number | string; bill_discount: number | string;
  total: number | string; returned_amount: number | string; due: number | string;
  customer?: { name: string; business_name?: string | null; customer_type?: string; phone?: string | null } | null;
};
export type DItem = {
  sale_id: string; medicine_id: string; name: string;
  qty: number | string; returned_qty: number | string; unit_cost: number | string; line_total: number | string;
};

export type SaleProfit = { id: string; invoice_no: string; created_at: string; customer: string; customer_id: string | null; b2b: boolean; sales: number; cost: number; profit: number; margin: number; due: number };
export type CustomerRow = { key: string; name: string; sub: string; b2b: boolean; bills: number; sales: number; profit: number; due: number; last: string; share: number };
export type ProductRow = { medicine_id: string; name: string; qty: number; sales: number; cost: number; profit: number; margin: number };

/** Share of a line's value that is still sold after returns and the bill discount. */
function lineNet(s: DSale, i: DItem) {
  const sold = Number(i.qty) - Number(i.returned_qty);
  if (sold <= 0 || Number(i.qty) <= 0) return { net: 0, cost: 0, qty: 0 };
  const base = Number(s.subtotal) - Number(s.item_discount);
  const factor = base > 0 ? (base - Number(s.bill_discount)) / base : 0;
  return { net: (Number(i.line_total) * sold) / Number(i.qty) * factor, cost: Number(i.unit_cost) * sold, qty: sold };
}

export function custName(s: DSale) {
  if (!s.customer) return "Walk-in customers";
  return s.customer.business_name || s.customer.name;
}

/** Profit of every bill (cancelled bills are left out). */
export function saleProfits(sales: DSale[], items: DItem[]): SaleProfit[] {
  const bySale = new Map<string, DItem[]>();
  for (const i of items) bySale.set(i.sale_id, [...(bySale.get(i.sale_id) ?? []), i]);
  const out: SaleProfit[] = [];
  for (const s of sales) {
    if (s.status === "cancelled") continue;
    const net = Number(s.total) - Number(s.returned_amount);
    const cost = (bySale.get(s.id) ?? []).reduce((a, i) => a + lineNet(s, i).cost, 0);
    if (net <= 0 && cost <= 0) continue;
    const profit = r2(net - cost);
    out.push({
      id: s.id, invoice_no: s.invoice_no, created_at: s.created_at, customer: custName(s), customer_id: s.customer_id,
      b2b: s.customer?.customer_type === "b2b", sales: r2(net), cost: r2(cost), profit, margin: net > 0 ? Math.round((profit / net) * 1000) / 10 : 0, due: r2(Number(s.due)),
    });
  }
  return out;
}

/** Who buys the most: one row per customer (walk-in sales grouped together). */
export function customerReport(profits: SaleProfit[], sales: DSale[]): CustomerRow[] {
  const info = new Map(sales.map((s) => [s.id, s]));
  const m = new Map<string, CustomerRow>();
  let total = 0;
  for (const p of profits) {
    const key = p.customer_id ?? "walkin";
    const s = info.get(p.id);
    const row = m.get(key) ?? {
      key, name: p.customer, b2b: p.b2b, bills: 0, sales: 0, profit: 0, due: 0, last: p.created_at, share: 0,
      sub: s?.customer ? [s.customer.business_name ? s.customer.name : null, s.customer.phone].filter(Boolean).join(" · ") : "No customer selected",
    };
    row.bills += 1; row.sales = r2(row.sales + p.sales); row.profit = r2(row.profit + p.profit); row.due = r2(row.due + p.due);
    if (p.created_at > row.last) row.last = p.created_at;
    m.set(key, row);
    total += p.sales;
  }
  // Named customers ranked by what they bought; walk-in sales (no customer picked) always last.
  return [...m.values()].map((r) => ({ ...r, share: total > 0 ? r.sales / total : 0 }))
    .sort((a, b) => (a.key === "walkin" ? 1 : 0) - (b.key === "walkin" ? 1 : 0) || b.sales - a.sales);
}

/** Which products earn the most. */
export function productReport(sales: DSale[], items: DItem[]): ProductRow[] {
  const info = new Map(sales.filter((s) => s.status !== "cancelled").map((s) => [s.id, s]));
  const m = new Map<string, ProductRow>();
  for (const i of items) {
    const s = info.get(i.sale_id);
    if (!s) continue;
    const { net, cost, qty } = lineNet(s, i);
    if (qty <= 0) continue;
    const row = m.get(i.medicine_id) ?? { medicine_id: i.medicine_id, name: i.name, qty: 0, sales: 0, cost: 0, profit: 0, margin: 0 };
    row.qty += qty; row.sales += net; row.cost += cost;
    m.set(i.medicine_id, row);
  }
  return [...m.values()].map((r) => {
    const sales = r2(r.sales), cost = r2(r.cost), profit = r2(r.sales - r.cost);
    return { ...r, sales, cost, profit, margin: sales > 0 ? Math.round((profit / sales) * 1000) / 10 : 0 };
  }).sort((a, b) => b.profit - a.profit);
}
