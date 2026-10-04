"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useAppData } from "../../../context/DataProvider";

const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const dutyStatuses: Record<string, string> = {
  assigned: "Assigned",
  confirmed: "Confirmed",
  in_progress: "In progress",
  submitted: "Questions submitted",
  reviewed: "Reviewed",
  change_requested: "Change requested",
  excused: "Excused",
  missed: "Missed"
};

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

export default function OverviewPage() {
  const { profile } = useAuth();
  const { questions, duties, myDuties, quizzes, people, attempts, quizSummary } = useAppData();
  const router = useRouter();

  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!profile) return null;

  const today = getTodayIST();
  const isTeacher = profile.role === "supervisor";
  const isStudentParticipant = ["student", "student_leader"].includes(profile.role);
  const canTakeQuizzes = isStudentParticipant;

  const enrollmentFor = (id: string) => people.find(p => p.id === id)?.enrollment_number;

  const todayDuty = duties.find(d => d.duty_date === today);
  const isViewerToday = todayDuty?.student_id === profile.id;
  const todayPerson = todayDuty
    ? todayDuty.student?.full_name || people.find(p => p.id === todayDuty.student_id)?.full_name || "Student"
    : null;
  const todayEnrollment = todayDuty
    ? todayDuty.student?.enrollment_number ?? enrollmentFor(todayDuty.student_id)
    : null;

  const myAttempts = useMemo(() => new Set(attempts.map(a => a.quiz_id)), [attempts]);

  const liveUnsubmitted = useMemo(() => {
    return quizzes.filter(
      q =>
        q.published &&
        new Date(q.opens_at).getTime() <= clock &&
        new Date(q.closes_at).getTime() >= clock &&
        !(q as any).ended_early_at &&
        !myAttempts.has(q.id)
    ).length;
  }, [quizzes, clock, myAttempts]);

  const pending = useMemo(
    () => questions.filter(q => ["pending", "revision_requested"].includes(q.status)),
    [questions]
  );

  const sortedDuties = useMemo(() => {
    return [...myDuties].sort((a, b) => {
      const aFuture = a.duty_date >= today;
      const bFuture = b.duty_date >= today;
      if (aFuture && bFuture) return a.duty_date.localeCompare(b.duty_date);
      if (aFuture) return -1;
      if (bFuture) return 1;
      return b.duty_date.localeCompare(a.duty_date);
    });
  }, [myDuties, today]);

  return (
    <>
      <div className="intro">
        <h2>Welcome, {profile.full_name.split(" ")[0]}</h2>
        <p>
          {profile.role === "supervisor"
            ? "Review questions, manage members, schedule duties, and publish quizzes."
            : profile.role === "student_leader"
            ? "Do your question duties, and assist with managing the rotation: assign, swap and edit duties."
            : "Confirm your assigned duty, submit your questions, and take class quizzes."}
        </p>
      </div>

      {/* Today's Duty Card (All Roles) */}
      <section className="card today-duty-card">
        <div className="card-head-row">
          <div>
            <span className="eyebrow">
              TODAY'S DUTY · {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </span>
            <h3>{todayDuty ? todayPerson : "No duty assigned today"}</h3>
          </div>
          {todayDuty && (
            <span className={`duty-status status-${todayDuty.duty_status || "assigned"}`}>
              {dutyStatuses[todayDuty.duty_status] || "Assigned"}
            </span>
          )}
        </div>
        {todayDuty ? (
          <div className="today-duty-body">
            <div className="today-duty-meta">
              {todayEnrollment && (
                <span>
                  <strong>Roll:</strong> {todayEnrollment}
                </span>
              )}
              <span>
                <strong>Target:</strong> {todayDuty.target_count} questions
              </span>
            </div>
            {isViewerToday && (
              <div className="today-duty-banner">
                <CheckCircle2 size={16} />
                <span>You are on duty today</span>
              </div>
            )}
          </div>
        ) : (
          <p className="muted-desc">No student is scheduled for question duty today.</p>
        )}
      </section>

      {/* 3 Metric Stat Cards */}
      <div className="stats">
        {isTeacher ? (
          (() => {
            const pendingNew = questions.filter(q => q.status === "pending").length;
            const revisionReq = questions.filter(q => q.status === "revision_requested").length;
            const conducted = quizzes.filter(
              q => q.published && (clock > new Date(q.closes_at).getTime() || Boolean((q as any).ended_early_at))
            );
            const waitingPublish = conducted.filter(
              q => q.result_visibility === "after_release" && !q.results_published
            ).length;
            const scheduled = quizzes
              .filter(q => q.published && clock < new Date(q.opens_at).getTime() && !(q as any).ended_early_at)
              .sort((a, b) => new Date(a.opens_at).getTime() - new Date(b.opens_at).getTime());
            const nextUp = scheduled[0];

            return (
              <>
                <article
                  style={{ cursor: "pointer" }}
                  onClick={() => router.push("/review")}
                  title="Click to open Review queue"
                >
                  <span>Questions to approve</span>
                  <strong>{pending.length}</strong>
                  <small>
                    {pendingNew} new · {revisionReq} correction{revisionReq === 1 ? "" : "s"}
                  </small>
                </article>
                <article>
                  <span>Quizzes conducted</span>
                  <strong>{conducted.length}</strong>
                  <small>
                    {waitingPublish > 0
                      ? `${waitingPublish} result${waitingPublish === 1 ? "" : "s"} waiting to publish`
                      : "All results released"}
                  </small>
                </article>
                <article>
                  <span>Quizzes scheduled</span>
                  <strong>{scheduled.length}</strong>
                  <small>
                    {nextUp
                      ? `Next: ${nextUp.title} · ${new Date(nextUp.opens_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric"
                        })}`
                      : "None scheduled"}
                  </small>
                </article>
              </>
            );
          })()
        ) : (
          <>
            <article>
              <span>My contributions</span>
              <strong>{questions.filter(q => q.author_id === profile.id).length}</strong>
              <small>All statuses</small>
            </article>
            <article>
              <span>Live quizzes</span>
              <strong>{liveUnsubmitted}</strong>
              <small>Open now, not yet taken</small>
            </article>
            <article>
              <span>My next duty</span>
              <strong>
                {duties.find(d => d.student_id === profile.id && d.duty_date >= today)?.duty_date || "None"}
              </strong>
              <small>Five questions per day</small>
            </article>
          </>
        )}
      </div>

      {/* Quiz Scorecard (Student and Student Leader) */}
      {canTakeQuizzes && (
        <section className="card quiz-scorecard">
          <div className="card-head-row">
            <div>
              <span className="eyebrow">ACADEMIC PERFORMANCE</span>
              <h3>Quiz scorecard</h3>
            </div>
            {quizSummary && quizSummary.pending_results > 0 && (
              <span className="tag pending">
                {quizSummary.pending_results} result{quizSummary.pending_results === 1 ? "" : "s"} pending
              </span>
            )}
          </div>
          {quizSummary ? (
            <div className="scorecard-grid">
              <article className="scorecard-stat">
                <span>Quizzes attended</span>
                <strong>
                  {quizSummary.attended} <i>of {quizSummary.eligible}</i>
                </strong>
                <small>Published quizzes opened so far</small>
              </article>
              <article className="scorecard-stat">
                <span>Total marks</span>
                <strong>
                  {quizSummary.marks_got} / {quizSummary.marks_total} <i>({quizSummary.percent}%)</i>
                </strong>
                <small>
                  {quizSummary.pending_results > 0
                    ? "Excludes quizzes awaiting result release"
                    : "Across all completed eligible quizzes"}
                </small>
              </article>
            </div>
          ) : (
            <p className="muted-desc">Loading quiz performance summary…</p>
          )}
        </section>
      )}

      {/* My Duties List (Students & Student Leaders) */}
      {isStudentParticipant && (
        <section className="card my-duties-card">
          <div className="card-head-row">
            <div>
              <span className="eyebrow">SCHEDULE & HISTORY</span>
              <h3>My duties</h3>
            </div>
            <span className="pill">{myDuties.length} total</span>
          </div>
          <div className="my-duties-list">
            {sortedDuties.map(d => {
              const isLive = d.duty_date === today;
              const isOpenLate =
                d.duty_date < today && ["assigned", "confirmed", "in_progress"].includes(d.duty_status || "assigned");
              const isPast = d.duty_date < today;
              const rowClass = `my-duty-row ${isLive ? "live" : isPast ? "past" : "upcoming"}`;
              const formattedDate = new Date(`${d.duty_date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short"
              });

              return (
                <div key={d.id} className={rowClass}>
                  <div className="my-duty-info">
                    <span className="my-duty-date">
                      <strong>{formattedDate}</strong>
                      <small>{d.duty_date}</small>
                    </span>
                    <span className="my-duty-target">{d.target_count} questions</span>
                  </div>
                  <div className="my-duty-badges">
                    {isLive && <span className="duty-status status-live">Live</span>}
                    <span className={`duty-status status-${isOpenLate ? "missed" : d.duty_status || "assigned"}`}>
                      {dutyStatuses[d.duty_status] || d.duty_status}
                      {isOpenLate ? " · Overdue" : ""}
                    </span>
                  </div>
                </div>
              );
            })}
            {!sortedDuties.length && <Empty text="No duties have been assigned to you." />}
          </div>
        </section>
      )}
    </>
  );
}
