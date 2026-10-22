import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bdToday, errMsg, taka } from "@/lib/format";
import { Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMyDrawer } from "@/components/DrawerGate";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — Pharmacy POS" },
      { name: "description", content: "Record and review shop expenses like rent, salary and bills." },
      { property: "og:title", content: "Expenses — Pharmacy POS" },
      { property: "og:description", content: "Record and review shop expenses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Expenses,
});

const CATS = ["Rent", "Salary", "Electricity", "Internet / Phone", "Transport", "Tea / Snacks", "Repair", "Other"];
const METHODS = ["cash", "bkash", "nagad", "rocket", "bank"] as const;
type Method = (typeof METHODS)[number];

function monthStart(d: string) { return d.slice(0, 8) + "01"; }

function Expenses() {
  const { role, user } = Route.useRouteContext();
  const qc = useQueryClient();
  const drawer = useMyDrawer(user.id);
  const drawerOpen = drawer.data?.status !== undefined; // drawer opens automatically; never block
  const [toDelete, setToDelete] = useState<{ id: string; category: string; amount: number; expense_date: string } | null>(null);
  const today = bdToday();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [f, setF] = useState({ category: "Rent", amount: "", date: today, method: "cash" as Method, note: "" });

  const list = useQuery({
    queryKey: ["expenses", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").gte("expense_date", from).lte("expense_date", to).order("expense_date", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const amt = Number(f.amount);
      if (!(amt > 0)) throw new Error("Enter an amount");
      const { error } = await supabase.from("expenses").insert({ category: f.category, amount: amt, expense_date: f.date, method: f.method, note: f.note.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense added");
      setF({ ...f, amount: "", note: "" });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_expense", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense removed");
      setToDelete(null);
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      qc.invalidateQueries({ queryKey: ["report-period"] });
      qc.invalidateQueries({ queryKey: ["cash-drawer"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (role !== "admin" && role !== "manager") return <p className="text-muted-foreground">Only managers can see expenses.</p>;

  const rows = list.data ?? [];
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  const byCat = Object.entries(rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.category]: (a[r.category] ?? 0) + Number(r.amount) }), {})).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold">Expenses</h1>
      <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div><Label>Category</Label>
          <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="amt">Amount (৳)</Label><Input id="amt" type="number" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div><Label htmlFor="d">Date</Label><Input id="d" type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><Label>Paid by</Label>
          <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v as Method })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="n">Note</Label><Input id="n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <Button type="submit" disabled={add.isPending || !drawerOpen} title={drawerOpen ? undefined : "Open the cash drawer first"}>Add expense</Button>
      </form>

      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="f">From</Label><Input id="f" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="t">To</Label><Input id="t" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="ml-auto text-sm">Total: <b className="text-lg">{taka(total)}</b></div>
      </div>
      {byCat.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {byCat.map(([c, v]) => <span key={c} className="rounded-md bg-muted px-3 py-1">{c}: <b>{taka(v)}</b></span>)}
        </div>
      )}
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Paid by</TableHead><TableHead>Note</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>
            {list.isLoading && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!list.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No expenses in this period.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.expense_date}</TableCell><TableCell>{r.category}</TableCell>
                <TableCell className="capitalize">{r.method}</TableCell><TableCell className="text-muted-foreground">{r.note}</TableCell>
                <TableCell className="text-right font-medium">{taka(r.amount)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label="Remove expense"
                    disabled={!drawerOpen}
                    title={drawerOpen ? "Remove" : "Open the cash drawer first"}
                    onClick={() => setToDelete({ id: r.id, category: r.category, amount: Number(r.amount), expense_date: r.expense_date })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">A removed expense is kept in the audit log (who removed it and when).</p>
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && `${toDelete.category} · ${taka(toDelete.amount)} · ${toDelete.expense_date}. Reports and the cash drawer will update.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => { e.preventDefault(); if (toDelete) remove.mutate(toDelete.id); }}
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
