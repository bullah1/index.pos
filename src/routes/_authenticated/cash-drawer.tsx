import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bdDateTime, bdToday, errMsg, taka } from "@/lib/format";
import { drawerRows, drawerSummary, myDrawerRow, type CashMovement } from "@/lib/cash";

export const Route = createFileRoute("/_authenticated/cash-drawer")({
  head: () => ({
    meta: [
      { title: "Cash Drawer — Pharmacy POS" },
      { name: "description", content: "Day-wise cash in, cash out and the balance the drawer should hold." },
      { property: "og:title", content: "Cash Drawer — Pharmacy POS" },
      { property: "og:description", content: "Day-wise cash in, cash out and the balance the drawer should hold." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CashDrawer,
});

const iso = (day: string) => new Date(day + "T00:00:00+06:00").toISOString();
function addDays(day: string, n: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function CashDrawer() {
  const { user, role } = Route.useRouteContext();
  const qc = useQueryClient();
  const isMgr = role === "admin" || role === "manager";
  const today = bdToday();
  const [day, setDay] = useState(today);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");

  const data = useQuery({
    queryKey: ["cash-drawer", day, user.id, isMgr],
    queryFn: async () => {
      const from = iso(day);
      const to = iso(addDays(day, 1));

      let cpQuery = supabase
        .from("customer_payments")
        .select("created_by, amount")
        .eq("method", "cash")
        .gte("created_at", from)
        .lt("created_at", to)
        .limit(5000);
      if (!isMgr) cpQuery = cpQuery.eq("created_by", user.id);

      const [sp, cp, dr, pr] = await Promise.all([
        supabase
          .from("sale_payments")
          .select("created_by, amount, kind")
          .eq("method", "cash")
          .gte("created_at", from)
          .lt("created_at", to)
          .limit(5000),
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

      // Due collections live in customer_payments; the matching sale_payments rows are the same money, so they are skipped here.
      const rows = drawerRows({
        drawers: dr.data.map((d) => ({ user_id: d.user_id, opening: d.opening, counted: d.counted })),
        cashSales: sp.data.filter((r) => r.kind === "sale"),
        dueCollections: cp.data,
        cashRefunds: sp.data.filter((r) => r.kind === "refund"),
        expenses,
        supplierPayments,
      });
      return { rows, names: new Map(pr.data.map((p) => [p.id, p.full_name])), drawers: dr.data };
    },
  });

  const openDrawer = useMutation({
    mutationFn: async () => {
      if (opening.trim() === "" || !(Number(opening) >= 0)) throw new Error("Enter the opening cash (0 if none)");
      const { error } = await supabase.rpc("cash_drawer_open", { p: { date: day, opening: Number(opening), note } as never });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Drawer opened");
      setOpening("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["cash-drawer"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const closeDrawer = useMutation({
    mutationFn: async () => {
      const rec = data.data?.drawers.find((d) => d.user_id === user.id);
      if (!rec) throw new Error("Open the drawer first");
      if (counted.trim() === "" || !(Number(counted) >= 0)) throw new Error("Enter the counted cash");
      const { error } = await supabase.rpc("cash_drawer_close", { p: { id: rec.id, counted: Number(counted), note } as never });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Drawer closed");
      setCounted("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["cash-drawer"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const rows = data.data?.rows ?? [];
  const sum = drawerSummary(rows);
  const mine = myDrawerRow(rows, user.id);
  const myRec = data.data?.drawers.find((d) => d.user_id === user.id) ?? null;
  const name = (id: string) => data.data?.names.get(id) ?? (id === user.id ? "You" : "Staff");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Cash Drawer</h1>
        <div>
          <Label htmlFor="d">Date</Label>
          <Input id="d" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={Wallet} label="Opening float" value={taka(sum.opening)} sub={`${rows.length} drawer${rows.length === 1 ? "" : "s"}`} />
        <Card icon={ArrowDownLeft} label="Cash in" value={taka(sum.cashIn)} sub="Counter sales + due collections" />
        <Card icon={ArrowUpRight} label="Cash out" value={taka(sum.cashOut)} sub="Refunds, expenses, supplier payments" />
        <Card icon={Wallet} label="Should be in drawer" value={taka(sum.expected)} sub={sum.unclosed > 0 ? `${sum.unclosed} drawer(s) not counted` : "All drawers counted"} />
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">My drawer</h2>

        {data.isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}

        {data.error && <p className="mt-3 text-sm text-destructive">Could not load the drawer.</p>}

        {data.data && !myRec && (
          <form
            className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              openDrawer.mutate();
            }}
          >
            <div>
              <Label htmlFor="op">Opening cash (৳)</Label>
              <Input id="op" type="number" step="0.01" min="0" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="on">Note</Label>
              <Input id="on" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change taken from bank" />
            </div>
            <Button type="submit" disabled={openDrawer.isPending}>Open drawer</Button>
          </form>
        )}

        {data.data && myRec && myRec.closed_at === null && (
          <div className="mt-3 space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <Mini label="Opening float" value={taka(mine?.opening)} />
              <Mini label="Expected now" value={taka(mine?.expected)} />
              <Mini label="Cash in today" value={taka(mine?.cashIn)} />
            </div>
            <form
              className="grid gap-3 sm:grid-cols-3 sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                closeDrawer.mutate();
              }}
            >
              <div>
                <Label htmlFor="ct">Cash counted (৳)</Label>
                <Input id="ct" type="number" step="0.01" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cn">Note</Label>
                <Input id="cn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short by ৳50, will check" />
              </div>
              <Button type="submit" disabled={closeDrawer.isPending}>Count &amp; close drawer</Button>
            </form>
            <form
              className="grid gap-3 sm:grid-cols-3 sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                openDrawer.mutate();
              }}
            >
              <div>
                <Label htmlFor="op2">Correct opening cash (৳)</Label>
                <Input id="op2" type="number" step="0.01" min="0" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder={String(mine?.opening ?? 0)} />
              </div>
              <div>
                <Label htmlFor="on2">Note</Label>
                <Input id="on2" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <Button type="submit" variant="outline" disabled={openDrawer.isPending}>Save opening</Button>
            </form>
          </div>
        )}

        {data.data && myRec && myRec.closed_at !== null && (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <Mini label="Opening float" value={taka(mine?.opening)} />
              <Mini label="Expected" value={taka(mine?.expected)} />
              <Mini label="Counted" value={taka(mine?.counted)} />
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">Difference</div>
                <div className={"text-lg font-semibold " + ((mine?.difference ?? 0) === 0 ? "" : "text-destructive")}>{taka(mine?.difference)}</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Closed on {bdDateTime(myRec.closed_at)}. A closed drawer can't be changed, so the record stays trustworthy.</p>
          </div>
        )}
      </section>

      <section className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Cash sales</TableHead>
              <TableHead className="text-right">Due collected</TableHead>
              <TableHead className="text-right">Refunds</TableHead>
              {isMgr && <TableHead className="text-right">Expenses</TableHead>}
              {isMgr && <TableHead className="text-right">Supplier paid</TableHead>}
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.isLoading && <TableRow><TableCell colSpan={10} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!data.isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No cash activity on this day.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.user_id}>
                <TableCell>{name(r.user_id)}</TableCell>
                <TableCell className="text-right">{taka(r.opening)}</TableCell>
                <TableCell className="text-right">{taka(r.cashSales)}</TableCell>
                <TableCell className="text-right">{taka(r.dueCollections)}</TableCell>
                <TableCell className="text-right">{taka(r.cashRefunds)}</TableCell>
                {isMgr && <TableCell className="text-right">{taka(r.expenses)}</TableCell>}
                {isMgr && <TableCell className="text-right">{taka(r.supplierPayments)}</TableCell>}
                <TableCell className="text-right font-medium">{taka(r.expected)}</TableCell>
                <TableCell className="text-right">{r.counted === null ? <span className="text-muted-foreground">open</span> : taka(r.counted)}</TableCell>
                <TableCell className={"text-right font-medium " + ((r.difference ?? 0) === 0 ? "" : "text-destructive")}>
                  {r.difference === null ? <span className="text-muted-foreground">—</span> : taka(r.difference)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <p className="text-xs text-muted-foreground">
        Due collections are counted as cash coming in, not as new sales. Expenses and supplier payments are only visible to managers,
        so a cashier's drawer shows the counter cash they handled.
      </p>
    </div>
  );
}

function Card({ icon: Icon, label, value, sub }: { icon: typeof Wallet; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4 text-primary" />{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted p-3"><div className="text-muted-foreground">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}
