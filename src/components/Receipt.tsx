import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { settingsQuery } from "@/lib/queries";
import { bdDateTime, taka } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const KIND: Record<string, string> = { sale: "Paid", due_collection: "Due paid", refund: "Refunded" };
const METHOD: Record<string, string> = { cash: "Cash", bkash: "bKash", nagad: "Nagad", rocket: "Rocket", bank: "Bank" };

export function ReceiptDialog({
  saleId,
  onClose,
  title = "Receipt",
  cashReceived,
  change,
}: {
  saleId: string | null;
  onClose: () => void;
  title?: string;
  /** Cash the customer handed over (only known right after the sale). */
  cashReceived?: number | undefined;
  change?: number | undefined;
}) {
  const { data: settings } = useQuery(settingsQuery);
  const [format, setFormat] = useState<"thermal" | "a4" | null>(null);
  const fmt = format ?? (settings?.receipt_format as "thermal" | "a4") ?? "thermal";
  const { data, isLoading } = useQuery({
    queryKey: ["sale", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const [s, i, p] = await Promise.all([
        supabase.from("sales").select("*, customers(name, phone)").eq("id", saleId!).single(),
        supabase.from("sale_items").select("*").eq("sale_id", saleId!),
        supabase.from("sale_payments").select("*").eq("sale_id", saleId!).order("created_at"),
      ]);
      if (s.error) throw s.error;
      return { sale: s.data, items: i.data ?? [], payments: p.data ?? [] };
    },
  });

  return (
    <Dialog open={!!saleId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {isLoading || !data ? <p className="text-sm text-muted-foreground">Loading receipt…</p> : (
          <>
            <div id="print-area" className={cn("rounded-md border bg-white p-4 text-sm text-black", fmt === "thermal" && "thermal mx-auto max-w-[300px] font-mono text-xs")}>
              <div className="text-center">
                <div className="text-base font-bold">{settings?.pharmacy_name}</div>
                {settings?.address && <div>{settings.address}</div>}
                {settings?.phone && <div>{settings.phone}</div>}
              </div>
              <div className="my-2 border-t border-dashed" />
              <div className="flex flex-wrap justify-between gap-x-3"><span className="font-bold">{data.sale.invoice_no}</span><span>{bdDateTime(data.sale.created_at)}</span></div>
              <div>Customer: {data.sale.customers?.name ?? "Walk-in"}{data.sale.customers?.phone ? ` · ${data.sale.customers.phone}` : ""}</div>
              <div className="my-2 border-t border-dashed" />
              <table className="w-full">
                <thead><tr className="text-left"><th>Item</th><th className="text-right">Qty</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id} className="align-top">
                      <td>{it.medicine_name}{fmt === "a4" && <span className="opacity-70"> · {it.batch_no} · exp {it.expiry_date}</span>}
                        <div className="opacity-70">@ {taka(it.unit_price)}{Number(it.discount) > 0 && ` − ${taka(it.discount)}`}</div></td>
                      <td className="text-right">{Number(it.qty)}</td>
                      <td className="text-right">{taka(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="my-2 border-t border-dashed" />
              <Row k="Subtotal" v={taka(data.sale.subtotal)} />
              {Number(data.sale.item_discount) + Number(data.sale.bill_discount) > 0 && <Row k="Discount" v={"−" + taka(Number(data.sale.item_discount) + Number(data.sale.bill_discount))} />}
              <Row k="Total" v={taka(data.sale.total)} bold />
              {data.payments.map((p) => (
                <Row key={p.id} k={`${KIND[p.kind] ?? p.kind} (${METHOD[p.method] ?? p.method})`} v={(p.kind === "refund" ? "−" : "") + taka(p.amount)} />
              ))}
              {cashReceived != null && change != null && change > 0 && (
                <>
                  <Row k="Cash received" v={taka(cashReceived)} />
                  <Row k="Change" v={taka(change)} />
                </>
              )}
              {Number(data.sale.returned_amount) > 0 && <Row k="Returned" v={"−" + taka(data.sale.returned_amount)} />}
              {Number(data.sale.due) > 0 && <Row k="Due" v={taka(data.sale.due)} bold />}
              {data.sale.status === "cancelled" && <div className="mt-1 text-center font-bold">*** CANCELLED ***</div>}
              <div className="my-2 border-t border-dashed" />
              <div className="text-center">{settings?.invoice_footer}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant={fmt === "thermal" ? "secondary" : "outline"} size="sm" onClick={() => setFormat("thermal")}>Thermal</Button>
              <Button variant={fmt === "a4" ? "secondary" : "outline"} size="sm" onClick={() => setFormat("a4")}>A4</Button>
              <Button size="sm" onClick={() => window.print()}>Print</Button>
              <Button size="sm" variant="outline" onClick={onClose}>{title === "Sale complete" ? "New sale" : "Close"}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div className={cn("flex justify-between", bold && "font-bold")}><span>{k}</span><span>{v}</span></div>;
}
