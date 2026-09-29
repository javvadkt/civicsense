-- UPSC Hub feature upgrade. Safe to run repeatedly after:
-- upgrade_member_signup_and_duty_rotation.sql and add_student_enrollment_number.sql
-- Never rerun setup.sql on an existing project.

-- Questions: optional source/explanation, arbitrary text sources, staff special tag.
alter table public.questions alter column explanation drop not null;
alter table public.questions alter column source_url drop not null;
alter table public.questions drop constraint if exists questions_source_url_check;
alter table public.questions drop constraint if exists questions_explanation_check;
alter table public.questions add column if not exists is_special boolean not null default false;

drop policy if exists questions_author_edit on public.questions;
create policy questions_author_edit on public.questions for update to authenticated
  using (public.is_active() and author_id=auth.uid() and status in ('pending','revision_requested'))
  with check (author_id=auth.uid() and status='pending' and reviewed_by is null and reviewed_at is null);
drop policy if exists questions_review_delete on public.questions;
create policy questions_review_delete on public.questions for delete to authenticated using (public.can_review());
grant delete on public.questions to authenticated;
grant insert(is_special) on public.questions to authenticated;
grant update(is_special) on public.questions to authenticated;

-- Keep answer keys and explanations out of normal browser reads. Review and
-- editing use narrowly authorized functions; submitted quiz review uses the
-- result function below.
revoke select on public.questions from authenticated;
grant select(id,author_id,stem,topic,options,source_url,status,created_at,is_special) on public.questions to authenticated;
revoke select on public.quiz_attempts from authenticated;
grant select(quiz_id,student_id,submitted_at) on public.quiz_attempts to authenticated;

-- Deleting a question from the bank also removes its quiz links.
alter table public.quiz_questions drop constraint if exists quiz_questions_question_id_fkey;
alter table public.quiz_questions add constraint quiz_questions_question_id_fkey
  foreign key(question_id) references public.questions(id) on delete cascade;

create or replace function public.get_review_questions()
returns table(id uuid,stem text,topic text,options jsonb,correct_index integer,explanation text,source_url text,
  status public.question_status,author_id uuid,created_at timestamptz,is_special boolean,author_full_name text,author_enrollment text)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_review() then raise exception 'Not permitted'; end if;
  return query select q.id,q.stem,q.topic,q.options,q.correct_index,q.explanation,q.source_url,q.status,q.author_id,
    q.created_at,q.is_special,p.full_name,p.enrollment_number
  from public.questions q join public.profiles p on p.id=q.author_id order by q.created_at desc limit 400;
end $$;

