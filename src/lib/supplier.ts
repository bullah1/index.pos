const r2 = (n: number) => Math.round(n * 100) / 100;

export type SPurchase = { supplier_id: string; total: number; paid: number };

/** Balance per supplier = purchase totals − paid (paid already includes supplier payments). */
export function supplierBalances(purchases: SPurchase[]) {
  const out = new Map<string, { billed: number; paid: number; balance: number }>();
  for (const p of purchases) {
    const x = out.get(p.supplier_id) ?? { billed: 0, paid: 0, balance: 0 };
    x.billed = r2(x.billed + Number(p.total));
    x.paid = r2(x.paid + Number(p.paid));
    x.balance = r2(x.billed - x.paid);
    out.set(p.supplier_id, x);
  }
  return out;
}

/** Mirrors pay_supplier: oldest purchase gets paid first; cannot exceed the balance. */
export function allocateSupplierPayment(open: { id: string; balance: number }[], amount: number) {
  const total = r2(open.reduce((s, o) => s + o.balance, 0));
  if (!(amount > 0)) return { error: "Amount must be more than 0" as const };
  if (amount > total) return { error: "Amount is more than the supplier balance" as const };
  let left = amount;
  const parts: { id: string; amount: number }[] = [];
  for (const o of open) {
    if (left <= 0) break;
    const take = r2(Math.min(left, o.balance));
    parts.push({ id: o.id, amount: take });
    left = r2(left - take);
  }
  return { parts };
}
