-- When a tenant profile is shared with an owner (via intake acceptance or a
-- claimed share link), link it to the owner's EXISTING tenant record instead
-- of creating a duplicate: match by tenant_user_id first, then by phone
-- (last 10 digits) or email (case-insensitive) among the owner's unlinked
-- records. Only create a fresh record when nothing matches.

create or replace function public.find_or_link_owner_tenant(
  p_owner_id uuid,
  p_tenant_user_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.tenant_profiles%rowtype;
  v_tenant_id uuid;
  v_phone_digits text;
begin
  select * into v_profile from public.tenant_profiles where user_id = p_tenant_user_id;
  if not found then
    return null;
  end if;

  -- 1. Already linked?
  select id into v_tenant_id from public.tenants
    where owner_id = p_owner_id and tenant_user_id = p_tenant_user_id
    limit 1;
  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  -- 2. Match an unlinked record by phone (last 10 digits) or email.
  v_phone_digits := right(regexp_replace(coalesce(v_profile.phone, ''), '\D', '', 'g'), 10);

  select id into v_tenant_id from public.tenants t
    where t.owner_id = p_owner_id
      and t.tenant_user_id is null
      and (
        (length(v_phone_digits) = 10
          and right(regexp_replace(coalesce(t.phone, ''), '\D', '', 'g'), 10) = v_phone_digits)
        or (v_profile.email is not null
          and lower(coalesce(t.email, '')) = lower(v_profile.email))
      )
    order by t.created_at
    limit 1;

  if v_tenant_id is not null then
    update public.tenants
      set tenant_user_id = p_tenant_user_id,
          kyc_status = v_profile.kyc_status,
          phone = coalesce(tenants.phone, v_profile.phone),
          email = coalesce(tenants.email, v_profile.email)
      where id = v_tenant_id;
    return v_tenant_id;
  end if;

  -- 3. Nothing matches: create.
  insert into public.tenants (owner_id, full_name, phone, email, kyc_status, tenant_user_id, notes)
  values (p_owner_id, v_profile.full_name, v_profile.phone, v_profile.email,
          v_profile.kyc_status, p_tenant_user_id, p_note)
  returning id into v_tenant_id;

  return v_tenant_id;
end;
$$;

revoke all on function public.find_or_link_owner_tenant(uuid, uuid, text) from public;
-- Internal helper: only callable by the two RPCs below (definer context), not directly.

create or replace function public.claim_profile_share(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.profile_shares%rowtype;
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

  if v_share.status = 'open' then
    update public.profile_shares
      set owner_id = auth.uid(), status = 'claimed', claimed_at = now()
      where id = p_token;
  end if;

  v_tenant_id := public.find_or_link_owner_tenant(
    auth.uid(), v_share.tenant_user_id, 'Linked from shared tenant profile');
  if v_tenant_id is null then
    return json_build_object('error', 'not_found');
  end if;

  return json_build_object('ok', true, 'tenant_id', v_tenant_id,
                           'tenant_user_id', v_share.tenant_user_id);
end;
$$;

create or replace function public.accept_intake_as_tenant(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.intake_links%rowtype;
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

  if not exists (select 1 from public.tenant_profiles where user_id = auth.uid()) then
    return json_build_object('error', 'no_tenant_profile');
  end if;

  insert into public.profile_shares (tenant_user_id, owner_id, status, claimed_at)
  values (auth.uid(), v_link.owner_id, 'claimed', now());

  v_tenant_id := public.find_or_link_owner_tenant(
    v_link.owner_id, auth.uid(), 'Self-registered via intake link');

  update public.intake_links
    set status = 'submitted', tenant_id = v_tenant_id, submitted_at = now()
    where id = p_token;

  return json_build_object('ok', true);
end;
$$;
