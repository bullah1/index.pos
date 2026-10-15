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
