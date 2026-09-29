-- Run once after upgrade_member_signup_and_duty_rotation.sql.
-- Enrollment numbers are stored on student profiles so they can be matched to
-- evaluation records. Teachers and super admins do not keep an enrollment number.

alter table public.profiles
  add column if not exists enrollment_number text;

create or replace function public.normalize_profile_enrollment()
returns trigger language plpgsql set search_path=public as $$
begin
  new.enrollment_number := nullif(btrim(new.enrollment_number), '');
  if new.role in ('supervisor','super_admin') then
    new.enrollment_number := null;
  end if;
  return new;
end $$;

drop trigger if exists profiles_normalize_enrollment on public.profiles;
create trigger profiles_normalize_enrollment
before insert or update on public.profiles
for each row execute function public.normalize_profile_enrollment();

create unique index if not exists profiles_enrollment_number_unique
  on public.profiles (lower(btrim(enrollment_number)))
  where enrollment_number is not null and btrim(enrollment_number) <> '';

create or replace function public.new_user_profile()
returns trigger language plpgsql security definer set search_path=public as $$
declare requested public.app_role; enrollment text;
begin
  requested := case
    when new.raw_user_meta_data->>'requested_role' = 'supervisor' then 'supervisor'::public.app_role
    else 'student'::public.app_role
  end;
  enrollment := case
    when requested = 'student' then nullif(btrim(new.raw_user_meta_data->>'enrollment_number'),'')
    else null
  end;
  insert into public.profiles(id,full_name,role,active,requested_role,enrollment_number)
  values(
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)),
    'student',false,requested,enrollment
  )
  on conflict (id) do update set
    full_name=excluded.full_name,
    requested_role=excluded.requested_role,
    enrollment_number=excluded.enrollment_number;
  return new;
end $$;

grant update(enrollment_number) on public.profiles to authenticated;
