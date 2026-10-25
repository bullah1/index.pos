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

type CustForm = { id?: string; name: string; phone: string; address: string; notes: string; customer_type: "retail" | "b2b"; business_name: string; discount_pct: string; credit_limit: string };
const blankCustomer = (type: "retail" | "b2b" = "retail"): CustForm => ({ name: "", phone: "", address: "", notes: "", customer_type: type, business_name: "", discount_pct: "", credit_limit: "" });

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
  const [kind, setKind] = useState<"all" | "retail" | "b2b">("all");
  const [edit, setEdit] = useState<null | CustForm>(null);
  const [collectId, setCollectId] = useState<string | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers
      .map((c) => ({ ...c, due: dues?.get(c.id)?.due ?? 0, open: dues?.get(c.id)?.open ?? 0 }))
      .filter((c) => (!s || c.name.toLowerCase().includes(s) || (c.phone ?? "").includes(s) || (c.business_name ?? "").toLowerCase().includes(s)) && (!onlyDue || c.due > 0))
      .filter((c) => kind === "all" || (c.customer_type ?? "retail") === kind)
      .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
  }, [customers, dues, q, onlyDue, kind]);
  const b2bCount = customers.filter((c) => c.customer_type === "b2b").length;
  const totalDue = list.reduce((a, c) => a + c.due, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Customers & Due</h1>
        <Button variant="outline" onClick={() => setEdit(blankCustomer("b2b"))}>Add B2B customer</Button>
        <Button onClick={() => setEdit(blankCustomer())}>Add customer</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search name, shop or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex rounded-md border p-0.5">
          {(["all", "retail", "b2b"] as const).map((k) => (
            <Button key={k} size="sm" variant={kind === k ? "secondary" : "ghost"} className="h-7" onClick={() => setKind(k)}>
              {k === "all" ? "All" : k === "retail" ? "Retail" : `B2B (${b2bCount})`}
            </Button>
          ))}
        </div>
        <Button variant={onlyDue ? "default" : "outline"} size="sm" onClick={() => setOnlyDue(!onlyDue)}>Only with due</Button>
        <span className="ml-auto text-sm">Total due: <b>{taka(totalDue)}</b></span>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead className="hidden md:table-cell">Address</TableHead>
            <TableHead className="text-right">Due</TableHead><TableHead className="hidden text-right lg:table-cell">Credit limit</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {list.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No customers found.</TableCell></TableRow>}
            {list.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5 font-medium">
                    {c.name}
                    {c.customer_type === "b2b" && <Badge className="h-5 bg-indigo-600 px-1.5 text-[10px] hover:bg-indigo-600">B2B{Number(c.discount_pct) > 0 ? ` −${Number(c.discount_pct)}%` : ""}</Badge>}
                  </div>
                  {c.business_name && <div className="text-xs text-muted-foreground">{c.business_name}</div>}
                </TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{c.address}</TableCell>
                <TableCell className="text-right">
                  {c.due > 0 ? <><b className={Number(c.credit_limit) > 0 && c.due > Number(c.credit_limit) ? "text-destructive" : ""}>{taka(c.due)}</b> <Badge variant="outline">{c.open} inv</Badge></> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="hidden text-right lg:table-cell">
                  {Number(c.credit_limit) > 0 ? <span className={c.due > Number(c.credit_limit) ? "font-medium text-destructive" : "text-muted-foreground"}>{taka(c.credit_limit)}</span> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => setCollectId(c.id)}>{c.due > 0 ? "Collect" : "History"}</Button>
                  {isMgr && <Button size="sm" variant="ghost" onClick={() => setEdit({
                    id: c.id, name: c.name, phone: c.phone ?? "", address: c.address ?? "", notes: c.notes ?? "",
                    customer_type: c.customer_type === "b2b" ? "b2b" : "retail", business_name: c.business_name ?? "",
                    discount_pct: Number(c.discount_pct) > 0 ? String(c.discount_pct) : "", credit_limit: Number(c.credit_limit) > 0 ? String(c.credit_limit) : "",
                  })}>Edit</Button>}
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

function EditDialog({ value, onClose }: { value: CustForm; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(value);
  const b2b = f.customer_type === "b2b";
  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Name is required");
      const disc = Number(f.discount_pct || 0), limit = Number(f.credit_limit || 0);
      if (!(disc >= 0 && disc < 100)) throw new Error("Discount must be between 0 and 99%");
      if (!(limit >= 0)) throw new Error("Credit limit can't be negative");
      const base = { name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null, notes: f.notes.trim() || null };
      const extra = { customer_type: f.customer_type, business_name: b2b ? f.business_name.trim() || null : null, discount_pct: b2b ? disc : 0, credit_limit: limit };
      const row = { ...base, ...extra };
      const { error } = f.id ? await supabase.from("customers").update(row).eq("id", f.id) : await supabase.from("customers").insert(row);
      if (error && /customer_type|business_name|discount_pct|credit_limit/.test(error.message)) {
        throw new Error("B2B needs a one-time database update: run supabase/06_b2b_customers.sql in Supabase SQL Editor.");
      }
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Customer saved"); qc.invalidateQueries({ queryKey: ["customers"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const set = (k: keyof CustForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{f.id ? "Edit customer" : b2b ? "Add B2B customer" : "Add customer"}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="grid grid-cols-2 gap-1 rounded-md border p-1">
            {(["retail", "b2b"] as const).map((t) => (
              <Button key={t} type="button" size="sm" variant={f.customer_type === t ? "secondary" : "ghost"} onClick={() => setF({ ...f, customer_type: t })}>
                {t === "retail" ? "Retail customer" : "B2B / Wholesale"}
              </Button>
            ))}
          </div>
          {b2b && <div><Label htmlFor="biz">Shop / business name</Label><Input id="biz" value={f.business_name} onChange={set("business_name")} placeholder="e.g. Rahman Pharmacy" /></div>}
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="name">{b2b ? "Contact person" : "Name"}</Label><Input id="name" value={f.name} onChange={set("name")} /></div>
            <div><Label htmlFor="phone">Phone</Label><Input id="phone" inputMode="tel" value={f.phone} onChange={set("phone")} placeholder="01XXXXXXXXX" /></div>
          </div>
          <div><Label htmlFor="address">Address</Label><Input id="address" value={f.address} onChange={set("address")} /></div>
          {b2b && (
            <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/50 p-3">
              <div>
                <Label htmlFor="disc">Discount from MRP (%)</Label>
                <Input id="disc" type="number" min={0} max={99} step="0.5" value={f.discount_pct} onChange={set("discount_pct")} placeholder="e.g. 30" />
                <p className="mt-1 text-[11px] text-muted-foreground">Applied automatically in POS</p>
              </div>
              <div>
                <Label htmlFor="limit">Credit (due) limit ৳</Label>
                <Input id="limit" type="number" min={0} step="100" value={f.credit_limit} onChange={set("credit_limit")} placeholder="0 = no limit" />
                <p className="mt-1 text-[11px] text-muted-foreground">POS warns above this</p>
              </div>
            </div>
          )}
          <div><Label htmlFor="notes">Notes</Label><Input id="notes" value={f.notes} onChange={set("notes")} /></div>
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
