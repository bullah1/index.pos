import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { BarChart3, BookOpen, FileText, ListChecks, PackageSearch, Boxes, ClipboardList, Building2, Coins, History, LayoutDashboard, Receipt as ReceiptIcon, Settings, Sparkles, Users, LogOut, Menu, Pill, ShoppingCart, Truck, Wallet } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsQuery } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { DrawerBanner } from "@/components/DrawerGate";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    // getSession reads the saved login locally (no network); the server still checks the token on every data request.
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw redirect({ to: "/auth" });
    const role = await context.queryClient.ensureQueryData({
      queryKey: ["my-role", user.id],
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const { data: roles, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
        if (error) throw error;
        const list = (roles ?? []).map((r) => r.role);
        return list.includes("admin") ? "admin" : list.includes("manager") ? "manager" : list.includes("cashier") ? "cashier" : null;
      },
    });
    return { user, role };
  },
  component: Layout,
});

type NavItem = { to: string; label: string; icon: typeof ShoppingCart; mgr?: boolean; admin?: boolean };
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Sell",
    items: [
      { to: "/pos", label: "POS Counter", icon: ShoppingCart },
      { to: "/sales", label: "Sales & Returns", icon: History },
      { to: "/quotations", label: "Quotations", icon: FileText },
      { to: "/customers", label: "Customers & Due", icon: Users },
      { to: "/cash-drawer", label: "Cash Drawer", icon: Wallet },
    ],
  },
  {
    title: "Stock",
    items: [
      { to: "/inventory", label: "Medicines & Stock", icon: Boxes },
      { to: "/stock-count", label: "Stock Entry", icon: ListChecks, mgr: true },
      { to: "/reorder", label: "Reorder List", icon: PackageSearch },
      { to: "/purchases", label: "Purchases", icon: Truck, mgr: true },
      { to: "/stock-adjustments", label: "Stock Adjustments", icon: ClipboardList, mgr: true },
      { to: "/suppliers", label: "Suppliers", icon: Building2, mgr: true },
      { to: "/supplier-payments", label: "Supplier Payments", icon: Coins, mgr: true },
      { to: "/supplier-ledger", label: "Supplier Ledger", icon: BookOpen, mgr: true },
    ],
  },
  {
    title: "Accounts",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/reports", label: "Reports", icon: BarChart3 },
      { to: "/expenses", label: "Expenses", icon: ReceiptIcon, mgr: true },
      { to: "/assistant", label: "Ask AI", icon: Sparkles, mgr: true },
      { to: "/settings", label: "Settings & Staff", icon: Settings, mgr: true, admin: true },
    ],
  },
];

function Layout() {
  const { user, role } = Route.useRouteContext();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isMgr = role === "admin" || role === "manager";
  const { data: settings } = useQuery({ ...settingsQuery, enabled: !!role });
  const shopName = settings?.pharmacy_name && settings.pharmacy_name !== "My Pharmacy" ? settings.pharmacy_name : "Pharmacy POS";

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

  if (!role) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="font-medium">Your account is waiting for approval.</p>
          <p className="text-sm text-muted-foreground">Ask the admin to give you a role in Settings &amp; Staff, then sign in again.</p>
          <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
          <Button variant="outline" className="mt-4" onClick={signOut}>Sign out</Button>
        </div>
      </div>
    );
  }

  const links = (
    <nav className="space-y-4">
      {NAV.map((g) => {
        const items = g.items.filter((n) => (!n.mgr || isMgr) && (!n.admin || role === "admin"));
        if (items.length === 0) return null;
        return (
          <div key={g.title}>
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</div>
            <div className="space-y-0.5">
              {items.map((n) => (
                <Link key={n.to} to={n.to} onClick={() => setOpen(false)}
                  className={cn("flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    path.startsWith(n.to) ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60")}>
                  <n.icon className="h-4 w-4 shrink-0" />{n.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
  const footer = (
    <div className="border-t pt-3 text-xs">
      <div className="truncate font-medium">{user.email}</div>
      <div className="capitalize text-muted-foreground">{role}</div>
      <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={signOut}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
    </div>
  );
  const brand = (
    <div className="mb-5 flex items-center gap-2 px-1 font-semibold">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"><Pill className="h-4 w-4" /></span>
      <span className="truncate">{shopName}</span>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between overflow-y-auto border-r bg-sidebar p-4 md:flex print:hidden">
        <div>{brand}{links}</div>{footer}
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-64 flex-col justify-between bg-sidebar p-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div>{brand}{links}</div>{footer}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-3 py-2 md:hidden print:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
          <span className="truncate font-semibold">{shopName}</span>
        </header>
        <DrawerBanner userId={user.id} />
        <main className="flex-1 p-3 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
