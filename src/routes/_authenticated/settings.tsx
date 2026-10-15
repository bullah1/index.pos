import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { settingsQuery, type Settings } from "@/lib/queries";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useServerFn } from "@tanstack/react-start";
import { Truck } from "lucide-react";
import { steadfastBalance } from "@/lib/courier.functions";
import { taka } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings & Staff — Pharmacy POS" }, { name: "description", content: "Pharmacy details, receipt and staff roles." }] }),
  component: SettingsPage,
});

type Role = "admin" | "manager" | "cashier";
const NONE = "none";

function SettingsPage() {
  const { role, user } = Route.useRouteContext();
  if (role !== "admin") return <p className="text-sm text-muted-foreground">Only the admin can change settings and staff.</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <h1 className="text-2xl font-semibold">Settings & Staff</h1>
      <ShopSettings />
      <CourierCheck />
      <Staff myId={user.id} />
    </div>
  );
}

function ShopSettings() {
  const qc = useQueryClient();
  const { data } = useQuery(settingsQuery);
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (data && !f) setF(data); }, [data, f]);

  const save = useMutation({
    mutationFn: async () => {
      if (!f) return;
      if (!f.pharmacy_name.trim()) throw new Error("Pharmacy name is required");
      const { error } = await supabase.from("settings").update({
        pharmacy_name: f.pharmacy_name.trim(),
        address: f.address.trim(),
        phone: f.phone.trim(),
        invoice_footer: f.invoice_footer.trim(),
        receipt_format: f.receipt_format,
        low_stock_threshold: Math.max(0, Math.round(Number(f.low_stock_threshold) || 0)),
        expiry_alert_days: Math.max(0, Math.round(Number(f.expiry_alert_days) || 0)),
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!f) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <section className="rounded-lg border p-4">
      <h2 className="font-semibold">Pharmacy & receipt</h2>
      <p className="text-sm text-muted-foreground">Shown at the top and bottom of every receipt.</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div><Label htmlFor="s-name">Pharmacy name</Label><Input id="s-name" value={f.pharmacy_name} onChange={set("pharmacy_name")} /></div>
        <div><Label htmlFor="s-phone">Phone</Label><Input id="s-phone" value={f.phone} onChange={set("phone")} placeholder="01XXXXXXXXX" /></div>
        <div className="sm:col-span-2"><Label htmlFor="s-addr">Address</Label><Input id="s-addr" value={f.address} onChange={set("address")} /></div>
        <div className="sm:col-span-2"><Label htmlFor="s-foot">Receipt footer</Label><Input id="s-foot" value={f.invoice_footer} onChange={set("invoice_footer")} /></div>
        <div>
          <Label>Default receipt size</Label>
          <Select value={f.receipt_format} onValueChange={(v) => setF({ ...f, receipt_format: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="thermal">Thermal (80 mm)</SelectItem>
              <SelectItem value="a4">A4</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="s-low">Low stock at</Label><Input id="s-low" type="number" min={0} value={f.low_stock_threshold} onChange={set("low_stock_threshold")} /></div>
          <div><Label htmlFor="s-exp">Expiry alert (days)</Label><Input id="s-exp" type="number" min={0} value={f.expiry_alert_days} onChange={set("expiry_alert_days")} /></div>
        </div>
        <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</Button></div>
      </form>
    </section>
  );
}

function Staff({ myId }: { myId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, created_at").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      const roles = new Map(r.data.map((x) => [x.user_id, x.role as Role]));
      return p.data.map((x) => ({ ...x, role: roles.get(x.id) ?? null }));
    },
  });
  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role | null }) => {
      const { error } = await supabase.rpc("admin_set_role", { p_user: id, p_role: role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["staff"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const waiting = data?.filter((s) => !s.role).length ?? 0;

  return (
    <section className="rounded-lg border p-4">
      <h2 className="font-semibold">Staff</h2>
      <p className="text-sm text-muted-foreground">
        New accounts cannot use the POS until you give them a role. Cashier: counter sales, customers, own sales. Manager: also purchases, stock, returns, expenses, reports.
      </p>
      {waiting > 0 && <p className="mt-2 text-sm font-medium text-warning-foreground">{waiting} account{waiting > 1 ? "s" : ""} waiting for a role.</p>}
      <div className="mt-3 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead className="w-44">Role</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {error && <TableRow><TableCell colSpan={3} className="text-destructive">{errMsg(error)}</TableCell></TableRow>}
            {data?.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.full_name || "—"}{s.id === myId && <Badge variant="secondary" className="ml-2">you</Badge>}</TableCell>
                <TableCell>{s.email}</TableCell>
                <TableCell>
                  <Select
                    value={s.role ?? NONE}
                    disabled={setRole.isPending}
                    onValueChange={(v) => setRole.mutate({ id: s.id, role: v === NONE ? null : (v as Role) })}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No access</SelectItem>
                      <SelectItem value="cashier">Cashier</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function CourierCheck() {
  const check = useServerFn(steadfastBalance);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="rounded-lg border p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 text-primary" />Steadfast courier</h2>
      <p className="text-sm text-muted-foreground">Keys live in the server settings (STEADFAST_API_KEY, STEADFAST_SECRET_KEY), never in the app. Test them here.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await check().catch((e) => ({ ok: false as const, error: errMsg(e) }));
          setResult(r.ok ? { ok: true, text: `Connected · balance ${taka(r.balance)}` } : { ok: false, text: r.error });
          setBusy(false);
        }}>{busy ? "Checking…" : "Test connection"}</Button>
        {result && <span className={result.ok ? "text-sm font-medium text-primary" : "text-sm text-destructive"}>{result.text}</span>}
      </div>
    </section>
  );
}
