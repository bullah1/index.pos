import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bookSteadfast, refreshSteadfastStatus, type BookCourierInput } from "@/lib/courier.functions";
import { bdDateTime, errMsg, taka } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const CHARGES = [
  { label: "Inside Dhaka", value: 70 },
  { label: "Dhaka sub-area", value: 100 },
  { label: "Outside Dhaka", value: 130 },
];

export const COURIER_STATUS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  in_review: { label: "In review", tone: "outline" },
  pending: { label: "Pending", tone: "outline" },
  hold: { label: "On hold", tone: "outline" },
  delivered_approval_pending: { label: "Delivered (approval)", tone: "secondary" },
  partial_delivered_approval_pending: { label: "Partly delivered (approval)", tone: "secondary" },
  cancelled_approval_pending: { label: "Cancel (approval)", tone: "destructive" },
  unknown_approval_pending: { label: "Unknown (approval)", tone: "outline" },
  delivered: { label: "Delivered", tone: "default" },
  partial_delivered: { label: "Partly delivered", tone: "secondary" },
  cancelled: { label: "Cancelled", tone: "destructive" },
  unknown: { label: "Unknown", tone: "outline" },
};
export const courierLabel = (s: string) => COURIER_STATUS[s]?.label ?? s;

export type CourierRow = {
  id: string; status: string; consignment_id: string; tracking_code: string | null; cod_amount: number;
  delivery_charge: number; recipient_name: string; recipient_phone: string; recipient_address: string; created_at: string;
};

export function CourierDialog({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const book = useServerFn(bookSteadfast);
  const refresh = useServerFn(refreshSteadfastStatus);

  const { data, isLoading } = useQuery({
    queryKey: ["courier", saleId],
    queryFn: async () => {
      const [s, c] = await Promise.all([
        supabase.from("sales").select("id, invoice_no, total, returned_amount, due, status, customers(name, phone, address)").eq("id", saleId).single(),
        supabase.from("courier_orders").select("*").eq("sale_id", saleId).order("created_at", { ascending: false }),
      ]);
      if (s.error) throw s.error;
      const items = await supabase.from("sale_items").select("medicine_name, qty, returned_qty").eq("sale_id", saleId);
      return { sale: s.data, couriers: (c.data ?? []) as CourierRow[], items: items.data ?? [] };
    },
  });

  const live = data?.couriers.find((c) => c.status !== "cancelled");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary" />Steadfast courier {data && `· ${data.sale.invoice_no}`}</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? <p className="text-sm text-muted-foreground">Loading…</p>
          : live ? <Booked row={live} onRefresh={async () => {
              const r = await refresh({ data: { courierId: live.id } });
              if (!r.ok) { toast.error(r.error); return; }
              toast.success(`Status: ${courierLabel(r.status)}`);
              qc.invalidateQueries({ queryKey: ["courier", saleId] });
              qc.invalidateQueries({ queryKey: ["sales"] });
              qc.invalidateQueries({ queryKey: ["sales-couriers"] });
            }} />
          : <BookForm data={data} onBook={async (input) => {
              const r = await book({ data: input });
              if (!r.ok) { toast.error(r.error, { duration: 8000 }); return false; }
              toast.success(`Booked · Consignment ${r.consignmentId}`);
              qc.invalidateQueries({ queryKey: ["courier", saleId] });
              qc.invalidateQueries({ queryKey: ["sales"] });
              qc.invalidateQueries({ queryKey: ["sales-couriers"] });
              return true;
            }} />}
      </DialogContent>
    </Dialog>
  );
}

type SaleForCourier = {
  sale: { id: string; invoice_no: string; total: number; returned_amount: number; due: number; customers: { name: string; phone: string | null; address: string | null } | null };
  items: { medicine_name: string; qty: number; returned_qty: number }[];
};

