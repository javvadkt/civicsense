"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, request } from "../../../context/AuthContext";
import type { Duty, QuizSummary } from "../../../context/DataProvider";

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
  const { session, profile } = useAuth();
  const router = useRouter();
  const token = session?.access_token || "";

  const isTeacher = profile?.role === "supervisor";
  const isStudentParticipant = ["student", "student_leader"].includes(profile?.role || "");

  // 1. Server-side aggregated stats (all roles)
  const {
    data: overviewData,
    isLoading: statsLoading,
    isFetching: statsFetching,
    refetch: refetchStats
  } = useQuery({
    queryKey: ["overview_stats", profile?.id],
    queryFn: () => request("/rest/v1/rpc/get_overview_stats", token, "POST", {}),
    enabled: Boolean(token && profile?.active)
  });

  // 2. Personal quiz scorecard (students & leaders only)
  const { data: quizSummary } = useQuery<QuizSummary | null>({
    queryKey: ["my_quiz_summary", profile?.id],
    queryFn: () => request("/rest/v1/rpc/get_my_quiz_summary", token, "POST", {}).catch(() => null),
    enabled: Boolean(token && profile?.active && isStudentParticipant)
  });

  // 3. Targeted personal duties (students & leaders only, limited to 20)
  const { data: myDutiesRaw = [] } = useQuery<Duty[]>({
    queryKey: ["my_duties_overview", profile?.id],
    queryFn: () =>
      request(
        `/rest/v1/duties?select=id,duty_date,student_id,target_count,rotation_cycle,duty_status,status_note&student_id=eq.${profile?.id}&order=duty_date.desc&limit=20`,
        token
      ).catch(() => []),
    enabled: Boolean(token && profile?.active && isStudentParticipant)
  });

  const today = overviewData?.today_ist || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const todayDuty = overviewData?.today_duty;
  const stats = overviewData?.stats;

  const sortedDuties = useMemo(() => {
    return [...myDutiesRaw].sort((a, b) => {
      const aFuture = a.duty_date >= today;
      const bFuture = b.duty_date >= today;
      if (aFuture && bFuture) return a.duty_date.localeCompare(b.duty_date);
      if (aFuture) return -1;
      if (bFuture) return 1;
      return b.duty_date.localeCompare(a.duty_date);
    });
  }, [myDutiesRaw, today]);

  if (!profile) return null;

  return (
    <>
      <div className="intro" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
        <div>
          <h2>Welcome, {profile.full_name.split(" ")[0]}</h2>
          <p>
            {isTeacher
              ? "Review questions, manage members, schedule duties, and publish quizzes."
              : profile.role === "student_leader"
              ? "Do your question duties, and assist with managing the rotation: assign, swap and edit duties."
              : "Confirm your assigned duty, submit your questions, and take class quizzes."}
          </p>
        </div>
        {statsFetching && !statsLoading && (
          <span className="muted" style={{ flexShrink: 0, marginTop: "6px" }}>
            <RefreshCw size={13} /> Updating
          </span>
        )}
      </div>

      {/* Today's Duty Card (All Roles) */}
      <section className="card today-duty-card">
        <div className="card-head-row">
          <div>
            <span className="eyebrow">
              TODAY'S DUTY · {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </span>
            <h3>{todayDuty ? todayDuty.student_name || "Student" : "No duty assigned today"}</h3>
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
              {todayDuty.enrollment_number && (
                <span>
                  <strong>Roll:</strong> {todayDuty.enrollment_number}
                </span>
              )}
              <span>
                <strong>Target:</strong> {todayDuty.target_count} questions
              </span>
            </div>
            {todayDuty.is_viewer_today && (
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
        {statsLoading || !stats ? (
          <>
            <article><span>Loading metrics…</span><strong>—</strong></article>
            <article><span>Loading metrics…</span><strong>—</strong></article>
            <article><span>Loading metrics…</span><strong>—</strong></article>
          </>
        ) : isTeacher ? (
          <>
            <article
              style={{ cursor: "pointer" }}
              onClick={() => router.push("/review")}
              title="Click to open Review queue"
            >
              <span>Questions to approve</span>
              <strong>{stats.pending_total ?? 0}</strong>
              <small>
                {stats.pending_new ?? 0} new · {stats.pending_revision ?? 0} correction{(stats.pending_revision ?? 0) === 1 ? "" : "s"}
              </small>
            </article>
            <article>
              <span>Quizzes conducted</span>
              <strong>{stats.conducted_count ?? 0}</strong>
              <small>
                {(stats.waiting_publish_count ?? 0) > 0
                  ? `${stats.waiting_publish_count} result${stats.waiting_publish_count === 1 ? "" : "s"} waiting to publish`
                  : "All results released"}
              </small>
            </article>
            <article>
              <span>Quizzes scheduled</span>
              <strong>{stats.scheduled_count ?? 0}</strong>
              <small>
                {stats.next_scheduled
                  ? `Next: ${stats.next_scheduled.title} · ${new Date(stats.next_scheduled.opens_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric"
                    })}`
                  : "None scheduled"}
              </small>
            </article>
          </>
        ) : (
          <>
            <article>
              <span>My contributions</span>
              <strong>{stats.my_contributions ?? 0}</strong>
              <small>All statuses</small>
            </article>
            <article>
              <span>Live quizzes</span>
              <strong>{stats.live_unsubmitted ?? 0}</strong>
              <small>Open now, not yet taken</small>
            </article>
            <article>
              <span>My next duty</span>
              <strong>{stats.next_duty_date || "None"}</strong>
              <small>Five questions per day</small>
            </article>
          </>
        )}
      </div>

      {/* Quiz Scorecard (Student and Student Leader) */}
      {isStudentParticipant && (
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
            <span className="pill">{myDutiesRaw.length} total</span>
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
