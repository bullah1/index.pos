import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileText, MessageCircle, Plus, Printer, ShoppingCart, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchSelect } from "@/components/SearchSelect";
import { customersQuery, medicinesQuery, settingsQuery, type Settings } from "@/lib/queries";
import { fefoAllocate, sellableStock } from "@/lib/pos";
import { packSize, stockLabel } from "@/lib/pack";
import { amountInWords, bdDateTime, bdToday, errMsg, taka } from "@/lib/format";
import { addDays } from "@/lib/cashQuery";
import { openWhatsApp, printElement } from "@/lib/share";

export const Route = createFileRoute("/_authenticated/quotations")({
  head: () => ({ meta: [{ title: "Quotations — Pharmacy POS" }, { name: "description", content: "Price offers for wholesale customers; turn into a sale when confirmed." }] }),
  component: Quotations,
});

export type QuoteItem = { medicine_id: string; name: string; unit: string; qty: number; mrp: number; price: number };
type Quote = {
  id: string; quote_no: string; created_at: string; customer_id: string | null; items: QuoteItem[];
  subtotal: number; discount: number; total: number; note: string | null; valid_until: string | null; status: string; sale_id: string | null;
};
const STATUS: Record<string, { l: string; c: string }> = {
  open: { l: "Open", c: "bg-sky-100 text-sky-800" }, converted: { l: "Sold", c: "bg-emerald-100 text-emerald-800" }, cancelled: { l: "Cancelled", c: "bg-muted text-muted-foreground" },
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function Quotations() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: customers = [] } = useQuery(customersQuery);
  const { data: settings } = useQuery(settingsQuery);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Quote | null>(null);
  const list = useQuery({
    queryKey: ["quotations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("quotations").select("*").order("created_at", { ascending: false }).limit(300);
      if (error) {
        if (/quotations/.test(error.message)) throw new Error("Quotations need a one-time database update: run supabase/07_quotations.sql in Supabase SQL Editor.");
        throw error;
      }
      return data as unknown as Quote[];
    },
  });
  const cust = (id: string | null) => customers.find((c) => c.id === id);
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quotations").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotations"] }),
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
          <p className="text-sm text-muted-foreground">Send a price offer to a shop. When they confirm, press Sell — it opens in the POS as a normal bill.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" />New quotation</Button>
      </div>
      {list.error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errMsg(list.error)}</p>}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr><th className="px-4 py-2">Quotation</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Customer</th><th className="px-2 py-2 text-right">Total</th><th className="px-2 py-2">Status</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No quotations yet.</td></tr>}
            {list.data?.map((q) => {
              const c = cust(q.customer_id);
              return (
                <tr key={q.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-medium">{q.quote_no}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{bdDateTime(q.created_at).split(",")[0]}</td>
                  <td className="px-2 py-2">{c ? c.business_name || c.name : "—"}</td>
                  <td className="px-2 py-2 text-right font-medium">{taka(q.total)}</td>
                  <td className="px-2 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[q.status]?.c}`}>{STATUS[q.status]?.l ?? q.status}</span></td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setViewing(q)} title="View / print / send"><FileText className="h-4 w-4" /></Button>
                    {q.status === "open" && <Button size="sm" variant="ghost" title="Cancel" onClick={() => cancel.mutate(q.id)}><X className="h-4 w-4" /></Button>}
                    {q.status === "open" && <Button size="sm" onClick={() => navigate({ to: "/pos", search: { quote: q.id } })}><ShoppingCart className="mr-1 h-4 w-4" />Sell</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {creating && <NewQuote onClose={() => setCreating(false)} onSaved={(q) => { setCreating(false); setViewing(q); qc.invalidateQueries({ queryKey: ["quotations"] }); }} />}
      {viewing && <QuoteView q={viewing} settings={settings} customer={cust(viewing.customer_id)} onClose={() => setViewing(null)} />}
    </div>
  );
}

function NewQuote({ onClose, onSaved }: { onClose: () => void; onSaved: (q: Quote) => void }) {
  const { data: meds = [] } = useQuery(medicinesQuery);
  const { data: customers = [] } = useQuery(customersQuery);
  const today = bdToday();
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<QuoteItem[]>([]);
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [valid, setValid] = useState(addDays(today, 7));
  const [busy, setBusy] = useState(false);
  const c = customers.find((x) => x.id === customerId);
  const disc = c?.customer_type === "b2b" ? Number(c.discount_pct ?? 0) : 0;

  const medOptions = useMemo(() => meds.filter((m) => m.is_active).map((m) => ({
    value: m.id, label: `${m.name}${m.strength ? " " + m.strength : ""}`,
    hint: `${stockLabel(sellableStock(m.batches, today), m)} in stock · ${m.manufacturer ?? ""}`, keywords: `${m.generic_name ?? ""} ${m.barcode ?? ""}`,
  })), [meds, today]);

  function add(id: string) {
    const m = meds.find((x) => x.id === id);
    if (!m || lines.some((l) => l.medicine_id === id)) return;
    const pack = packSize(m);
    // Quote in boxes for box items: price per box = MRP per piece × pack.
    const unitMrp = Number(fefoAllocate(m.batches, 1, today).allocations[0]?.batch.sale_price ?? m.default_price);
    const mrp = r2(unitMrp * pack);
    setLines((ls) => [...ls, { medicine_id: m.id, name: `${m.name}${m.strength ? " " + m.strength : ""}`, unit: pack > 1 ? "box" : m.sale_unit, qty: 1, mrp, price: r2(mrp * (1 - disc / 100)) }]);
  }
  function applyDisc(d: number) { setLines((ls) => ls.map((l) => ({ ...l, price: r2(l.mrp * (1 - d / 100)) }))); }
  const sub = r2(lines.reduce((a, l) => a + l.qty * l.price, 0));
  const total = r2(Math.max(0, sub - (Number(discount) || 0)));

  async function save() {
    if (lines.length === 0) { toast.error("Add at least one product"); return; }
    if (lines.some((l) => !(l.qty > 0) || !(l.price >= 0))) { toast.error("Check the quantities and prices"); return; }
    setBusy(true);
    const { data, error } = await supabase.from("quotations").insert({
      customer_id: customerId || null, items: lines as unknown as Json, subtotal: sub, discount: Number(discount) || 0, total, note: note.trim() || null, valid_until: valid || null,
    }).select("*").single();
    setBusy(false);
    if (error) { toast.error(/quotations/.test(error.message) ? "Run supabase/07_quotations.sql in Supabase first." : errMsg(error)); return; }
    toast.success(`Quotation ${data.quote_no} saved`);
    onSaved(data as unknown as Quote);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>New quotation</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label>Customer</Label>
            <SearchSelect value={customerId} onChange={(v) => { setCustomerId(v); const cc = customers.find((x) => x.id === v); applyDisc(cc?.customer_type === "b2b" ? Number(cc.discount_pct ?? 0) : 0); }}
              placeholder="Choose customer (B2B discount applies)"
              options={customers.map((x) => ({ value: x.id, label: x.customer_type === "b2b" ? `${x.business_name || x.name} · B2B` : x.name, hint: x.phone ?? undefined, keywords: `${x.business_name ?? ""} ${x.phone ?? ""}` }))} />
            {disc > 0 && <p className="mt-1 text-xs text-indigo-700">{disc}% off MRP applied</p>}
          </div>
          <div><Label htmlFor="qv">Valid until</Label><Input id="qv" type="date" value={valid} min={today} onChange={(e) => setValid(e.target.value)} /></div>
        </div>
        <div>
          <Label>Add product</Label>
          <SearchSelect value="" onChange={add} placeholder="Search product…" searchPlaceholder="Name, generic or barcode…" options={medOptions} />
        </div>
        {lines.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Product</th><th className="p-2">Qty</th><th className="p-2 text-right">MRP</th><th className="p-2">Price</th><th className="p-2 text-right">Amount</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.medicine_id} className="border-b last:border-0">
                    <td className="p-2 font-medium">{l.name}</td>
                    <td className="p-2"><div className="flex items-center gap-1"><Input type="number" min={1} value={l.qty || ""} className="h-8 w-16" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Number(e.target.value) || 0) } : x)))} /><span className="text-xs text-muted-foreground">{l.unit}</span></div></td>
                    <td className="p-2 text-right text-muted-foreground">{taka(l.mrp)}</td>
                    <td className="p-2"><Input type="number" min={0} step="0.01" value={l.price} className="h-8 w-24" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} /></td>
                    <td className="p-2 text-right font-medium">{taka(l.qty * l.price)}</td>
                    <td className="p-2"><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><Label htmlFor="qn">Note</Label><Input id="qn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivery in 2 days, cash on delivery" /></div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{taka(sub)}</span></div>
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Extra discount</span><Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-8 w-24 text-right" placeholder="0" /></div>
            <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{taka(total)}</span></div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save quotation"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Cust = { name: string; phone: string | null; address: string | null; business_name?: string | null; customer_type?: string } | undefined;

