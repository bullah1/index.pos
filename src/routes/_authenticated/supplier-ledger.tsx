import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MessageCircle, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { settingsQuery } from "@/lib/queries";
import { bdToday, errMsg, taka } from "@/lib/format";
import { openWhatsApp, printElement } from "@/lib/share";
import { PAY_METHODS } from "@/lib/pos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/supplier-ledger")({
  head: () => ({ meta: [{ title: "Supplier Ledger — Pharmacy POS" }, { name: "description", content: "Goods received, money paid and balance for each supplier." }] }),
  component: SupplierLedger,
});

const ALL = "__all";
const label = (m: string) => PAY_METHODS.find((x) => x.value === m)?.label ?? m;

function SupplierLedger() {
  const { role } = Route.useRouteContext();
  const today = bdToday();
  const { data: settings } = useQuery(settingsQuery);
  const [supplier, setSupplier] = useState<string>("");
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);

  const q = useQuery({
    queryKey: ["supplier-ledger"],
    queryFn: async () => {
      const [s, p, sp] = await Promise.all([
        supabase.from("suppliers").select("id, name, phone, address").order("name"),
        supabase.from("purchases").select("id, purchase_no, supplier_id, supplier_invoice_no, purchase_date, total, paid, status, note").order("purchase_date").order("created_at").limit(10000),
        supabase.from("supplier_payments").select("id, supplier_id, amount, method, payment_date, note").order("payment_date").limit(10000),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      if (sp.error) throw sp.error;
      return { suppliers: s.data, purchases: p.data.filter((x) => x.status !== "cancelled"), payments: sp.data };
    },
  });

  // Balance per supplier (all time) for the overview cards.
  const overview = useMemo(() => {
    if (!q.data) return [];
    return q.data.suppliers.map((s) => {
      const ps = q.data.purchases.filter((p) => p.supplier_id === s.id);
      const bought = ps.reduce((a, p) => a + Number(p.total), 0);
      const paid = ps.reduce((a, p) => a + Number(p.paid), 0);
      return { ...s, bought, paid, balance: Math.round((bought - paid) * 100) / 100, bills: ps.length };
    }).filter((s) => s.bills > 0).sort((a, b) => b.balance - a.balance || b.bought - a.bought);
  }, [q.data]);

  const sel = q.data?.suppliers.find((s) => s.id === supplier);
  const detail = useMemo(() => {
    if (!q.data || !supplier) return null;
    const ps = q.data.purchases.filter((p) => p.supplier_id === supplier && p.purchase_date >= from && p.purchase_date <= to);
    const pays = q.data.payments.filter((p) => p.supplier_id === supplier && p.payment_date >= from && p.payment_date <= to);
    const all = q.data.purchases.filter((p) => p.supplier_id === supplier);
    const balanceNow = all.reduce((a, p) => a + Number(p.total) - Number(p.paid), 0);
    return {
      ps, pays,
      bought: ps.reduce((a, p) => a + Number(p.total), 0),
      paidOnBills: ps.reduce((a, p) => a + Number(p.paid), 0),
      payments: pays.reduce((a, p) => a + Number(p.amount), 0),
      balanceNow: Math.round(balanceNow * 100) / 100,
    };
  }, [q.data, supplier, from, to]);

  if (role === "cashier") return <p className="text-sm text-muted-foreground">Supplier ledger is available to managers and admins.</p>;

  const waText = detail && sel ? [
    `*${settings?.pharmacy_name ?? ""}* — Account with ${sel.name}`, `${from} to ${to}`, "------------------------",
    `Goods received: Tk ${detail.bought.toFixed(2)} (${detail.ps.length} bills)`,
    `Payments made: Tk ${detail.payments.toFixed(2)}`,
    `*Balance owed now: Tk ${detail.balanceNow.toFixed(2)}*`,
  ].join("\n") : "";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Supplier ledger</h1>
        <p className="text-sm text-muted-foreground">Goods received, money paid and what you still owe each company.</p>
      </div>
      {q.error && <p className="text-sm text-destructive">{errMsg(q.error)}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {overview.map((s) => (
          <button key={s.id} type="button" onClick={() => setSupplier(s.id)}
            className={cn("rounded-xl border bg-card p-4 text-left transition-shadow hover:shadow-sm", supplier === s.id && "border-primary ring-1 ring-primary")}>
            <div className="truncate font-semibold">{s.name}</div>
            <div className="mt-2 flex justify-between text-sm"><span className="text-muted-foreground">Goods received</span><span>{taka(s.bought)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Paid</span><span>{taka(s.paid)}</span></div>
            <div className={cn("mt-1 flex justify-between border-t pt-1 font-semibold", s.balance > 0 ? "text-destructive" : "text-emerald-700")}><span>{s.balance > 0 ? "You owe" : "Settled"}</span><span>{taka(s.balance)}</span></div>
          </button>
        ))}
        {q.data && overview.length === 0 && <p className="text-sm text-muted-foreground">No purchases yet.</p>}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <div>
          <Label className="text-xs">Supplier</Label>
          <Select value={supplier || ALL} onValueChange={(v) => setSupplier(v === ALL ? "" : v)}>
            <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Choose a supplier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Choose a supplier</SelectItem>
              {overview.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="lf" className="text-xs">From</Label><Input id="lf" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-9" /></div>
        <div><Label htmlFor="lt" className="text-xs">To</Label><Input id="lt" type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-9" /></div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" disabled={!detail} onClick={() => openWhatsApp(sel?.phone, waText)}><MessageCircle className="mr-1 h-4 w-4" />WhatsApp</Button>
          <Button size="sm" disabled={!detail} onClick={() => printElement(document.getElementById("print-area"))}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>
        </div>
      </div>

      {detail && sel && (
        <div id="print-area" className="a4 rounded-xl border bg-white p-5 text-[13px] text-black">
          <div className="flex justify-between gap-4 border-b-2 border-black pb-2">
            <div><div className="text-xl font-bold">{settings?.pharmacy_name}</div><div className="text-gray-600">{settings?.address}{settings?.phone ? ` · ${settings.phone}` : ""}</div></div>
            <div className="text-right"><div className="text-xl font-bold">SUPPLIER LEDGER</div><div className="text-gray-600">{from} – {to}</div></div>
          </div>
          <div className="mt-2 font-semibold">{sel.name}</div>
          <div className="text-gray-600">{[sel.phone, sel.address].filter(Boolean).join(" · ")}</div>

          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Goods received</div>
          <table className="mt-1 w-full border-collapse text-[12px]">
            <thead><tr className="bg-gray-100 text-left">
              <th className="border border-gray-300 px-2 py-1">Date</th><th className="border border-gray-300 px-2 py-1">Purchase</th><th className="border border-gray-300 px-2 py-1">Supplier bill</th>
              <th className="border border-gray-300 px-2 py-1 text-right">Amount</th><th className="border border-gray-300 px-2 py-1 text-right">Paid</th><th className="border border-gray-300 px-2 py-1 text-right">Balance</th>
            </tr></thead>
            <tbody>
              {detail.ps.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap border border-gray-300 px-2 py-1">{p.purchase_date}</td>
                  <td className="border border-gray-300 px-2 py-1">{p.purchase_no}{p.note ? <span className="text-gray-500"> · {p.note}</span> : null}</td>
                  <td className="border border-gray-300 px-2 py-1">{p.supplier_invoice_no ?? ""}</td>
                  <td className="border border-gray-300 px-2 py-1 text-right">{taka(p.total)}</td>
                  <td className="border border-gray-300 px-2 py-1 text-right">{taka(p.paid)}</td>
                  <td className={cn("border border-gray-300 px-2 py-1 text-right", Number(p.total) - Number(p.paid) > 0 && "font-semibold text-red-700")}>{taka(Number(p.total) - Number(p.paid))}</td>
                </tr>
              ))}
              {detail.ps.length === 0 && <tr><td colSpan={6} className="border border-gray-300 px-2 py-3 text-center text-gray-500">No purchases in this period</td></tr>}
            </tbody>
          </table>

          <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Payments made</div>
          <table className="mt-1 w-full border-collapse text-[12px]">
            <thead><tr className="bg-gray-100 text-left">
              <th className="border border-gray-300 px-2 py-1">Date</th><th className="border border-gray-300 px-2 py-1">Paid by</th><th className="border border-gray-300 px-2 py-1">Note</th><th className="border border-gray-300 px-2 py-1 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {detail.pays.map((p) => (
                <tr key={p.id}>
                  <td className="border border-gray-300 px-2 py-1">{p.payment_date}</td>
                  <td className="border border-gray-300 px-2 py-1">{label(p.method)}</td>
                  <td className="border border-gray-300 px-2 py-1">{p.note ?? ""}</td>
                  <td className="border border-gray-300 px-2 py-1 text-right">{taka(p.amount)}</td>
                </tr>
              ))}
              {detail.pays.length === 0 && <tr><td colSpan={4} className="border border-gray-300 px-2 py-3 text-center text-gray-500">No separate payments in this period (money paid with the purchase is in the table above)</td></tr>}
            </tbody>
          </table>

          <div className="ml-auto mt-4 w-72 space-y-0.5">
            <div className="flex justify-between"><span>Goods received ({detail.ps.length} bills)</span><span>{taka(detail.bought)}</span></div>
            <div className="flex justify-between"><span>Paid on these bills</span><span>−{taka(detail.paidOnBills)}</span></div>
            <div className="flex justify-between border-t-2 border-black pt-1 text-base font-bold"><span>You owe now</span><span>{taka(detail.balanceNow)}</span></div>
            <div className="text-[11px] text-gray-500">"You owe now" is the balance on all purchases, not only this period.</div>
          </div>
        </div>
      )}
    </div>
  );
}
