import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bdDateTime, bdToday, errMsg, taka } from "@/lib/format";
import { drawerSummary, myDrawerRow } from "@/lib/cash";
import { addDays, cashDayQuery } from "@/lib/cashQuery";
import { useMyDrawer } from "@/components/DrawerGate";
import { PAY_METHODS } from "@/lib/pos";

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


function CashDrawer() {
  const { user, role } = Route.useRouteContext();
  const qc = useQueryClient();
  const isMgr = role === "admin" || role === "manager";
  const today = bdToday();
  const [day, setDay] = useState(today);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");

  const data = useQuery(cashDayQuery(day, user.id, isMgr));
  const [openErr, setOpenErr] = useState<string | null>(null);
  const myRecRef = useRef<{ opening: number | string } | null>(null);
  // When the drawer opens by itself in the background, reload this page's numbers.
  const myDrawer = useMyDrawer(user.id);
  const drawerStatus = myDrawer.data?.status;
  useEffect(() => { if (drawerStatus && day === today) void data.refetch(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerStatus]);

  const openDrawer = useMutation({
    mutationFn: async () => {
      const amt = opening.trim() === "" ? (myRecRef.current ? Number(myRecRef.current.opening) : 0) : Number(opening);
      if (!(amt >= 0)) throw new Error("Opening cash can't be negative");
      const { error } = await supabase.rpc("cash_drawer_open", { p: { date: day, opening: amt } as never });
      if (error) throw error;
    },
    onSuccess: () => {
      setOpenErr(null);
      toast.success(myRecRef.current ? "Opening cash saved" : "Drawer opened");
      setOpening("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["cash-drawer"] });
      qc.invalidateQueries({ queryKey: ["my-drawer"] });
    },
    onError: (e) => { setOpenErr(errMsg(e)); toast.error(errMsg(e)); },
  });

  const closeDrawer = useMutation({
    mutationFn: async () => {
      if (counted.trim() === "" || !(Number(counted) >= 0)) throw new Error("Enter the counted cash");
      let id = data.data?.drawers.find((d) => d.user_id === user.id)?.id;
      if (!id) {
        // No drawer yet today: open it (opening ৳0) and close it in one go.
        const o = await supabase.rpc("cash_drawer_open", { p: { date: day, opening: 0 } as never });
        if (o.error) throw o.error;
        id = (o.data as { id: string }).id;
      }
      const { error } = await supabase.rpc("cash_drawer_close", { p: { id, counted: Number(counted), note } as never });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Drawer closed");
      setCounted("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["cash-drawer"] });
      qc.invalidateQueries({ queryKey: ["my-drawer"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const rows = data.data?.rows ?? [];
  const sum = drawerSummary(rows);
  const mine = myDrawerRow(rows, user.id);
  const myRec = data.data?.drawers.find((d) => d.user_id === user.id) ?? null;
  const name = (id: string) => data.data?.names.get(id) ?? (id === user.id ? "You" : "Staff");

  const byMethod = data.data?.byMethod ?? new Map<string, number>();
  const closed = myRec?.closed_at != null;
  myRecRef.current = myRec;
  const openedAt = (myRec as { created_at?: string } | null)?.created_at;
  const diff = Number(counted) - (mine?.expected ?? 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Cash Drawer</h1>
          <p className="text-sm text-muted-foreground">Count the cash at the end of the day and check it matches.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setDay(addDays(day, -1))}>‹</Button>
          <Input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} className="h-9 w-40" aria-label="Date" />
          <Button variant="outline" size="sm" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>›</Button>
        </div>
      </div>

      {data.error && <p className="text-sm text-destructive">Could not load the drawer: {errMsg(data.error)}</p>}

      {day === today && (
        <section className={"flex flex-wrap items-center gap-3 rounded-xl border p-4 " + (closed ? "bg-muted/50" : myRec ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50")}>
          <div className="mr-auto">
            <div className={"flex items-center gap-2 font-semibold " + (closed ? "" : myRec ? "text-emerald-800" : "text-amber-900")}>
              <span className={"h-2.5 w-2.5 rounded-full " + (closed ? "bg-slate-400" : myRec ? "bg-emerald-500" : "bg-amber-500")} />
              {closed ? "Today's drawer is closed" : myRec ? "Drawer is open" : data.isLoading ? "Checking drawer…" : "Drawer is not open yet"}
            </div>
            <div className="text-xs text-muted-foreground">
              {closed ? `Counted and closed ${bdDateTime(myRec!.closed_at!)}. Sales still work.`
                : myRec ? `Opened ${openedAt ? bdDateTime(openedAt).split(", ")[1] : ""} · opening cash ${taka(myRec.opening)}`
                : "Enter the cash you have in the drawer now (0 if none) and press Open."}
            </div>
            {openErr && <div className="mt-1 text-xs font-medium text-destructive">Could not open: {openErr}</div>}
          </div>
          {!closed && (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); openDrawer.mutate(); }}>
              <div>
                <Label htmlFor="op" className="text-xs">Opening cash (৳)</Label>
                <Input id="op" type="number" inputMode="decimal" min="0" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)}
                  placeholder={myRec ? String(Number(myRec.opening)) : "0"} className="h-10 w-36 bg-white" />
              </div>
              <Button type="submit" className="h-10" disabled={openDrawer.isPending}>
                {openDrawer.isPending ? "Saving…" : myRec ? "Save" : "Open drawer"}
              </Button>
            </form>
          )}
        </section>
      )}

      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 p-6 text-white">
        <Wallet className="absolute -right-6 -top-6 h-40 w-40 text-white/5" />
        <div className="text-sm text-white/70">{day === today ? "Should be in the drawer now" : `Should have been in the drawer · ${day}`}</div>
        <div className="mt-1 text-4xl font-semibold tracking-tight">{data.isLoading ? "…" : taka(sum.expected)}</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat icon={Wallet} k="Opening cash" v={taka(sum.opening)} />
          <Stat icon={ArrowDownLeft} k="Cash in" v={"+" + taka(sum.cashIn)} hint="Cash sales + dues collected" />
          <Stat icon={ArrowUpRight} k="Cash out" v={"−" + taka(sum.cashOut)} hint="Refunds, expenses, supplier cash" />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Other money received</h2>
        <p className="text-xs text-muted-foreground">Not in the drawer — check these in your phone / bank.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {PAY_METHODS.filter((m) => m.value !== "cash").map((m) => (
            <div key={m.value} className="rounded-lg bg-muted/60 px-3 py-2">
              <div className="text-xs text-muted-foreground">{m.label}</div>
              <div className="font-semibold">{taka(Math.max(0, byMethod.get(m.value) ?? 0))}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">{closed ? "Counted" : "Count the cash"}</h2>
        {!closed ? (
          <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); if (day === today) closeDrawer.mutate(); }}>
            <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
              <div>
                <Label htmlFor="ct">Cash you counted (৳)</Label>
                <Input id="ct" type="number" inputMode="decimal" step="0.01" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} className="h-11 text-lg" placeholder="0" />
              </div>
              <div>
                <Label htmlFor="cn">Note (optional)</Label>
                <Input id="cn" value={note} onChange={(e) => setNote(e.target.value)} className="h-11" placeholder="e.g. ৳50 short" />
              </div>
              <Button type="submit" className="h-11" disabled={closeDrawer.isPending || day !== today}>Save count &amp; close day</Button>
            </div>
            {counted.trim() !== "" && (
              <div className={"rounded-md px-3 py-2 text-sm font-medium " + (Math.abs(diff) < 0.01 ? "bg-emerald-50 text-emerald-700" : diff > 0 ? "bg-sky-50 text-sky-700" : "bg-rose-50 text-rose-700")}>
                {Math.abs(diff) < 0.01 ? "Matches exactly ✓" : diff > 0 ? `${taka(diff)} extra in the drawer` : `${taka(-diff)} short`}
              </div>
            )}
            {day !== today && !myRec && <p className="text-xs text-muted-foreground">No drawer was used on this day.</p>}
          </form>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <MiniStat k="Should be" v={taka(mine?.expected)} />
            <MiniStat k="Counted" v={taka(mine?.counted)} />
            <MiniStat k="Difference" v={taka(mine?.difference)} bad={(mine?.difference ?? 0) !== 0} />
            <p className="text-xs text-muted-foreground sm:col-span-3">Closed {bdDateTime(myRec!.closed_at!)}. Sales after closing are still allowed.</p>
          </div>
        )}
      </section>

      {isMgr && rows.length > 1 && (
        <section className="rounded-xl border">
          <div className="border-b px-4 py-3 font-semibold">By staff</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Cash in</TableHead>
                <TableHead className="text-right">Cash out</TableHead>
                <TableHead className="text-right">Should be</TableHead>
                <TableHead className="text-right">Counted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.user_id}>
                  <TableCell>{name(r.user_id)}</TableCell>
                  <TableCell className="text-right">{taka(r.opening)}</TableCell>
                  <TableCell className="text-right">{taka(r.cashIn)}</TableCell>
                  <TableCell className="text-right">{taka(r.cashOut)}</TableCell>
                  <TableCell className="text-right font-medium">{taka(r.expected)}</TableCell>
                  <TableCell className={"text-right " + ((r.difference ?? 0) !== 0 ? "text-destructive" : "")}>{r.counted === null ? <span className="text-muted-foreground">open</span> : taka(r.counted)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}

function Stat({ icon: Icon, k, v, hint }: { icon: typeof Wallet; k: string; v: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-white/70"><Icon className="h-3.5 w-3.5" />{k}</div>
      <div className="text-lg font-semibold">{v}</div>
      {hint && <div className="text-[11px] text-white/50">{hint}</div>}
    </div>
  );
}

function MiniStat({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return <div className="rounded-lg bg-muted/60 px-3 py-2"><div className="text-xs text-muted-foreground">{k}</div><div className={"text-lg font-semibold " + (bad ? "text-destructive" : "")}>{v}</div></div>;
}

