-- Repairs student enrollment persistence and the activate_member RPC.
-- Run in Supabase SQL Editor after setup.sql and the existing member/enrollment migrations.
-- This script is safe to rerun. Do not rerun setup.sql.

alter table public.profiles add column if not exists enrollment_number text;

create or replace function public.new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested public.app_role;
  enrollment text;
begin
  requested := case
    when new.raw_user_meta_data->>'requested_role' = 'supervisor'
      then 'supervisor'::public.app_role
    else 'student'::public.app_role
  end;
  enrollment := case
    when requested = 'student'
      then nullif(btrim(new.raw_user_meta_data->>'enrollment_number'), '')
    else null
  end;

  insert into public.profiles(
    id, full_name, role, active, requested_role, enrollment_number
  ) values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    'student'::public.app_role,
    false,
    requested,
    enrollment
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    requested_role = excluded.requested_role,
    enrollment_number = coalesce(excluded.enrollment_number, public.profiles.enrollment_number);

  return new;
end;
$$;

-- Recover values for accounts created before this trigger fix, when auth metadata
-- still contains the number. Skip duplicates so the unique enrollment index stays valid.
update public.profiles p
set enrollment_number = nullif(btrim(u.raw_user_meta_data->>'enrollment_number'), '')
from auth.users u
where p.id = u.id
  and p.role in ('student', 'student_leader')
  and p.enrollment_number is null
  and nullif(btrim(u.raw_user_meta_data->>'enrollment_number'), '') is not null
  and not exists (
    select 1 from public.profiles other
    where other.id <> p.id
      and lower(btrim(other.enrollment_number)) =
          lower(btrim(u.raw_user_meta_data->>'enrollment_number'))
  );

-- Input names are part of the PostgREST RPC contract. Remove any older overloads
-- and stale argument-name variants before creating the one supported signature.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'activate_member'
  loop
    execute format('drop function %s', fn.signature);
  end loop;
end;
$$;

create function public.activate_member(
  p_profile_id uuid,
  p_role text,
  p_enrollment_number text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  enrollment text;
  selected_role public.app_role;
begin
  if not coalesce(public.current_role() = 'super_admin', false) then
    raise exception 'Only a super admin can activate members';
  end if;

  if p_role is null or p_role not in ('super_admin', 'supervisor', 'student_leader', 'student') then
    raise exception 'Choose a valid role';
  end if;
  selected_role := p_role::public.app_role;

  select coalesce(
    nullif(btrim(p_enrollment_number), ''),
    nullif(btrim(p.enrollment_number), ''),
    nullif(btrim(u.raw_user_meta_data->>'enrollment_number'), '')
  ) into enrollment
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_profile_id;

  if not found then raise exception 'Member profile was not found'; end if;
  if selected_role in ('student', 'student_leader') and enrollment is null then
    raise exception 'Enrollment number was not saved at signup; ask the student to provide it';
  end if;
  if selected_role in ('super_admin', 'supervisor') then enrollment := null; end if;

  update public.profiles
  set role = selected_role,
      active = true,
      requested_role = null,
      enrollment_number = enrollment
  where id = p_profile_id and active = false;

  if not found then raise exception 'This member is not waiting for activation'; end if;
  return true;
exception
  when unique_violation then
    raise exception 'That enrollment number is already assigned to another member';
end;
$$;

revoke all on function public.activate_member(uuid, text, text) from public, anon;
grant execute on function public.activate_member(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
