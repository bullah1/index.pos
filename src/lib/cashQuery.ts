import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { drawerRows, type CashMovement } from "@/lib/cash";

const iso = (day: string) => new Date(day + "T00:00:00+06:00").toISOString();
export function addDays(day: string, n: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Everything the cash drawer needs for one Bangladesh day: drawers, cash in/out per staff, and money by payment method. */
export const cashDayQuery = (day: string, userId: string, isMgr: boolean) =>
  queryOptions({
    queryKey: ["cash-drawer", day, userId, isMgr],
    queryFn: async () => {
      const from = iso(day);
      const to = iso(addDays(day, 1));
      let cpQuery = supabase.from("customer_payments").select("created_by, amount, method").gte("created_at", from).lt("created_at", to).limit(5000);
      if (!isMgr) cpQuery = cpQuery.eq("created_by", userId);
      const [sp, cp, dr, pr] = await Promise.all([
        supabase.from("sale_payments").select("created_by, amount, kind, method").gte("created_at", from).lt("created_at", to).limit(5000),
        cpQuery,
        supabase.from("cash_drawers").select("id, user_id, opening, counted, note, closed_at").eq("drawer_date", day).limit(500),
        supabase.from("profiles").select("id, full_name").limit(500),
      ]);
      if (sp.error) throw sp.error;
      if (cp.error) throw cp.error;
      if (dr.error) throw dr.error;
      if (pr.error) throw pr.error;

      let expenses: CashMovement[] = [];
      let supplierPayments: CashMovement[] = [];
      if (isMgr) {
        const [ex, su] = await Promise.all([
          supabase.from("expenses").select("created_by, amount").eq("method", "cash").eq("expense_date", day).limit(5000),
          supabase.from("supplier_payments").select("created_by, amount").eq("method", "cash").eq("payment_date", day).limit(5000),
        ]);
        if (ex.error) throw ex.error;
        if (su.error) throw su.error;
        expenses = ex.data;
        supplierPayments = su.data;
      }

      const cashSp = sp.data.filter((r) => r.method === "cash");
      // Due collections live in customer_payments; the matching sale_payments rows are the same money, so they are skipped here.
      const rows = drawerRows({
        drawers: dr.data.map((d) => ({ user_id: d.user_id, opening: d.opening, counted: d.counted })),
        cashSales: cashSp.filter((r) => r.kind === "sale"),
        dueCollections: cp.data.filter((r) => r.method === "cash"),
        cashRefunds: cashSp.filter((r) => r.kind === "refund"),
        expenses,
        supplierPayments,
      });

      // Money received today by method (sales − refunds + due collections).
      const byMethod = new Map<string, number>();
      for (const r of sp.data) {
        if (r.kind === "due_collection") continue;
        byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + (r.kind === "refund" ? -1 : 1) * Number(r.amount));
      }
      for (const r of cp.data) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + Number(r.amount));

      return { rows, byMethod, names: new Map(pr.data.map((p) => [p.id, p.full_name])), drawers: dr.data };
    },
  });
