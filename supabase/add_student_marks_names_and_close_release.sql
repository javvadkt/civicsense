-- Add preferred names and a result-on-close mode. Run in the Supabase SQL Editor.
alter table public.profiles
  add column if not exists preferred_name text;

alter table public.quizzes
  drop constraint if exists quizzes_result_visibility_check;
alter table public.quizzes
  add constraint quizzes_result_visibility_check
  check (result_visibility in ('immediate', 'after_release', 'after_close'));

create or replace function public.set_my_preferred_name(p_preferred_name text)
returns text language plpgsql security definer set search_path=public as $$
declare cleaned_name text := nullif(btrim(p_preferred_name), '');
begin
  if not public.is_active() then raise exception 'Not permitted'; end if;
  if cleaned_name is not null and length(cleaned_name) > 40 then
    raise exception 'Preferred name must be 40 characters or fewer';
  end if;
  if cleaned_name is not null and cleaned_name ~ '[[:space:]]' then
    raise exception 'Preferred name must be a single word';
  end if;
  update public.profiles set preferred_name=cleaned_name where id=auth.uid();
  return cleaned_name;
end $$;

create or replace function public.create_quiz_with_settings(
  p_title text,
  p_kind public.quiz_kind,
  p_question_ids uuid[],
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_duration_minutes integer,
  p_result_visibility text default 'immediate'
) returns uuid language plpgsql security definer set search_path=public as $$
declare qid uuid; cnt integer;
begin
  if not public.can_review() then raise exception 'Only a teacher or super admin can create quizzes'; end if;
  if coalesce(trim(p_title),'')='' or array_length(p_question_ids,1) is null or p_closes_at<=p_opens_at then
    raise exception 'Invalid quiz';
  end if;
  if p_duration_minutes not between 1 and 180
    or p_result_visibility not in ('immediate','after_release','after_close') then
    raise exception 'Invalid quiz settings';
  end if;
  select count(*) into cnt from public.questions where id=any(p_question_ids) and status='approved';
  if cnt<>array_length(p_question_ids,1)
    or cnt<>(select count(distinct x) from unnest(p_question_ids) x) then
    raise exception 'Select unique approved questions';
  end if;
  insert into public.quizzes(title,kind,opens_at,closes_at,duration_minutes,published,created_by,result_visibility,results_published)
  values(trim(p_title),p_kind,p_opens_at,p_closes_at,p_duration_minutes,true,auth.uid(),p_result_visibility,p_result_visibility='immediate')
  returning id into qid;
  insert into public.quiz_questions(quiz_id,question_id,position)
    select qid,x,ord::integer from unnest(p_question_ids) with ordinality as a(x,ord);
  return qid;
end $$;

create or replace function public.get_my_quiz_marks()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if public.current_role() not in ('student','student_leader') then raise exception 'Not permitted'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'quiz_id',q.id,
      'title',q.title,
      'closes_at',q.closes_at,
      'result_visibility',q.result_visibility,
      'submitted_at',a.submitted_at,
      'available',(
        q.result_visibility='immediate'
        or (q.result_visibility='after_release' and q.results_published)
        or (q.result_visibility='after_close' and (q.closes_at<=clock_timestamp() or q.ended_early_at is not null))
      ),
      'score',case when q.result_visibility='immediate'
        or (q.result_visibility='after_release' and q.results_published)
        or (q.result_visibility='after_close' and (q.closes_at<=clock_timestamp() or q.ended_early_at is not null))
        then a.score else null end,
      'total',case when q.result_visibility='immediate'
        or (q.result_visibility='after_release' and q.results_published)
        or (q.result_visibility='after_close' and (q.closes_at<=clock_timestamp() or q.ended_early_at is not null))
        then a.total else null end
    ) order by q.closes_at desc)
    from public.quiz_attempts a
    join public.quizzes q on q.id=a.quiz_id
    where a.student_id=auth.uid() and a.status='submitted' and q.published=true
  ), '[]'::jsonb);
end $$;

create or replace function public.get_my_quiz_summary()
returns json language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid := auth.uid();
  v_eligible integer := 0;
  v_attended integer := 0;
  v_marks_got integer := 0;
  v_marks_total integer := 0;
  v_pending integer := 0;
  v_pct integer := 0;
