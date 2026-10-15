import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { BarChart3, Boxes, Building2, Coins, History, LayoutDashboard, Receipt as ReceiptIcon, Settings, Sparkles, Users, LogOut, Menu, Pill, ShoppingCart, Truck, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { DrawerBanner } from "@/components/DrawerGate";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    const list = (roles ?? []).map((r) => r.role);
    const role = list.includes("admin") ? "admin" : list.includes("manager") ? "manager" : list.includes("cashier") ? "cashier" : null;
    return { user: data.user, role };
  },
  component: Layout,
});

const NAV = [
  { to: "/pos", label: "POS Counter", icon: ShoppingCart, mgr: false, admin: false },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mgr: false, admin: false },
  { to: "/sales", label: "Sales History", icon: History, mgr: false, admin: false },
  { to: "/cash-drawer", label: "Cash Drawer", icon: Wallet, mgr: false, admin: false },
  { to: "/inventory", label: "Medicines / Inventory", icon: Boxes, mgr: false, admin: false },
  { to: "/customers", label: "Customers & Due", icon: Users, mgr: false, admin: false },
  { to: "/purchases", label: "Purchases", icon: Truck, mgr: true, admin: false },
  { to: "/suppliers", label: "Suppliers", icon: Building2, mgr: true, admin: false },
  { to: "/supplier-payments", label: "Supplier Payments", icon: Coins, mgr: true, admin: false },
  { to: "/expenses", label: "Expenses", icon: ReceiptIcon, mgr: true, admin: false },
  { to: "/reports", label: "Reports", icon: BarChart3, mgr: false, admin: false },
  { to: "/assistant", label: "Ask AI", icon: Sparkles, mgr: true, admin: false },
  { to: "/settings", label: "Settings & Staff", icon: Settings, mgr: true, admin: true },
] as const;

function Layout() {
  const { user, role } = Route.useRouteContext();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isMgr = role === "admin" || role === "manager";

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
    <nav className="space-y-1">
      {NAV.filter((n) => (!n.mgr || isMgr) && (!n.admin || role === "admin")).map((n) => (
        <Link key={n.to} to={n.to} onClick={() => setOpen(false)}
          className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            path.startsWith(n.to) ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60")}>
          <n.icon className="h-4 w-4 shrink-0" />{n.label}
        </Link>
      ))}
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
    <div className="mb-6 flex items-center gap-2 px-1 font-semibold">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground"><Pill className="h-4 w-4" /></span>
      Pharmacy POS
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
          <span className="font-semibold">Pharmacy POS</span>
        </header>
        {path !== "/pos" && <DrawerBanner userId={user.id} />}
        <main className="flex-1 p-3 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
