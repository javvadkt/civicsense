-- Duty workflow and reassignment repair.
-- Run in Supabase SQL Editor after the existing UPSC Hub setup/upgrade scripts.
-- Safe to rerun.

alter table public.duties
  add column if not exists duty_status text not null default 'assigned',
  add column if not exists status_note text,
  add column if not exists status_updated_at timestamptz not null default now(),
  add column if not exists status_updated_by uuid references public.profiles(id);

alter table public.duties drop constraint if exists duties_duty_status_check;
alter table public.duties add constraint duties_duty_status_check
  check (duty_status in ('assigned','confirmed','in_progress','submitted','reviewed','change_requested','excused','missed'));

create table if not exists public.duty_change_log (
  id uuid primary key default gen_random_uuid(),
  duty_id uuid not null references public.duties(id) on delete cascade,
  action text not null,
  old_student_id uuid references public.profiles(id),
  new_student_id uuid references public.profiles(id),
  reason text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists duty_change_log_duty_idx on public.duty_change_log(duty_id,changed_at desc);
alter table public.duty_change_log enable row level security;
drop policy if exists duty_change_log_read on public.duty_change_log;
create policy duty_change_log_read on public.duty_change_log for select to authenticated
  using (public.is_active() and public.can_manage());
revoke all on public.duty_change_log from anon,authenticated;
grant select on public.duty_change_log to authenticated;

-- Replace the old two-argument RPC. The output field is also named duty_date,
-- so every table reference below is qualified to prevent PL/pgSQL ambiguity.
drop function if exists public.reassign_duty(date,uuid);
create or replace function public.reassign_duty(p_duty_date date,p_student_id uuid,p_reason text default null)
returns table(duty_id uuid,duty_date date,student_id uuid,full_name text,target_count integer,rotation_cycle integer)
language plpgsql security definer set search_path=public as $$
declare current_duty public.duties%rowtype; c integer; old_student uuid; clean_reason text;
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  clean_reason:=coalesce(nullif(trim(p_reason),''),'Manual reassignment by staff');

  select existing.* into current_duty
  from public.duties as existing
  where existing.duty_date=p_duty_date
  for update;
  if not found then raise exception 'No duty is assigned for this date'; end if;

  insert into public.duty_rotation_state(singleton,current_cycle)
  values(true,coalesce(current_duty.rotation_cycle,1)) on conflict(singleton) do nothing;
  perform 1 from public.duty_rotation_state as rotation where rotation.singleton=true for update;
  select rotation.current_cycle into c from public.duty_rotation_state as rotation where rotation.singleton=true;
  c:=coalesce(current_duty.rotation_cycle,c,1);
  old_student:=current_duty.student_id;

  if p_student_id=old_student then raise exception 'Choose a different student or keep the current assignment'; end if;
  if not exists(select 1 from public.profiles as member where member.id=p_student_id and member.active and member.role in ('student','student_leader')) then
    raise exception 'Choose an active student';
  end if;
  if exists(select 1 from public.duty_availability as availability
    where availability.profile_id=p_student_id and availability.availability_date=p_duty_date
      and availability.status in ('leave','unavailable')) then
    raise exception 'This student is unavailable for that date';
  end if;
  if exists(select 1 from public.duty_rotation_members as rotation_member
    where rotation_member.cycle_no=c and rotation_member.profile_id=p_student_id and rotation_member.assigned_on is not null) then
    raise exception 'This student already had a turn in the current rotation';
  end if;

  insert into public.duty_rotation_members(cycle_no,profile_id,position)
  select c,p_student_id,coalesce((select max(existing.position)+1 from public.duty_rotation_members as existing where existing.cycle_no=c),1)
  where not exists(select 1 from public.duty_rotation_members as existing where existing.cycle_no=c and existing.profile_id=p_student_id);

  update public.duty_rotation_members as rotation_member
    set assigned_on=null where rotation_member.cycle_no=c and rotation_member.profile_id=old_student;
  update public.duties as target
    set student_id=p_student_id,assigned_by=auth.uid(),duty_status='assigned',status_note=clean_reason,
        status_updated_at=now(),status_updated_by=auth.uid()
    where target.id=current_duty.id;
  update public.duty_rotation_members as rotation_member
    set assigned_on=p_duty_date where rotation_member.cycle_no=c and rotation_member.profile_id=p_student_id;
  insert into public.duty_change_log(duty_id,action,old_student_id,new_student_id,reason,changed_by)
    values(current_duty.id,'reassigned',old_student,p_student_id,clean_reason,auth.uid());

  return query select current_duty.id,current_duty.duty_date,member.id,member.full_name,current_duty.target_count,c
    from public.profiles as member where member.id=p_student_id;
end $$;

create or replace function public.update_duty_status(p_duty_id uuid,p_status text,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare current_duty public.duties%rowtype; clean_reason text; is_manager boolean;
begin
  if not public.is_active() then raise exception 'Active account required'; end if;
  if p_status is null or p_status not in ('assigned','confirmed','in_progress','submitted','reviewed','change_requested','excused','missed') then
    raise exception 'Choose a valid duty status';
  end if;
  select target.* into current_duty from public.duties as target where target.id=p_duty_id for update;
  if not found then raise exception 'Duty not found'; end if;
  is_manager:=public.can_manage();
  if not is_manager and current_duty.student_id<>auth.uid() then raise exception 'You can update only your own duty'; end if;
  if not is_manager and p_status not in ('confirmed','in_progress','submitted','change_requested') then
    raise exception 'Students can confirm, start, submit, or request a change';
  end if;
  clean_reason:=nullif(trim(p_reason),'');
  if p_status='change_requested' and clean_reason is null then raise exception 'Add a short reason for the urgent change request'; end if;
  if p_status='submitted' and not is_manager then
    if (select count(*) from public.questions as question
        where question.author_id=auth.uid()
          and question.created_at >= (current_duty.duty_date::timestamp at time zone 'Asia/Kolkata')
          and question.created_at < ((current_duty.duty_date+1)::timestamp at time zone 'Asia/Kolkata')) < current_duty.target_count then
      raise exception 'Upload the required questions before marking this duty submitted';
    end if;
  end if;
  update public.duties as target set duty_status=p_status,
    status_note=case when clean_reason is not null then clean_reason else null end,
    status_updated_at=now(),status_updated_by=auth.uid()
    where target.id=current_duty.id;
  insert into public.duty_change_log(duty_id,action,old_student_id,new_student_id,reason,changed_by)
    values(current_duty.id,'status:'||p_status,current_duty.student_id,current_duty.student_id,clean_reason,auth.uid());
end $$;

revoke all on function public.reassign_duty(date,uuid,text),public.update_duty_status(uuid,text,text) from public,anon;
grant execute on function public.reassign_duty(date,uuid,text),public.update_duty_status(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
-- Flexible assignment, editing, reassignment and deletion for duty managers.
-- Included at the end of fix_duty_status_and_reassignment.sql.

-- Keep deletion history after the duty row is removed.
alter table public.duty_change_log alter column duty_id drop not null;
alter table public.duty_change_log drop constraint if exists duty_change_log_duty_id_fkey;
alter table public.duty_change_log add constraint duty_change_log_duty_id_fkey
  foreign key (duty_id) references public.duties(id) on delete set null;

create or replace function public.assign_duty_manually(
  p_duty_date date,p_student_id uuid,p_target_count integer default 5
)
returns table(duty_id uuid,duty_date date,student_id uuid,full_name text,target_count integer,rotation_cycle integer)
language plpgsql security definer set search_path=public as $$
declare c integer; new_id uuid;
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  if p_duty_date is null or p_target_count not between 1 and 20 then raise exception 'Choose a valid date and question target'; end if;
  if exists(select 1 from public.duties as existing where existing.duty_date=p_duty_date) then raise exception 'A duty is already assigned for this date'; end if;
  if not exists(select 1 from public.profiles as member where member.id=p_student_id and member.active and member.role in ('student','student_leader')) then
    raise exception 'Choose an active student';
  end if;

  insert into public.duty_rotation_state(singleton,current_cycle) values(true,1) on conflict(singleton) do nothing;
  perform 1 from public.duty_rotation_state as rotation where rotation.singleton=true for update;
  select rotation.current_cycle into c from public.duty_rotation_state as rotation where rotation.singleton=true;
  c:=coalesce(c,1);
  if not exists(select 1 from public.duty_rotation_members as member where member.cycle_no=c) then
    insert into public.duty_rotation_members(cycle_no,profile_id,position)
      select c,p.id,row_number() over(order by random())::integer from public.profiles as p
      where p.active and p.role in ('student','student_leader');
  end if;
  insert into public.duty_rotation_members(cycle_no,profile_id,position)
    select c,p_student_id,coalesce((select max(member.position)+1 from public.duty_rotation_members as member where member.cycle_no=c),1)
    where not exists(select 1 from public.duty_rotation_members as member where member.cycle_no=c and member.profile_id=p_student_id);
  if exists(select 1 from public.duty_rotation_members as member where member.cycle_no=c and member.profile_id=p_student_id and member.assigned_on is not null) then
    raise exception 'This student already had a turn in the current rotation';
  end if;

  insert into public.duties(duty_date,student_id,target_count,assigned_by,rotation_cycle,duty_status,status_updated_by)
    values(p_duty_date,p_student_id,p_target_count,auth.uid(),c,'assigned',auth.uid()) returning id into new_id;
  update public.duty_rotation_members as member set assigned_on=p_duty_date where member.cycle_no=c and member.profile_id=p_student_id;
  insert into public.duty_change_log(duty_id,action,new_student_id,reason,changed_by)
    values(new_id,'manually_assigned',p_student_id,'Manually assigned by staff',auth.uid());
  return query select new_id,p_duty_date,p.id,p.full_name,p_target_count,c from public.profiles as p where p.id=p_student_id;
end $$;

create or replace function public.save_duty(
  p_duty_id uuid,p_duty_date date,p_student_id uuid,p_target_count integer,p_reason text default null
)
returns table(duty_id uuid,duty_date date,student_id uuid,full_name text,target_count integer,rotation_cycle integer)
language plpgsql security definer set search_path=public as $$
declare existing public.duties%rowtype; c integer; clean_reason text; changed_student boolean;
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  if p_duty_date is null or p_target_count not between 1 and 20 then raise exception 'Choose a valid date and question target'; end if;
  select target.* into existing from public.duties as target where target.id=p_duty_id for update;
  if not found then raise exception 'Duty not found'; end if;
  if exists(select 1 from public.duties as conflict where conflict.duty_date=p_duty_date and conflict.id<>existing.id) then
    raise exception 'Another duty already exists for this date';
  end if;
  if not exists(select 1 from public.profiles as member where member.id=p_student_id and member.active and member.role in ('student','student_leader')) then
    raise exception 'Choose an active student';
  end if;

  insert into public.duty_rotation_state(singleton,current_cycle) values(true,coalesce(existing.rotation_cycle,1)) on conflict(singleton) do nothing;
  perform 1 from public.duty_rotation_state as rotation where rotation.singleton=true for update;
  select rotation.current_cycle into c from public.duty_rotation_state as rotation where rotation.singleton=true;
  c:=coalesce(existing.rotation_cycle,c,1);
  changed_student:=p_student_id<>existing.student_id;
  insert into public.duty_rotation_members(cycle_no,profile_id,position)
    select c,p_student_id,coalesce((select max(member.position)+1 from public.duty_rotation_members as member where member.cycle_no=c),1)
    where not exists(select 1 from public.duty_rotation_members as member where member.cycle_no=c and member.profile_id=p_student_id);
  if changed_student and exists(select 1 from public.duty_rotation_members as member where member.cycle_no=c and member.profile_id=p_student_id and member.assigned_on is not null) then
    raise exception 'This student already had a turn in the current rotation';
  end if;

  if changed_student then
    update public.duty_rotation_members as member set assigned_on=null where member.cycle_no=c and member.profile_id=existing.student_id;
  end if;
  update public.duty_rotation_members as member set assigned_on=p_duty_date where member.cycle_no=c and member.profile_id=p_student_id;
  clean_reason:=nullif(trim(p_reason),'');
  update public.duties as target set duty_date=p_duty_date,student_id=p_student_id,target_count=p_target_count,assigned_by=auth.uid(),
    duty_status=case when changed_student then 'assigned' else target.duty_status end,
    status_note=coalesce(clean_reason,target.status_note),status_updated_at=case when changed_student then now() else target.status_updated_at end,
    status_updated_by=case when changed_student then auth.uid() else target.status_updated_by end
    where target.id=existing.id;
  insert into public.duty_change_log(duty_id,action,old_student_id,new_student_id,reason,changed_by)
    values(existing.id,case when changed_student then 'reassigned' else 'edited' end,existing.student_id,p_student_id,clean_reason,auth.uid());
  return query select existing.id,p_duty_date,p.id,p.full_name,p_target_count,c from public.profiles as p where p.id=p_student_id;
end $$;

create or replace function public.delete_duty(p_duty_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare existing public.duties%rowtype; c integer;
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  select target.* into existing from public.duties as target where target.id=p_duty_id for update;
  if not found then raise exception 'Duty not found'; end if;
  c:=existing.rotation_cycle;
  update public.duty_rotation_members as member set assigned_on=null
    where member.cycle_no=c and member.profile_id=existing.student_id and member.assigned_on=existing.duty_date;
  insert into public.duty_change_log(duty_id,action,old_student_id,reason,changed_by)
    values(existing.id,'deleted',existing.student_id,coalesce(nullif(trim(p_reason),''),'Deleted by staff'),auth.uid());
  delete from public.duties as target where target.id=existing.id;
end $$;

revoke all on function public.assign_duty_manually(date,uuid,integer),public.save_duty(uuid,date,uuid,integer,text),public.delete_duty(uuid,text) from public,anon;
grant execute on function public.assign_duty_manually(date,uuid,integer),public.save_duty(uuid,date,uuid,integer,text),public.delete_duty(uuid,text) to authenticated;
notify pgrst,'reload schema';
