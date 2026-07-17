-- With "automatically expose new tables" OFF, service_role gets no table
-- privileges by default either (same lesson as ReceiptCash's migration 0007):
-- it bypasses RLS but NOT table-level grants, so admin/Edge Function access
-- fails with "permission denied" without these. Surfaced by a smoke test:
-- a service_role DELETE on properties returned 403.

grant select, insert, update, delete on all tables in schema public to service_role;

-- Cover tables added by future migrations too.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
