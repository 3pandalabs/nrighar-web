-- Portable tenant profiles: tenants become real auth users who own their
-- profile + documents and share them with owners via revocable, unguessable
-- share tokens. Owners' existing tenants/leases/rent flow is untouched — a
-- nullable tenants.tenant_user_id bridges owner-side records to tenant users.

-- 1. Roles on profiles
alter table public.profiles
  add column role text not null default 'owner' check (role in ('owner', 'tenant'));

-- 2. Tenant-owned profile
create table public.tenant_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  current_city text,
  employer text,
  kyc_status text not null default 'pending'
    check (kyc_status in ('pending', 'submitted', 'verified')),
  created_at timestamptz not null default now()
);

alter table public.tenant_profiles enable row level security;

create policy "tenant_profiles_all_own" on public.tenant_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Tenant-owned documents (files live at documents/<tenant_user_id>/... —
-- the existing path-scoped storage policies already give the tenant CRUD).
create table public.tenant_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_user_id uuid not null references auth.users(id) on delete cascade,
  doc_type text not null default 'other'
    check (doc_type in ('agreement', 'kyc', 'property_paper', 'tax', 'other')),
  title text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.tenant_documents enable row level security;

create policy "tenant_documents_all_own" on public.tenant_documents
  for all using (auth.uid() = tenant_user_id) with check (auth.uid() = tenant_user_id);

create index idx_tenant_documents_user on public.tenant_documents (tenant_user_id);

-- 4. Shares: consent records. id doubles as the unguessable share token.
create table public.profile_shares (
  id uuid primary key default gen_random_uuid(),
  tenant_user_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'claimed', 'revoked')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  revoked_at timestamptz
);

alter table public.profile_shares enable row level security;

create policy "profile_shares_tenant_all" on public.profile_shares
  for all using (auth.uid() = tenant_user_id) with check (auth.uid() = tenant_user_id);

create policy "profile_shares_owner_select" on public.profile_shares
  for select using (auth.uid() = owner_id);

create index idx_profile_shares_tenant on public.profile_shares (tenant_user_id);
create index idx_profile_shares_owner on public.profile_shares (owner_id);

-- Owners with a claimed, unrevoked share can read the profile + doc metadata.
create policy "tenant_profiles_select_shared" on public.tenant_profiles
  for select using (
    exists (
      select 1 from public.profile_shares s
      where s.tenant_user_id = tenant_profiles.user_id
        and s.owner_id = auth.uid()
        and s.status = 'claimed'
    )
  );

create policy "tenant_documents_select_shared" on public.tenant_documents
  for select using (
    exists (
      select 1 from public.profile_shares s
      where s.tenant_user_id = tenant_documents.tenant_user_id
        and s.owner_id = auth.uid()
        and s.status = 'claimed'
    )
  );

-- 5. Bridge owner-side tenant records to tenant users
alter table public.tenants
  add column tenant_user_id uuid references auth.users(id) on delete set null;

-- 6. Storage: owners with a claimed share can read files in the tenant's
-- folder (metadata gate is the RLS above; this is the file gate).
create policy "documents_bucket_select_shared" on storage.objects
  for select using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.profile_shares s
      where s.status = 'claimed'
        and s.owner_id = auth.uid()
        and (storage.foldername(name))[1] = s.tenant_user_id::text
    )
  );

