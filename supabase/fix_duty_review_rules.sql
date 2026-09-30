-- Duty review rules. Run once in the Supabase SQL Editor. Safe to run again.
-- 1) "Submitted" and "Reviewed" need all target questions uploaded (for everyone).
-- 2) Only a teacher / super admin can change another person's duty status.
--    Class leaders and students can change only their OWN duty (confirm, start, submit, request change).
--    Leaders keep assign / edit / delete duty (those use other functions).
-- 3) An assigned student can read their own upload progress (needed for "Mark questions submitted").

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
    select count(*) into uploaded from public.questions as question
      where question.author_id=current_duty.student_id
        and question.created_at >= (current_duty.duty_date::timestamp at time zone 'Asia/Kolkata')
        and question.created_at < ((current_duty.duty_date+1)::timestamp at time zone 'Asia/Kolkata');
    if uploaded < current_duty.target_count then
      raise exception 'Only % of % questions are uploaded for this duty',uploaded,current_duty.target_count;
    end if;
  end if;

  update public.duties as target set duty_status=p_status,
    status_note=case when clean_reason is not null then clean_reason else null end,
    status_updated_at=now(),status_updated_by=auth.uid()
    where target.id=current_duty.id;
  insert into public.duty_change_log(duty_id,action,old_student_id,new_student_id,reason,changed_by)
    values(current_duty.id,'status:'||p_status,current_duty.student_id,current_duty.student_id,clean_reason,auth.uid());
end $$;

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
  left join public.questions q on q.author_id=d.student_id
    and q.created_at >= (d.duty_date::timestamp at time zone 'Asia/Kolkata')
    and q.created_at < ((d.duty_date+1)::timestamp at time zone 'Asia/Kolkata')
  where d.duty_date=p_duty_date and (public.can_manage() or d.student_id=auth.uid())
  group by d.id,d.duty_date,d.student_id,p.full_name,d.target_count;
end $$;

revoke all on function public.update_duty_status(uuid,text,text),public.get_duty_progress(date) from public,anon;
grant execute on function public.update_duty_status(uuid,text,text),public.get_duty_progress(date) to authenticated;
notify pgrst,'reload schema';
