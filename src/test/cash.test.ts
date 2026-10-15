import { describe, expect, it } from "vitest";
import { drawerRows, drawerSummary, myDrawerRow } from "../lib/cash";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const mv = (user: string, amount: number) => ({ created_by: user, amount });

describe("cash drawer math", () => {
  it("counts due collections as cash in", () => {
    const rows = drawerRows({
      drawers: [{ user_id: A, opening: 500, counted: null }],
      cashSales: [mv(A, 1200)],
      dueCollections: [mv(A, 300)],
      cashRefunds: [],
      expenses: [],
      supplierPayments: [],
    });
    expect(rows[0].cashIn).toBe(1500);
    expect(rows[0].dueCollections).toBe(300);
    expect(rows[0].cashOut).toBe(0);
    expect(rows[0].expected).toBe(2000);
  });

  it("reduces cash by refunds, expenses and supplier payments", () => {
    const rows = drawerRows({
      drawers: [{ user_id: A, opening: 1000, counted: null }],
      cashSales: [mv(A, 800)],
      dueCollections: [mv(A, 200)],
      cashRefunds: [mv(A, 150)],
      expenses: [mv(A, 100)],
      supplierPayments: [mv(A, 500)],
    });
    expect(rows[0].cashIn).toBe(1000);
    expect(rows[0].cashOut).toBe(750);
    expect(rows[0].expected).toBe(1250);
  });

  it("difference is counted minus expected and stays null until counted", () => {
    const open = drawerRows({
      drawers: [{ user_id: A, opening: 100, counted: null }],
      cashSales: [mv(A, 50)],
      dueCollections: [],
      cashRefunds: [],
      expenses: [],
      supplierPayments: [],
    });
    expect(open[0].expected).toBe(150);
    expect(open[0].counted).toBeNull();
    expect(open[0].difference).toBeNull();

    const closed = drawerRows({
      drawers: [{ user_id: A, opening: 100, counted: 140 }],
      cashSales: [mv(A, 50)],
      dueCollections: [],
      cashRefunds: [],
      expenses: [],
      supplierPayments: [],
    });
    expect(closed[0].difference).toBe(-10);
  });

  it("keeps staff separate and includes a cashier who never opened a drawer", () => {
    const rows = drawerRows({
      drawers: [{ user_id: A, opening: 200, counted: null }],
      cashSales: [mv(A, 100), mv(B, 60)],
      dueCollections: [mv(B, 40)],
      cashRefunds: [],
      expenses: [],
      supplierPayments: [],
    });
    expect(rows).toHaveLength(2);
    expect(myDrawerRow(rows, A)?.expected).toBe(300);
    const b = myDrawerRow(rows, B);
    expect(b?.opening).toBe(0);
    expect(b?.expected).toBe(100);
  });

  it("adds paisa exactly, without float drift", () => {
    const rows = drawerRows({
      drawers: [{ user_id: A, opening: 0, counted: null }],
      cashSales: [mv(A, 0.1), mv(A, 0.2)],
      dueCollections: [mv(A, 19.99)],
      cashRefunds: [],
      expenses: [],
      supplierPayments: [],
    });
    expect(rows[0].cashSales).toBe(0.3);
    expect(rows[0].cashIn).toBe(20.29);
    expect(rows[0].expected).toBe(20.29);
  });

  it("sums the shop and only compares cash once every drawer is closed", () => {
    const rows = drawerRows({
      drawers: [
        { user_id: A, opening: 500, counted: 900 },
        { user_id: B, opening: 0, counted: null },
      ],
      cashSales: [mv(A, 400), mv(B, 250)],
      dueCollections: [mv(A, 0)],
      cashRefunds: [],
      expenses: [mv(A, 50)],
      supplierPayments: [],
    });
    const s = drawerSummary(rows);
    expect(s.opening).toBe(500);
    expect(s.cashIn).toBe(650);
    expect(s.cashOut).toBe(50);
    expect(s.expected).toBe(1100);
    expect(s.counted).toBe(900);
    expect(s.unclosed).toBe(1);
    expect(s.difference).toBeNull();

    const allClosed = rows.map((r) => (r.user_id === B ? { ...r, counted: 200, difference: -50 } : r));
    // A: 850 expected vs 900 counted (+50); B: 250 vs 200 (−50) → shop is exactly even
    expect(drawerSummary(allClosed).difference).toBe(0);
  });
});