begin
  if public.current_role() not in ('student','student_leader') then raise exception 'Not permitted'; end if;
  select count(*) into v_eligible from public.quizzes
    where published=true and opens_at<=clock_timestamp();
  select count(a.id),
    coalesce(sum(case when q.result_visibility='immediate'
      or (q.result_visibility='after_release' and q.results_published)
      or (q.result_visibility='after_close' and (q.closes_at<=clock_timestamp() or q.ended_early_at is not null))
      then a.score else 0 end),0),
    coalesce(sum(case when q.result_visibility='immediate'
      or (q.result_visibility='after_release' and q.results_published)
      or (q.result_visibility='after_close' and (q.closes_at<=clock_timestamp() or q.ended_early_at is not null))
      then a.total else 0 end),0),
    count(*) filter (where not (
      q.result_visibility='immediate'
      or (q.result_visibility='after_release' and q.results_published)
      or (q.result_visibility='after_close' and (q.closes_at<=clock_timestamp() or q.ended_early_at is not null))
    ))
    into v_attended,v_marks_got,v_marks_total,v_pending
    from public.quiz_attempts a join public.quizzes q on q.id=a.quiz_id
    where a.student_id=v_uid and a.status='submitted' and q.published=true;
  if v_marks_total>0 then v_pct:=round((v_marks_got::numeric/v_marks_total::numeric)*100); end if;
  return json_build_object('eligible',v_eligible,'attended',v_attended,'marks_got',v_marks_got,
    'marks_total',v_marks_total,'percent',v_pct,'pending_results',v_pending);
end $$;

create or replace function public.get_my_quiz_result(p_quiz_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.quiz_attempts%rowtype; q public.quizzes%rowtype; detail jsonb;
begin
  if public.current_role() not in ('student','student_leader') then raise exception 'Not permitted'; end if;
  select * into q from public.quizzes where id=p_quiz_id and published=true;
  if not found then raise exception 'Quiz not found'; end if;
  select * into a from public.quiz_attempts where quiz_id=p_quiz_id and student_id=auth.uid() and status='submitted';
  if not found then raise exception 'No submitted attempt found'; end if;
  if q.result_visibility='after_release' and not q.results_published then
    raise exception 'Results have not been published yet';
  end if;
  if q.result_visibility='after_close' and q.closes_at>clock_timestamp() and q.ended_early_at is null then
    raise exception 'Results will be available when the quiz closes';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',questions.id,'stem',questions.stem,'topic',questions.topic,'options',questions.options,
    'selected_index',case when a.answers ? questions.id::text then (a.answers->>questions.id::text)::integer else null end,
    'correct_index',questions.correct_index,'is_correct',(a.answers->>questions.id::text)=questions.correct_index::text,
    'explanation',questions.explanation,'source',questions.source_url
  ) order by qq.position),'[]'::jsonb) into detail
  from public.quiz_questions qq join public.questions on questions.id=qq.question_id where qq.quiz_id=p_quiz_id;
  return jsonb_build_object('quiz_id',q.id,'title',q.title,'score',a.score,'total',a.total,
    'submitted_at',a.submitted_at,'questions',detail);
end $$;

create or replace function public.get_quiz_gradebook()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if public.current_role() not in ('supervisor','super_admin') then raise exception 'Not permitted'; end if;
  return jsonb_build_object(
    'attempts',coalesce((select jsonb_agg(jsonb_build_object(
      'quiz_id',a.quiz_id,'student_id',a.student_id,'score',a.score,'status',a.status,'submitted_at',a.submitted_at
    ) order by a.submitted_at desc) from public.quiz_attempts a),'[]'::jsonb),
    'contributors',coalesce((select jsonb_agg(jsonb_build_object(
      'quiz_id',qq.quiz_id,'author_id',questions.author_id
    )) from public.quiz_questions qq join public.questions on questions.id=qq.question_id),'[]'::jsonb)
  );
end $$;

-- Raw attempt reads omit marks. Owner-checked and teacher-checked RPCs return them.
revoke select on public.quiz_attempts from authenticated;
grant select(quiz_id,student_id,answers,submitted_at,status,autosaved_answers)
  on public.quiz_attempts to authenticated;

revoke all on function public.set_my_preferred_name(text),public.get_my_quiz_marks(),
  public.get_quiz_gradebook() from public,anon;
grant execute on function public.set_my_preferred_name(text),public.get_my_quiz_marks(),
  public.get_quiz_gradebook() to authenticated;
revoke all on function public.get_my_quiz_summary(),public.get_my_quiz_result(uuid),
  public.create_quiz_with_settings(text,public.quiz_kind,uuid[],timestamptz,timestamptz,integer,text)
  from public,anon;
grant execute on function public.get_my_quiz_summary(),public.get_my_quiz_result(uuid),
  public.create_quiz_with_settings(text,public.quiz_kind,uuid[],timestamptz,timestamptz,integer,text)
  to authenticated;