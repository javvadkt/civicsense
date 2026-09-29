-- Fixes: null value in column "cycle_no" of duty_rotation_members.
-- Run this in Supabase SQL Editor. It restores the initial rotation state and
-- makes assignment initialize that state automatically if it is ever absent.

create table if not exists public.duty_rotation_state (
  singleton boolean primary key default true check (singleton),
  current_cycle integer not null default 1 check (current_cycle > 0)
);

create table if not exists public.duty_rotation_members (
  cycle_no integer not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null,
  assigned_on date,
  primary key (cycle_no, profile_id),
  unique (cycle_no, position)
);

alter table public.duties add column if not exists rotation_cycle integer;

insert into public.duty_rotation_state(singleton, current_cycle)
values (true, 1)
on conflict (singleton) do nothing;

create or replace function public.assign_next_duty(
  p_duty_date date,
  p_target_count integer default 5
)
returns table(
  duty_id uuid,
  duty_date date,
  student_id uuid,
  full_name text,
  target_count integer,
  rotation_cycle integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c integer;
  chosen uuid;
  new_id uuid;
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  if p_duty_date is null or p_target_count not between 1 and 20 then
    raise exception 'Invalid duty date or target';
  end if;
  if exists(select 1 from public.duties d where d.duty_date = p_duty_date) then
    raise exception 'A duty is already assigned for that date';
  end if;

  -- Ensure the singleton exists before reading and locking it. Without this row,
  -- c would be NULL and the NOT NULL cycle_no insert would fail.
  insert into public.duty_rotation_state(singleton, current_cycle)
  values (true, 1)
  on conflict (singleton) do nothing;
  perform 1 from public.duty_rotation_state where singleton = true for update;
  select current_cycle into c
  from public.duty_rotation_state where singleton = true;

  if c is null then raise exception 'Could not initialize duty rotation cycle'; end if;

  if not exists(select 1 from public.duty_rotation_members where cycle_no = c) then
    insert into public.duty_rotation_members(cycle_no, profile_id, position)
    select c, p.id, row_number() over(order by random())::integer
    from public.profiles p
    where p.active and p.role in ('student', 'student_leader');
  end if;

  if not exists(
    select 1
    from public.duty_rotation_members rm
    join public.profiles p on p.id = rm.profile_id
    where rm.cycle_no = c
      and rm.assigned_on is null
      and p.active and p.role in ('student', 'student_leader')
      and not exists(
        select 1 from public.duty_availability a
        where a.profile_id = rm.profile_id
          and a.availability_date = p_duty_date
          and a.status in ('leave', 'unavailable')
      )
  ) then
    if exists(
      select 1
      from public.duty_rotation_members rm
      join public.profiles p on p.id = rm.profile_id
      where rm.cycle_no = c
        and rm.assigned_on is null
        and p.active and p.role in ('student', 'student_leader')
    ) then
      raise exception 'All remaining students are marked on leave or unavailable for this date';
    end if;

    update public.duty_rotation_state
    set current_cycle = current_cycle + 1
    where singleton = true
    returning current_cycle into c;

    insert into public.duty_rotation_members(cycle_no, profile_id, position)
    select c, p.id, row_number() over(order by random())::integer
    from public.profiles p
    where p.active and p.role in ('student', 'student_leader');
  end if;

  insert into public.duty_rotation_members(cycle_no, profile_id, position)
  select c, p.id,
    coalesce((select max(position)
              from public.duty_rotation_members
              where cycle_no = c), 0) + 1
  from public.profiles p
  where p.active and p.role in ('student', 'student_leader')
    and not exists(
      select 1 from public.duty_rotation_members rm
      where rm.cycle_no = c and rm.profile_id = p.id
    );

  select rm.profile_id into chosen
  from public.duty_rotation_members rm
  join public.profiles p on p.id = rm.profile_id
    and p.active and p.role in ('student', 'student_leader')
  where rm.cycle_no = c
    and rm.assigned_on is null
    and not exists(
      select 1 from public.duty_availability a
      where a.profile_id = rm.profile_id
        and a.availability_date = p_duty_date
        and a.status in ('leave', 'unavailable')
    )
  order by rm.position
  limit 1;

  if chosen is null then
    raise exception 'No available students are eligible for duty on this date';
  end if;

  insert into public.duties(duty_date, student_id, target_count, assigned_by, rotation_cycle)
  values (p_duty_date, chosen, p_target_count, auth.uid(), c)
  returning id into new_id;

  update public.duty_rotation_members
  set assigned_on = p_duty_date
  where cycle_no = c and profile_id = chosen;

  return query
  select new_id, p_duty_date, chosen, p.full_name, p_target_count, c
  from public.profiles p where p.id = chosen;
end;
$$;

revoke all on function public.assign_next_duty(date, integer) from public, anon;
grant execute on function public.assign_next_duty(date, integer) to authenticated;

notify pgrst, 'reload schema';
