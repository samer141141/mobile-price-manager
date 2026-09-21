# Lager iPhone

English, responsive Next.js + Supabase inventory, market pricing and sales management. The application uses the existing Supabase password sign-in and the same public connection variable names. It never needs a service-role key.

## Run locally

1. Work inside this folder (the downloaded archive contains a parent folder with the same name).
2. Copy `.env.example` to `.env.local` and supply your **existing** Supabase URL and publishable key. Keep your current values if this file already exists. Never put a service-role or secret key in a `NEXT_PUBLIC_` variable.
3. Run `npm install` (or `pnpm install`).
4. Apply the migration below, assign your first Admin, then run `npm run dev`.
5. `npm test` runs business logic and PostgreSQL-compatible migration/security tests in an isolated in-memory PGlite database. `npm run build` creates the production build. `npm run test:e2e` runs browser tests using installed Microsoft Edge and simulated Supabase responses; it starts an isolated development server on port 3100. No live database is used by these tests.

## Required manual Supabase migration

Run **migrations/20260921_lager_iphone.sql** in the SQL Editor of your existing Supabase project, as the database owner. This file has NOT been applied to your live database by this project upgrade.

The migration runs in one transaction. It adds nullable IMEI, any missing market-price columns, a membership table and permission-checked functions. It does not delete, reset, convert IDs, or rewrite existing phone or market-price records. It checks for the phone columns used by the original application and aborts on unknown required columns without defaults. If it aborts, inspect the actual schema and adapt the migration before continuing; do not reset your tables. In a SQL session reporting an aborted transaction, run `ROLLBACK` before retrying.

No live credentials or schema dump were supplied with the project. The inspected original code assumes `public.phones` has `id`, `model`, `storage_gb`, `color`, `battery_health`, `condition`, `status`, `purchase_price`, `repair_cost`, `other_cost`, `selling_price`, `purchase_source`, `notes`, `created_at`. No original code describes `market_prices`. The migration adopts `model`, `storage_gb`, `condition`, `source`, `market_price`, `listing_url`, `created_at`; any differently named legacy columns remain untouched. If your existing market table uses other names for these concepts, map them explicitly after inspecting the schema so historical values appear in the new UI. Extra required columns must have an appropriate default or explicit handling. Existing row defaults, IDs and user ownership columns are preserved; new rows receive the signed-in user ID when a `user_id` column exists.

After migration, replace the email below with your existing Supabase Auth user's email and run this once in SQL Editor. This is an explicit trusted bootstrap, never an automatic promotion of all users:

```sql
insert into public.lager_memberships (user_id, role, can_view_financials, can_delete)
select id, 'admin', true, true
from auth.users
where lower(email) = lower('YOUR_EXISTING_EMAIL_HERE')
on conflict (user_id) do update
set role = 'admin', can_view_financials = true, can_delete = true;
```

Ensure the SQL reports one affected row. Then sign in with your existing password. Use **Team Permissions** to assign existing Auth users as Admin or Employee. Newly registered/unassigned accounts cannot access inventory. This is a shared inventory for the assigned team, not separate inventories per user.

## Permissions and compatibility

- Admin: all phone fields, market records, exports, deletion and team permissions.
- Employee: non-sensitive inventory editing, Mark Sold, market records and permitted exports. Purchase price, repair cost, other cost, calculated profit and buying estimates are restricted by default. Admin can grant financial access and deletion independently.
- Restricted columns are excluded in the database response, not merely hidden in the UI. Restricted mutations are rejected in PostgreSQL. Editing a phone as a restricted Employee does not zero out its stored costs.
- Direct browser access to the three managed tables is revoked (including column grants); the application uses authenticated RPCs with fixed search paths and explicit permissions. Existing RLS policies remain, and RLS is enabled. Directly dependent views have browser grants revoked too. Coordinate this deployment with any other tools that currently access those tables directly.
- Review any pre-existing custom security-definer functions, nested views, GraphQL endpoints, storage copies or other APIs that expose inventory data: the downloaded project does not contain their definitions, and this migration cannot prove their security. Remove or secure alternate access paths before granting restricted Employee accounts. Do not store sensitive prices in public Notes or Purchase Source fields.
- Without the migration, the app fails closed with a setup message rather than silently bypassing permissions. Authentication itself is unchanged.

## Inventory, pricing and exports

- Available includes all statuses except Sold. Mark Sold updates only status; all stored financial information remains available in Sold Phones. Only confirmed, authorized Delete removes a record.
- Search covers model, IMEI, storage, color, condition and status within the selected list. IMEI is optional text (15 digits for new values), preserving leading zeros. Existing empty IMEIs remain valid.
- Excel and PDF exports include the selected list and current search results. Select columns in the export dialog. Purchase price, costs and profit start unchecked every time. Employee exports cannot select restricted fields. Excel values are exported as data, not formulas.
- Market comparisons match model and condition case-insensitively and storage numerically. Average, minimum and maximum use positive recorded listing prices across matching sources. Prices are manually recorded; there is no scraping or currency conversion.
- Buy percentage defaults to a clearly editable 75% and is saved on the current device. Recommended Buy Price = Average Market Price x Buy Percentage / 100. Expected Profit = Average Market Price - Recommended Buy Price - Estimated Repair/Other Costs. This is an estimate before any unentered selling fees/taxes. All currency fields use SEK.
- For existing phone records, Profit = Selling Price - Purchase Price - Repair Cost - Other Cost. Inventory Value includes available phones only; Realized Profit includes sold phones only.

## Validation scope

Automated tests use an isolated PostgreSQL-compatible database, never your real Supabase project. Production authentication and live schema compatibility still need verification after applying the migration and configuring your existing environment. The PDF uses standard embedded PDF fonts; unusual non-Latin notes may need a Unicode font integration for full glyph coverage.