-- 7. Claiming a share (owner presents the token). Security definer so the
-- owner can flip an 'open' row they could not otherwise see, and so the
-- bridged owner-side tenant record is created atomically.
create function public.claim_profile_share(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.profile_shares%rowtype;
  v_profile public.tenant_profiles%rowtype;
  v_tenant_id uuid;
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_signed_in');
  end if;

  select * into v_share from public.profile_shares where id = p_token;
  if not found then
    return json_build_object('error', 'not_found');
  end if;
  if v_share.status = 'revoked' then
    return json_build_object('error', 'revoked');
  end if;
  if v_share.status = 'claimed' and v_share.owner_id <> auth.uid() then
    return json_build_object('error', 'already_claimed');
  end if;
  if v_share.tenant_user_id = auth.uid() then
    return json_build_object('error', 'own_profile');
  end if;

  select * into v_profile from public.tenant_profiles where user_id = v_share.tenant_user_id;
  if not found then
    return json_build_object('error', 'not_found');
  end if;

  if v_share.status = 'open' then
    update public.profile_shares
      set owner_id = auth.uid(), status = 'claimed', claimed_at = now()
      where id = p_token;
  end if;

  -- Bridge: ensure this owner has a tenants record pointing at the user.
  select id into v_tenant_id from public.tenants
    where owner_id = auth.uid() and tenant_user_id = v_share.tenant_user_id
    limit 1;
  if v_tenant_id is null then
    insert into public.tenants (owner_id, full_name, phone, email, kyc_status, tenant_user_id, notes)
    values (auth.uid(), v_profile.full_name, v_profile.phone, v_profile.email,
            v_profile.kyc_status, v_share.tenant_user_id, 'Linked from shared tenant profile')
    returning id into v_tenant_id;
  end if;

  return json_build_object('ok', true, 'tenant_id', v_tenant_id,
                           'tenant_user_id', v_share.tenant_user_id);
end;
$$;

revoke all on function public.claim_profile_share(uuid) from public;
grant execute on function public.claim_profile_share(uuid) to authenticated;

-- Preview for the claim page (name/city only — no docs before claiming).
create function public.get_profile_share_preview(p_token uuid)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'status', s.status,
    'full_name', tp.full_name,
    'current_city', tp.current_city,
    'kyc_status', tp.kyc_status
  )
  from public.profile_shares s
  join public.tenant_profiles tp on tp.user_id = s.tenant_user_id
  where s.id = p_token;
$$;

revoke all on function public.get_profile_share_preview(uuid) from public;
grant execute on function public.get_profile_share_preview(uuid) to authenticated;

-- 8. Intake acceptance by a signed-in tenant user: consumes the invite,
-- creates the claimed share to the inviting owner, bridges the owner-side
-- tenant record, marks the invite submitted.
create function public.accept_intake_as_tenant(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.intake_links%rowtype;
  v_profile public.tenant_profiles%rowtype;
  v_tenant_id uuid;
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_signed_in');
  end if;

  select * into v_link from public.intake_links where id = p_token;
  if not found then
    return json_build_object('error', 'not_found');
  end if;
  if v_link.status <> 'pending' then
    return json_build_object('error', 'already_used');
  end if;
  if v_link.expires_at < now() then
    return json_build_object('error', 'expired');
  end if;

  select * into v_profile from public.tenant_profiles where user_id = auth.uid();
  if not found then
    return json_build_object('error', 'no_tenant_profile');
  end if;

  -- Consent: accepting the invite shares the profile with the inviting owner.
  insert into public.profile_shares (tenant_user_id, owner_id, status, claimed_at)
  values (auth.uid(), v_link.owner_id, 'claimed', now());

  select id into v_tenant_id from public.tenants
    where owner_id = v_link.owner_id and tenant_user_id = auth.uid()
    limit 1;
  if v_tenant_id is null then
    insert into public.tenants (owner_id, full_name, phone, email, kyc_status, tenant_user_id, notes)
    values (v_link.owner_id, v_profile.full_name, v_profile.phone, v_profile.email,
            v_profile.kyc_status, auth.uid(), 'Self-registered via intake link')
    returning id into v_tenant_id;
  end if;

  update public.intake_links
    set status = 'submitted', tenant_id = v_tenant_id, submitted_at = now()
    where id = p_token;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.accept_intake_as_tenant(uuid) from public;
grant execute on function public.accept_intake_as_tenant(uuid) to authenticated;

-- 9. Grants (authenticated; service_role covered by 0004 default privileges,
-- but granted explicitly for clarity)
grant select, insert, update, delete on public.tenant_profiles to authenticated;
grant select, insert, update, delete on public.tenant_documents to authenticated;
grant select, insert, update, delete on public.profile_shares to authenticated;
grant select, insert, update, delete on public.tenant_profiles to service_role;
grant select, insert, update, delete on public.tenant_documents to service_role;
grant select, insert, update, delete on public.profile_shares to service_role;
