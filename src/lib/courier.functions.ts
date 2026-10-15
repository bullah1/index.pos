import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/*
  Steadfast Courier (Packzy) merchant API. Runs only on the server:
  the keys come from server environment variables and never reach the browser.
    STEADFAST_API_KEY, STEADFAST_SECRET_KEY  (required)
    STEADFAST_BASE_URL                       (optional, default https://portal.packzy.com/api/v1)
*/
const BASE = () => (process.env["STEADFAST_BASE_URL"] || "https://portal.packzy.com/api/v1").replace(/\/+$/, "");

function keys() {
  const apiKey = process.env["STEADFAST_API_KEY"];
  const secretKey = process.env["STEADFAST_SECRET_KEY"];
  if (!apiKey || !secretKey) return null;
  return { "Api-Key": apiKey, "Secret-Key": secretKey, "Content-Type": "application/json", Accept: "application/json" };
}

const BD_PHONE = /^01[3-9]\d{8}$/;
const normalizePhone = (s: string) => s.replace(/[\s-]/g, "").replace(/^\+?88/, "");

const BookInput = z.object({
  saleId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: z.string().transform(normalizePhone).refine((v) => BD_PHONE.test(v), "Enter a valid mobile number (01XXXXXXXXX)"),
  altPhone: z.string().optional().transform((v) => (v ? normalizePhone(v) : "")).refine((v) => !v || BD_PHONE.test(v), "Alternative phone is not valid"),
  address: z.string().trim().min(5, "Write the full address").max(490),
  codAmount: z.number().min(0).max(1_000_000),
  deliveryCharge: z.number().min(0).max(100_000),
  note: z.string().trim().max(480).optional().default(""),
  itemDescription: z.string().trim().max(255).optional().default(""),
  deliveryType: z.union([z.literal(0), z.literal(1)]).default(0),
});

export type BookCourierInput = z.input<typeof BookInput>;

type SteadfastConsignment = {
  consignment_id: number | string;
  invoice: string;
  tracking_code?: string;
  status?: string;
};

function errorText(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; errors?: Record<string, unknown> };
    if (b.errors && typeof b.errors === "object") {
      const parts = Object.entries(b.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      if (parts.length) return parts.join("; ");
    }
    if (typeof b.message === "string") return b.message;
  }
  return `Steadfast request failed (${status})`;
}

export const bookSteadfast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BookInput.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isStaff } = await sb.rpc("is_staff", { _user_id: context.userId });
    if (!isStaff) return { ok: false as const, error: "Not allowed" };
    const headers = keys();
    if (!headers) return { ok: false as const, error: "Steadfast is not set up. Add STEADFAST_API_KEY and STEADFAST_SECRET_KEY in the server settings." };

    const { data: sale, error: saleErr } = await sb.from("sales").select("id, invoice_no, status").eq("id", data.saleId).maybeSingle();
    if (saleErr || !sale) return { ok: false as const, error: "Sale not found" };
    if (sale.status === "cancelled" || sale.status === "returned") return { ok: false as const, error: "This sale is cancelled/returned" };

    const { data: existing } = await sb.from("courier_orders").select("id, status").eq("sale_id", sale.id);
    const live = (existing ?? []).filter((x) => x.status !== "cancelled");
    if (live.length) return { ok: false as const, error: "This sale is already booked with the courier" };
    // Steadfast needs a unique invoice per account; add a suffix when re-booking after a cancel.
    const invoice = existing?.length ? `${sale.invoice_no}-${existing.length + 1}` : sale.invoice_no;

    const body = {
      invoice,
      recipient_name: data.name,
      recipient_phone: data.phone,
      ...(data.altPhone ? { alternative_phone: data.altPhone } : {}),
      recipient_address: data.address,
      cod_amount: Math.round(data.codAmount),
      note: data.note || undefined,
      item_description: data.itemDescription || undefined,
      delivery_type: data.deliveryType,
    };

    let res: Response;
    try {
      res = await fetch(`${BASE()}/create_order`, { method: "POST", headers, body: JSON.stringify(body) });
    } catch {
      return { ok: false as const, error: "Could not reach Steadfast. Check the internet connection and try again." };
    }
    const json = (await res.json().catch(() => null)) as { status?: number; message?: string; consignment?: SteadfastConsignment } | null;
    if (!res.ok || !json || (json.status && json.status !== 200) || !json.consignment) {
      return { ok: false as const, error: errorText(json, res.status) };
    }
    const c = json.consignment;

    const { error: saveErr } = await sb.rpc("save_courier_order", {
      p: {
        sale_id: sale.id,
        provider: "steadfast",
        consignment_id: String(c.consignment_id),
        tracking_code: c.tracking_code ?? "",
        courier_invoice: invoice,
        recipient_name: data.name,
        recipient_phone: data.phone,
        recipient_address: data.address,
        cod_amount: Math.round(data.codAmount),
        delivery_charge: data.deliveryCharge,
        delivery_type: data.deliveryType,
        note: data.note,
        status: c.status ?? "in_review",
      },
    });
    if (saveErr) {
      // The parcel exists at Steadfast even if our record failed — tell the user the IDs so nothing is lost.
      return { ok: false as const, error: `Booked at Steadfast (ID ${c.consignment_id}, tracking ${c.tracking_code ?? "-"}) but could not save here: ${saveErr.message}` };
    }
    return { ok: true as const, consignmentId: String(c.consignment_id), trackingCode: c.tracking_code ?? "", status: c.status ?? "in_review" };
  });

export const refreshSteadfastStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ courierId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const headers = keys();
    if (!headers) return { ok: false as const, error: "Steadfast is not set up" };
    const { data: row } = await sb.from("courier_orders").select("id, consignment_id").eq("id", data.courierId).maybeSingle();
    if (!row) return { ok: false as const, error: "Courier booking not found" };
    let res: Response;
    try {
      res = await fetch(`${BASE()}/status_by_cid/${encodeURIComponent(row.consignment_id)}`, { headers });
    } catch {
      return { ok: false as const, error: "Could not reach Steadfast" };
    }
    const json = (await res.json().catch(() => null)) as { status?: number; delivery_status?: string } | null;
    if (!res.ok || !json?.delivery_status) return { ok: false as const, error: errorText(json, res.status) };
    const { error } = await sb.rpc("set_courier_status", { p_id: row.id, p_status: json.delivery_status });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, status: json.delivery_status };
  });

export const steadfastBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isMgr } = await context.supabase.rpc("is_manager", { _user_id: context.userId });
    if (!isMgr) return { ok: false as const, error: "Managers only" };
    const headers = keys();
    if (!headers) return { ok: false as const, error: "Steadfast is not set up" };
    const res = await fetch(`${BASE()}/get_balance`, { headers }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { current_balance?: number } | null;
    if (!res?.ok || json?.current_balance == null) return { ok: false as const, error: "Could not read balance" };
    return { ok: true as const, balance: Number(json.current_balance) };
  });
