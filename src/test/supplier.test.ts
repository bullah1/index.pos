import { describe, expect, it } from "vitest";
import { allocateSupplierPayment, supplierBalances } from "@/lib/supplier";

describe("supplier balances", () => {
  it("balance is billed minus paid", () => {
    const b = supplierBalances([
      { supplier_id: "s1", total: 1000, paid: 400 },
      { supplier_id: "s1", total: 500, paid: 500 },
    ]).get("s1");
    expect(b).toEqual({ billed: 1500, paid: 900, balance: 600 });
  });
  it("pays oldest purchase first", () => {
    expect(allocateSupplierPayment([{ id: "a", balance: 300 }, { id: "b", balance: 500 }], 450))
      .toEqual({ parts: [{ id: "a", amount: 300 }, { id: "b", amount: 150 }] });
  });
  it("rejects paying more than owed", () => {
    expect(allocateSupplierPayment([{ id: "a", balance: 300 }], 301)).toHaveProperty("error");
  });
});
