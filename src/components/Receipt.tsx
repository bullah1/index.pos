import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { settingsQuery, type Settings } from "@/lib/queries";
import { amountInWords, bdDateTime, taka } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const KIND: Record<string, string> = { sale: "Paid", due_collection: "Due paid", refund: "Refunded" };
const METHOD: Record<string, string> = { cash: "Cash", bkash: "bKash", nagad: "Nagad", rocket: "Rocket", bank: "Bank" };

type SaleData = {
  sale: {
    invoice_no: string; created_at: string; status: string;
    subtotal: number | string; item_discount: number | string; bill_discount: number | string; total: number | string;
    paid: number | string; due: number | string; returned_amount: number | string;
    customers: { name: string; phone: string | null } | null;
  };
  items: {
    id: string; medicine_name: string; qty: number | string; unit_price: number | string; discount: number | string; line_total: number | string;
    medicines?: { strength: string | null; sale_unit: string | null } | null;
  }[];
  payments: { id: string; kind: string; method: string; amount: number | string }[];
};

export function ReceiptDialog({
  saleId,
  onClose,
  title = "Receipt",
  cashReceived,
  change,
}: {
  saleId: string | null;
  onClose: () => void;
  title?: string;
  /** Cash the customer handed over (only known right after the sale). */
  cashReceived?: number | undefined;
  change?: number | undefined;
}) {
  const { data: settings } = useQuery(settingsQuery);
  const [format, setFormat] = useState<"thermal" | "a4" | null>(null);
  const fmt = format ?? (settings?.receipt_format as "thermal" | "a4") ?? "thermal";
  const { data, isLoading } = useQuery({
    queryKey: ["sale", saleId],
    enabled: !!saleId,
    queryFn: async (): Promise<SaleData> => {
      const [s, i, p] = await Promise.all([
        supabase.from("sales").select("*, customers(name, phone)").eq("id", saleId!).single(),
        supabase.from("sale_items").select("*, medicines(strength, sale_unit)").eq("sale_id", saleId!),
        supabase.from("sale_payments").select("*").eq("sale_id", saleId!).order("created_at"),
      ]);
      if (s.error) throw s.error;
      return { sale: s.data as SaleData["sale"], items: mergeLines((i.data ?? []) as SaleData["items"]), payments: p.data ?? [] };
    },
  });

  return (
    <Dialog open={!!saleId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", fmt === "a4" ? "sm:max-w-3xl" : "sm:max-w-md")}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {isLoading || !data ? <p className="text-sm text-muted-foreground">Loading invoice…</p> : (
          <>
            {fmt === "a4"
              ? <A4Invoice data={data} settings={settings} cashReceived={cashReceived} change={change} />
              : <ThermalReceipt data={data} settings={settings} cashReceived={cashReceived} change={change} />}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="mr-auto flex rounded-md border p-0.5">
                <Button variant={fmt === "thermal" ? "secondary" : "ghost"} size="sm" className="h-7" onClick={() => setFormat("thermal")}>Small receipt</Button>
                <Button variant={fmt === "a4" ? "secondary" : "ghost"} size="sm" className="h-7" onClick={() => setFormat("a4")}>A4 invoice</Button>
              </div>
              <Button size="sm" onClick={() => printInvoice(fmt)}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>
              <Button size="sm" variant="outline" onClick={onClose}>{title === "Sale complete" ? "New sale" : "Close"}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Prints only the invoice, from a hidden frame with the app's styles, so it always comes out
 * clean at the top of the page (A4 or 80 mm roll) no matter which dialog it was opened from.
 */
function printInvoice(fmt: "thermal" | "a4") {
  const el = document.querySelectorAll("#print-area");
  const area = el[el.length - 1];
  if (!area) return;
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join("");
  const page = fmt === "a4" ? "@page { size: A4; margin: 12mm; }" : "@page { size: 80mm auto; margin: 3mm; }";
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title>${styles}<style>${page}
    html,body{background:#fff!important;margin:0}
    #print-area{border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;max-width:none!important;width:100%!important}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @media print{body *{visibility:visible!important}#print-area{position:static!important}}</style></head>
    <body class="font-sans">${area.outerHTML}</body></html>`);
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  // wait for fonts/styles inside the frame
  setTimeout(go, 400);
}

/** A sale can take one medicine from several batches; the customer sees it as one line. */
function mergeLines(items: (SaleData["items"][number] & { medicine_id?: string })[]): SaleData["items"] {
  const out = new Map<string, SaleData["items"][number]>();
  for (const it of items) {
    const k = `${it.medicine_id ?? it.medicine_name}|${Number(it.unit_price)}`;
    const ex = out.get(k);
    if (ex) {
      ex.qty = Number(ex.qty) + Number(it.qty);
      ex.discount = Number(ex.discount) + Number(it.discount);
      ex.line_total = Number(ex.line_total) + Number(it.line_total);
    } else out.set(k, { ...it });
  }
  return [...out.values()];
}

type Props = { data: SaleData; settings: Settings | undefined; cashReceived?: number | undefined; change?: number | undefined };

function totalsOf(data: SaleData) {
  const s = data.sale;
  const discount = Number(s.item_discount) + Number(s.bill_discount);
  const salePaid = data.payments.filter((p) => p.kind !== "refund");
  return { s, discount, salePaid, refunds: data.payments.filter((p) => p.kind === "refund") };
}

function A4Invoice({ data, settings, cashReceived, change }: Props) {
  const { s, discount, salePaid, refunds } = totalsOf(data);
  const cancelled = s.status === "cancelled";
  return (
    <div id="print-area" className="a4 relative rounded-md border bg-white p-6 text-[13px] leading-relaxed text-black">
      {cancelled && <div className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-black tracking-widest text-red-600/15 [transform:rotate(-20deg)]">CANCELLED</div>}
      <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div>
          <div className="text-2xl font-bold">{settings?.pharmacy_name}</div>
          {settings?.address && <div className="text-gray-700">{settings.address}</div>}
          {settings?.phone && <div className="text-gray-700">Phone: {settings.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tracking-wide">INVOICE</div>
          <div><span className="text-gray-600">No:</span> <b>{s.invoice_no}</b></div>
          <div><span className="text-gray-600">Date:</span> {bdDateTime(s.created_at)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Bill to</div>
          <div className="font-semibold">{s.customers?.name ?? "Walk-in customer"}</div>
          {s.customers?.phone && <div>{s.customers.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Payment</div>
          <div>{salePaid.length ? [...new Set(salePaid.map((p) => METHOD[p.method] ?? p.method))].join(", ") : "Due"}</div>
          <div className={cn("font-semibold", Number(s.due) > 0 ? "text-red-700" : "text-green-700")}>{cancelled ? "Cancelled" : Number(s.due) > 0 ? "Partly paid" : "Paid"}</div>
        </div>
      </div>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left text-[12px]">
            <th className="border border-gray-300 px-2 py-1.5 text-center">#</th>
            <th className="border border-gray-300 px-2 py-1.5">Item</th>
            <th className="border border-gray-300 px-2 py-1.5 text-right">Qty</th>
            <th className="border border-gray-300 px-2 py-1.5 text-right">Rate</th>
            <th className="border border-gray-300 px-2 py-1.5 text-right">Discount</th>
            <th className="border border-gray-300 px-2 py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={it.id}>
              <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
              <td className="border border-gray-300 px-2 py-1">{itemName(it)}</td>
              <td className="border border-gray-300 px-2 py-1 text-right whitespace-nowrap">{qtyText(it)}</td>
              <td className="border border-gray-300 px-2 py-1 text-right">{taka(it.unit_price)}</td>
              <td className="border border-gray-300 px-2 py-1 text-right">{Number(it.discount) > 0 ? taka(it.discount) : "—"}</td>
              <td className="border border-gray-300 px-2 py-1 text-right">{taka(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap justify-between gap-6">
        <div className="max-w-sm self-end text-[12px]">
          <div className="text-gray-500">In words</div>
          <div className="font-medium italic">{amountInWords(Number(s.total) - Number(s.returned_amount))}</div>
        </div>
        <div className="ml-auto w-64 space-y-0.5">
          <Line k="Subtotal" v={taka(s.subtotal)} />
          {discount > 0 && <Line k="Discount" v={"−" + taka(discount)} />}
          <div className="flex justify-between border-y-2 border-black py-1 text-base font-bold"><span>Total</span><span>{taka(s.total)}</span></div>
          {salePaid.map((p) => <Line key={p.id} k={`${KIND[p.kind] ?? p.kind} (${METHOD[p.method] ?? p.method})`} v={taka(p.amount)} />)}
          {refunds.map((p) => <Line key={p.id} k={`Refunded (${METHOD[p.method] ?? p.method})`} v={"−" + taka(p.amount)} />)}
          {Number(s.returned_amount) > 0 && <Line k="Returned" v={"−" + taka(s.returned_amount)} />}
          {cashReceived != null && change != null && change > 0 && <><Line k="Cash received" v={taka(cashReceived)} /><Line k="Change" v={taka(change)} /></>}
          {Number(s.due) > 0 && <div className="flex justify-between font-bold text-red-700"><span>Due</span><span>{taka(s.due)}</span></div>}
        </div>
      </div>

      <div className="mt-14 flex justify-between gap-8 text-[12px] text-gray-700">
        <div className="w-44 border-t border-gray-500 pt-1 text-center">Customer signature</div>
        <div className="w-44 border-t border-gray-500 pt-1 text-center">Authorised signature</div>
      </div>
      {settings?.invoice_footer && <div className="mt-5 border-t pt-2 text-center text-[12px] text-gray-700">{settings.invoice_footer}</div>}
    </div>
  );
}

function ThermalReceipt({ data, settings, cashReceived, change }: Props) {
  const { s, discount, salePaid, refunds } = totalsOf(data);
  return (
    <div id="print-area" className="thermal mx-auto w-full max-w-[300px] rounded-md border bg-white p-3 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <div className="text-[15px] font-bold">{settings?.pharmacy_name}</div>
        {settings?.address && <div>{settings.address}</div>}
        {settings?.phone && <div>Phone: {settings.phone}</div>}
      </div>
      <Dash />
      <div className="flex justify-between"><span>Invoice</span><b>{s.invoice_no}</b></div>
      <div className="flex justify-between"><span>Date</span><span>{bdDateTime(s.created_at)}</span></div>
      <div className="flex justify-between gap-2"><span>Customer</span><span className="text-right">{s.customers?.name ?? "Walk-in"}{s.customers?.phone ? ` ${s.customers.phone}` : ""}</span></div>
      <Dash />
      {data.items.map((it) => (
        <div key={it.id} className="mb-1">
          <div className="font-semibold">{itemName(it)}</div>
          <div className="flex justify-between">
            <span>{qtyText(it)} x {Number(it.unit_price).toFixed(2)}{Number(it.discount) > 0 ? ` -${Number(it.discount).toFixed(2)}` : ""}</span>
            <span>{Number(it.line_total).toFixed(2)}</span>
          </div>
        </div>
      ))}
      <Dash />
      <Line k="Subtotal" v={taka(s.subtotal)} />
      {discount > 0 && <Line k="Discount" v={"−" + taka(discount)} />}
      <div className="flex justify-between text-[14px] font-bold"><span>TOTAL</span><span>{taka(s.total)}</span></div>
      {salePaid.map((p) => <Line key={p.id} k={`${KIND[p.kind] ?? p.kind} (${METHOD[p.method] ?? p.method})`} v={taka(p.amount)} />)}
      {refunds.map((p) => <Line key={p.id} k="Refunded" v={"−" + taka(p.amount)} />)}
      {cashReceived != null && change != null && change > 0 && <><Line k="Cash" v={taka(cashReceived)} /><Line k="Change" v={taka(change)} /></>}
      {Number(s.returned_amount) > 0 && <Line k="Returned" v={"−" + taka(s.returned_amount)} />}
      {Number(s.due) > 0 && <div className="flex justify-between font-bold"><span>DUE</span><span>{taka(s.due)}</span></div>}
      {s.status === "cancelled" && <div className="mt-1 text-center font-bold">*** CANCELLED ***</div>}
      <div className="mt-1 text-[11px] italic">{amountInWords(Number(s.total) - Number(s.returned_amount))}</div>
      <Dash />
      <div className="text-center">{settings?.invoice_footer}</div>
    </div>
  );
}

/** "Konadex 450 ml" — the size tells 200 ml and 450 ml apart. */
function itemName(it: SaleData["items"][number]) {
  const st = it.medicines?.strength;
  return st && !it.medicine_name.toLowerCase().includes(st.toLowerCase()) ? `${it.medicine_name} ${st}` : it.medicine_name;
}
function qtyText(it: SaleData["items"][number]) {
  const u = it.medicines?.sale_unit;
  return `${Number(it.qty)}${u && u !== "pcs" ? " " + u : ""}`;
}

function Dash() { return <div className="my-1.5 border-t border-dashed border-black" />; }
function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span>{k}</span><span className="shrink-0">{v}</span></div>;
}
