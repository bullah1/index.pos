import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Batch, Medicine } from "@/lib/queries";
import { bdToday, errMsg, taka } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const ADJ_REASONS = [
  { value: "count", label: "Stock count correction" },
  { value: "damaged", label: "Damaged / broken" },
  { value: "expired", label: "Expired — disposed" },
  { value: "lost", label: "Lost / missing" },
  { value: "return_to_supplier", label: "Returned to supplier" },
  { value: "opening", label: "Opening stock" },
  { value: "other", label: "Other (write a note)" },
] as const;
export type AdjReason = (typeof ADJ_REASONS)[number]["value"];
export const reasonLabel = (r: string) => ADJ_REASONS.find((x) => x.value === r)?.label ?? r;

type Mode = "set" | "add" | "remove";

function useAdjust(onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc("adjust_stock", { p: p as never });
      if (error) throw error;
      return data as { adj_no: string; qty_after: number; change: number };
    },
    onSuccess: (r) => {
      toast.success(`${r.adj_no}: stock is now ${Number(r.qty_after)}`);
      qc.invalidateQueries({ queryKey: ["medicines"] });
      qc.invalidateQueries({ queryKey: ["stock-adjustments"] });
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

/** Adjust the quantity of one existing batch. */
export function AdjustBatchDialog({ medicine, batch, onClose }: { medicine: Medicine; batch: Batch; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("set");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<AdjReason>(batch.expiry_date <= bdToday() ? "expired" : "count");
  const [note, setNote] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const adjust = useAdjust(onClose);

  const now = Number(batch.qty_on_hand);
  const n = Number(qty);
  const valid = qty.trim() !== "" && Number.isFinite(n) && n >= 0;
  const after = !valid ? null : mode === "set" ? n : mode === "add" ? now + n : now - n;
  const change = after == null ? 0 : after - now;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Adjust stock</DialogTitle></DialogHeader>
        <div className="rounded-md bg-muted p-3 text-sm">
          <div className="font-medium">{medicine.name} {medicine.strength}</div>
          <div className="text-muted-foreground">Batch {batch.batch_no} · exp {batch.expiry_date} · cost {taka(batch.unit_cost)}</div>
          <div className="mt-1">In system now: <b>{now} {medicine.sale_unit}</b></div>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            adjust.mutate({ idempotency_key: key, batch_id: batch.id, mode, qty: n, reason, note });
          }}
        >
          <div className="grid grid-cols-3 gap-1 rounded-md border p-1 text-sm">
            {([["set", "Counted qty"], ["add", "Add (+)"], ["remove", "Remove (−)"]] as const).map(([m, l]) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={cn("rounded px-2 py-1.5", mode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>{l}</button>
            ))}
          </div>
          <div>
            <Label htmlFor="adj-qty">{mode === "set" ? "Quantity actually on the shelf" : mode === "add" ? "Quantity to add" : "Quantity to remove"}</Label>
            <Input id="adj-qty" type="number" inputMode="decimal" min={0} step="any" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as AdjReason)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ADJ_REASONS.filter((r) => r.value !== "opening").map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="adj-note">Note</Label><Input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "other" ? "Required" : "Optional"} /></div>
          {after != null && (
            <div className={cn("rounded-md border p-3 text-sm", after < 0 && "border-destructive text-destructive")}>
              {after < 0 ? `Cannot remove more than ${now}.` : change === 0 ? "No change." : (
                <>
                  {now} → <b>{after}</b> ({change > 0 ? "+" : ""}{change}) · value {change > 0 ? "+" : "−"}{taka(Math.abs(change) * Number(batch.unit_cost))} at cost
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={adjust.isPending || after == null || after < 0 || change === 0}>{adjust.isPending ? "Saving…" : "Save adjustment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add stock as a new batch without a purchase (opening stock, found stock). */
export function NewBatchDialog({ medicine, onClose }: { medicine: Medicine & { batches: Batch[] }; onClose: () => void }) {
  const last = [...medicine.batches].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
  const [f, setF] = useState({
    batch_no: "",
    expiry_date: "",
    qty: "",
    unit_cost: last ? String(last.unit_cost) : "",
    sale_price: String(last?.sale_price ?? medicine.default_price ?? ""),
    reason: "opening" as AdjReason,
    note: "",
  });
  const [key] = useState(() => crypto.randomUUID());
  const adjust = useAdjust(onClose);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.batch_no.trim() || !f.expiry_date) { toast.error("Batch number and expiry are required"); return; }
    if (f.expiry_date <= bdToday()) { toast.error("This batch is already expired"); return; }
    if (!(Number(f.qty) > 0)) { toast.error("Enter a quantity"); return; }
    if (f.unit_cost === "" || !(Number(f.sale_price) > 0)) { toast.error("Enter cost and sale price"); return; }
    adjust.mutate({
      idempotency_key: key, medicine_id: medicine.id, batch_no: f.batch_no.trim(), expiry_date: f.expiry_date,
      qty: Number(f.qty), unit_cost: Number(f.unit_cost), sale_price: Number(f.sale_price), reason: f.reason, note: f.note,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add stock — {medicine.name} {medicine.strength}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">For stock you already have (opening stock, found stock). New stock bought from a supplier goes in Purchases, so the supplier balance stays right.</p>
        <form className="grid grid-cols-2 gap-3" onSubmit={submit}>
          <div><Label htmlFor="nb-b">Batch no.</Label><Input id="nb-b" value={f.batch_no} onChange={set("batch_no")} autoFocus /></div>
          <div><Label htmlFor="nb-e">Expiry</Label><Input id="nb-e" type="date" value={f.expiry_date} onChange={set("expiry_date")} /></div>
          <div><Label htmlFor="nb-q">Quantity ({medicine.sale_unit})</Label><Input id="nb-q" type="number" inputMode="decimal" min={0} step="any" value={f.qty} onChange={set("qty")} /></div>
          <div><Label htmlFor="nb-c">Cost / unit (৳)</Label><Input id="nb-c" type="number" inputMode="decimal" min={0} step="0.01" value={f.unit_cost} onChange={set("unit_cost")} /></div>
          <div><Label htmlFor="nb-s">Sale price (৳)</Label><Input id="nb-s" type="number" inputMode="decimal" min={0} step="0.01" value={f.sale_price} onChange={set("sale_price")} /></div>
          <div>
            <Label>Reason</Label>
            <Select value={f.reason} onValueChange={(v) => setF({ ...f, reason: v as AdjReason })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="opening">Opening stock</SelectItem>
                <SelectItem value="count">Found in count</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label htmlFor="nb-n">Note</Label><Input id="nb-n" value={f.note} onChange={set("note")} placeholder={f.reason === "other" ? "Required" : "Optional"} /></div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={adjust.isPending}>{adjust.isPending ? "Saving…" : "Add stock"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
