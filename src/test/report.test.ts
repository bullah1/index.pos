import { describe, expect, it } from "vitest";
import { dailyReport } from "@/lib/report";

describe("daily report", () => {
  it("groups by Bangladesh day and subtracts returns from sales and cost", () => {
    const rows = dailyReport(
      [
        { id: "a", created_at: "2026-10-14T19:00:00Z", total: 100, returned_amount: 0, due: 10 }, // 15 Oct in Dhaka
        { id: "b", created_at: "2026-10-14T10:00:00Z", total: 200, returned_amount: 50, due: 0 },
      ],
      [
        { sale_id: "a", qty: 2, returned_qty: 0, unit_cost: 30 },
        { sale_id: "b", qty: 4, returned_qty: 1, unit_cost: 40 },
      ],
    );
    expect(rows.map((r) => r.day)).toEqual(["2026-10-15", "2026-10-14"]);
    expect(rows[0]).toMatchObject({ sales: 100, cost: 60, profit: 40, due: 10 });
    expect(rows[1]).toMatchObject({ sales: 150, cost: 120, profit: 30 });
  });
  it("does not count fully cancelled invoices", () => {
    const [r] = dailyReport([{ id: "c", created_at: "2026-10-14T10:00:00Z", total: 80, returned_amount: 80, due: 0 }], [
      { sale_id: "c", qty: 1, returned_qty: 1, unit_cost: 50 },
    ]);
    expect(r).toMatchObject({ invoices: 0, sales: 0, cost: 0, profit: 0 });
  });
});

import { periodReport, toCsv } from "@/lib/report";
describe("period report", () => {
  it("groups days into months with expenses", () => {
    const r = periodReport(
      [{ day: "2026-01-05", invoices: 2, sales: 100, cost: 60, profit: 40, due: 0 }, { day: "2026-01-20", invoices: 1, sales: 50, cost: 20, profit: 30, due: 10 }],
      [{ expense_date: "2026-02-01", amount: 25 }], "month");
    expect(r).toEqual([
      { day: "2026-01", invoices: 3, sales: 150, cost: 80, profit: 70, due: 10, expenses: 0 },
      { day: "2026-02", invoices: 0, sales: 0, cost: 0, profit: 0, due: 0, expenses: 25 },
    ]);
  });
  it("escapes csv cells", () => {
    expect(toCsv([["a,b", 1]])).toBe('"a,b",1');
  });
});
