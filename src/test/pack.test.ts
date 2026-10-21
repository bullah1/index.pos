import { describe, expect, it } from "vitest";
import { isLowStock, packSize, parseCount, stockLabel } from "@/lib/pack";

describe("pack helpers", () => {
  it("reads the box size from strength", () => {
    expect(packSize({ strength: "30 cap" })).toBe(30);
    expect(packSize({ strength: "10 Tablets" })).toBe(10);
    expect(packSize({ strength: "450 ml" })).toBe(1);
    expect(packSize({ strength: "500 mg" })).toBe(1);
    expect(packSize({ strength: null })).toBe(1);
  });

  it("shows stock as boxes plus loose pieces", () => {
    const cap = { strength: "30 cap", sale_unit: "cap" };
    expect(stockLabel(126, cap)).toBe("4 box + 6 cap");
    expect(stockLabel(60, cap)).toBe("2 box");
    expect(stockLabel(12, cap)).toBe("12 cap");
    expect(stockLabel(0, cap)).toBe("0 cap");
    expect(stockLabel(6, { strength: "450 ml", sale_unit: "bottle" })).toBe("6 bottle");
  });

  it("judges low stock in boxes", () => {
    const cap = { strength: "30 cap", sale_unit: "cap" };
    expect(isLowStock(126, cap, 3)).toBe(false);
    expect(isLowStock(90, cap, 3)).toBe(true);
    expect(isLowStock(6, { strength: "450 ml" }, 3)).toBe(false);
    expect(isLowStock(2, { strength: "450 ml" }, 3)).toBe(true);
  });

  it("parses typed counts, including box+pieces", () => {
    expect(parseCount("126", 30)).toBe(126);
    expect(parseCount("4+6", 30)).toBe(126);
    expect(parseCount(" 2 + 0 ", 30)).toBe(60);
    expect(parseCount("0", 30)).toBe(0);
    expect(parseCount("", 30)).toBeNull();
    expect(parseCount("abc", 30)).toBeNull();
    expect(parseCount("1+2+3", 30)).toBeNull();
    expect(parseCount("-5", 1)).toBeNull();
  });
});
