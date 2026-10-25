import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/format";

describe("amountInWords", () => {
  it("writes taka amounts in words (lakh / crore)", () => {
    expect(amountInWords(0)).toBe("Taka Zero Only");
    expect(amountInWords(5)).toBe("Taka Five Only");
    expect(amountInWords(870)).toBe("Taka Eight Hundred Seventy Only");
    expect(amountInWords(1200)).toBe("Taka One Thousand Two Hundred Only");
    expect(amountInWords(1250.5)).toBe("Taka One Thousand Two Hundred Fifty and Fifty Paisa Only");
    expect(amountInWords(125000)).toBe("Taka One Lakh Twenty Five Thousand Only");
    expect(amountInWords(23456789)).toBe("Taka Two Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only");
  });
});
