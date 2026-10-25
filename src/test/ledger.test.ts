import { describe, expect, it } from "vitest";
import { customerLedger, daysSince } from "@/lib/ledger";

describe("customer statement", () => {
  const sales = [
    { id: "s1", invoice_no: "INV-1", created_at: "2026-09-28T05:00:00Z", total: 1000, returned_amount: 0, status: "completed" },
    { id: "s2", invoice_no: "INV-2", created_at: "2026-10-05T05:00:00Z", total: 600, returned_amount: 200, status: "partially_returned" },
  ];
  const pays = [
    { sale_id: "s1", kind: "sale", method: "cash", amount: 400, created_at: "2026-09-28T05:00:00Z" },
    { sale_id: "s2", kind: "sale", method: "bkash", amount: 600, created_at: "2026-10-05T05:00:00Z" },
    { sale_id: "s2", kind: "refund", method: "cash", amount: 200, created_at: "2026-10-06T05:00:00Z" },
    { sale_id: "s1", kind: "due_collection", method: "cash", amount: 300, created_at: "2026-10-10T05:00:00Z" },
  ];
  const returns = [{ sale_id: "s2", amount: 200, created_at: "2026-10-06T05:00:00Z" }];
  const collections = [{ amount: 300, method: "cash", created_at: "2026-10-10T05:00:00Z" }];

  it("carries the opening balance and ends at what is still owed", () => {
    const l = customerLedger(sales, pays, returns, collections, "2026-10-01", "2026-10-31");
    expect(l.opening).toBe(600);
    expect(l.lines.map((x) => x.text)).toEqual(["Bill", "Paid (bKash)", "Items returned", "Refund given (Cash)", "Due collected (Cash)"]);
    expect(l.closing).toBe(300); // s1 still owes 1000 - 400 - 300
    expect(l.lines.at(-1)!.balance).toBe(300);
  });

  it("whole period", () => {
    const l = customerLedger(sales, pays, returns, collections, "2026-01-01", "2026-12-31");
    expect(l.opening).toBe(0);
    expect(l.billed).toBe(1800);
    expect(l.closing).toBe(300);
  });

  it("days since", () => {
    expect(daysSince("2026-10-20T04:00:00Z", "2026-10-25")).toBe(5);
  });
});
