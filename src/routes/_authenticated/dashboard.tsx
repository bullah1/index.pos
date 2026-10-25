import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, HandCoins, ListChecks, Receipt, ShoppingCart, TrendingUp, Truck, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { bdToday, daysUntil, taka } from "@/lib/format";
import { dailyReport, type RItem, type RSale } from "@/lib/report";
import { fetchAll, medicinesQuery, settingsQuery } from "@/lib/queries";
import { isLowStock } from "@/lib/pack";
import { PAY_METHODS, sellableStock } from "@/lib/pos";
import { drawerSummary } from "@/lib/cash";
import { addDays, cashDayQuery } from "@/lib/cashQuery";
import { cn } from "@/lib/utils";
import { openWhatsApp } from "@/lib/share";
import { MessageCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Pharmacy POS" }, { name: "description", content: "Today's sales, cash, dues and stock alerts." }] }),
  component: Dashboard,
});

const dhakaStartIso = (day: string) => new Date(day + "T00:00:00+06:00").toISOString();

const METHOD_COLOR: Record<string, string> = {
  cash: "bg-emerald-500", bkash: "bg-pink-500", nagad: "bg-orange-500", rocket: "bg-violet-500", bank: "bg-sky-500",
};

function Dashboard() {
  const { user, role } = Route.useRouteContext();
  const isMgr = role === "admin" || role === "manager";
  const today = bdToday();
  const from = addDays(today, -6);

  const week = useQuery({
    queryKey: ["report", from, today],
    queryFn: async () => {
      const sales = await fetchAll<RSale>((a, b) => supabase.from("sales").select("id, created_at, total, returned_amount, due")
        .gte("created_at", dhakaStartIso(from)).lt("created_at", dhakaStartIso(addDays(today, 1))).order("created_at").order("id").range(a, b));
      const ids = sales.map((s) => s.id);
      const items: RItem[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        items.push(...(await fetchAll<RItem>((a, b) => supabase.from("sale_items").select("sale_id, qty, returned_qty, unit_cost").in("sale_id", ids.slice(i, i + 150)).order("id").range(a, b))));
      }
      return dailyReport(sales, items);
    },
  });
  const cash = useQuery(cashDayQuery(today, user.id, isMgr));
  const dues = useQuery({
    queryKey: ["customer-dues-total"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_dues");
      if (error) throw error;
      return { total: data.reduce((a, d) => a + Number(d.due), 0), customers: data.length };
    },
  });
  const supplierOwed = useQuery({
    queryKey: ["supplier-owed"],
    enabled: isMgr,
    queryFn: async () => {
      const pu = await fetchAll<{ total: number; paid: number }>((a, b) => supabase.from("purchases").select("total, paid").order("id").range(a, b));
      return pu.reduce((a, x) => a + Number(x.total) - Number(x.paid), 0);
    },
  });

  const { data: meds } = useSuspenseQuery(medicinesQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const alerts = useMemo(() => {
    let low = 0, expiring = 0, expired = 0, out = 0;
    for (const m of meds) {
      if (!m.is_active) continue;
      const st = sellableStock(m.batches, today);
      if (st <= 0) out++;
      else if (isLowStock(st, m, settings.low_stock_threshold)) low++;
      for (const b of m.batches) {
        if (Number(b.qty_on_hand) <= 0) continue;
        const d = daysUntil(b.expiry_date, today);
        if (d < 0) expired++;
        else if (d <= settings.expiry_alert_days) expiring++;
      }
    }
    return { low, expiring, expired, out };
  }, [meds, settings, today]);

  const days = useMemo(() => {
    const map = new Map((week.data ?? []).map((r) => [r.day, r]));
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      return { day: d, sales: map.get(d)?.sales ?? 0, profit: map.get(d)?.profit ?? 0, invoices: map.get(d)?.invoices ?? 0 };
    });
  }, [week.data, from]);
  const t = days[6]!;
  const weekSales = days.reduce((a, d) => a + d.sales, 0);
  const max = Math.max(1, ...days.map((d) => d.sales));
  const sum = drawerSummary(cash.data?.rows ?? []);
  const byMethod = cash.data?.byMethod ?? new Map<string, number>();
  const received = [...byMethod.values()].reduce((a, v) => a + Math.max(0, v), 0);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dhaka" }).format(new Date()));
  const dayReport = () => {
    const f = (n: number) => `Tk ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const lines = [
      `*${settings.pharmacy_name} — Day report*`,
      new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dhaka" }).format(new Date()),
      "------------------------",
      `Sales: ${f(t.sales)} (${t.invoices} bills)`,
      `Profit: ${f(t.profit)}${t.sales > 0 ? ` (${Math.round((t.profit / t.sales) * 100)}%)` : ""}`,
      "",
      "*Money received*",
      ...PAY_METHODS.map((m) => ({ m, v: Math.max(0, byMethod.get(m.value) ?? 0) })).filter((x) => x.v > 0).map((x) => `${x.m.label}: ${f(x.v)}`),
      `Total: ${f(received)}`,
      "",
      `Cash in drawer: ${f(sum.expected)}`,
      `Customer dues: ${f(dues.data?.total ?? 0)}`,
      ...(isMgr && (supplierOwed.data ?? 0) > 0 ? [`Owed to suppliers: ${f(supplierOwed.data ?? 0)}`] : []),
      `Low / out of stock: ${alerts.low} / ${alerts.out}`,
      `7-day sales: ${f(weekSales)}`,
    ];
    openWhatsApp(settings.phone, lines.join("\n"));
  };
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{greet} · {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dhaka" }).format(new Date())}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{settings.pharmacy_name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to="/pos" search={{}}><ShoppingCart className="mr-1.5 h-4 w-4" />New sale</Link></Button>
          {isMgr && <Button asChild variant="outline"><Link to="/stock-count"><ListChecks className="mr-1.5 h-4 w-4" />Stock entry</Link></Button>}
          <Button variant="outline" className="border-[#25D366] text-[#128C7E] hover:bg-[#25D366]/10" onClick={dayReport} title={settings.phone ? `Send to ${settings.phone}` : "Choose who to send it to"}>
            <MessageCircle className="mr-1.5 h-4 w-4" />Day report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={TrendingUp} tone="emerald" label="Today's sales" value={taka(t.sales)} sub={`${t.invoices} bill${t.invoices === 1 ? "" : "s"}`} />
        <Kpi icon={Receipt} tone="sky" label="Today's profit" value={taka(t.profit)} sub={t.sales > 0 ? `${Math.round((t.profit / t.sales) * 100)}% margin` : "—"} />
        <Kpi icon={Wallet} tone="amber" label="Cash in drawer" value={taka(sum.expected)} sub="should be there now" to="/cash-drawer" />
        <Kpi icon={HandCoins} tone="rose" label="Customer dues" value={taka(dues.data?.total)} sub={`${dues.data?.customers ?? 0} customer${dues.data?.customers === 1 ? "" : "s"}`} to="/customers" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl border bg-card p-5 lg:col-span-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Money received today</h2>
            <span className="text-lg font-semibold">{taka(received)}</span>
          </div>
          <div className="mt-4 space-y-3">
            {PAY_METHODS.map((m) => {
              const v = Math.max(0, byMethod.get(m.value) ?? 0);
              return (
                <div key={m.value}>
                  <div className="mb-1 flex justify-between text-sm"><span className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full", METHOD_COLOR[m.value])} />{m.label}</span><span className={v ? "font-medium" : "text-muted-foreground"}>{taka(v)}</span></div>
                  <div className="h-1.5 rounded-full bg-muted"><div className={cn("h-1.5 rounded-full", METHOD_COLOR[m.value])} style={{ width: `${received ? (v / received) * 100 : 0}%` }} /></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 p-5 text-white lg:col-span-2">
          <Wallet className="absolute -right-4 -top-4 h-28 w-28 text-white/5" />
          <div className="text-sm text-white/70">Cash drawer · today</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight">{taka(sum.expected)}</div>
          <div className="text-xs text-white/60">should be in the drawer</div>
          <dl className="mt-4 space-y-1.5 text-sm">
            <Row k="Opening cash" v={taka(sum.opening)} />
            <Row k="Cash in (sales + dues)" v={"+" + taka(sum.cashIn)} />
            <Row k="Cash out (refunds, expenses)" v={"−" + taka(sum.cashOut)} />
          </dl>
          <Button asChild size="sm" variant="secondary" className="mt-4 w-full"><Link to="/cash-drawer">Count cash <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl border bg-card p-5 lg:col-span-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Last 7 days</h2>
            <span className="text-sm text-muted-foreground">{taka(weekSales)}</span>
          </div>
          <div className="mt-5 flex h-40 items-end gap-2">
            {days.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5" title={`${d.day}: ${taka(d.sales)}`}>
                <div className="text-[10px] text-muted-foreground">{d.sales ? Math.round(d.sales).toLocaleString("en-IN") : ""}</div>
                <div className={cn("w-full rounded-t-md", d.day === today ? "bg-primary" : "bg-primary/30")} style={{ height: `${Math.max(3, (d.sales / max) * 120)}px` }} />
                <div className={cn("text-xs", d.day === today ? "font-semibold" : "text-muted-foreground")}>
                  {new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(d.day + "T00:00:00Z"))}
                </div>
              </div>
            ))}
          </div>
          <Link to="/reports" className="mt-3 inline-flex items-center text-sm text-primary hover:underline">Full report <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </section>

        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <h2 className="font-semibold">Needs attention</h2>
          <ul className="mt-3 divide-y text-sm">
            <Alert icon={Boxes} label="Out of stock" n={alerts.out} to="/inventory" />
            <Alert icon={AlertTriangle} label="Low stock" n={alerts.low} to="/inventory" />
            <Alert icon={CalendarClock} label="Expiring soon" n={alerts.expiring} to="/inventory" />
            <Alert icon={CalendarClock} label="Expired stock" n={alerts.expired} to="/inventory" danger />
            {isMgr && <Alert icon={Truck} label="Owed to suppliers" n={supplierOwed.data ?? 0} money to="/supplier-payments" />}
          </ul>
        </section>
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-600", sky: "bg-sky-50 text-sky-600", amber: "bg-amber-50 text-amber-600", rose: "bg-rose-50 text-rose-600",
};

function Kpi({ icon: Icon, tone, label, value, sub, to }: { icon: typeof Wallet; tone: string; label: string; value: string; sub: string; to?: string }) {
  const body = (
    <div className="h-full rounded-xl border bg-card p-3 transition-shadow hover:shadow-sm sm:p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", TONES[tone])}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><dt className="text-white/70">{k}</dt><dd className="font-medium">{v}</dd></div>;
}

function Alert({ icon: Icon, label, n, to, danger, money }: { icon: typeof Wallet; label: string; n: number; to: string; danger?: boolean; money?: boolean }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 py-2.5 hover:text-primary">
        <Icon className={cn("h-4 w-4", n > 0 ? (danger ? "text-destructive" : "text-amber-500") : "text-muted-foreground")} />
        <span className="flex-1">{label}</span>
        <span className={cn("font-semibold", n > 0 && danger && "text-destructive", n === 0 && "font-normal text-muted-foreground")}>{money ? taka(n) : n}</span>
      </Link>
    </li>
  );
}