function QuoteView({ q, settings, customer, onClose }: { q: Quote; settings: Settings | undefined; customer: Cust; onClose: () => void }) {
  const who = customer ? customer.business_name || customer.name : "";
  const text = [
    `*${settings?.pharmacy_name ?? ""}* — Quotation ${q.quote_no}`, `Date: ${bdDateTime(q.created_at).split(",")[0]}`, who ? `To: ${who}` : "", "------------------------",
    ...q.items.map((l, i) => `${i + 1}. ${l.name}\n   ${l.qty} ${l.unit} x ${l.price.toFixed(2)} = ${(l.qty * l.price).toFixed(2)}${l.mrp > l.price ? ` (MRP ${l.mrp.toFixed(2)})` : ""}`),
    "------------------------", Number(q.discount) > 0 ? `Discount: -${Number(q.discount).toFixed(2)}` : "", `*Total: Tk ${Number(q.total).toFixed(2)}*`,
    q.valid_until ? `Valid until: ${q.valid_until}` : "", q.note ?? "", settings?.phone ? `Phone: ${settings.phone}` : "",
  ].filter(Boolean).join("\n");
  const mrpTotal = q.items.reduce((a, l) => a + l.qty * l.mrp, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Quotation {q.quote_no}</DialogTitle></DialogHeader>
        <div id="print-area" className="a4 rounded-md border bg-white p-6 text-[13px] text-black">
          <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
            <div><div className="text-2xl font-bold">{settings?.pharmacy_name}</div><div className="text-gray-700">{settings?.address}</div>{settings?.phone && <div className="text-gray-700">Phone: {settings.phone}</div>}</div>
            <div className="text-right"><div className="text-2xl font-bold tracking-wide">QUOTATION</div><div><span className="text-gray-600">No:</span> <b>{q.quote_no}</b></div><div><span className="text-gray-600">Date:</span> {bdDateTime(q.created_at).split(",")[0]}</div>{q.valid_until && <div><span className="text-gray-600">Valid until:</span> {q.valid_until}</div>}</div>
          </div>
          {customer && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">To</div>
              <div className="font-semibold">{who}{customer.customer_type === "b2b" && <span className="ml-1.5 rounded border border-black px-1 text-[10px] font-bold">B2B</span>}</div>
              {customer.business_name && <div>{customer.name}</div>}
              <div className="text-gray-700">{[customer.phone, customer.address].filter(Boolean).join(" · ")}</div>
            </div>
          )}
          <table className="mt-4 w-full border-collapse">
            <thead><tr className="bg-gray-100 text-left text-[12px]">
              <th className="border border-gray-300 px-2 py-1.5 text-center">#</th><th className="border border-gray-300 px-2 py-1.5">Item</th><th className="border border-gray-300 px-2 py-1.5 text-right">Qty</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right">MRP</th><th className="border border-gray-300 px-2 py-1.5 text-right">Rate</th><th className="border border-gray-300 px-2 py-1.5 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {q.items.map((l, i) => (
                <tr key={l.medicine_id}>
                  <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td><td className="border border-gray-300 px-2 py-1">{l.name}</td>
                  <td className="whitespace-nowrap border border-gray-300 px-2 py-1 text-right">{l.qty} {l.unit}</td><td className="border border-gray-300 px-2 py-1 text-right text-gray-600">{taka(l.mrp)}</td>
                  <td className="border border-gray-300 px-2 py-1 text-right">{taka(l.price)}</td><td className="border border-gray-300 px-2 py-1 text-right">{taka(l.qty * l.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap justify-between gap-6">
            <div className="max-w-sm self-end text-[12px]"><div className="text-gray-500">In words</div><div className="font-medium italic">{amountInWords(q.total)}</div>{q.note && <div className="mt-2"><span className="text-gray-500">Note: </span>{q.note}</div>}</div>
            <div className="ml-auto w-64 space-y-0.5">
              {mrpTotal > Number(q.subtotal) && <div className="flex justify-between"><span>MRP value</span><span>{taka(mrpTotal)}</span></div>}
              {mrpTotal > Number(q.subtotal) && <div className="flex justify-between"><span>Trade discount</span><span>−{taka(mrpTotal - Number(q.subtotal))}</span></div>}
              <div className="flex justify-between"><span>Subtotal</span><span>{taka(q.subtotal)}</span></div>
              {Number(q.discount) > 0 && <div className="flex justify-between"><span>Discount</span><span>−{taka(q.discount)}</span></div>}
              <div className="flex justify-between border-y-2 border-black py-1 text-base font-bold"><span>Total</span><span>{taka(q.total)}</span></div>
            </div>
          </div>
          <div className="mt-12 flex justify-end text-[12px] text-gray-700"><div className="w-44 border-t border-gray-500 pt-1 text-center">Authorised signature</div></div>
          <div className="mt-4 border-t pt-2 text-center text-[11px] text-gray-500">This is a price offer, not a bill. Prices are valid until the date above.</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" className="mr-auto bg-[#25D366] text-white hover:bg-[#1ebe5b]" onClick={() => openWhatsApp(customer?.phone, text)}><MessageCircle className="mr-1 h-4 w-4" />WhatsApp</Button>
          <Button size="sm" onClick={() => printElement(document.getElementById("print-area"))}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        </div>
        {q.status === "converted" && <Badge variant="secondary" className="w-fit">Sold</Badge>}
      </DialogContent>
    </Dialog>
  );
}
