import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errMsg, taka } from "@/lib/format";
import { supplierBalances } from "@/lib/supplier";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers — Pharmacy POS" },
      { name: "description", content: "Suppliers with purchase totals and outstanding balances." },
      { property: "og:title", content: "Suppliers — Pharmacy POS" },
      { property: "og:description", content: "Supplier list and balances." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Suppliers,
});

function Suppliers() {
  const { role } = Route.useRouteContext();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [f, setF] = useState({ name: "", phone: "", address: "" });

  const data = useQuery({
    queryKey: ["supplier-balances"],
    queryFn: async () => {
      const [s, p] = await Promise.all([
        supabase.from("suppliers").select("*").order("name"),
        supabase.from("purchases").select("supplier_id, total, paid"),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      return { suppliers: s.data, bal: supplierBalances(p.data) };
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Name is required");
      const { error } = await supabase.from("suppliers").insert({ name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Supplier added"); setF({ name: "", phone: "", address: "" }); qc.invalidateQueries({ queryKey: ["supplier-balances"] }); qc.invalidateQueries({ queryKey: ["suppliers"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  async function toggle(id: string, active: boolean): Promise<void> {
    const { error } = await supabase.from("suppliers").update({ is_active: active }).eq("id", id);
    if (error) { toast.error(errMsg(error)); return; }
    qc.invalidateQueries({ queryKey: ["supplier-balances"] }); qc.invalidateQueries({ queryKey: ["suppliers"] });
  }

  if (role !== "admin" && role !== "manager") return <p className="text-muted-foreground">Only managers can see suppliers.</p>;

  const s = q.trim().toLowerCase();
  const list = (data.data?.suppliers ?? []).filter((x) => !s || x.name.toLowerCase().includes(s) || x.phone?.includes(s));
  const totalDue = [...(data.data?.bal.values() ?? [])].reduce((a, b) => a + b.balance, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Suppliers</h1>
        <span className="text-sm">We owe suppliers: <b className="text-lg">{taka(totalDue)}</b></span>
        <Button asChild variant="outline"><Link to="/supplier-payments">Pay a supplier</Link></Button>
      </div>
      <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4 sm:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div><Label htmlFor="sn">Name</Label><Input id="sn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><Label htmlFor="sp">Phone</Label><Input id="sp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div><Label htmlFor="sa">Address</Label><Input id="sa" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <Button type="submit" disabled={add.isPending}>Add supplier</Button>
      </form>
      <Input placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead className="text-right">Purchased</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {data.isLoading && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!data.isLoading && list.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No suppliers yet.</TableCell></TableRow>}
            {list.map((x) => {
              const b = data.data?.bal.get(x.id) ?? { billed: 0, paid: 0, balance: 0 };
              return (
                <TableRow key={x.id} className={x.is_active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{x.name}</TableCell>
                  <TableCell>{x.phone}</TableCell>
                  <TableCell className="text-right">{taka(b.billed)}</TableCell>
                  <TableCell className="text-right">{taka(b.paid)}</TableCell>
                  <TableCell className="text-right font-semibold">{taka(b.balance)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => toggle(x.id, !x.is_active)}>{x.is_active ? "Deactivate" : "Activate"}</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
