-- Privacy patch: only teachers / super admins can see another student's questions and duty progress.
-- Class leaders see only their own. Run once in the Supabase SQL Editor (safe to run again).

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
  where d.duty_date=p_duty_date and (public.can_review() or d.student_id=auth.uid())
  group by d.id,d.duty_date,d.student_id,p.full_name,d.target_count;
end $$;

create or replace function public.get_duty_questions(p_duty_id uuid)
returns table(question_id uuid,stem text,topic text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare owner_id uuid;
begin
  select d.student_id into owner_id from public.duties as d where d.id=p_duty_id;
  if owner_id is null then raise exception 'Duty not found'; end if;
  if not (public.can_review() or owner_id=auth.uid()) then raise exception 'Not permitted'; end if;
  return query
  select q.id,q.stem,q.topic,q.status::text,q.created_at
  from public.duty_questions as dq join public.questions as q on q.id=dq.question_id
  where dq.duty_id=p_duty_id and q.author_id=owner_id
  order by q.created_at;
end $$;

create or replace function public.attach_questions_to_duty(p_duty_id uuid,p_question_ids uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare cur_duty public.duties%rowtype; have integer; want integer; ok integer;
begin
  select t.* into cur_duty from public.duties as t where t.id=p_duty_id for update;
  if not found then raise exception 'Duty not found'; end if;
  if not (public.can_review() or cur_duty.student_id=auth.uid()) then raise exception 'Not permitted'; end if;
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
  if not (public.can_review() or cur_duty.student_id=auth.uid()) then raise exception 'Not permitted'; end if;
  if cur_duty.duty_status='reviewed' and not public.can_review() then raise exception 'This duty is already reviewed'; end if;
  delete from public.duty_questions where question_id=p_question_id;
end $$;

notify pgrst,'reload schema';
