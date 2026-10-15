<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Project rules
- Stock and money changes go only through database functions (post_sale, post_purchase, return_sale); tables are read-only to clients so rules can't be bypassed.
- Sales/purchases carry a client idempotency key (unique) to block double submits.
- FEFO and cart math live in src/lib/pos.ts and must mirror the database rules; covered by src/test/pos.test.ts.
- Roles live in user_roles (admin/manager/cashier); first signup becomes admin.
- Signed-in pages live under src/routes/_authenticated/.
