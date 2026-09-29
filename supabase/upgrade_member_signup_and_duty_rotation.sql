-- Run once after the original setup.sql. Safe to run again.
-- Enables student/teacher self-registration, admin approval, fair duty rotation,
-- daily question progress, and quiz attendance reporting.

alter table public.profiles
  add column if not exists requested_role public.app_role;

create or replace function public.new_user_profile()
returns trigger language plpgsql security definer set search_path=public as $$
declare requested public.app_role;
begin
  requested := case
    when new.raw_user_meta_data->>'requested_role' = 'supervisor' then 'supervisor'::public.app_role
    else 'student'::public.app_role
  end;
  insert into public.profiles(id,full_name,role,active,requested_role)
  values(
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)),
    'student',
    false,
    requested
  )
  on conflict (id) do update set
    full_name=excluded.full_name,
    requested_role=excluded.requested_role;
  return new;
end $$;

-- Directly created accounts are active and have no pending request.
-- Signup trigger handles only accounts whose profile is not already provisioned.

create table if not exists public.duty_rotation_state (
  singleton boolean primary key default true check(singleton),
  current_cycle integer not null default 1 check(current_cycle > 0)
);
insert into public.duty_rotation_state(singleton,current_cycle)
values(true,1) on conflict(singleton) do nothing;

create table if not exists public.duty_rotation_members (
  cycle_no integer not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null,
  assigned_on date,
  primary key(cycle_no,profile_id),
  unique(cycle_no,position)
);

alter table public.duties add column if not exists rotation_cycle integer;

create or replace function public.assign_next_duty(p_duty_date date,p_target_count integer default 5)
returns table(duty_id uuid,duty_date date,student_id uuid,full_name text,target_count integer,rotation_cycle integer)
language plpgsql security definer set search_path=public as $$
declare c integer; chosen uuid; new_id uuid;
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  if p_duty_date is null or p_target_count not between 1 and 20 then raise exception 'Invalid duty date or target'; end if;
  if exists(select 1 from public.duties d where d.duty_date=p_duty_date) then raise exception 'A duty is already assigned for that date'; end if;

  insert into public.duty_rotation_state(singleton,current_cycle)
  values(true,1) on conflict(singleton) do nothing;
  perform 1 from public.duty_rotation_state where singleton=true for update;
  select current_cycle into c from public.duty_rotation_state where singleton=true;
  if c is null then raise exception 'Could not initialize duty rotation cycle'; end if;

  if not exists(select 1 from public.duty_rotation_members where cycle_no=c) then
    insert into public.duty_rotation_members(cycle_no,profile_id,position)
    select c,p.id,row_number() over(order by random())::integer
    from public.profiles p
    where p.active and p.role in ('student','student_leader');
  end if;

  if not exists(select 1 from public.duty_rotation_members where cycle_no=c and assigned_on is null) then
    update public.duty_rotation_state set current_cycle=current_cycle+1 where singleton=true returning current_cycle into c;
    insert into public.duty_rotation_members(cycle_no,profile_id,position)
    select c,p.id,row_number() over(order by random())::integer
    from public.profiles p
    where p.active and p.role in ('student','student_leader');
  end if;

  select rm.profile_id into chosen from public.duty_rotation_members rm
  join public.profiles p on p.id=rm.profile_id and p.active and p.role in ('student','student_leader')
  where rm.cycle_no=c and rm.assigned_on is null order by rm.position limit 1;
  if chosen is null then raise exception 'No active students are available for duty'; end if;

  insert into public.duties(duty_date,student_id,target_count,assigned_by,rotation_cycle)
  values(p_duty_date,chosen,p_target_count,auth.uid(),c) returning id into new_id;
  update public.duty_rotation_members set assigned_on=p_duty_date where cycle_no=c and profile_id=chosen;
  return query select new_id,p_duty_date,chosen,p.full_name,p_target_count,c from public.profiles p where p.id=chosen;
end $$;

create or replace function public.get_duty_progress(p_duty_date date default current_date)
returns table(duty_id uuid,duty_date date,student_id uuid,full_name text,target_count integer,
  submitted_count bigint,approved_count bigint,pending_count bigint,revision_requested_count bigint)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  return query
  select d.id,d.duty_date,d.student_id,p.full_name,d.target_count,
    count(q.id),count(q.id) filter(where q.status='approved'),
    count(q.id) filter(where q.status='pending'),count(q.id) filter(where q.status='revision_requested')
  from public.duties d join public.profiles p on p.id=d.student_id
  left join public.questions q on q.author_id=d.student_id
    and q.created_at >= (d.duty_date::timestamp at time zone 'Asia/Kolkata')
    and q.created_at < ((d.duty_date+1)::timestamp at time zone 'Asia/Kolkata')
  where d.duty_date=p_duty_date
  group by d.id,d.duty_date,d.student_id,p.full_name,d.target_count;
end $$;

create or replace function public.get_quiz_participation(p_quiz_id uuid)
returns table(student_id uuid,full_name text,role public.app_role,attended boolean,submitted_at timestamptz,score integer,total integer)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  if not exists(select 1 from public.quizzes q where q.id=p_quiz_id) then raise exception 'Quiz not found'; end if;
  return query
  select p.id,p.full_name,p.role,(a.id is not null),a.submitted_at,a.score,a.total
  from public.profiles p
  left join public.quiz_attempts a on a.student_id=p.id and a.quiz_id=p_quiz_id
  where p.active and p.role in ('student','student_leader')
  order by p.full_name;
end $$;

revoke all on function public.assign_next_duty(date,integer),public.get_duty_progress(date),public.get_quiz_participation(uuid) from public,anon;
grant execute on function public.assign_next_duty(date,integer),public.get_duty_progress(date),public.get_quiz_participation(uuid) to authenticated;
grant update(requested_role) on public.profiles to authenticated;

grant select on public.duty_rotation_members,public.duty_rotation_state to authenticated;
alter table public.duty_rotation_members enable row level security;
alter table public.duty_rotation_state enable row level security;
drop policy if exists rotation_members_read on public.duty_rotation_members;
create policy rotation_members_read on public.duty_rotation_members for select to authenticated using(public.can_manage());
drop policy if exists rotation_state_read on public.duty_rotation_state;
create policy rotation_state_read on public.duty_rotation_state for select to authenticated using(public.can_manage());