function BookForm({ data, onBook }: { data: SaleForCourier; onBook: (i: BookCourierInput) => Promise<boolean> }) {
  const c = data.sale.customers;
  const due = Math.max(0, Number(data.sale.due));
  const [f, setF] = useState({
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    altPhone: "",
    address: c?.address ?? "",
    charge: "130",
    collectDue: due > 0,
    note: "",
    deliveryType: 0 as 0 | 1,
  });
  const [busy, setBusy] = useState(false);
  const charge = Math.max(0, Number(f.charge) || 0);
  const cod = Math.round((f.collectDue ? due : 0) + charge);
  const items = data.items
    .map((i) => ({ name: i.medicine_name, qty: Number(i.qty) - Number(i.returned_qty) }))
    .filter((i) => i.qty > 0);
  const itemText = items.map((i) => `${i.name} x${i.qty}`).join(", ").slice(0, 250);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await onBook({
      saleId: data.sale.id, name: f.name, phone: f.phone, altPhone: f.altPhone, address: f.address,
      codAmount: cod, deliveryCharge: charge, note: f.note, itemDescription: itemText, deliveryType: f.deliveryType,
    }).catch((err) => toast.error(errMsg(err)));
    setBusy(false);
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="c-name">Customer name</Label><Input id="c-name" value={f.name} onChange={set("name")} required /></div>
        <div><Label htmlFor="c-phone">Mobile</Label><Input id="c-phone" inputMode="tel" placeholder="01XXXXXXXXX" value={f.phone} onChange={set("phone")} required /></div>
      </div>
      <div><Label htmlFor="c-addr">Full address</Label><Textarea id="c-addr" rows={3} placeholder="House, road, area, thana, district" value={f.address} onChange={set("address")} required /></div>
      <div><Label htmlFor="c-alt">Alternative mobile (optional)</Label><Input id="c-alt" inputMode="tel" value={f.altPhone} onChange={set("altPhone")} /></div>

      <div>
        <Label>Delivery charge (customer pays)</Label>
        <div className="mt-1 flex flex-wrap gap-2">
          {CHARGES.map((x) => (
            <button key={x.label} type="button" onClick={() => setF({ ...f, charge: String(x.value) })}
              className={cn("rounded-md border px-3 py-1.5 text-sm", Number(f.charge) === x.value ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent")}>
              {x.label} ৳{x.value}
            </button>
          ))}
          <Input type="number" inputMode="decimal" min={0} className="h-9 w-24" value={f.charge} onChange={set("charge")} aria-label="Delivery charge" />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={f.deliveryType === 0} onChange={() => setF({ ...f, deliveryType: 0 })} />Home delivery</label>
        <label className="flex items-center gap-2"><input type="radio" checked={f.deliveryType === 1} onChange={() => setF({ ...f, deliveryType: 1 })} />Point (hub) pickup</label>
      </div>

      <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Sale total</span><span>{taka(Number(data.sale.total) - Number(data.sale.returned_amount))}</span></div>
        <label className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><input type="checkbox" checked={f.collectDue} disabled={due <= 0} onChange={(e) => setF({ ...f, collectDue: e.target.checked })} />Collect unpaid due</span>
          <span>{taka(f.collectDue ? due : 0)}</span>
        </label>
        <div className="flex justify-between"><span className="text-muted-foreground">Delivery charge</span><span>+{taka(charge)}</span></div>
        <div className="flex justify-between border-t pt-1 text-base font-semibold"><span>Courier collects (COD)</span><span>{taka(cod)}</span></div>
        {due <= 0 && <p className="text-xs text-muted-foreground">Sale is fully paid, so the courier only collects the delivery charge.</p>}
      </div>

      <div><Label htmlFor="c-note">Note for rider (optional)</Label><Input id="c-note" value={f.note} onChange={set("note")} placeholder="Call before delivery" /></div>
      {itemText && <p className="text-xs text-muted-foreground">Items: {itemText}</p>}

      <DialogFooter><Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy ? "Booking…" : `Book Steadfast · COD ${taka(cod)}`}</Button></DialogFooter>
    </form>
  );
}

function Booked({ row, onRefresh }: { row: CourierRow; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const st = COURIER_STATUS[row.status] ?? { label: row.status, tone: "outline" as const };
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={st.tone}>{st.label}</Badge>
        <span className="text-muted-foreground">Booked {bdDateTime(row.created_at)}</span>
      </div>
      <div className="grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-2">
        <div><div className="text-xs text-muted-foreground">Consignment ID</div><div className="font-mono font-semibold">{row.consignment_id}</div></div>
        <div><div className="text-xs text-muted-foreground">Tracking code</div><div className="font-mono font-semibold">{row.tracking_code ?? "—"}</div></div>
        <div><div className="text-xs text-muted-foreground">COD</div><div className="font-semibold">{taka(row.cod_amount)}</div></div>
        <div><div className="text-xs text-muted-foreground">Delivery charge</div><div>{taka(row.delivery_charge)}</div></div>
      </div>
      <div><div className="text-xs text-muted-foreground">Deliver to</div><div>{row.recipient_name} · {row.recipient_phone}</div><div className="text-muted-foreground">{row.recipient_address}</div></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); await onRefresh(); setBusy(false); }}>
          <RefreshCw className={cn("mr-1 h-4 w-4", busy && "animate-spin")} />Check status
        </Button>
        {row.tracking_code && (
          <Button variant="outline" size="sm" asChild>
            <a href={`https://steadfast.com.bd/t/${encodeURIComponent(row.tracking_code)}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Track parcel</a>
          </Button>
        )}
      </div>
    </div>
  );
}
