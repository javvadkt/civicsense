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
