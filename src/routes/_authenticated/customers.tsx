import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { customersQuery } from "@/lib/queries";
import { bdDateTime, errMsg, taka } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers & Due — Pharmacy POS" },
      { name: "description", content: "Customer list, outstanding dues and due collection." },
      { property: "og:title", content: "Customers & Due — Pharmacy POS" },
      { property: "og:description", content: "Customer list, outstanding dues and due collection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Customers,
});

const METHODS = ["cash", "bkash", "nagad", "rocket", "bank"] as const;
type Method = (typeof METHODS)[number];

const duesQuery = {
  queryKey: ["customer-dues"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("customer_dues");
    if (error) throw error;
    return new Map(data.map((d) => [d.customer_id, { due: Number(d.due), open: Number(d.open_invoices) }]));
  },
};

function Customers() {
  const { role } = Route.useRouteContext();
  const isMgr = role === "admin" || role === "manager";
  const { data: customers } = useSuspenseQuery(customersQuery);
  const { data: dues } = useQuery(duesQuery);
  const [q, setQ] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [edit, setEdit] = useState<null | { id?: string; name: string; phone: string; address: string; notes: string }>(null);
  const [collectId, setCollectId] = useState<string | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers
      .map((c) => ({ ...c, due: dues?.get(c.id)?.due ?? 0, open: dues?.get(c.id)?.open ?? 0 }))
      .filter((c) => (!s || c.name.toLowerCase().includes(s) || (c.phone ?? "").includes(s)) && (!onlyDue || c.due > 0))
      .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
  }, [customers, dues, q, onlyDue]);
  const totalDue = list.reduce((a, c) => a + c.due, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Customers & Due</h1>
        <Button onClick={() => setEdit({ name: "", phone: "", address: "", notes: "" })}>Add customer</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant={onlyDue ? "default" : "outline"} size="sm" onClick={() => setOnlyDue(!onlyDue)}>Only with due</Button>
        <span className="ml-auto text-sm">Total due: <b>{taka(totalDue)}</b></span>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead className="hidden md:table-cell">Address</TableHead>
            <TableHead className="text-right">Due</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {list.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No customers found.</TableCell></TableRow>}
            {list.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{c.address}</TableCell>
                <TableCell className="text-right">
                  {c.due > 0 ? <><b>{taka(c.due)}</b> <Badge variant="outline">{c.open} inv</Badge></> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => setCollectId(c.id)}>{c.due > 0 ? "Collect" : "History"}</Button>
                  {isMgr && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, name: c.name, phone: c.phone ?? "", address: c.address ?? "", notes: c.notes ?? "" })}>Edit</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {edit && <EditDialog value={edit} onClose={() => setEdit(null)} />}
      {collectId && <CollectDialog customer={list.find((c) => c.id === collectId)!} onClose={() => setCollectId(null)} />}
    </div>
  );
}

function EditDialog({ value, onClose }: { value: { id?: string; name: string; phone: string; address: string; notes: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(value);
  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Name is required");
      const row = { name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null, notes: f.notes.trim() || null };
      const { error } = f.id ? await supabase.from("customers").update(row).eq("id", f.id) : await supabase.from("customers").insert(row);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Customer saved"); qc.invalidateQueries({ queryKey: ["customers"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{f.id ? "Edit customer" : "Add customer"}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {(["name", "phone", "address", "notes"] as const).map((k) => (
            <div key={k}><Label className="capitalize" htmlFor={k}>{k}</Label><Input id={k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
          ))}
          <Button type="submit" className="w-full" disabled={save.isPending}>Save</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CollectDialog({ customer, onClose }: { customer: { id: string; name: string; due: number }; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(customer.due ? String(customer.due) : "");
  const [method, setMethod] = useState<Method>("cash");
  const [note, setNote] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const history = useQuery({
    queryKey: ["customer-payments", customer.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_payments").select("*").eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });
  const collect = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter an amount");
      if (amt > customer.due) throw new Error(`Due is only ${taka(customer.due)}`);
      const { error } = await supabase.rpc("collect_due", { p: { idempotency_key: key, customer_id: customer.id, amount: amt, method, note } });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Due collected");
      ["customer-dues", "sales", "report"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{customer.name} — due {taka(customer.due)}</DialogTitle></DialogHeader>
        {customer.due > 0 && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); collect.mutate(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="amt">Amount</Label><Input id="amt" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label htmlFor="note">Note</Label><Input id="note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <p className="text-xs text-muted-foreground">Payment clears the oldest invoices first.</p>
            <Button type="submit" className="w-full" disabled={collect.isPending}>Collect {amount ? taka(amount) : ""}</Button>
          </form>
        )}
        <div className="mt-2">
          <div className="mb-1 text-sm font-medium">Past collections</div>
          {history.data?.length ? (
            <ul className="max-h-48 space-y-1 overflow-auto text-sm">
              {history.data.map((h) => (
                <li key={h.id} className="flex justify-between gap-2 border-b py-1">
                  <span>{bdDateTime(h.created_at)} · <span className="capitalize">{h.method}</span>{h.note ? ` · ${h.note}` : ""}</span><b>{taka(h.amount)}</b>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">None yet.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
