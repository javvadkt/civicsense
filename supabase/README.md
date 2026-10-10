# CivicPrep Supabase setup

## Database scripts

The SQL files in this folder are bootstrap scripts and incremental repairs, not a generated snapshot of the live Supabase project. The live database changes only when a script is explicitly run in the Supabase SQL Editor or through the Supabase CLI. Do not rerun old setup or upgrade scripts against a newer live database just to make the files appear synchronized.

`live_schema_snapshot.json` is a read-only catalog snapshot of the live `public` schema, based on the SQL Editor inventory shared on 2026-10-06. It records table columns, constraints, indexes, row-level security policies, functions, triggers, enums, RLS flags, and table grants. It is documentation, not a migration; refresh it after making schema changes in Supabase.

`setup.sql` is the original bootstrap script; **do not run it on an existing project** because it creates types and base objects. The older upgrades and fixes below record prior deployment steps and should only be used when the project is at the matching earlier schema version:

1. `upgrade_member_signup_and_duty_rotation.sql`
2. `add_student_enrollment_number.sql`
3. `upgrade_question_quiz_duty_features.sql`
4. `fix_signup_enrollment_and_activation.sql` (only if enrollment or activation needs that repair)
5. `fix_duty_rotation_null_cycle.sql` (only if duty assignment needs that repair)

For the inspected live project, `fix_live_question_visibility_and_quiz_submissions.sql` is the targeted patch for student question visibility, practice-pool visibility, and quiz answer recovery. It has been run in the SQL Editor. Before applying any other historical SQL to this project, compare it with the live schema.

Run `enable_quiz_realtime.sql` once in the Supabase SQL Editor to add quiz changes to the `supabase_realtime` publication. The app uses this stream for quiz scheduling, early closure, and result-release updates; existing RLS policies continue to control which quiz rows each authenticated user can read.

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
- Students can browse their own questions at any time. Other students can browse questions from an after-release quiz only after its results are published; a student does not need to have taken that quiz. While a quiz is live, only its participants can read its questions. Practice mode uses the same visibility rules.
- Question sources may be publication names or URLs; sources and explanations are optional.
- A student can declare availability or leave per date. Automatic and manual duty assignment skip unavailable students and preserve the no-repeat rotation.
- Teachers and super admins can tag special questions and filter the bank by date, contributor, and category while creating a quiz.
- Quiz results may appear after each submission or after a teacher/super admin publishes them. Students can revisit released answers and explanations.
- Student and student-leader enrollment numbers come from signup. The activation RPC uses the saved profile value or auth signup metadata automatically. The super admin enters a number only when neither signup record has it.
- Each section loads only its relevant data when opened. Returning to a visible tab refreshes that section once, even when both focus and visibility events fire.
- Question Bank results load 10 questions at a time. The quiz builder loads 100 approved questions when opened and lets teachers fetch further batches on demand. Quiz schedule and result-release changes use Supabase Realtime with a slow refresh fallback; results that become available at quiz close are refreshed at the scheduled close time.

The Site URL is publicly reachable so prospective students and teachers can open sign-up. Workspace data still requires an authenticated, active Supabase profile; keep the RLS policies enabled.
