// Cash drawer math. Money handled in paisa (integers) so totals never drift.
const p = (n: number | string | null | undefined) => Math.round((Number(n) || 0) * 100);
const t = (n: number) => n / 100;

export type CashMovement = { created_by: string; amount: number | string };
export type DrawerRecord = { user_id: string; opening: number | string; counted: number | string | null };

export interface DrawerSources {
  /** One drawer row per staff member for the day (may be missing). */
  drawers: DrawerRecord[];
  /** Cash collected at the counter (sale_payments kind = sale). */
  cashSales: CashMovement[];
  /** Customer due collections (customer_payments) — money in, but not a new sale. */
  dueCollections: CashMovement[];
  /** Cash handed back for returns/refunds. */
  cashRefunds: CashMovement[];
  /** Operating expenses paid from the drawer. */
  expenses: CashMovement[];
  /** Cash paid to suppliers. */
  supplierPayments: CashMovement[];
}

export interface DrawerRow {
  user_id: string;
  opening: number;
  cashSales: number;
  dueCollections: number;
  cashRefunds: number;
  expenses: number;
  supplierPayments: number;
  cashIn: number;
  cashOut: number;
  /** opening + cash in - cash out: what the drawer should hold. */
  expected: number;
  /** Cash actually counted, or null while the drawer is still open. */
  counted: number | null;
  /** counted - expected (negative means short). */
  difference: number | null;
}

function byUser(list: CashMovement[]) {
  const m = new Map<string, number>();
  for (const x of list) m.set(x.created_by, (m.get(x.created_by) ?? 0) + p(x.amount));
  return m;
}

/** One row per staff member who opened a drawer or moved cash that day. */
export function drawerRows(s: DrawerSources): DrawerRow[] {
  const sales = byUser(s.cashSales);
  const dues = byUser(s.dueCollections);
  const refunds = byUser(s.cashRefunds);
  const exp = byUser(s.expenses);
  const sup = byUser(s.supplierPayments);
  const drawer = new Map(s.drawers.map((d) => [d.user_id, d]));

  const ids = new Set<string>([
    ...s.drawers.map((d) => d.user_id),
    ...[s.cashSales, s.dueCollections, s.cashRefunds, s.expenses, s.supplierPayments]
      .flatMap((l) => l.map((x) => x.created_by)),
  ]);

  const rows: DrawerRow[] = [];
  for (const user_id of ids) {
    const d = drawer.get(user_id);
    const opening = p(d?.opening ?? 0);
    const cashSales = t(sales.get(user_id) ?? 0);
    const dueCollections = t(dues.get(user_id) ?? 0);
    const cashRefunds = t(refunds.get(user_id) ?? 0);
    const expenses = t(exp.get(user_id) ?? 0);
    const supplierPayments = t(sup.get(user_id) ?? 0);
    const cashIn = t(p(cashSales) + p(dueCollections));
    const cashOut = t(p(cashRefunds) + p(expenses) + p(supplierPayments));
    const expected = t(opening + p(cashIn) - p(cashOut));
    const counted = d?.counted == null ? null : t(p(d.counted));
    rows.push({
      user_id,
      opening: t(opening),
      cashSales,
      dueCollections,
      cashRefunds,
      expenses,
      supplierPayments,
      cashIn,
      cashOut,
      expected,
      counted,
      difference: counted == null ? null : t(p(counted) - p(expected)),
    });
  }
  return rows.sort((a, b) => a.user_id.localeCompare(b.user_id));
}

export interface DrawerSummary {
  opening: number;
  cashIn: number;
  cashOut: number;
  expected: number;
  /** Sum of counted cash from closed drawers only. */
  counted: number;
  /** Drawers still open (no counted cash yet). */
  unclosed: number;
  /** counted - expected, or null while any drawer is still open. */
  difference: number | null;
}

export function drawerSummary(rows: DrawerRow[]): DrawerSummary {
  let opening = 0, cashIn = 0, cashOut = 0, counted = 0, closed = 0, unclosed = 0;
  for (const r of rows) {
    opening += p(r.opening);
    cashIn += p(r.cashIn);
    cashOut += p(r.cashOut);
    if (r.counted == null) unclosed++;
    else {
      counted += p(r.counted);
      closed++;
    }
  }
  const expected = opening + p(cashIn / 100) - p(cashOut / 100);
  return {
    opening: t(opening),
    cashIn: t(cashIn),
    cashOut: t(cashOut),
    expected: t(expected),
    counted: t(counted),
    unclosed,
    difference: closed > 0 && unclosed === 0 ? t(p(counted / 100) - expected) : null,
  };
}

/** The drawer that belongs to a single staff member, if any. */
export function myDrawerRow(rows: DrawerRow[], userId: string) {
  return rows.find((r) => r.user_id === userId) ?? null;
}
