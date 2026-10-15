import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Medicine = Database["public"]["Tables"]["medicines"]["Row"];
export type Batch = Database["public"]["Tables"]["medicine_batches"]["Row"];
export type MedicineWithBatches = Medicine & { batches: Batch[] };

/**
 * The API returns at most 1000 rows per request, so lists that can grow past that
 * (medicines, batches, a month of sales) are read page by page.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

export const medicinesQuery = queryOptions({
  queryKey: ["medicines"],
  queryFn: async (): Promise<MedicineWithBatches[]> => {
    const [meds, batches] = await Promise.all([
      fetchAll<Medicine>((a, b) => supabase.from("medicines").select("*").order("name").order("id").range(a, b)),
      fetchAll<Batch>((a, b) => supabase.from("medicine_batches").select("*").order("expiry_date").order("created_at").order("id").range(a, b)),
    ]);
    const byMed = new Map<string, Batch[]>();
    for (const x of batches) {
      const list = byMed.get(x.medicine_id);
      if (list) list.push(x);
      else byMed.set(x.medicine_id, [x]);
    }
    return meds.map((x) => ({ ...x, batches: byMed.get(x.id) ?? [] }));
  },
});

export type Settings = Database["public"]["Tables"]["settings"]["Row"];
const DEFAULT_SETTINGS: Settings = {
  id: 1, pharmacy_name: "My Pharmacy", address: "", phone: "", invoice_footer: "Thank you. Get well soon!",
  currency: "BDT", receipt_format: "thermal", low_stock_threshold: 10, expiry_alert_days: 90, updated_at: "",
};

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: async (): Promise<Settings> => {
    const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data ?? DEFAULT_SETTINGS;
  },
});

export const suppliersQuery = queryOptions({
  queryKey: ["suppliers"],
  queryFn: async () => {
    const { data, error } = await supabase.from("suppliers").select("*").eq("is_active", true).order("name");
    if (error) throw error;
    return data;
  },
});

export const customersQuery = queryOptions({
  queryKey: ["customers"],
  queryFn: async () => {
    return fetchAll<Database["public"]["Tables"]["customers"]["Row"]>((a, b) =>
      supabase.from("customers").select("*").order("name").order("id").range(a, b),
    );
  },
});
