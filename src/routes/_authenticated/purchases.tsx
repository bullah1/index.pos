import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { medicinesQuery, suppliersQuery } from "@/lib/queries";
import { bdDateTime, bdToday, errMsg, taka, NO_EXPIRY, autoBatchNo, defaultCost } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchSelect } from "@/components/SearchSelect";

export const Route = createFileRoute("/_authenticated/purchases")({
  head: () => ({ meta: [{ title: "Purchases — Pharmacy POS" }, { name: "description", content: "Receive medicine stock from suppliers." }] }),
  component: PurchasesPage,
});

interface Line { medicine_id: string; batch_no: string; expiry_date: string; qty: number; unit_cost: number; sale_price: number }
const blank = (): Line => ({ medicine_id: "", batch_no: "", expiry_date: "", qty: 1, unit_cost: 0, sale_price: 0 });

function PurchasesPage() {
  const { role } = Route.useRouteContext();
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchases").select("*, suppliers(name)").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
  if (role === "cashier") return <p className="text-sm text-muted-foreground">Purchases are available to managers and admins.</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Purchases</h1>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />New purchase</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="p-2">No.</th><th className="p-2">Date</th><th className="p-2">Supplier</th><th className="p-2">Supplier inv.</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Balance</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && data.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No purchases yet.</td></tr>}
            {data.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="p-2 font-medium">{p.purchase_no}</td>
                <td className="p-2" title={bdDateTime(p.created_at)}>{p.purchase_date}</td>
                <td className="p-2">{p.suppliers?.name}</td>
                <td className="p-2">{p.supplier_invoice_no}</td>
                <td className="p-2 text-right">{taka(p.total)}</td>
                <td className="p-2 text-right">{taka(p.paid)}</td>
                <td className="p-2 text-right">{taka(Number(p.total) - Number(p.paid))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && <PurchaseDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function PurchaseDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: meds = [] } = useQuery(medicinesQuery);
  const { data: suppliers = [] } = useQuery(suppliersQuery);
  const [supplierId, setSupplierId] = useState("");
  const [newSup, setNewSup] = useState("");
  const [invNo, setInvNo] = useState("");
  const [date, setDate] = useState(bdToday());
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState(0);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const sub = lines.reduce((s, l) => s + Math.round(l.qty * l.unit_cost * 100), 0) / 100;
  const total = Math.max(0, sub - discount);
  const medOptions = useMemo(
    () => meds.filter((m) => m.is_active).map((m) => ({
      value: m.id,
      label: `${m.name}${m.strength ? " " + m.strength : ""}`,
      hint: [m.dosage_form, m.generic_name, m.manufacturer].filter(Boolean).join(" · ") || undefined,
      keywords: [m.barcode, m.code, m.name_bn].filter(Boolean).join(" "),
    })),
    [meds],
  );
  const upd = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, ...patch } : l));

  async function addSupplier() {
    if (!newSup.trim()) return;
    const { data, error } = await supabase.from("suppliers").insert({ name: newSup.trim() }).select("id").single();
    if (error) { toast.error(errMsg(error)); return; }
    setSupplierId(data.id); setNewSup("");
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  }

  async function post() {
    if (busy) return;
    if (!supplierId) { toast.error("Select a supplier"); return; }
    const items = lines.map((l) => ({ ...l, batch_no: l.batch_no.trim() || autoBatchNo(), expiry_date: l.expiry_date || NO_EXPIRY }));
    for (const l of items) {
      const name = meds.find((m) => m.id === l.medicine_id)?.name ?? "this line";
      if (!l.medicine_id) { toast.error("Select a medicine on each line"); return; }
      if (l.expiry_date <= bdToday()) { toast.error(`${name}: expiry date has already passed`); return; }
      if (!(l.sale_price > 0)) { toast.error(`${name}: set a sale price`); return; }
      if (!(l.qty > 0)) { toast.error("Quantity must be positive"); return; }
    }
    if (discount > sub) { toast.error("Discount exceeds subtotal"); return; }
    if (paid > total) { toast.error("Paid exceeds total"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("post_purchase", {
      p: { idempotency_key: key, supplier_id: supplierId, supplier_invoice_no: invNo, purchase_date: date, discount, paid, items } as never,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Purchase ${(data as { purchase_no: string }).purchase_no} posted — stock updated`);
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["medicines"] });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle>New purchase</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Supplier</Label>
            <SearchSelect value={supplierId} onChange={setSupplierId} placeholder="Select supplier"
              options={suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.phone ?? undefined }))} />
            <div className="mt-1 flex gap-1"><Input className="h-8" placeholder="or add new supplier" value={newSup} onChange={(e) => setNewSup(e.target.value)} /><Button size="sm" variant="outline" onClick={addSupplier}>Add</Button></div>
          </div>
          <div><Label>Supplier invoice no.</Label><Input value={invNo} onChange={(e) => setInvNo(e.target.value)} /></div>
          <div><Label>Purchase date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        <div className="space-y-2">
          <div className="hidden grid-cols-[2fr_1fr_1fr_80px_1fr_1fr_32px] gap-2 text-xs text-muted-foreground md:grid">
            <span>Medicine</span><span>Batch (optional)</span><span>Expiry (optional)</span><span>Qty</span><span>Purchase / unit</span><span>MRP / unit</span><span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2 md:grid-cols-[2fr_1fr_1fr_80px_1fr_1fr_32px] md:border-0 md:p-0">
              <div className="col-span-2 min-w-0 md:col-span-1">
                <SearchSelect
                  value={l.medicine_id}
                  placeholder="Medicine"
                  searchPlaceholder="Name, generic or barcode…"
                  options={medOptions}
                  onChange={(v) => {
                    const m = meds.find((x) => x.id === v);
                    const last = [...(m?.batches ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
                    upd(i, { medicine_id: v, sale_price: Number(last?.sale_price ?? m?.default_price ?? 0), unit_cost: defaultCost(last?.sale_price ?? m?.default_price) });
                  }}
                />
              </div>
              <Input placeholder="Batch (auto)" value={l.batch_no} onChange={(e) => upd(i, { batch_no: e.target.value })} />
              <Input type="date" value={l.expiry_date} title="Expiry (optional)" aria-label="Expiry (optional)" onChange={(e) => upd(i, { expiry_date: e.target.value })} />
              <Input type="number" min={1} value={l.qty || ""} placeholder="Qty" onChange={(e) => upd(i, { qty: Math.max(0, Number(e.target.value) || 0) })} aria-label="Quantity" />
              <Input type="number" min={0} step="0.01" value={l.unit_cost} onChange={(e) => upd(i, { unit_cost: Number(e.target.value) })} aria-label="Cost" />
              <Input type="number" min={0} step="0.01" value={l.sale_price} onChange={(e) => upd(i, { sale_price: Number(e.target.value), unit_cost: defaultCost(e.target.value) })} aria-label="Sale price" title="MRP — purchase price is set to MRP − 55%" />
              <Button variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="mr-1 h-4 w-4" />Add line</Button>
          {meds.length === 0 && <p className="text-xs text-muted-foreground">Add medicines in Inventory first.</p>}
        </div>

        <div className="ml-auto w-full max-w-xs space-y-2 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{taka(sub)}</span></div>
          <div className="flex items-center justify-between gap-2"><span>Discount</span><Input className="h-8 w-28 text-right" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></div>
          <div className="flex justify-between font-bold"><span>Total</span><span>{taka(total)}</span></div>
          <div className="flex items-center justify-between gap-2"><span>Paid now</span><Input className="h-8 w-28 text-right" type="number" min={0} value={paid} onChange={(e) => setPaid(Number(e.target.value))} /></div>
          <div className="flex justify-between text-muted-foreground"><span>Supplier balance</span><span>{taka(Math.max(0, total - paid))}</span></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={post}>{busy ? "Posting…" : "Post purchase"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
