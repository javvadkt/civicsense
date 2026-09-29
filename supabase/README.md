# CivicPrep Supabase setup

## Existing database

You already ran `setup.sql`; **do not run it again**. It is the original bootstrap script and recreates types. In the Supabase SQL Editor, run these rerunnable upgrades in order:

1. `upgrade_member_signup_and_duty_rotation.sql` (if not already applied).
2. `add_student_enrollment_number.sql` (if not already applied).
3. `upgrade_question_quiz_duty_features.sql` (question editing/import, availability, quiz result release, and quiz-only student question visibility). Re-run this migration after updating the Site; it also resets the safe question-read grants if a full-table grant was added while debugging imports.
4. If student enrollment is still blank or activation reports that `activate_member` is missing from the schema cache, run `fix_signup_enrollment_and_activation.sql`. It repairs the auth trigger, backfills available signup metadata, recreates one RPC signature, and asks PostgREST to reload its schema.
5. If duty assignment reports a null `cycle_no`, run `fix_duty_rotation_null_cycle.sql` in the SQL Editor. It restores the initial rotation row and makes the assignment function recreate it if missing.

The enrollment migration stores a unique enrollment number on student and student-leader profiles. Teachers do not get one. The latest upgrade backfills missing profile numbers from the student’s auth signup metadata. If both records lack the number, the super admin can enter it once in People.

## Authentication settings

1. In Authentication → Providers, keep Email enabled so members can sign in with a password. Public sign-ups now go through the `public-signup` Edge Function, which marks the email as confirmed without sending a verification message. The profile remains inactive until a super admin approves it.
2. In Authentication → URL Configuration, use `https://upsc-current-affairs-hub.mohammedjavvadkt.chatgpt.site` as the Site URL and add that exact URL to Redirect URLs for password recovery. No confirmation email is needed for sign-up.

## Bootstrap and deploy

1. Create the first administrator in Supabase Authentication, then use the original setup's commented SQL once to set that profile to `super_admin` and active.
2. From the `site` folder, deploy the public signup function with `supabase functions deploy public-signup --project-ref dclxjishlusibfiedroo`. After deployment, a successful student signup response must contain `signup_version: "enrollment-v2"` and `member.enrollment_number`. The function writes the number to both auth metadata and the inactive profile. If that marker is missing, Supabase is still running an older function. The function is configured with JWT verification disabled because it must accept signed-out visitors; it only allows Student or Teacher requests and uses the service role key on the server. Never add a service role key to the Site/browser. Deploy `admin-create-member` separately only if its source has changed.
3. The super admin can create accounts with email/password from People, or approve pending Student/Teacher sign-ups there. Self-sign-ups are email-confirmed automatically but stay inactive until approval. Teacher requests map to the existing `supervisor` role. The super admin can choose Student, Student leader, or Teacher for accounts created directly.
4. Students and student leaders must have a unique enrollment number. Teachers do not get one. Add numbers to existing student profiles from People before matching them with evaluation records.

## Roles and workflow

- Super admin creates users, approves sign-ups, changes roles, and pauses access.
- Teacher (`supervisor`) reviews question submissions and creates quizzes.
- Student leaders do the same question duty as students. Their extra tools show today's question target, uploads, teacher approvals, and quiz attendance. They can assign the next duty.
- Duty assignment rotates through active students and student leaders once per cycle. The next cycle begins after every eligible person has had a turn.
- Students can revise their own pending or revision-requested questions. Teachers and super admins can edit or delete questions at any review stage.
- Students see their own questions and questions belonging to a quiz only after they start that quiz. Other students cannot browse the approved question bank before starting a quiz.
- Question sources may be publication names or URLs; sources and explanations are optional.
- A student can declare availability or leave per date. Automatic and manual duty assignment skip unavailable students and preserve the no-repeat rotation.
- Teachers and super admins can tag special questions and filter the bank by date, contributor, and category while creating a quiz.
- Quiz results may appear after each submission or after a teacher/super admin publishes them. Students can revisit released answers and explanations.
- Student and student-leader enrollment numbers come from signup. The activation RPC uses the saved profile value or auth signup metadata automatically. The super admin enters a number only when neither signup record has it.
- Question and quiz data refresh when users switch sections or return to the tab.

The Site URL is publicly reachable so prospective students and teachers can open sign-up. Workspace data still requires an authenticated, active Supabase profile; keep the RLS policies enabled.