create or replace function public.get_question_editor(p_question_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.is_active() then raise exception 'Not permitted'; end if;
  select jsonb_build_object('id',q.id,'stem',q.stem,'topic',q.topic,'options',q.options,
    'correct_index',q.correct_index,'explanation',q.explanation,'source_url',q.source_url,
    'status',q.status,'author_id',q.author_id,'created_at',q.created_at,'is_special',q.is_special)
  into result from public.questions q
  where q.id=p_question_id and (public.can_review() or q.author_id=auth.uid());
  if result is null then raise exception 'Question is not available for editing'; end if;
  return result;
end $$;

create or replace function public.question_defaults()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    new.author_id:=auth.uid();
    new.status:='pending';
    new.reviewed_by:=null;
    new.reviewed_at:=null;
    if not public.can_review() then new.is_special:=false; end if;
  elsif public.can_review() then
    if old.author_id is distinct from new.author_id then new.author_id:=old.author_id; end if;
    if old.status is distinct from new.status then
      new.reviewed_by:=auth.uid();
      new.reviewed_at:=now();
    else
      new.reviewed_by:=old.reviewed_by;
      new.reviewed_at:=old.reviewed_at;
    end if;
  else
    new.author_id:=old.author_id;
    new.status:='pending';
    new.reviewed_by:=null;
    new.reviewed_at:=null;
    new.is_special:=old.is_special;
  end if;
  return new;
end $$;

-- Duty availability. A member may set available, leave or unavailable for a date.
create table if not exists public.duty_availability (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  availability_date date not null,
  status text not null check(status in ('available','leave','unavailable')),
  note text,
  updated_at timestamptz not null default now(),
  primary key(profile_id,availability_date)
);
alter table public.duty_availability enable row level security;
drop policy if exists duty_availability_read on public.duty_availability;
create policy duty_availability_read on public.duty_availability for select to authenticated
  using(public.is_active() and (profile_id=auth.uid() or public.can_manage()));
drop policy if exists duty_availability_insert on public.duty_availability;
create policy duty_availability_insert on public.duty_availability for insert to authenticated
  with check(public.is_active() and profile_id=auth.uid() and public.current_role() in ('student','student_leader'));
drop policy if exists duty_availability_update on public.duty_availability;
create policy duty_availability_update on public.duty_availability for update to authenticated
  using(public.is_active() and (profile_id=auth.uid() or public.can_manage()))
  with check(public.is_active() and (profile_id=auth.uid() or public.can_manage()));
grant select,insert,update on public.duty_availability to authenticated;

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
      select c,p.id,row_number() over(order by random())::integer from public.profiles p
      where p.active and p.role in ('student','student_leader');
  end if;
  if not exists(select 1 from public.duty_rotation_members rm join public.profiles p on p.id=rm.profile_id
      where rm.cycle_no=c and rm.assigned_on is null and p.active and p.role in ('student','student_leader')
      and not exists(select 1 from public.duty_availability a where a.profile_id=rm.profile_id and a.availability_date=p_duty_date and a.status in ('leave','unavailable'))) then
    if exists(select 1 from public.duty_rotation_members rm join public.profiles p on p.id=rm.profile_id
        where rm.cycle_no=c and rm.assigned_on is null and p.active and p.role in ('student','student_leader')) then
      raise exception 'All remaining students are marked on leave or unavailable for this date';
    end if;
    update public.duty_rotation_state set current_cycle=current_cycle+1 where singleton=true returning current_cycle into c;
    insert into public.duty_rotation_members(cycle_no,profile_id,position)
      select c,p.id,row_number() over(order by random())::integer from public.profiles p
      where p.active and p.role in ('student','student_leader');
  end if;
  insert into public.duty_rotation_members(cycle_no,profile_id,position)
    select c,p.id,coalesce((select max(position) from public.duty_rotation_members where cycle_no=c),0)+1
    from public.profiles p where p.active and p.role in ('student','student_leader')
      and not exists(select 1 from public.duty_rotation_members rm where rm.cycle_no=c and rm.profile_id=p.id);
  select rm.profile_id into chosen from public.duty_rotation_members rm
    join public.profiles p on p.id=rm.profile_id and p.active and p.role in ('student','student_leader')
    where rm.cycle_no=c and rm.assigned_on is null
      and not exists(select 1 from public.duty_availability a where a.profile_id=rm.profile_id and a.availability_date=p_duty_date and a.status in ('leave','unavailable'))
    order by rm.position limit 1;
  if chosen is null then raise exception 'No available students are eligible for duty on this date'; end if;
  insert into public.duties(duty_date,student_id,target_count,assigned_by,rotation_cycle)
    values(p_duty_date,chosen,p_target_count,auth.uid(),c) returning id into new_id;
  update public.duty_rotation_members set assigned_on=p_duty_date where cycle_no=c and profile_id=chosen;
  return query select new_id,p_duty_date,chosen,p.full_name,p_target_count,c from public.profiles p where p.id=chosen;
end $$;

create or replace function public.reassign_duty(p_duty_date date,p_student_id uuid)
returns table(duty_id uuid,duty_date date,student_id uuid,full_name text,target_count integer,rotation_cycle integer)
language plpgsql security definer set search_path=public as $$
declare d public.duties%rowtype; c integer; old_student uuid;
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  select * into d from public.duties where duty_date=p_duty_date for update;
  if not found then raise exception 'No duty is assigned for this date'; end if;
  perform 1 from public.duty_rotation_state where singleton=true for update;
  select coalesce(d.rotation_cycle,current_cycle) into c from public.duty_rotation_state where singleton=true;
  old_student:=d.student_id;
  if not exists(select 1 from public.profiles p where p.id=p_student_id and p.active and p.role in ('student','student_leader')) then raise exception 'Choose an active student'; end if;
  if exists(select 1 from public.duty_availability a where a.profile_id=p_student_id and a.availability_date=p_duty_date and a.status in ('leave','unavailable')) then raise exception 'This student is marked unavailable for the date'; end if;
  if p_student_id<>old_student and exists(select 1 from public.duty_rotation_members rm where rm.cycle_no=c and rm.profile_id=p_student_id and rm.assigned_on is not null) then raise exception 'This student already had a turn in the current rotation'; end if;
  insert into public.duty_rotation_members(cycle_no,profile_id,position)
    select c,p_student_id,coalesce((select max(position) from public.duty_rotation_members where cycle_no=c),0)+1
    where not exists(select 1 from public.duty_rotation_members where cycle_no=c and profile_id=p_student_id);
  update public.duty_rotation_members set assigned_on=null where cycle_no=c and profile_id=old_student;
  update public.duties set student_id=p_student_id,assigned_by=auth.uid() where id=d.id;
  update public.duty_rotation_members set assigned_on=p_duty_date where cycle_no=c and profile_id=p_student_id;
  return query select d.id,p_duty_date,p.id,p.full_name,d.target_count,c from public.profiles p where p.id=p_student_id;
end $$;

create or replace function public.get_duty_availability(p_duty_date date)
returns table(profile_id uuid,full_name text,role public.app_role,status text,note text,already_assigned boolean)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_manage() then raise exception 'Not permitted'; end if;
  return query select p.id,p.full_name,p.role,coalesce(a.status,'available'),a.note,
    exists(select 1 from public.duty_rotation_members rm join public.duty_rotation_state rs on rs.singleton and rm.cycle_no=rs.current_cycle where rm.profile_id=p.id and rm.assigned_on is not null)
  from public.profiles p left join public.duty_availability a on a.profile_id=p.id and a.availability_date=p_duty_date
  where p.active and p.role in ('student','student_leader') order by p.full_name;
end $$;

-- Quiz result release and management tagging.
alter table public.quizzes add column if not exists result_visibility text not null default 'immediate';
alter table public.quizzes add column if not exists results_published boolean not null default false;
alter table public.quizzes drop constraint if exists quizzes_result_visibility_check;
alter table public.quizzes add constraint quizzes_result_visibility_check check(result_visibility in ('immediate','after_release'));

-- Persist a single start time so refreshing the browser cannot reset the timer.
create table if not exists public.quiz_attempt_starts (
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key(quiz_id,student_id)
);
alter table public.quiz_attempt_starts enable row level security;
revoke all on public.quiz_attempt_starts from public,anon,authenticated;
grant select(quiz_id,student_id) on public.quiz_attempt_starts to authenticated;
drop policy if exists quiz_attempt_starts_read on public.quiz_attempt_starts;
create policy quiz_attempt_starts_read on public.quiz_attempt_starts for select to authenticated
  using(public.is_active() and student_id=auth.uid());

-- Approved questions stay hidden from other students until they start the quiz
-- containing them. Authors see their own questions and teachers/admins see all.
drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions for select to authenticated
  using(public.is_active() and (
    public.can_review()
    or author_id=auth.uid()
    or (status='approved' and (
      exists(select 1 from public.quiz_questions qq
        join public.quiz_attempt_starts qs on qs.quiz_id=qq.quiz_id
        where qq.question_id=questions.id and qs.student_id=auth.uid())
      or exists(select 1 from public.quiz_questions qq
        join public.quiz_attempts a on a.quiz_id=qq.quiz_id
        where qq.question_id=questions.id and a.student_id=auth.uid())
    ))
  ));
drop policy if exists quiz_questions_read on public.quiz_questions;
create policy quiz_questions_read on public.quiz_questions for select to authenticated
  using(public.is_active() and (
    public.can_review()
    or exists(select 1 from public.quiz_attempt_starts qs
      where qs.quiz_id=quiz_questions.quiz_id and qs.student_id=auth.uid())
  ));

-- Recover enrollment values submitted by older sign-ups whose profile write failed.
update public.profiles p
set enrollment_number=nullif(btrim(u.raw_user_meta_data->>'enrollment_number'),'')
from auth.users u
where p.id=u.id and p.role in ('student','student_leader')
  and p.enrollment_number is null
  and nullif(btrim(u.raw_user_meta_data->>'enrollment_number'),'') is not null
  and not exists (
    select 1 from public.profiles other
    where other.id<>p.id
      and lower(btrim(other.enrollment_number))=lower(btrim(u.raw_user_meta_data->>'enrollment_number'))
  );

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='activate_member'
  loop
    execute format('drop function %s',fn.signature);
  end loop;
end;
$$;

create function public.activate_member(p_profile_id uuid,p_role text,p_enrollment_number text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare enrollment text; selected_role public.app_role;
begin
  if not coalesce(public.current_role()='super_admin',false) then raise exception 'Only a super admin can activate members'; end if;
  if p_role is null or p_role not in ('super_admin','supervisor','student_leader','student') then raise exception 'Choose a valid role'; end if;
  selected_role:=p_role::public.app_role;
  select coalesce(nullif(btrim(p_enrollment_number),''),nullif(btrim(p.enrollment_number),''),nullif(btrim(u.raw_user_meta_data->>'enrollment_number'),''))
    into enrollment from public.profiles p left join auth.users u on u.id=p.id where p.id=p_profile_id;
  if not found then raise exception 'Member profile was not found'; end if;
  if selected_role in ('student','student_leader') and enrollment is null then
    raise exception 'Enrollment number was not saved at signup; ask the student to provide it';
  end if;
  if selected_role in ('super_admin','supervisor') then enrollment:=null; end if;
  update public.profiles set role=selected_role,active=true,requested_role=null,enrollment_number=enrollment
    where id=p_profile_id and active=false;
  if not found then raise exception 'This member is not waiting for activation'; end if;
  return true;
exception when unique_violation then
  raise exception 'That enrollment number is already assigned to another member';
end $$;

create or replace function public.start_quiz(p_quiz_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.quizzes%rowtype; started timestamptz;
begin
  if public.current_role() not in ('student','student_leader') then raise exception 'Only students can start this quiz'; end if;
  select * into q from public.quizzes where id=p_quiz_id and published=true;
  if not found or now()<q.opens_at or now()>q.closes_at then raise exception 'Quiz is not open'; end if;
  if exists(select 1 from public.quiz_attempts where quiz_id=p_quiz_id and student_id=auth.uid()) then raise exception 'Quiz already submitted'; end if;
  insert into public.quiz_attempt_starts(quiz_id,student_id) values(p_quiz_id,auth.uid())
    on conflict(quiz_id,student_id) do nothing;
  select started_at into started from public.quiz_attempt_starts where quiz_id=p_quiz_id and student_id=auth.uid();
  return jsonb_build_object('started_at',started);
end $$;

create or replace function public.create_quiz_with_settings(
  p_title text,p_kind public.quiz_kind,p_question_ids uuid[],p_opens_at timestamptz,p_closes_at timestamptz,
  p_duration_minutes integer,p_result_visibility text default 'immediate'
) returns uuid language plpgsql security definer set search_path=public as $$
declare qid uuid; cnt integer;
begin
  if not public.can_review() then raise exception 'Only a teacher or super admin can create quizzes'; end if;
  if coalesce(trim(p_title),'')='' or array_length(p_question_ids,1) is null or p_closes_at<=p_opens_at then raise exception 'Invalid quiz'; end if;
  if p_duration_minutes not between 1 and 180 or p_result_visibility not in ('immediate','after_release') then raise exception 'Invalid quiz settings'; end if;
  select count(*) into cnt from public.questions where id=any(p_question_ids) and status='approved';
  if cnt<>array_length(p_question_ids,1) or cnt<>(select count(distinct x) from unnest(p_question_ids) x) then raise exception 'Select unique approved questions'; end if;
  insert into public.quizzes(title,kind,opens_at,closes_at,duration_minutes,published,created_by,result_visibility,results_published)
  values(trim(p_title),p_kind,p_opens_at,p_closes_at,p_duration_minutes,true,auth.uid(),p_result_visibility,p_result_visibility='immediate')
  returning id into qid;
  insert into public.quiz_questions(quiz_id,question_id,position)
    select qid,x,ord::integer from unnest(p_question_ids) with ordinality as a(x,ord);
  return qid;
end $$;

create or replace function public.publish_quiz_results(p_quiz_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.can_review() then raise exception 'Only a teacher or super admin can publish results'; end if;
  update public.quizzes set results_published=true where id=p_quiz_id and result_visibility='after_release';
  if not found then raise exception 'Quiz not found or results are already configured for immediate release'; end if;
  return true;
end $$;

create or replace function public.submit_quiz(p_quiz_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer;s integer;q public.quizzes%rowtype; started timestamptz; cutoff timestamptz;
begin
  if public.current_role() not in ('student','student_leader') then raise exception 'Only students can submit this quiz'; end if;
  select * into q from public.quizzes where id=p_quiz_id and published=true;
  if not found then raise exception 'Quiz is closed'; end if;
  select started_at into started from public.quiz_attempt_starts where quiz_id=p_quiz_id and student_id=auth.uid();
  if not found or started>q.closes_at then raise exception 'Start this quiz from its open page before submitting'; end if;
  cutoff:=least(started+make_interval(mins=>q.duration_minutes),q.closes_at);
  if now()>cutoff+interval '2 minutes' then raise exception 'The quiz timer expired. Reopen the quiz page to submit the saved timer state'; end if;
  if exists(select 1 from public.quiz_attempts where quiz_id=p_quiz_id and student_id=auth.uid()) then raise exception 'Quiz already submitted'; end if;
  select count(*),count(*) filter(where p_answers->>qq.question_id::text=questions.correct_index::text) into n,s
    from public.quiz_questions qq join public.questions on questions.id=qq.question_id where qq.quiz_id=p_quiz_id;
  if n=0 then raise exception 'Quiz has no questions'; end if;
  insert into public.quiz_attempts(quiz_id,student_id,answers,score,total) values(p_quiz_id,auth.uid(),coalesce(p_answers,'{}'::jsonb),s,n);
  return jsonb_build_object('submitted',true,'score_available',q.result_visibility='immediate','score',case when q.result_visibility='immediate' then s else null end,'total',case when q.result_visibility='immediate' then n else null end);
end $$;

create or replace function public.get_my_quiz_result(p_quiz_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.quiz_attempts%rowtype; q public.quizzes%rowtype; detail jsonb;
begin
  if public.current_role() not in ('student','student_leader') then raise exception 'Not permitted'; end if;
  select * into q from public.quizzes where id=p_quiz_id and published=true;
  select * into a from public.quiz_attempts where quiz_id=p_quiz_id and student_id=auth.uid();
  if not found then raise exception 'No submitted attempt found'; end if;
  if q.result_visibility='after_release' and not q.results_published then raise exception 'Results have not been published yet'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',questions.id,'stem',questions.stem,'topic',questions.topic,'options',questions.options,
    'selected_index',case when a.answers ? questions.id::text then (a.answers->>questions.id::text)::integer else null end,
    'correct_index',questions.correct_index,'is_correct',(a.answers->>questions.id::text)=questions.correct_index::text,
    'explanation',questions.explanation,'source',questions.source_url
  ) order by qq.position),'[]'::jsonb) into detail
  from public.quiz_questions qq join public.questions on questions.id=qq.question_id where qq.quiz_id=p_quiz_id;
  return jsonb_build_object('quiz_id',q.id,'title',q.title,'score',a.score,'total',a.total,'submitted_at',a.submitted_at,'questions',detail);
end $$;

revoke all on function public.create_quiz(text,public.quiz_kind,uuid[],timestamptz,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.assign_next_duty(date,integer),public.reassign_duty(date,uuid),public.get_duty_availability(date),public.get_review_questions(),public.get_question_editor(uuid),public.activate_member(uuid,text,text),public.create_quiz_with_settings(text,public.quiz_kind,uuid[],timestamptz,timestamptz,integer,text),public.publish_quiz_results(uuid),public.start_quiz(uuid),public.submit_quiz(uuid,jsonb),public.get_my_quiz_result(uuid) from public,anon;
grant execute on function public.assign_next_duty(date,integer),public.reassign_duty(date,uuid),public.get_duty_availability(date),public.get_review_questions(),public.get_question_editor(uuid),public.activate_member(uuid,text,text),public.create_quiz_with_settings(text,public.quiz_kind,uuid[],timestamptz,timestamptz,integer,text),public.publish_quiz_results(uuid),public.start_quiz(uuid),public.submit_quiz(uuid,jsonb),public.get_my_quiz_result(uuid) to authenticated;

notify pgrst, 'reload schema';
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
