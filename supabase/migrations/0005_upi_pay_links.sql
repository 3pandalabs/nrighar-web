-- UPI pay-link flow ("UPI directory" model — money flows tenant -> owner P2P,
-- never through us). The owner generates a per-month pay link; the tenant opens
-- a public page that launches their UPI app with the owner's VPA prefilled.
-- Confirmation is a claim ("I've paid"), not a webhook — plain P2P UPI has no
-- programmatic payment notification, so the owner still confirms receipt.

-- 1. Owner UPI details on profile
alter table public.profiles
  add column upi_vpa text,
  add column upi_name text;

-- 2. Pay links: one per lease per month
create table public.pay_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  period_year integer not null check (period_year between 2000 and 2100),
  period_month integer not null check (period_month between 1 and 12),
  amount_due numeric(12, 2) not null check (amount_due >= 0),
  opened_at timestamptz,
  claimed_paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lease_id, period_year, period_month)
);

alter table public.pay_links enable row level security;

create policy "pay_links_all_own" on public.pay_links
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create index idx_pay_links_owner on public.pay_links (owner_id);

grant select, insert, update, delete on public.pay_links to authenticated;
grant select, insert, update, delete on public.pay_links to service_role;

-- 3. Anonymous access is ONLY via these narrow security-definer functions,
-- keyed by the unguessable pay-link uuid. The table itself stays closed to
-- anon (no grants), so the only anonymous surface is: read one link's display
-- data, stamp opened_at, stamp claimed_paid_at.

create function public.get_pay_link(p_token uuid)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'amount_due', pl.amount_due,
    'period_year', pl.period_year,
    'period_month', pl.period_month,
    'property_nickname', p.nickname,
    'property_city', p.city,
    'tenant_name', t.full_name,
    'owner_upi_vpa', pr.upi_vpa,
    'owner_upi_name', coalesce(pr.upi_name, pr.display_name),
    'claimed_paid_at', pl.claimed_paid_at
  )
  from public.pay_links pl
  join public.leases l on l.id = pl.lease_id
  join public.properties p on p.id = l.property_id
  join public.tenants t on t.id = l.tenant_id
  left join public.profiles pr on pr.id = pl.owner_id
  where pl.id = p_token;
$$;

create function public.mark_pay_link_opened(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pay_links
    set opened_at = coalesce(opened_at, now())
    where id = p_token;
end;
$$;

create function public.claim_pay_link_paid(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pay_links
    set claimed_paid_at = coalesce(claimed_paid_at, now())
    where id = p_token;
end;
$$;

revoke all on function public.get_pay_link(uuid) from public;
revoke all on function public.mark_pay_link_opened(uuid) from public;
revoke all on function public.claim_pay_link_paid(uuid) from public;

grant execute on function public.get_pay_link(uuid) to anon, authenticated;
grant execute on function public.mark_pay_link_opened(uuid) to anon, authenticated;
grant execute on function public.claim_pay_link_paid(uuid) to anon, authenticated;
