-- Run once in the Supabase SQL Editor. Do not put a service_role key in the website.
create extension if not exists pgcrypto;
create type public.app_role as enum ('super_admin','supervisor','student_leader','student');
create type public.question_status as enum ('pending','approved','revision_requested');
create type public.quiz_kind as enum ('daily','weekly','monthly');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default 'New member',
 role public.app_role not null default 'student',
 active boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.questions (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references public.profiles(id),
 stem text not null check (length(trim(stem)) between 12 and 1500),
 topic text not null,
 options jsonb not null check (jsonb_typeof(options)='array' and jsonb_array_length(options)=4),
 correct_index integer not null check (correct_index between 0 and 3),
 explanation text not null check (length(trim(explanation))>0),
 source_url text not null check (source_url ~ '^https?://'),
 status public.question_status not null default 'pending',
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index questions_status_date_idx on public.questions(status,created_at desc);
create index questions_author_idx on public.questions(author_id);
create table public.duties (
 id uuid primary key default gen_random_uuid(),
 duty_date date not null unique,
 student_id uuid not null references public.profiles(id),
 target_count integer not null default 5 check (target_count between 1 and 20),
 assigned_by uuid references public.profiles(id),
 duty_status text not null default 'assigned' check (duty_status in ('assigned','confirmed','in_progress','submitted','reviewed','change_requested','excused','missed')),
 status_note text,
 status_updated_at timestamptz not null default now(),
 status_updated_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create index duties_student_date_idx on public.duties(student_id,duty_date);
create table public.quizzes (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 kind public.quiz_kind not null,
 opens_at timestamptz not null,
 closes_at timestamptz not null,
 duration_minutes integer not null check (duration_minutes between 1 and 180),
 published boolean not null default false,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 check (closes_at>opens_at)
);
create table public.quiz_questions (
 quiz_id uuid not null references public.quizzes(id) on delete cascade,
 question_id uuid not null references public.questions(id),
 position integer not null,
 primary key(quiz_id,question_id),
 unique(quiz_id,position)
);
create table public.quiz_attempts (
 id uuid primary key default gen_random_uuid(),
 quiz_id uuid not null references public.quizzes(id),
 student_id uuid not null references public.profiles(id),
 answers jsonb not null,
 score integer not null,
 total integer not null,
 submitted_at timestamptz not null default now(),
 unique(quiz_id,student_id)
);

create function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid() and active=true
$$;
create function public.is_active() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active=true)
$$;
create function public.can_review() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.current_role() in ('super_admin','supervisor'),false)
$$;
create function public.can_manage() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.current_role() in ('super_admin','supervisor','student_leader'),false)
$$;
revoke all on function public.current_role() from public;
revoke all on function public.is_active() from public;
revoke all on function public.can_review() from public;
revoke all on function public.can_manage() from public;
grant execute on function public.current_role(),public.is_active(),public.can_review(),public.can_manage() to authenticated;

create function public.new_user_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,full_name) values(new.id,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)));
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_user_profile();
insert into public.profiles(id,full_name) select id,coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),split_part(email,'@',1)) from auth.users on conflict(id) do nothing;

alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.duties enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id=auth.uid() or public.is_active());
create policy profiles_admin_update on public.profiles for update to authenticated using (public.current_role()='super_admin') with check (public.current_role()='super_admin');
create policy questions_read on public.questions for select to authenticated using (public.is_active() and (status='approved' or author_id=auth.uid() or public.can_review()));
create policy questions_insert on public.questions for insert to authenticated with check (public.is_active() and author_id=auth.uid() and status='pending' and reviewed_by is null and reviewed_at is null);
create policy questions_author_edit on public.questions for update to authenticated using (public.is_active() and author_id=auth.uid() and status='revision_requested') with check (author_id=auth.uid() and status='pending' and reviewed_by is null and reviewed_at is null);
create policy questions_review on public.questions for update to authenticated using (public.can_review()) with check (public.can_review());
create policy duties_read on public.duties for select to authenticated using (public.is_active());
create policy duties_insert on public.duties for insert to authenticated with check (public.can_manage() and assigned_by=auth.uid());
create policy duties_update on public.duties for update to authenticated using (public.can_manage()) with check (public.can_manage());
create policy quizzes_read on public.quizzes for select to authenticated using (public.is_active() and (published or public.can_manage()));
create policy quiz_questions_read on public.quiz_questions for select to authenticated using (public.is_active() and exists(select 1 from public.quizzes q where q.id=quiz_id and (q.published or public.can_manage())));
create policy attempts_read on public.quiz_attempts for select to authenticated using (public.is_active() and (student_id=auth.uid() or public.can_review()));

