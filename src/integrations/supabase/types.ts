export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          details: Json | null
          entity: string | null
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: never
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: never
        }
        Relationships: []
      }
      cash_drawers: {
        Row: {
          closed_at: string | null
          counted: number | null
          created_at: string
          drawer_date: string
          id: string
          note: string | null
          opening: number
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          counted?: number | null
          created_at?: string
          drawer_date?: string
          id?: string
          note?: string | null
          opening?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          counted?: number | null
          created_at?: string
          drawer_date?: string
          id?: string
          note?: string | null
          opening?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          customer_id: string
          id: string
          idempotency_key: string
          method: Database["public"]["Enums"]["pay_method"]
          note: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          idempotency_key: string
          method?: Database["public"]["Enums"]["pay_method"]
          note?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          idempotency_key?: string
          method?: Database["public"]["Enums"]["pay_method"]
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string
          expense_date: string
          id: string
          method: Database["public"]["Enums"]["pay_method"]
          note: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string
          expense_date?: string
          id?: string
          method?: Database["public"]["Enums"]["pay_method"]
          note?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string
          expense_date?: string
          id?: string
          method?: Database["public"]["Enums"]["pay_method"]
          note?: string | null
        }
        Relationships: []
      }
      medicine_batches: {
        Row: {
          batch_no: string
          created_at: string
          expiry_date: string
          id: string
          medicine_id: string
          qty_on_hand: number
          sale_price: number
          supplier_id: string | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          batch_no: string
          created_at?: string
          expiry_date: string
          id?: string
          medicine_id: string
          qty_on_hand?: number
          sale_price: number
          supplier_id?: string | null
          unit_cost: number
          updated_at?: string
        }
        Update: {
          batch_no?: string
          created_at?: string
          expiry_date?: string
          id?: string
          medicine_id?: string
          qty_on_hand?: number
          sale_price?: number
          supplier_id?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicine_batches_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          barcode: string | null
          category: string | null
          code: string | null
          created_at: string
          default_price: number
          dosage_form: string | null
          generic_name: string | null
          id: string
          is_active: boolean
          manufacturer: string | null
          name: string
          name_bn: string | null
          prescription_required: boolean
          sale_unit: string
          strength: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          code?: string | null
          created_at?: string
          default_price?: number
          dosage_form?: string | null
          generic_name?: string | null
          id?: string
          is_active?: boolean
          manufacturer?: string | null
          name: string
          name_bn?: string | null
          prescription_required?: boolean
          sale_unit?: string
          strength?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          code?: string | null
          created_at?: string
          default_price?: number
          dosage_form?: string | null
          generic_name?: string | null
          id?: string
          is_active?: boolean
          manufacturer?: string | null
          name?: string
          name_bn?: string | null
          prescription_required?: boolean
          sale_unit?: string
          strength?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          batch_id: string
          batch_no: string
          expiry_date: string
          id: string
          line_total: number
          medicine_id: string
          purchase_id: string
          qty: number
          sale_price: number
          unit_cost: number
        }
        Insert: {
          batch_id: string
          batch_no: string
          expiry_date: string
          id?: string
          line_total: number
          medicine_id: string
          purchase_id: string
          qty: number
          sale_price: number
          unit_cost: number
        }
        Update: {
          batch_id?: string
          batch_no?: string
          expiry_date?: string
          id?: string
          line_total?: number
          medicine_id?: string
          purchase_id?: string
          qty?: number
          sale_price?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "medicine_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          created_at: string
          created_by: string
          discount: number
          id: string
          idempotency_key: string
          note: string | null
          paid: number
          purchase_date: string
          purchase_no: string
          status: string
          subtotal: number
          supplier_id: string
          supplier_invoice_no: string | null
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          discount?: number
          id?: string
          idempotency_key: string
          note?: string | null
          paid?: number
          purchase_date?: string
          purchase_no: string
          status?: string
          subtotal: number
          supplier_id: string
          supplier_invoice_no?: string | null
          total: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          discount?: number
          id?: string
          idempotency_key?: string
          note?: string | null
          paid?: number
          purchase_date?: string
          purchase_no?: string
          status?: string
          subtotal?: number
          supplier_id?: string
          supplier_invoice_no?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          batch_id: string
          batch_no: string
          discount: number
          expiry_date: string
          id: string
          line_total: number
          medicine_id: string
          medicine_name: string
          qty: number
          returned_qty: number
          sale_id: string
          unit_cost: number
          unit_price: number
        }
        Insert: {
          batch_id: string
          batch_no: string
          discount?: number
          expiry_date: string
          id?: string
          line_total: number
          medicine_id: string
          medicine_name: string
          qty: number
          returned_qty?: number
          sale_id: string
          unit_cost: number
          unit_price: number
        }
        Update: {
          batch_id?: string
          batch_no?: string
          discount?: number
          expiry_date?: string
          id?: string
          line_total?: number
          medicine_id?: string
          medicine_name?: string
          qty?: number
          returned_qty?: number
          sale_id?: string
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "medicine_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          kind: string
          method: Database["public"]["Enums"]["pay_method"]
          sale_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          kind?: string
          method: Database["public"]["Enums"]["pay_method"]
          sale_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          method?: Database["public"]["Enums"]["pay_method"]
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_return_items: {
        Row: {
          amount: number
          batch_id: string
          id: string
          qty: number
          return_id: string
          sale_item_id: string
        }
        Insert: {
          amount: number
          batch_id: string
          id?: string
          qty: number
          return_id: string
          sale_item_id: string
        }
        Update: {
          amount?: number
          batch_id?: string
          id?: string
          qty?: number
          return_id?: string
          sale_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_return_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "medicine_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_returns: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          due_reduced: number
          id: string
          idempotency_key: string
          kind: string
          reason: string | null
          refund: number
          refund_method: Database["public"]["Enums"]["pay_method"] | null
          return_no: string
          sale_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          due_reduced?: number
          id?: string
          idempotency_key: string
          kind?: string
          reason?: string | null
          refund?: number
          refund_method?: Database["public"]["Enums"]["pay_method"] | null
          return_no: string
          sale_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          due_reduced?: number
          id?: string
          idempotency_key?: string
          kind?: string
          reason?: string | null
          refund?: number
          refund_method?: Database["public"]["Enums"]["pay_method"] | null
          return_no?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          bill_discount: number
          created_at: string
          created_by: string
          customer_id: string | null
          due: number
          id: string
          idempotency_key: string
          invoice_no: string
          item_discount: number
          paid: number
          refunded: number
          returned_amount: number
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          bill_discount?: number
          created_at?: string
          created_by: string
          customer_id?: string | null
          due?: number
          id?: string
          idempotency_key: string
          invoice_no: string
          item_discount?: number
          paid?: number
          refunded?: number
          returned_amount?: number
          status?: string
          subtotal: number
          total: number
          updated_at?: string
        }
        Update: {
          bill_discount?: number
          created_at?: string
          created_by?: string
          customer_id?: string | null
          due?: number
          id?: string
          idempotency_key?: string
          invoice_no?: string
          item_discount?: number
          paid?: number
          refunded?: number
          returned_amount?: number
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          address: string
          currency: string
          expiry_alert_days: number
          id: number
          invoice_footer: string
          low_stock_threshold: number
          pharmacy_name: string
          phone: string
          receipt_format: string
          updated_at: string
        }
        Insert: {
          address?: string
          currency?: string
          expiry_alert_days?: number
          id?: number
          invoice_footer?: string
          low_stock_threshold?: number
          pharmacy_name?: string
          phone?: string
          receipt_format?: string
          updated_at?: string
        }
        Update: {
          address?: string
          currency?: string
          expiry_alert_days?: number
          id?: number
          invoice_footer?: string
          low_stock_threshold?: number
          pharmacy_name?: string
          phone?: string
          receipt_format?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          batch_id: string
          created_at: string
          created_by: string
          id: string
          medicine_id: string
          movement_type: string
          qty_change: number
          ref_id: string | null
          ref_table: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_by: string
          id?: string
          medicine_id: string
          movement_type: string
          qty_change: number
          ref_id?: string | null
          ref_table?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_by?: string
          id?: string
          medicine_id?: string
          movement_type?: string
          qty_change?: number
          ref_id?: string | null
          ref_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "medicine_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          method: Database["public"]["Enums"]["pay_method"]
          note: string | null
          payment_date: string
          supplier_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          method?: Database["public"]["Enums"]["pay_method"]
          note?: string | null
          payment_date?: string
          supplier_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          method?: Database["public"]["Enums"]["pay_method"]
          note?: string | null
          payment_date?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_set_role: {
        Args: { p_user: string; p_role: Database["public"]["Enums"]["app_role"] | null }
        Returns: undefined
      }
      cash_drawer_close: { Args: { p: Json }; Returns: Json }
      cash_drawer_open: { Args: { p: Json }; Returns: Json }
      collect_due: { Args: { p: Json }; Returns: Json }
      customer_dues: {
        Args: never
        Returns: {
          customer_id: string
          due: number
          open_invoices: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_manager: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      pay_supplier: { Args: { p: Json }; Returns: Json }
      post_purchase: { Args: { p: Json }; Returns: Json }
      post_sale: { Args: { p: Json }; Returns: Json }
      return_sale: { Args: { p: Json }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "manager" | "cashier"
      pay_method: "cash" | "bkash" | "nagad" | "rocket" | "bank"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "cashier"],
      pay_method: ["cash", "bkash", "nagad", "rocket", "bank"],
    },
  },
} as const
