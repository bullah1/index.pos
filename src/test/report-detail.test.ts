import { describe, expect, it } from "vitest";
import { customerReport, productReport, saleProfits, type DItem, type DSale } from "@/lib/report";

const sale = (id: string, o: Partial<DSale> = {}): DSale => ({
  id, invoice_no: id, created_at: "2026-10-20T04:00:00Z", status: "completed", customer_id: null,
  subtotal: 1000, item_discount: 0, bill_discount: 0, total: 1000, returned_amount: 0, due: 0, customer: null, ...o,
});
const item = (sale_id: string, medicine_id: string, qty: number, price: number, cost: number, returned = 0): DItem => ({
  sale_id, medicine_id, name: medicine_id, qty, returned_qty: returned, unit_cost: cost, line_total: qty * price,
});

describe("detailed reports", () => {
  const sales = [
    sale("A", { customer_id: "c1", customer: { name: "Rahman", business_name: "Rahman Pharmacy", customer_type: "b2b" }, subtotal: 1000, total: 900, bill_discount: 100 }),
    sale("B", { subtotal: 600, total: 600 }),
    sale("C", { status: "cancelled", subtotal: 300, total: 300, returned_amount: 300 }),
    sale("D", { customer_id: "c1", customer: { name: "Rahman", business_name: "Rahman Pharmacy", customer_type: "b2b" }, subtotal: 400, total: 400, returned_amount: 200, due: 100 }),
  ];
  const items = [
    item("A", "konadex", 1, 600, 270), item("A", "ledex", 1, 400, 180),
    item("B", "konadex", 1, 600, 270),
    item("C", "konadex", 1, 300, 135),
    item("D", "ledex", 2, 200, 90, 1),
  ];

  it("profit per bill: after bill discount and returns, cancelled left out", () => {
    const p = saleProfits(sales, items);
    expect(p.map((x) => x.invoice_no)).toEqual(["A", "B", "D"]);
    expect(p[0]).toMatchObject({ sales: 900, cost: 450, profit: 450, margin: 50, b2b: true, customer: "Rahman Pharmacy" });
    expect(p[2]).toMatchObject({ sales: 200, cost: 90, profit: 110, due: 100 });
  });

  it("customers ranked by what they bought", () => {
    const c = customerReport(saleProfits(sales, items), sales);
    expect(c[0]).toMatchObject({ key: "c1", bills: 2, sales: 1100, profit: 560, due: 100, b2b: true });
    expect(c[1]).toMatchObject({ key: "walkin", bills: 1, sales: 600, profit: 330 });
    expect(c[0]!.share).toBeCloseTo(1100 / 1700);
  });

  it("products ranked by profit", () => {
    const pr = productReport(sales, items);
    const k = pr.find((x) => x.medicine_id === "konadex")!;
    expect(k).toMatchObject({ qty: 2, sales: 1140, cost: 540, profit: 600 });
    const l = pr.find((x) => x.medicine_id === "ledex")!;
    expect(l).toMatchObject({ qty: 2, sales: 560, cost: 270, profit: 290 });
  });
});
