-- Duty tracking rebuild + swap duties + bulk assign.
-- Run ONCE in the Supabase SQL Editor. Safe to run again.
-- This REPLACES update_duty_status and get_duty_progress from fix_duty_review_rules.sql.
--
-- What it does
--  1. Questions now count for a duty through an explicit link (duty_questions), not through the upload date.
--     A student's new questions are linked automatically to their nearest duty that still needs questions.
--  2. Duty status follows the real work: first question -> In progress, all questions in -> Submitted,
--     all approved -> Reviewed. Manual states (excused, missed, change requested) are never overwritten.
--  3. swap_duties: two students trade days.
--  4. bulk_assign_duties: assign many days at once (used by the Bulk assign screen).

------------------------------------------------------------------------------
-- 1. Link table
------------------------------------------------------------------------------
create table if not exists public.duty_questions (
  question_id uuid primary key references public.questions(id) on delete cascade,
  duty_id uuid not null references public.duties(id) on delete cascade,
  linked_at timestamptz not null default now(),
  linked_by uuid references public.profiles(id) on delete set null
);
create index if not exists duty_questions_duty_idx on public.duty_questions(duty_id);
alter table public.duty_questions enable row level security;
revoke all on public.duty_questions from public,anon,authenticated;

-- Backfill: existing questions written on a duty's date count for that duty (up to its target).
insert into public.duty_questions(question_id,duty_id,linked_by)
select x.qid,x.did,x.author
from (
  select q.id as qid,d.id as did,q.author_id as author,d.target_count as tc,
         row_number() over(partition by d.id order by q.created_at) as rn
  from public.duties d
  join public.questions q on q.author_id=d.student_id
   and q.created_at >= (d.duty_date::timestamp at time zone 'Asia/Kolkata')
   and q.created_at <  ((d.duty_date+1)::timestamp at time zone 'Asia/Kolkata')
) x
where x.rn<=x.tc
on conflict do nothing;

