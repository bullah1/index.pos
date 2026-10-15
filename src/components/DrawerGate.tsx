import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { myDrawerQuery } from "@/lib/queries";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function useMyDrawer(userId: string) {
  return useQuery(myDrawerQuery(userId));
}

/** Opening-cash form; used by the gate and the banner. */
export function OpenDrawerForm({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const [opening, setOpening] = useState("");
  const open = useMutation({
    mutationFn: async () => {
      if (opening.trim() === "" || !(Number(opening) >= 0)) throw new Error("Enter the opening cash (0 if none)");
      const { error } = await supabase.rpc("cash_drawer_open", { p: { opening: Number(opening) } as never });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cash drawer opened");
      qc.invalidateQueries({ queryKey: ["my-drawer"] });
      qc.invalidateQueries({ queryKey: ["cash-drawer"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <form
      className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-3 sm:flex-row sm:items-end"}
      onSubmit={(e) => { e.preventDefault(); open.mutate(); }}
    >
      <div className={compact ? "" : "flex-1"}>
        {!compact && <Label htmlFor="gate-open">Opening cash in drawer (৳)</Label>}
        <Input
          id="gate-open"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          placeholder={compact ? "Opening cash ৳" : "0"}
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          className={compact ? "h-8 w-36 bg-background" : ""}
          autoFocus={!compact}
        />
      </div>
      <Button type="submit" size={compact ? "sm" : "default"} disabled={open.isPending}>
        {open.isPending ? "Opening…" : "Open drawer"}
      </Button>
    </form>
  );
}

/** Blocks the page until today's drawer is open. */
export function DrawerGate({ userId, children }: { userId: string; children: ReactNode }) {
  const { data, isLoading, error } = useMyDrawer(userId);
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Checking cash drawer…</p>;
  if (error) return <p className="p-6 text-sm text-destructive">Could not check the cash drawer: {errMsg(error)}</p>;
  if (data?.status === "open") return <>{children}</>;

  const closed = data?.status === "closed";
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
        {closed ? <Lock className="h-5 w-5 text-destructive" /> : <Wallet className="h-5 w-5 text-primary" />}
        {closed ? "Today's drawer is closed" : "Open the cash drawer first"}
      </div>
      {closed ? (
        <p className="text-sm text-muted-foreground">
          You already counted and closed your drawer for today, so no more sales, expenses or payments can be made until tomorrow.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Count the cash in the drawer and enter it. Sales, expenses, purchases and payments are locked until the drawer is open.
          </p>
          <OpenDrawerForm />
        </>
      )}
      <Link to="/cash-drawer" className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline">Go to Cash Drawer</Link>
    </div>
  );
}

/** Thin warning shown on every page while the drawer is not open. */
export function DrawerBanner({ userId }: { userId: string }) {
  const { data } = useMyDrawer(userId);
  if (!data || data.status === "open") return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm print:hidden">
      <span className="flex items-center gap-2 font-medium text-warning-foreground">
        <Lock className="h-4 w-4" />
        {data.status === "closed"
          ? "Your cash drawer is closed for today — sales, expenses and payments are locked."
          : "Cash drawer is not open — sales, expenses and payments are locked."}
      </span>
      {data.status === "none" && <OpenDrawerForm compact />}
    </div>
  );
}
