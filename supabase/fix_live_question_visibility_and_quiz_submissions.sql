-- Apply in the Supabase SQL Editor to align live student question visibility
-- and quiz submission recovery with the current application behavior.

create or replace function public.question_visible_to_me(
  q_id uuid,
  q_author uuid,
  q_status question_status
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when not public.is_active() then false
    when public.can_review() then true
    when q_author = auth.uid() then true
    else q_status = 'approved' and exists (
      select 1
      from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.question_id = q_id
        and q.published = true
        and q.result_visibility = 'after_release'
        and q.results_published = true
    )
  end
$function$;

drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions
for select to authenticated
using (
  public.is_active()
  and (
    public.question_visible_to_me(id, author_id, status)
    or (
      status = 'approved'
      and exists (
        select 1
        from public.quiz_questions qq
        join public.quizzes q on q.id = qq.quiz_id
        join public.quiz_attempt_starts qs on qs.quiz_id = q.id
        where qq.question_id = questions.id
          and qs.student_id = auth.uid()
          and q.published = true
          and q.opens_at <= clock_timestamp()
          and q.closes_at >= clock_timestamp()
          and q.ended_early_at is null
      )
    )
  )
);

drop policy if exists quiz_questions_read on public.quiz_questions;
create policy quiz_questions_read on public.quiz_questions
for select to authenticated
using (
  public.is_active()
  and (
    public.can_review()
    or exists (
      select 1
      from public.quizzes q
      where q.id = quiz_questions.quiz_id
        and q.published = true
        and q.result_visibility = 'after_release'
        and q.results_published = true
    )
    or exists (
      select 1
      from public.quizzes q
      join public.quiz_attempt_starts qs on qs.quiz_id = q.id
      where q.id = quiz_questions.quiz_id
        and qs.student_id = auth.uid()
        and q.published = true
        and q.opens_at <= clock_timestamp()
        and q.closes_at >= clock_timestamp()
        and q.ended_early_at is null
    )
  )
);

create or replace function public.get_question_bank(
  p_search text default null,
  p_topic text default null,
  p_author_id text default null,
  p_only_mine boolean default false,
  p_status text default null,
  p_is_special boolean default null,
  p_date_from text default null,
  p_date_to text default null,
  p_has_source boolean default null,
  p_quiz_usage text default null,
  p_sort text default 'newest',
  p_limit integer default 25,
  p_offset integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_caller_id uuid := auth.uid();
  v_is_staff boolean := false;
  v_author_uuid uuid := null;
  v_status_enum question_status := null;
  v_date_from date := null;
  v_date_to date := null;
  v_total integer := 0;
  v_questions json := '[]'::json;
  v_uploaders json := '[]'::json;
begin
  if v_caller_id is null or not public.is_active() then
    raise exception 'Not permitted';
  end if;

  v_is_staff := coalesce(public.can_review(), false);

  if p_author_id is not null and trim(p_author_id) not in ('', 'all') then
    begin
      v_author_uuid := trim(p_author_id)::uuid;
    exception when others then
      v_author_uuid := null;
    end;
  end if;

  if p_status is not null and trim(p_status) not in ('', 'all') then
    begin
      v_status_enum := trim(p_status)::question_status;
    exception when others then
      v_status_enum := null;
    end;
  end if;

  if p_date_from is not null and trim(p_date_from) <> '' then
    begin
      v_date_from := trim(p_date_from)::date;
    exception when others then
      v_date_from := null;
    end;
  end if;

  if p_date_to is not null and trim(p_date_to) <> '' then
    begin
      v_date_to := trim(p_date_to)::date;
    exception when others then
      v_date_to := null;
    end;
  end if;

  select coalesce(json_agg(row_to_json(u)), '[]'::json)
  into v_uploaders
  from (
    select distinct p.id, p.full_name, p.enrollment_number
    from public.questions q
    join public.profiles p on p.id = q.author_id
    where (
      v_is_staff
      or public.question_visible_to_me(q.id, q.author_id, q.status)
    )
    order by p.full_name asc
  ) u;

  select count(*)
  into v_total
  from public.questions q
  left join public.profiles a on a.id = q.author_id
  where (
      v_is_staff
      or public.question_visible_to_me(q.id, q.author_id, q.status)
    )
    and (not coalesce(p_only_mine, false) or q.author_id = v_caller_id)
    and (v_author_uuid is null or q.author_id = v_author_uuid)
    and (v_status_enum is null or q.status = v_status_enum)
    and (p_topic is null or p_topic = 'all' or q.topic = p_topic)
    and (
      p_is_special is null
      or not v_is_staff
      or q.is_special = p_is_special
    )
    and (v_date_from is null or q.created_at::date >= v_date_from)
    and (v_date_to is null or q.created_at::date <= v_date_to)
    and (
      p_has_source is null
      or (p_has_source and q.source_url is not null and trim(q.source_url) <> '')
      or (not p_has_source and (q.source_url is null or trim(q.source_url) = ''))
    )
    and (
      p_quiz_usage is null
      or p_quiz_usage = 'all'
      or not v_is_staff
      or (
        p_quiz_usage = 'used'
        and exists (
          select 1 from public.quiz_questions qq where qq.question_id = q.id
        )
      )
      or (
        p_quiz_usage = 'unused'
        and not exists (
          select 1 from public.quiz_questions qq where qq.question_id = q.id
        )
      )
    )
    and (
      p_search is null
      or trim(p_search) = ''
      or q.stem ilike '%' || trim(p_search) || '%'
      or q.explanation ilike '%' || trim(p_search) || '%'
      or q.source_url ilike '%' || trim(p_search) || '%'
      or q.options::text ilike '%' || trim(p_search) || '%'
    );

  select coalesce(json_agg(row_data), '[]'::json)
  into v_questions
  from (
    select
      q.id,
      q.stem,
      q.topic,
      q.options,
      q.correct_index,
      q.explanation,
      q.source_url,
      q.status,
      q.author_id,
      q.created_at,
      q.is_special,
      exists (
        select 1 from public.quiz_questions qq where qq.question_id = q.id
      ) as is_used_in_quiz,
      json_build_object(
        'full_name', a.full_name,
        'enrollment_number', a.enrollment_number
      ) as author
    from public.questions q
    left join public.profiles a on a.id = q.author_id
    where (
        v_is_staff
        or public.question_visible_to_me(q.id, q.author_id, q.status)
      )
      and (not coalesce(p_only_mine, false) or q.author_id = v_caller_id)
      and (v_author_uuid is null or q.author_id = v_author_uuid)
      and (v_status_enum is null or q.status = v_status_enum)
      and (p_topic is null or p_topic = 'all' or q.topic = p_topic)
      and (
        p_is_special is null
        or not v_is_staff
        or q.is_special = p_is_special
      )
      and (v_date_from is null or q.created_at::date >= v_date_from)
      and (v_date_to is null or q.created_at::date <= v_date_to)
      and (
        p_has_source is null
        or (p_has_source and q.source_url is not null and trim(q.source_url) <> '')
        or (not p_has_source and (q.source_url is null or trim(q.source_url) = ''))
      )
      and (
        p_quiz_usage is null
        or p_quiz_usage = 'all'
        or not v_is_staff
        or (
          p_quiz_usage = 'used'
          and exists (
            select 1 from public.quiz_questions qq where qq.question_id = q.id
          )
        )
        or (
          p_quiz_usage = 'unused'
          and not exists (
            select 1 from public.quiz_questions qq where qq.question_id = q.id
          )
        )
      )
      and (
        p_search is null
        or trim(p_search) = ''
        or q.stem ilike '%' || trim(p_search) || '%'
        or q.explanation ilike '%' || trim(p_search) || '%'
        or q.source_url ilike '%' || trim(p_search) || '%'
        or q.options::text ilike '%' || trim(p_search) || '%'
      )
    order by
      case when p_sort = 'oldest' then q.created_at end asc,
      case when p_sort = 'topic' then q.topic end asc,
      case when p_sort = 'uploader' then a.full_name end asc,
      case when p_sort = 'status' then q.status::text end asc,
      q.created_at desc
    limit p_limit
    offset p_offset
  ) row_data;

  return json_build_object(
    'total', v_total,
    'uploaders', v_uploaders,
    'questions', v_questions
  );
end;
$function$;

create or replace function public.get_mock_quiz_pool(
  p_topics text[] default null,
  p_count integer default 10
)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_is_staff boolean := false;
  v_res json;
begin
  if v_user_id is null or not public.is_active() then
    return '[]'::json;
  end if;

  v_is_staff := coalesce(public.can_review(), false);

  with visible_approved as (
    select
      q.id,
      q.stem,
      q.topic,
      q.options,
      q.correct_index,
      q.explanation,
      q.source_url,
      q.status::text as status,
      q.author_id,
      q.created_at,
      q.is_special
    from public.questions q
    where q.status = 'approved'
      and (
        v_is_staff
        or q.author_id = v_user_id
        or exists (
          select 1
          from public.quiz_questions qq
          join public.quizzes z on z.id = qq.quiz_id
          where qq.question_id = q.id
            and z.published = true
            and z.result_visibility = 'after_release'
            and z.results_published = true
        )
        or exists (
          select 1
          from public.quiz_questions qq
          join public.quizzes z on z.id = qq.quiz_id
          join public.quiz_attempts qa on qa.quiz_id = z.id
          where qq.question_id = q.id
            and qa.student_id = v_user_id
            and qa.status = 'submitted'
            and z.published = true
            and coalesce(z.is_hidden, false) = false
            and z.result_visibility = 'immediate'
            and clock_timestamp() > z.closes_at
        )
      )
      and (p_topics is null or cardinality(p_topics) = 0 or q.topic = any(p_topics))
    order by random()
    limit case when p_count is null or p_count <= 0 then 1000 else p_count end
  )
  select coalesce(json_agg(
    json_build_object(
      'id', id,
      'stem', stem,
      'topic', topic,
      'options', options,
      'correct_index', correct_index,
      'explanation', explanation,
      'source_url', source_url,
      'status', status,
      'author_id', author_id,
      'created_at', created_at,
      'is_special', is_special
    )
  ), '[]'::json)
  into v_res
  from visible_approved;

  return v_res;
end;
$function$;

create or replace function public.autosave_quiz_progress(
  p_quiz_id uuid,
  p_answers jsonb,
  p_time_taken_seconds integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_student_id uuid;
  v_quiz record;
  v_attempt record;
  v_total int := 0;
  v_answers jsonb;
begin
  v_student_id := auth.uid();
  if v_student_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be an object';
  end if;
  v_answers := coalesce(p_answers, '{}'::jsonb);

  select id, opens_at, closes_at, ended_early_at, is_hidden
  into v_quiz
  from public.quizzes
  where id = p_quiz_id;

  if not found then
    raise exception 'Quiz not found';
  end if;
  if v_quiz.ended_early_at is not null or clock_timestamp() > v_quiz.closes_at then
    return jsonb_build_object(
      'success', false,
      'status', 'closed',
      'message', 'Quiz has closed'
    );
  end if;

  select id, status
  into v_attempt
  from public.quiz_attempts
  where quiz_id = p_quiz_id and student_id = v_student_id;

  if found and v_attempt.status = 'submitted' then
    return jsonb_build_object(
      'success', false,
      'status', 'submitted',
      'message', 'Quiz already submitted'
    );
  end if;

  select count(*) into v_total
  from public.quiz_questions
  where quiz_id = p_quiz_id;

  insert into public.quiz_attempts (
    quiz_id,
    student_id,
    status,
    autosaved_answers,
    answers,
    time_taken_seconds,
    total,
    started_at,
    updated_at
  )
  values (
    p_quiz_id,
    v_student_id,
    'in_progress',
    v_answers,
    v_answers,
    coalesce(p_time_taken_seconds, 0),
    v_total,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (quiz_id, student_id) do update set
    autosaved_answers =
      coalesce(public.quiz_attempts.autosaved_answers, '{}'::jsonb)
      || excluded.autosaved_answers,
    answers =
      coalesce(public.quiz_attempts.answers, '{}'::jsonb)
      || excluded.answers,
    time_taken_seconds =
      coalesce(p_time_taken_seconds, public.quiz_attempts.time_taken_seconds),
    updated_at = clock_timestamp()
  where public.quiz_attempts.status = 'in_progress';

  return jsonb_build_object(
    'success', true,
    'status', 'in_progress',
    'saved_at', clock_timestamp()
  );
end;
$function$;

create or replace function public.submit_quiz(p_quiz_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_student_id uuid;
  v_total int := 0;
  v_correct int := 0;
  v_wrong int := 0;
  v_skipped int := 0;
  v_q record;
  v_chosen_str text;
  v_chosen_idx int;
  v_effective_answers jsonb;
  v_saved_answers jsonb;
begin
  v_student_id := auth.uid();
  if v_student_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be an object';
  end if;

  select coalesce(autosaved_answers, '{}'::jsonb)
  into v_saved_answers
  from public.quiz_attempts
  where quiz_id = p_quiz_id and student_id = v_student_id;

  v_effective_answers :=
    coalesce(v_saved_answers, '{}'::jsonb)
    || coalesce(p_answers, '{}'::jsonb);

  select count(*) into v_total
  from public.quiz_questions
  where quiz_id = p_quiz_id;

  for v_q in
    select q.id, q.correct_index
    from public.quiz_questions qq
    join public.questions q on q.id = qq.question_id
    where qq.quiz_id = p_quiz_id
  loop
    v_chosen_str := v_effective_answers ->> v_q.id::text;
    if v_chosen_str is null or v_chosen_str = '' then
      v_skipped := v_skipped + 1;
    else
      begin
        v_chosen_idx := v_chosen_str::int;
        if v_chosen_idx = v_q.correct_index then
          v_correct := v_correct + 1;
        else
          v_wrong := v_wrong + 1;
        end if;
      exception when others then
        v_wrong := v_wrong + 1;
      end;
    end if;
  end loop;

  insert into public.quiz_attempts (
    quiz_id,
    student_id,
    status,
    answers,
    autosaved_answers,
    score,
    total,
    correct_count,
    wrong_count,
    skipped_count,
    submitted_at,
    updated_at
  )
  values (
    p_quiz_id,
    v_student_id,
    'submitted',
    v_effective_answers,
    v_effective_answers,
    v_correct,
    v_total,
    v_correct,
    v_wrong,
    v_skipped,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (quiz_id, student_id) do update set
    status = 'submitted',
    answers = excluded.answers,
    autosaved_answers = excluded.autosaved_answers,
    score = excluded.score,
    total = excluded.total,
    correct_count = excluded.correct_count,
    wrong_count = excluded.wrong_count,
    skipped_count = excluded.skipped_count,
    submitted_at = clock_timestamp(),
    updated_at = clock_timestamp();

  return jsonb_build_object(
    'success', true,
    'status', 'submitted',
    'score', v_correct,
    'total', v_total
  );
end;
$function$;

notify pgrst, 'reload schema';
