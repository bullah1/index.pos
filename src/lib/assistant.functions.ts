import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })).min(1).max(30),
});

function dhakaDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date(iso));
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isMgr } = await sb.rpc("is_manager", { _user_id: context.userId });
    if (!isMgr) return { ok: false as const, error: "Only managers and admins can use the assistant." };
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false as const, error: "AI is not configured." };

    const today = dhakaDay(new Date().toISOString());
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const sinceDay = dhakaDay(since);
    const [sales, expenses, dues, customers, settings] = await Promise.all([
      sb.from("sales").select("id, created_at, total, returned_amount, due, customer_id").gte("created_at", since).limit(5000),
      sb.from("expenses").select("category, amount, expense_date, method").gte("expense_date", sinceDay).limit(2000),
      sb.rpc("customer_dues"),
      sb.from("customers").select("id, name, phone"),
      sb.from("settings").select("pharmacy_name").eq("id", 1).maybeSingle(),
    ]);
    for (const r of [sales, expenses, dues, customers]) if (r.error) return { ok: false as const, error: "Could not load your shop data." };

    const ids = sales.data!.map((s) => s.id);
    const cost = new Map<string, number>();
    const items: { medicine_name: string; qty: number; returned_qty: number; line_total: number; unit_cost: number; sale_id: string }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data: it } = await sb.from("sale_items").select("sale_id, medicine_name, qty, returned_qty, line_total, unit_cost").in("sale_id", ids.slice(i, i + 200));
      items.push(...(it ?? []));
    }
    const topMeds = new Map<string, { qty: number; revenue: number; profit: number }>();
    for (const x of items) {
      const kept = Number(x.qty) - Number(x.returned_qty);
      cost.set(x.sale_id, (cost.get(x.sale_id) ?? 0) + kept * Number(x.unit_cost));
      const m = topMeds.get(x.medicine_name) ?? { qty: 0, revenue: 0, profit: 0 };
      const rev = Number(x.qty) ? (Number(x.line_total) * kept) / Number(x.qty) : 0;
      m.qty += kept; m.revenue += rev; m.profit += rev - kept * Number(x.unit_cost);
      topMeds.set(x.medicine_name, m);
    }
    const daily = new Map<string, { invoices: number; net_sales: number; cost: number; new_due: number }>();
    for (const s of sales.data!) {
      const d = dhakaDay(s.created_at);
      const r = daily.get(d) ?? { invoices: 0, net_sales: 0, cost: 0, new_due: 0 };
      const net = Number(s.total) - Number(s.returned_amount);
      if (net > 0) r.invoices++;
      r.net_sales += net; r.cost += cost.get(s.id) ?? 0; r.new_due += Number(s.due);
      daily.set(d, r);
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    const custName = new Map(customers.data!.map((c) => [c.id, `${c.name}${c.phone ? ` (${c.phone})` : ""}`]));
    const expByCat: Record<string, number> = {};
    for (const e of expenses.data!) expByCat[e.category] = round((expByCat[e.category] ?? 0) + Number(e.amount));

    const ctx = {
      pharmacy: settings.data?.pharmacy_name ?? "Pharmacy",
      today_bd: today,
      period: `${sinceDay} to ${today} (last 60 days, Bangladesh time)`,
      currency: "BDT (৳)",
      daily_sales: [...daily.entries()].sort().map(([day, r]) => ({ day, invoices: r.invoices, net_sales: round(r.net_sales), gross_profit: round(r.net_sales - r.cost), due_still_open_from_that_day: round(r.new_due) })),
      top_medicines_by_revenue: [...topMeds.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 25)
        .map(([name, m]) => ({ name, qty: m.qty, revenue: round(m.revenue), profit: round(m.profit) })),
      customer_dues_all_time: dues.data!.map((d) => ({ customer: custName.get(d.customer_id) ?? "Unknown", due: round(Number(d.due)), open_invoices: Number(d.open_invoices) }))
        .sort((a, b) => b.due - a.due).slice(0, 50),
      expenses_by_category: expByCat,
      expenses: expenses.data!.map((e) => ({ date: e.expense_date, category: e.category, amount: Number(e.amount), method: e.method })).slice(0, 300),
    };

    const instructions = `You are a business assistant for a small pharmacy in Bangladesh. Answer the manager's questions using ONLY the shop data below. Reply in the same language the user writes in (Bangla or English). Use ৳ for money. Be concise: give the direct answer first, then short bullet-point recommendations (actions the manager can take, e.g. follow up with specific customers about dues, cut a growing expense, restock best sellers). If the data does not cover the question, say so plainly — never invent numbers. "gross_profit" = net sales minus batch cost; net profit = gross profit minus expenses.

SHOP DATA (JSON):
${JSON.stringify(ctx)}`;

    try {
      const { askModel } = await import("@/lib/ai/assistant.server");
      const text = await askModel(apiKey, instructions, data.messages);
      if (!text.trim()) return { ok: false as const, error: "The assistant could not answer this question." };
      return { ok: true as const, text };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 402) return { ok: false as const, error: "AI credits have run out. Add credits in your workspace billing settings." };
      if (status === 429) return { ok: false as const, error: "Too many requests. Please wait a minute and try again." };
      if (status === 403) return { ok: false as const, error: (e as Error).message || "AI access is not allowed for this workspace." };
      console.error("assistant error", e);
      return { ok: false as const, error: "The assistant is unavailable right now." };
    }
  });
