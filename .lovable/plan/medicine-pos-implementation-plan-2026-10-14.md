# Medicine POS — Implementation Plan

## Current project (inspected)
- Fresh TanStack Start + React 19 + Tailwind v4 template. Only a placeholder home page.
- No backend, no schema, no auth, no existing features. Nothing to preserve beyond the template shell.

## Approach
Single pharmacy (one shop) for v1. Lovable Cloud for database + login. All money/stock logic runs in database functions so it cannot be bypassed from the browser.

## Phases
1. **Foundation** — enable Cloud, email login, roles (admin/manager/cashier in a separate roles table), full schema migration, app layout (desktop sidebar, mobile drawer), green accent design, ৳ + Bangladesh-time formatting.
2. **Inventory & purchases** — medicines CRUD + deactivate, batches, low-stock/expiry alerts, CSV import/export, suppliers, purchase posting (atomic, idempotent).
3. **POS** — instant search (name/generic/barcode/code), cart, FEFO batch pick, discounts, customer pick/quick-add, split payments (Cash/bKash/Nagad/Rocket/Bank), atomic sale function with row locks, thermal + A4 receipt.
4. **Customers, due, expenses** — ledger-based dues, due collection, expenses.
5. **Reports, dashboard, staff, settings** — date-filtered reports from real data, historical-cost gross profit, staff role management, pharmacy settings.
6. **Testing** — vitest for pricing/FEFO/due math; database-level checks of sale/purchase/return functions; build verification.

## Technical details
- Tables: profiles, user_roles, settings, medicines, medicine_batches, suppliers, purchases, purchase_items, customers, sales, sale_items, sale_payments, customer_payments, supplier_payments, expenses, stock_movements, audit_log. All money `numeric(14,2)`, timestamps `timestamptz`.
- Security-definer RPCs: `post_sale`, `post_purchase`, `return_sale`, `cancel_sale`, `collect_due`, `pay_supplier` — validate inputs, `SELECT ... FOR UPDATE` on batches, reject expired/insufficient, client idempotency key (unique) to block double submit, all-or-nothing.
- Invoice numbers via sequences (e.g. INV-000123, PUR-000045).
- RLS on every table; writes to stock/money tables only through RPCs; `has_role()` checks per role.
- sale_items snapshot name, batch no, qty, unit price, discount, unit cost.

## Out of scope (v1)
Multi-branch, delivery, CRM, full accounting, purchase editing (cancellation via reversal only).