-- Column permissions protect role, answer keys, and moderation fields from direct client edits.
revoke all on public.profiles,public.questions,public.duties,public.quizzes,public.quiz_questions,public.quiz_attempts from anon,authenticated;
grant select on public.profiles,public.questions,public.duties,public.quizzes,public.quiz_questions,public.quiz_attempts to authenticated;
grant update(role,active) on public.profiles to authenticated;
grant insert(stem,topic,options,correct_index,explanation,source_url,author_id) on public.questions to authenticated;
grant update(stem,topic,options,correct_index,explanation,source_url,status) on public.questions to authenticated;
grant insert(duty_date,student_id,target_count,assigned_by) on public.duties to authenticated;
grant update(duty_date,student_id,target_count) on public.duties to authenticated;

-- Set author/assigner in the database, so browser requests cannot impersonate another user.
create function public.question_defaults() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then new.author_id:=auth.uid(); new.status:='pending';
 elsif public.can_review() and old.status is distinct from new.status then
   new.reviewed_by:=auth.uid();new.reviewed_at:=now();
 elsif not public.can_review() then
   new.author_id:=old.author_id;new.reviewed_by:=null;new.reviewed_at:=null;
 end if;
 return new;
end $$;
create trigger questions_defaults before insert or update on public.questions for each row execute function public.question_defaults();
create function public.duty_defaults() returns trigger language plpgsql security definer set search_path=public as $$
begin if tg_op='INSERT' then new.assigned_by:=auth.uid();end if;return new;end $$;
create trigger duties_defaults before insert on public.duties for each row execute function public.duty_defaults();

create function public.create_quiz(p_title text,p_kind public.quiz_kind,p_question_ids uuid[],p_opens_at timestamptz,p_closes_at timestamptz,p_duration_minutes integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare qid uuid; cnt integer;
begin
 if not public.can_manage() then raise exception 'Not permitted';end if;
 if array_length(p_question_ids,1) is null or p_closes_at<=p_opens_at then raise exception 'Invalid quiz';end if;
 select count(*) into cnt from public.questions where id=any(p_question_ids) and status='approved';
 if cnt<>array_length(p_question_ids,1) or cnt<>(select count(distinct x) from unnest(p_question_ids) x) then raise exception 'Select unique approved questions';end if;
 insert into public.quizzes(title,kind,opens_at,closes_at,duration_minutes,published,created_by) values(p_title,p_kind,p_opens_at,p_closes_at,p_duration_minutes,true,auth.uid()) returning id into qid;
 insert into public.quiz_questions(quiz_id,question_id,position) select qid,x,ord::integer from unnest(p_question_ids) with ordinality as a(x,ord);
 return qid;
end $$;
create function public.submit_quiz(p_quiz_id uuid,p_answers jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer;s integer;q public.quizzes%rowtype;
begin
 if not public.is_active() then raise exception 'Not permitted';end if;
 select * into q from public.quizzes where id=p_quiz_id and published=true;
 if not found or now()<q.opens_at or now()>q.closes_at then raise exception 'Quiz is closed';end if;
 if exists(select 1 from public.quiz_attempts where quiz_id=p_quiz_id and student_id=auth.uid()) then raise exception 'Quiz already submitted';end if;
 select count(*),count(*) filter(where p_answers->>qq.question_id::text=questions.correct_index::text) into n,s
 from public.quiz_questions qq join public.questions on questions.id=qq.question_id where qq.quiz_id=p_quiz_id;
 insert into public.quiz_attempts(quiz_id,student_id,answers,score,total) values(p_quiz_id,auth.uid(),p_answers,s,n);
 return jsonb_build_object('score',s,'total',n);
end $$;
revoke all on function public.create_quiz(text,public.quiz_kind,uuid[],timestamptz,timestamptz,integer),public.submit_quiz(uuid,jsonb) from public;
grant execute on function public.create_quiz(text,public.quiz_kind,uuid[],timestamptz,timestamptz,integer),public.submit_quiz(uuid,jsonb) to authenticated;

-- AFTER creating your own user in Authentication > Users, replace this email and run once:
-- update public.profiles set role='super_admin',active=true where id=(select id from auth.users where email='YOUR_EMAIL@example.com');
