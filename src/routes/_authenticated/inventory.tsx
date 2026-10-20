import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { medicinesQuery, settingsQuery, type Batch, type Medicine, type MedicineWithBatches } from "@/lib/queries";
import { sellableStock } from "@/lib/pos";
import { isLowStock, stockLabel } from "@/lib/pack";
import { bdToday, daysUntil, errMsg, taka, expLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdjustBatchDialog, NewBatchDialog } from "@/components/StockAdjust";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Pharmacy POS" }, { name: "description", content: "Medicines, batches, stock and expiry." }] }),
  component: InventoryPage,
});

type Filter = "all" | "low" | "expiring" | "expired" | "inactive";

function InventoryPage() {
  const { role } = Route.useRouteContext();
  const isMgr = role === "admin" || role === "manager";
  const { data: meds = [], isLoading, error } = useQuery(medicinesQuery);
  const { data: settings } = useQuery(settingsQuery);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [editing, setEditing] = useState<Partial<Medicine> | null>(null);
  const [adjusting, setAdjusting] = useState<{ m: MedicineWithBatches; b: Batch } | null>(null);
  const [adding, setAdding] = useState<MedicineWithBatches | null>(null);
  const today = bdToday();
  const low = settings?.low_stock_threshold ?? 10;
  const alertDays = settings?.expiry_alert_days ?? 90;

  const rows = useMemo(() => meds.map((m) => {
    const stock = sellableStock(m.batches, today);
    const value = m.batches.filter((b) => b.expiry_date > today).reduce((s, b) => s + Number(b.qty_on_hand) * Number(b.unit_cost), 0);
    const expired = m.batches.some((b) => b.expiry_date <= today && Number(b.qty_on_hand) > 0);
    const expiring = m.batches.some((b) => b.expiry_date > today && daysUntil(b.expiry_date, today) <= alertDays && Number(b.qty_on_hand) > 0);
    return { m, stock, value, expired, expiring };
  }), [meds, today, alertDays]);

  const shown = rows.filter(({ m, stock, expired, expiring }) => {
    const s = q.trim().toLowerCase();
    if (s && ![m.name, m.name_bn, m.generic_name, m.barcode, m.code, m.manufacturer].some((f) => f?.toLowerCase().includes(s))) return false;
    if (filter === "inactive") return !m.is_active;
    if (!m.is_active) return false;
    if (filter === "low") return isLowStock(stock, m, low);
    if (filter === "expiring") return expiring;
    if (filter === "expired") return expired;
    return true;
  });
  const totalValue = rows.filter((r) => r.m.is_active).reduce((s, r) => s + r.value, 0);

  function exportCsv() {
    const head = ["code", "name", "name_bn", "generic_name", "manufacturer", "category", "strength", "dosage_form", "sale_unit", "barcode", "prescription_required", "stock", "stock_value"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map(({ m, stock, value }) => [m.code, m.name, m.name_bn, m.generic_name, m.manufacturer, m.category, m.strength, m.dosage_form, m.sale_unit, m.barcode, m.prescription_required, stock, value.toFixed(2)].map(esc).join(","));
    const blob = new Blob(["\ufeff" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `medicines-${today}.csv`; a.click();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Medicines &amp; Stock</h1>
          <p className="text-sm text-muted-foreground">Sellable stock value (at cost): <span className="font-medium text-foreground">{taka(totalValue)}</span></p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>
          {isMgr && <Button size="sm" onClick={() => setEditing({ sale_unit: "pcs", is_active: true, prescription_required: false, default_price: 0 })}><Plus className="mr-1 h-4 w-4" />Add medicine</Button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search name, generic, barcode…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100); }} className="max-w-xs" />
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All active</SelectItem>
            <SelectItem value="low">Low stock</SelectItem>
            <SelectItem value="expiring">Expiring in {alertDays}d</SelectItem>
            <SelectItem value="expired">Has expired stock</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="w-8" /><th className="p-2">Medicine</th><th className="p-2">Stock</th><th className="p-2">Value</th><th className="p-2">Alerts</th><th /></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {error && <tr><td colSpan={6} className="p-6 text-center text-destructive">{errMsg(error)}</td></tr>}
            {!isLoading && shown.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No medicines found.{isMgr && meds.length === 0 && " Add your first medicine, then receive stock from Purchases."}</td></tr>}
            {shown.slice(0, limit).map(({ m, stock, value, expired, expiring }) => (
              <Fragment key={m.id}>
                <tr className="border-b">
                  <td className="p-2"><button aria-label="Show batches" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                  <td className="p-2"><div className="font-medium">{m.name} {m.strength}</div><div className="text-xs text-muted-foreground">{[m.name_bn, m.generic_name, m.dosage_form, m.manufacturer, m.code].filter(Boolean).join(" · ")}</div></td>
                  <td className="whitespace-nowrap p-2 font-medium">{stockLabel(stock, m)}</td>
                  <td className="p-2">{taka(value)}</td>
                  <td className="p-2 space-x-1">
                    {stock <= 0 ? <Badge variant="destructive">Out of stock</Badge>
                      : isLowStock(stock, m, low) && <Badge variant="outline" className="border-warning text-warning-foreground">Low</Badge>}
                    {expiring && <Badge variant="outline" className="border-warning text-warning-foreground">Expiring</Badge>}
                    {expired && <Badge variant="destructive">Expired</Badge>}
                    {m.prescription_required && <Badge variant="secondary">Rx</Badge>}
                  </td>
                  <td className="p-2 text-right">{isMgr && <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>Edit</Button>}</td>
                </tr>
                {open === m.id && (
                  <tr className="border-b bg-muted/30"><td /><td colSpan={5} className="p-2">
                    {isMgr && (
                      <div className="mb-2 flex justify-end">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAdding(m)}><Plus className="mr-1 h-3 w-3" />Add stock (opening)</Button>
                      </div>
                    )}
                    {m.batches.length === 0 ? <p className="text-xs text-muted-foreground">No batches yet. Receive stock from Purchases{isMgr ? " or use “Add stock”" : ""}.</p> : (
                      <table className="w-full text-xs">
                        <thead className="text-left text-muted-foreground"><tr><th className="py-1">Batch</th><th>Expiry</th><th>Qty</th><th>Cost</th><th>Price</th><th /><th /></tr></thead>
                        <tbody>{m.batches.map((b) => {
                          const d = daysUntil(b.expiry_date, today);
                          const nextId = m.batches.find((x) => x.expiry_date > today && Number(x.qty_on_hand) > 0)?.id;
                          return (
                            <tr key={b.id}>
                              <td className="py-1">{b.batch_no}{b.id === nextId && <Badge variant="secondary" className="ml-1">sells next</Badge>}</td>
                              <td>{expLabel(b.expiry_date)}</td><td>{Number(b.qty_on_hand)}</td><td>{taka(b.unit_cost)}</td><td>{taka(b.sale_price)}</td>
                              <td>{d <= 0 ? <Badge variant="destructive">Expired</Badge> : d <= alertDays ? <span className="text-warning-foreground">{d} days left</span> : null}</td>
                              <td className="text-right">{isMgr && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdjusting({ m, b })}>Adjust</Button>}</td>
                            </tr>
                          );
                        })}</tbody>
                      </table>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
          Showing {limit} of {shown.length}
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 200)}>Show more</Button>
        </div>
      )}
      {editing && <MedicineDialog value={editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustBatchDialog medicine={adjusting.m} batch={adjusting.b} onClose={() => setAdjusting(null)} />}
      {adding && <NewBatchDialog medicine={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function MedicineDialog({ value, onClose }: { value: Partial<Medicine>; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Medicine) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  async function save() {
    if (!v.name?.trim()) { toast.error("Medicine name is required"); return; }
    setBusy(true);
    const row = {
      name: v.name.trim(), name_bn: v.name_bn || null, generic_name: v.generic_name || null, manufacturer: v.manufacturer || null,
      category: v.category || null, strength: v.strength || null, dosage_form: v.dosage_form || null, sale_unit: v.sale_unit || "pcs",
      barcode: v.barcode || null, code: v.code || null, prescription_required: !!v.prescription_required, is_active: v.is_active ?? true,
      default_price: Number(v.default_price) || 0,
    };
    const { error } = v.id ? await supabase.from("medicines").update(row).eq("id", v.id) : await supabase.from("medicines").insert(row);
    setBusy(false);
    if (error) { toast.error(error.code === "23505" ? "Barcode or code already used by another medicine" : errMsg(error)); return; }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["medicines"] });
    onClose();
  }
  const F = ({ k, label, ph }: { k: keyof Medicine; label: string; ph?: string }) => (
    <div><Label>{label}</Label><Input value={(v[k] as string) ?? ""} onChange={set(k)} placeholder={ph} /></div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{v.id ? "Edit medicine" : "Add medicine"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {F({ k: "name", label: "Name (English)", ph: "Napa" })}
          {F({ k: "name_bn", label: "Name (বাংলা)", ph: "নাপা" })}
          {F({ k: "generic_name", label: "Generic", ph: "Paracetamol" })}
          {F({ k: "manufacturer", label: "Brand / Manufacturer" })}
          {F({ k: "category", label: "Category" })}
          {F({ k: "strength", label: "Strength", ph: "500 mg" })}
          {F({ k: "dosage_form", label: "Dosage form", ph: "Tablet" })}
          {F({ k: "sale_unit", label: "Sale unit", ph: "pcs" })}
          {F({ k: "barcode", label: "Barcode" })}
          {F({ k: "code", label: "Medicine code / SKU" })}
        </div>
        <div className="flex flex-wrap gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm"><Switch checked={!!v.prescription_required} onCheckedChange={(c) => setV({ ...v, prescription_required: c })} />Prescription required</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={v.is_active ?? true} onCheckedChange={(c) => setV({ ...v, is_active: c })} />Active</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