------------------------------------------------------------------------------
-- 2. Automatic status
------------------------------------------------------------------------------
create or replace function public.refresh_duty_status(p_duty_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  cur_duty public.duties%rowtype; uploaded integer; approved integer; need integer; cur integer; nxt text;
  names constant text[]:=array['assigned','confirmed','in_progress','submitted','reviewed'];
begin
  select t.* into cur_duty from public.duties as t where t.id=p_duty_id for update;
  if not found then return; end if;
  cur:=array_position(names,cur_duty.duty_status);
  if cur is null then return; end if;   -- excused / missed / change_requested stay as set by a person

  select count(*),count(*) filter(where q.status='approved') into uploaded,approved
  from public.duty_questions as dq join public.questions as q on q.id=dq.question_id
  where dq.duty_id=cur_duty.id and q.author_id=cur_duty.student_id;

  need:=case when approved>=cur_duty.target_count then 5
             when uploaded>=cur_duty.target_count then 4
             when uploaded>=1 then 3 else 1 end;

  if need>cur then
    nxt:=names[need];
  elsif cur>=4 and uploaded<cur_duty.target_count then
    nxt:=case when uploaded>=1 then 'in_progress' else 'confirmed' end;      -- questions were removed
  elsif cur=5 and cur_duty.status_updated_by is null and need<5 then
    nxt:=names[greatest(need,2)];                                              -- an approval was withdrawn
  else
    return;
  end if;

  if nxt is distinct from cur_duty.duty_status then
    update public.duties as t set duty_status=nxt,status_note=null,status_updated_at=now(),status_updated_by=null where t.id=cur_duty.id;
    insert into public.duty_change_log(duty_id,action,old_student_id,new_student_id,reason,changed_by)
      values(cur_duty.id,'status:'||nxt,cur_duty.student_id,cur_duty.student_id,'Automatic, based on the questions added and approved',null);
  end if;
end $$;

-- A new question from a student joins their nearest duty that still needs questions
-- (today, upcoming, or up to 2 days overdue). Change requested / excused / missed duties are skipped.
create or replace function public.trg_attach_question_to_duty()
returns trigger language plpgsql security definer set search_path=public as $$
declare today_ist date:=(now() at time zone 'Asia/Kolkata')::date; target_duty uuid;
begin
  if not exists(select 1 from public.profiles as p where p.id=new.author_id and p.role in ('student','student_leader')) then return null; end if;
  select d.id into target_duty from public.duties as d
  where d.student_id=new.author_id
    and d.duty_status not in ('excused','missed','change_requested')
    and d.duty_date>=today_ist-2
    and (select count(*) from public.duty_questions as dq join public.questions as q on q.id=dq.question_id
         where dq.duty_id=d.id and q.author_id=d.student_id) < d.target_count
  order by d.duty_date limit 1;
  if target_duty is not null then
    insert into public.duty_questions(question_id,duty_id,linked_by) values(new.id,target_duty,new.author_id) on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists zz_questions_attach_duty on public.questions;
create trigger zz_questions_attach_duty after insert on public.questions
  for each row execute function public.trg_attach_question_to_duty();

create or replace function public.trg_duty_questions_refresh()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then perform public.refresh_duty_status(old.duty_id);
  else perform public.refresh_duty_status(new.duty_id); end if;
  return null;
end $$;
drop trigger if exists duty_questions_refresh on public.duty_questions;
create trigger duty_questions_refresh after insert or delete on public.duty_questions
  for each row execute function public.trg_duty_questions_refresh();

create or replace function public.trg_question_status_refresh()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.refresh_duty_status(dq.duty_id) from public.duty_questions as dq where dq.question_id=new.id;
  return null;
end $$;
drop trigger if exists zz_questions_status_refresh on public.questions;
create trigger zz_questions_status_refresh after update of status on public.questions
  for each row when (old.status is distinct from new.status)
  execute function public.trg_question_status_refresh();

-- If a duty is given to another student, the previous student's questions stop counting for it.
create or replace function public.trg_duty_student_changed()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  delete from public.duty_questions as dq using public.questions as q
  where dq.duty_id=new.id and q.id=dq.question_id and q.author_id<>new.student_id;
  return null;
end $$;
drop trigger if exists duties_student_changed on public.duties;
create trigger duties_student_changed after update of student_id on public.duties
  for each row when (old.student_id is distinct from new.student_id)
  execute function public.trg_duty_student_changed();

------------------------------------------------------------------------------
-- 3. Progress and manual status now use the link
------------------------------------------------------------------------------
create or replace function public.get_duty_progress(p_duty_date date default current_date)
returns table(duty_id uuid,duty_date date,student_id uuid,full_name text,target_count integer,
  submitted_count bigint,approved_count bigint,pending_count bigint,revision_requested_count bigint)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_active() then raise exception 'Not permitted'; end if;
  return query
  select d.id,d.duty_date,d.student_id,p.full_name,d.target_count,
    count(q.id),count(q.id) filter(where q.status='approved'),
    count(q.id) filter(where q.status='pending'),count(q.id) filter(where q.status='revision_requested')
  from public.duties d join public.profiles p on p.id=d.student_id
  left join public.duty_questions dq on dq.duty_id=d.id
  left join public.questions q on q.id=dq.question_id and q.author_id=d.student_id
  where d.duty_date=p_duty_date and (public.can_manage() or d.student_id=auth.uid())
  group by d.id,d.duty_date,d.student_id,p.full_name,d.target_count;
end $$;

create or replace function public.update_duty_status(p_duty_id uuid,p_status text,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare current_duty public.duties%rowtype; clean_reason text; is_reviewer boolean; uploaded integer;
begin
  if not public.is_active() then raise exception 'Active account required'; end if;
  if p_status is null or p_status not in ('assigned','confirmed','in_progress','submitted','reviewed','change_requested','excused','missed') then
    raise exception 'Choose a valid duty status';
  end if;
  select target.* into current_duty from public.duties as target where target.id=p_duty_id for update;
  if not found then raise exception 'Duty not found'; end if;

  is_reviewer:=public.can_review();
  if not is_reviewer then
    if current_duty.student_id<>auth.uid() then
      raise exception 'Only a teacher or super admin can change another student''s duty status';
    end if;
    if p_status not in ('confirmed','in_progress','submitted','change_requested') then
      raise exception 'Students can confirm, start, submit, or request a change';
    end if;
  end if;

  clean_reason:=nullif(trim(p_reason),'');
  if p_status='change_requested' and clean_reason is null then
    raise exception 'Add a short reason for the urgent change request';
  end if;

  if p_status in ('submitted','reviewed') then
    select count(*) into uploaded from public.duty_questions as dq join public.questions as q on q.id=dq.question_id
      where dq.duty_id=current_duty.id and q.author_id=current_duty.student_id;
    if uploaded < current_duty.target_count then
      raise exception 'Only % of % questions are added to this duty',uploaded,current_duty.target_count;
    end if;
  end if;

  update public.duties as target set duty_status=p_status,
    status_note=case when clean_reason is not null then clean_reason else null end,
    status_updated_at=now(),status_updated_by=auth.uid()
    where target.id=current_duty.id;
  insert into public.duty_change_log(duty_id,action,old_student_id,new_student_id,reason,changed_by)
    values(current_duty.id,'status:'||p_status,current_duty.student_id,current_duty.student_id,clean_reason,auth.uid());
end $$;

------------------------------------------------------------------------------
-- 4. Reading and editing the links
------------------------------------------------------------------------------
create or replace function public.get_duty_questions(p_duty_id uuid)
returns table(question_id uuid,stem text,topic text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare owner_id uuid;
begin
  select d.student_id into owner_id from public.duties as d where d.id=p_duty_id;
  if owner_id is null then raise exception 'Duty not found'; end if;
  if not (public.can_manage() or owner_id=auth.uid()) then raise exception 'Not permitted'; end if;
  return query
  select q.id,q.stem,q.topic,q.status::text,q.created_at
  from public.duty_questions as dq join public.questions as q on q.id=dq.question_id
  where dq.duty_id=p_duty_id and q.author_id=owner_id
  order by q.created_at;
end $$;

create or replace function public.get_my_unlinked_questions()
returns table(question_id uuid,stem text,topic text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_active() then raise exception 'Not permitted'; end if;
  return query
  select q.id,q.stem,q.topic,q.status::text,q.created_at
  from public.questions as q
  where q.author_id=auth.uid() and not exists(select 1 from public.duty_questions as dq where dq.question_id=q.id)
  order by q.created_at desc limit 40;
end $$;

create or replace function public.attach_questions_to_duty(p_duty_id uuid,p_question_ids uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare cur_duty public.duties%rowtype; have integer; want integer; ok integer;
begin
  select t.* into cur_duty from public.duties as t where t.id=p_duty_id for update;
  if not found then raise exception 'Duty not found'; end if;
  if not (public.can_manage() or cur_duty.student_id=auth.uid()) then raise exception 'Not permitted'; end if;
  if cur_duty.duty_status in ('excused','missed') then raise exception 'This duty is closed'; end if;
  want:=coalesce(array_length(p_question_ids,1),0);
  if want=0 then raise exception 'Choose at least one question'; end if;
  select count(*) into have from public.duty_questions as dq join public.questions as q on q.id=dq.question_id
    where dq.duty_id=cur_duty.id and q.author_id=cur_duty.student_id;
  if have+want>cur_duty.target_count then
    raise exception 'This duty needs only % more question(s)',greatest(cur_duty.target_count-have,0);
  end if;
  select count(*) into ok from public.questions as q
    where q.id=any(p_question_ids) and q.author_id=cur_duty.student_id
      and not exists(select 1 from public.duty_questions as x where x.question_id=q.id);
  if ok<>want then raise exception 'Some questions are not yours or already count for another duty'; end if;
  insert into public.duty_questions(question_id,duty_id,linked_by)
    select q.id,cur_duty.id,auth.uid() from public.questions as q where q.id=any(p_question_ids);
  return want;
end $$;

create or replace function public.detach_question_from_duty(p_question_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare cur_duty public.duties%rowtype;
begin
  select t.* into cur_duty from public.duties as t join public.duty_questions as dq on dq.duty_id=t.id where dq.question_id=p_question_id;
  if not found then raise exception 'That question is not linked to a duty'; end if;
  if not (public.can_manage() or cur_duty.student_id=auth.uid()) then raise exception 'Not permitted'; end if;
  if cur_duty.duty_status='reviewed' and not public.can_manage() then raise exception 'This duty is already reviewed'; end if;
  delete from public.duty_questions where question_id=p_question_id;
end $$;

------------------------------------------------------------------------------
-- 5. Swap two upcoming duties (the two students trade days)
------------------------------------------------------------------------------
create or replace function public.swap_duties(p_duty_a uuid,p_duty_b uuid,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare
  dut_a public.duties%rowtype; dut_b public.duties%rowtype; clean_reason text; name_a text; name_b text;
  today_ist date:=(now() at time zone 'Asia/Kolkata')::date;
  parked constant date:=date '0001-01-01';
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  if p_duty_a is null or p_duty_b is null or p_duty_a=p_duty_b then raise exception 'Choose two different duties'; end if;
  perform 1 from public.duties as locked where locked.id in (p_duty_a,p_duty_b) order by locked.id for update;
  select t.* into dut_a from public.duties as t where t.id=p_duty_a;
  if not found then raise exception 'Duty not found'; end if;
  select t.* into dut_b from public.duties as t where t.id=p_duty_b;
  if not found then raise exception 'Duty not found'; end if;
  if dut_a.student_id=dut_b.student_id then raise exception 'Both duties belong to the same student'; end if;
  if dut_a.duty_date<today_ist or dut_b.duty_date<today_ist then raise exception 'Only today''s and upcoming duties can be swapped'; end if;
  if dut_a.duty_status in ('submitted','reviewed','excused','missed') or dut_b.duty_status in ('submitted','reviewed','excused','missed') then
    raise exception 'A duty that is already submitted, reviewed, excused or missed cannot be swapped';
  end if;
  select f.full_name into name_a from public.profiles as f where f.id=dut_a.student_id;
  select f.full_name into name_b from public.profiles as f where f.id=dut_b.student_id;
  if exists(select 1 from public.duty_availability as av where av.profile_id=dut_a.student_id and av.availability_date=dut_b.duty_date and av.status in ('leave','unavailable')) then
    raise exception '% is marked unavailable on %',name_a,dut_b.duty_date;
  end if;
  if exists(select 1 from public.duty_availability as av where av.profile_id=dut_b.student_id and av.availability_date=dut_a.duty_date and av.status in ('leave','unavailable')) then
    raise exception '% is marked unavailable on %',name_b,dut_a.duty_date;
  end if;

  clean_reason:=coalesce(nullif(trim(p_reason),''),'Swapped by staff');
  -- duty_date is unique, so park one duty while the dates trade places
  update public.duties as t set duty_date=parked where t.id=dut_a.id;
  update public.duties as t set duty_date=dut_a.duty_date,duty_status='assigned',status_note=clean_reason,
    status_updated_at=now(),status_updated_by=auth.uid(),assigned_by=auth.uid() where t.id=dut_b.id;
  update public.duties as t set duty_date=dut_b.duty_date,duty_status='assigned',status_note=clean_reason,
    status_updated_at=now(),status_updated_by=auth.uid(),assigned_by=auth.uid() where t.id=dut_a.id;

  update public.duty_rotation_members as m set assigned_on=dut_b.duty_date where m.cycle_no=dut_a.rotation_cycle and m.profile_id=dut_a.student_id;
  update public.duty_rotation_members as m set assigned_on=dut_a.duty_date where m.cycle_no=dut_b.rotation_cycle and m.profile_id=dut_b.student_id;

  insert into public.duty_change_log(duty_id,action,old_student_id,new_student_id,reason,changed_by)
    values(dut_a.id,'swapped',dut_a.student_id,dut_b.student_id,clean_reason,auth.uid()),
          (dut_b.id,'swapped',dut_b.student_id,dut_a.student_id,clean_reason,auth.uid());
end $$;

------------------------------------------------------------------------------
-- 6. Assign many days at once
------------------------------------------------------------------------------
create or replace function public.bulk_assign_duties(p_dates date[],p_student_ids uuid[],p_target_count integer default 5)
returns integer language plpgsql security definer set search_path=public as $$
declare
  c integer; n integer; i integer; v_date date; v_student uuid; sname text; new_id uuid;
  today_ist date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  n:=coalesce(array_length(p_dates,1),0);
  if n=0 or n<>coalesce(array_length(p_student_ids,1),0) then raise exception 'Provide the same number of dates and students'; end if;
  if n>100 then raise exception 'Assign at most 100 duties at once'; end if;
  if p_target_count is null or p_target_count not between 1 and 20 then raise exception 'Choose a question target between 1 and 20'; end if;
  if (select count(distinct x) from unnest(p_dates) as x)<>n then raise exception 'Each date can be used only once'; end if;
  if (select count(distinct x) from unnest(p_student_ids) as x)<>n then raise exception 'Each student can be assigned only once'; end if;

  insert into public.duty_rotation_state(singleton,current_cycle) values(true,1) on conflict(singleton) do nothing;
  perform 1 from public.duty_rotation_state as rs where rs.singleton=true for update;
  select rs.current_cycle into c from public.duty_rotation_state as rs where rs.singleton=true;
  c:=coalesce(c,1);
  if not exists(select 1 from public.duty_rotation_members as m where m.cycle_no=c) then
    insert into public.duty_rotation_members(cycle_no,profile_id,position)
      select c,p.id,row_number() over(order by random())::integer from public.profiles as p
      where p.active and p.role in ('student','student_leader');
  end if;
  -- everyone already had a turn: this batch starts the next rotation
  if not exists(select 1 from public.duty_rotation_members as m join public.profiles as p on p.id=m.profile_id
      where m.cycle_no=c and m.assigned_on is null and p.active and p.role in ('student','student_leader')) then
    update public.duty_rotation_state set current_cycle=current_cycle+1 where singleton=true returning current_cycle into c;
    insert into public.duty_rotation_members(cycle_no,profile_id,position)
      select c,p.id,row_number() over(order by random())::integer from public.profiles as p
      where p.active and p.role in ('student','student_leader');
  end if;

  for i in 1..n loop
    v_date:=p_dates[i]; v_student:=p_student_ids[i]; sname:=null;
    if v_date<today_ist then raise exception 'Cannot assign a duty in the past (%)',v_date; end if;
    if exists(select 1 from public.duties as x where x.duty_date=v_date) then raise exception 'A duty is already assigned for %',v_date; end if;
    select p.full_name into sname from public.profiles as p where p.id=v_student and p.active and p.role in ('student','student_leader');
    if sname is null then raise exception 'Choose only active students'; end if;
    if exists(select 1 from public.duty_availability as av where av.profile_id=v_student and av.availability_date=v_date and av.status in ('leave','unavailable')) then
      raise exception '% is unavailable on %',sname,v_date;
    end if;
    insert into public.duty_rotation_members(cycle_no,profile_id,position)
      select c,v_student,coalesce((select max(m.position)+1 from public.duty_rotation_members as m where m.cycle_no=c),1)
      where not exists(select 1 from public.duty_rotation_members as m where m.cycle_no=c and m.profile_id=v_student);
    if exists(select 1 from public.duty_rotation_members as m where m.cycle_no=c and m.profile_id=v_student and m.assigned_on is not null) then
      raise exception '% already had a turn in this rotation',sname;
    end if;
    insert into public.duties(duty_date,student_id,target_count,assigned_by,rotation_cycle,duty_status,status_updated_by)
      values(v_date,v_student,p_target_count,auth.uid(),c,'assigned',auth.uid()) returning id into new_id;
    update public.duty_rotation_members as m set assigned_on=v_date where m.cycle_no=c and m.profile_id=v_student;
    insert into public.duty_change_log(duty_id,action,new_student_id,reason,changed_by)
      values(new_id,'bulk_assigned',v_student,'Assigned in bulk by staff',auth.uid());
  end loop;
  return n;
end $$;

------------------------------------------------------------------------------
-- 7. Permissions and refresh
------------------------------------------------------------------------------
revoke all on function
  public.refresh_duty_status(uuid),public.get_duty_progress(date),public.update_duty_status(uuid,text,text),
  public.get_duty_questions(uuid),public.get_my_unlinked_questions(),public.attach_questions_to_duty(uuid,uuid[]),
  public.detach_question_from_duty(uuid),public.swap_duties(uuid,uuid,text),public.bulk_assign_duties(date[],uuid[],integer)
from public,anon,authenticated;
grant execute on function
  public.get_duty_progress(date),public.update_duty_status(uuid,text,text),
  public.get_duty_questions(uuid),public.get_my_unlinked_questions(),public.attach_questions_to_duty(uuid,uuid[]),
  public.detach_question_from_duty(uuid),public.swap_duties(uuid,uuid,text),public.bulk_assign_duties(date[],uuid[],integer)
to authenticated;

-- Bring every existing duty in line with its linked questions once.
select public.refresh_duty_status(id) from public.duties;

notify pgrst,'reload schema';
