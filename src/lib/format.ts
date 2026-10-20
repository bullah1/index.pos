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
