import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * Never blocks: if today's drawer isn't open yet it is opened automatically with ৳0,
 * so staff can sell straight away. Counting cash on the Cash Drawer page is optional.
 */
export function DrawerGate({ userId, children }: { userId: string; children: ReactNode }) {
  useAutoOpenDrawer(userId);
  return <>{children}</>;
}

export function useAutoOpenDrawer(userId: string) {
  const { data } = useMyDrawer(userId);
  const qc = useQueryClient();
  const tried = useRef(false);
  useEffect(() => {
    if (data?.status !== "none" || tried.current) return;
    tried.current = true;
    void supabase.rpc("cash_drawer_open", { p: { opening: 0 } as never }).then(({ error }) => {
      if (!error) {
        qc.invalidateQueries({ queryKey: ["my-drawer"] });
        qc.invalidateQueries({ queryKey: ["cash-drawer"] });
      }
    });
  }, [data?.status, qc]);
}

/** Opens today's drawer in the background on every page; shows nothing. */
export function DrawerBanner({ userId }: { userId: string }) {
  useAutoOpenDrawer(userId);
  return null;
}
