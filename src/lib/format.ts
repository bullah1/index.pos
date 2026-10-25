export function taka(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return "৳" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Today's date in Bangladesh (YYYY-MM-DD). */
export function bdToday(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
}

export function bdDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function daysUntil(date: string, today = bdToday()) {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
}

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: string }).message);
  return "Something went wrong";
}

/** Stock without a known expiry is saved with this far-future date (the database needs a date). */
export const NO_EXPIRY = "2099-12-31";

/** Expiry for display: "2027-12", or "—" when no expiry was entered. */
export function expLabel(date: string | null | undefined) {
  if (!date || date >= NO_EXPIRY) return "—";
  return date.slice(0, 7);
}

/** Batch number for stock entered without one, e.g. "B201026-4821" (unique enough per medicine). */
export function autoBatchNo(d = new Date()) {
  const ymd = bdToday(d).slice(2).replace(/-/g, "").replace(/(\d{2})(\d{2})(\d{2})/, "$3$2$1");
  return `B${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Purchase price used when a medicine has no earlier batch: MRP − 55%. */
export const COST_RATE = 0.45;
export const defaultCost = (mrp: number | string | null | undefined) => Math.round(Number(mrp ?? 0) * COST_RATE * 100) / 100;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function below100(n: number) { return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`; }
function below1000(n: number) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}
/** Bangladeshi style (crore / lakh): 1250.5 → "Taka One Thousand Two Hundred Fifty and Fifty Paisa Only". */
export function amountInWords(amount: number | string) {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100);
  let n = Math.floor(v / 100);
  const paisa = v % 100;
  if (n === 0 && paisa === 0) return "Taka Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${crore >= 1000 ? amountInWords(crore).replace(/^Taka | Only$/g, "") : below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  const taka = parts.join(" ") || "Zero";
  return `Taka ${taka}${paisa ? ` and ${below100(paisa)} Paisa` : ""} Only`;
}
