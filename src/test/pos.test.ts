import { describe, expect, it } from "vitest";
import { computeTotals, fefoAllocate, fefoGross, sellableStock, settlePayments, validateCart, type CartLine } from "@/lib/pos";

const line = (o: Partial<CartLine> = {}): CartLine => ({
  medicine_id: "m1", name: "Napa", qty: 2, unit_price: 10.5, discount: 0, available: 100, ...o,
});

describe("POS totals", () => {
  it("computes split payments and due", () => {
    const t = computeTotals([line({ qty: 3 })], 1.5, [
      { method: "cash", amount: 10 },
      { method: "bkash", amount: 15 },
    ]);
    expect(t.subtotal).toBe(31.5);
    expect(t.payable).toBe(30);
    expect(t.paid).toBe(25);
    expect(t.due).toBe(5);
  });
  it("blocks credit sale without a customer", () => {
    expect(validateCart([line()], 0, [], false)).toMatch(/customer/);
    expect(validateCart([line()], 0, [], true)).toBeNull();
  });
  it("blocks overselling", () => {
    expect(validateCart([line({ qty: 5, available: 4 })], 0, [{ method: "cash", amount: 52.5 }], false)).toMatch(/Only 4/);
  });
  it("blocks overpayment by mobile/bank but allows cash change", () => {
    expect(validateCart([line()], 0, [{ method: "bkash", amount: 50 }], false)).toMatch(/more than payable/);
    expect(validateCart([line()], 0, [{ method: "cash", amount: 50 }], false)).toBeNull();
    expect(computeTotals([line()], 0, [{ method: "cash", amount: 50 }]).change).toBe(29);
  });
  it("saves only the cash kept after change", () => {
    expect(settlePayments([{ method: "bkash", amount: 10 }, { method: "cash", amount: 500 }], 489)).toEqual([
      { method: "bkash", amount: 10 },
      { method: "cash", amount: 11 },
    ]);
    expect(settlePayments([{ method: "cash", amount: 0 }], 0)).toEqual([]);
  });
  it("prices a FEFO split at each batch's own price", () => {
    const b = [
      { id: "a", batch_no: "A", expiry_date: "2027-01-01", qty_on_hand: 2, sale_price: 2 },
      { id: "b", batch_no: "B", expiry_date: "2028-01-01", qty_on_hand: 50, sale_price: 2.5 },
    ];
    expect(fefoGross(b, 3, "2026-10-15")).toBe(6.5);
    expect(computeTotals([line({ qty: 3, unit_price: 2, gross: 6.5 })], 0, []).payable).toBe(6.5);
  });
});

describe("FEFO", () => {
  const batches = [
    { id: "late", batch_no: "B2", expiry_date: "2027-06-01", qty_on_hand: 50, sale_price: 10 },
    { id: "early", batch_no: "B1", expiry_date: "2026-12-01", qty_on_hand: 5, sale_price: 10 },
    { id: "expired", batch_no: "B0", expiry_date: "2026-01-01", qty_on_hand: 99, sale_price: 10 },
  ];
  it("takes earliest-expiring batch first and skips expired", () => {
    const r = fefoAllocate(batches, 8, "2026-10-14");
    expect(r.allocations.map((a) => [a.batch.id, a.qty])).toEqual([["early", 5], ["late", 3]]);
    expect(r.shortBy).toBe(0);
  });
  it("does not count expired stock as sellable", () => {
    expect(sellableStock(batches, "2026-10-14")).toBe(55);
    expect(fefoAllocate(batches, 60, "2026-10-14").shortBy).toBe(5);
  });
});

import { returnValue, splitRefund } from "@/lib/pos";
describe("returns", () => {
  it("shares bill discount pro-rata", () => {
    expect(returnValue({ subtotal: 200, item_discount: 0, bill_discount: 20 }, [{ line_total: 100, qty: 10, returnQty: 5 }])).toBe(45);
  });
  it("clears due before refunding", () => {
    expect(splitRefund(45, 30)).toEqual({ dueReduced: 30, refund: 15 });
  });
});
