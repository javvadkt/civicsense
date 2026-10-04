"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Edit,
  Eye,
  MoreVertical,
  Play,
  Plus,
  Timer,
  Users
} from "lucide-react";
import { useAuth, request } from "../../../context/AuthContext";
import { useAppData, Quiz } from "../../../context/DataProvider";
import QuizBuilder, { QuizPayload } from "../../QuizBuilder";
import QuizAttendeesModal from "../../../components/QuizAttendeesModal";
import StudentResultModal, { QuizResultData } from "../../../components/StudentResultModal";
import EndQuizEarlyModal from "../../../components/EndQuizEarlyModal";

function QuizzesListContent() {
  const { session, profile, flash, setError } = useAuth();
  const { quizzes, attempts, reload, change } = useAppData();
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = session?.access_token || "";
  const filterParam = searchParams.get("filter") || "all";
  const quizFilter = ["all", "live", "upcoming", "closed"].includes(filterParam) ? filterParam : "all";

  const [clock, setClock] = useState(() => Date.now());
  const [menuQuizId, setMenuQuizId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<any | null>(null);
  const [attendeesQuiz, setAttendeesQuiz] = useState<Quiz | null>(null);
  const [selectedResult, setSelectedResult] = useState<QuizResultData | null>(null);
  const [endQuizTarget, setEndQuizTarget] = useState<Quiz | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!menuQuizId) return;
    const close = () => setMenuQuizId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuQuizId]);

  const isTeacher = profile?.role === "supervisor";
  const isLeader = profile?.role === "student_leader";
  const canManageAcademics = isTeacher;
  const canTakeQuizzes = ["student", "student_leader"].includes(profile?.role || "");

  const approvedQuestions = useMemo(
    () => questions.filter(q => q.status === "approved"),
    [questions]
  );

  const memberName = (id: string, name: string) => {
    const enroll = people.find(p => p.id === id)?.enrollment_number;
    return enroll ? `${name} · ${enroll}` : name;
  };

  const myAttempts = useMemo(() => new Map(attempts.map(a => [a.quiz_id, a])), [attempts]);

  const setFilter = (tabId: string) => {
    router.push(tabId === "all" ? "/quizzes" : `/quizzes?filter=${tabId}`);
  };

  async function handleStartQuizNow(z: Quiz) {
    if (!confirm(`Start "${z.title}" right now? It will become live immediately for students.`)) return;
    setError("");
    try {
      const now = new Date();
      const opens_at = now.toISOString();
      const currentCloses = new Date(z.closes_at).getTime();
      const minCloses = now.getTime() + z.duration_minutes * 60_000;
      const closes_at = currentCloses < minCloses ? new Date(minCloses + 36e5).toISOString() : z.closes_at;

      await change(`/rest/v1/quizzes?id=eq.${z.id}`, { opens_at, closes_at }, "PATCH");
      flash(`"${z.title}" is now Live!`);
      await reload();
    } catch (e: any) {
      setError(e.message || "Failed to start quiz now.");
    }
  }

  async function handlePublishResults(z: Quiz) {
    if (await change("/rest/v1/rpc/publish_quiz_results", { p_quiz_id: z.id })) {
      flash("Results published to students.");
      await reload();
    }
  }

  async function handleRecalculateScores(z: Quiz) {
    setError("");
    try {
      const res = await request("/rest/v1/rpc/recalculate_quiz_scores", token, "POST", { p_quiz_id: z.id });
      flash(`Scores recalculated for ${res?.updated_submissions || 0} attempts.`);
      await reload();
    } catch (e: any) {
      setError(e.message || "Failed to recalculate scores.");
    }
  }

  async function handleToggleHideQuiz(z: Quiz) {
    const nextState = !z.is_hidden;
    if (await change(`/rest/v1/quizzes?id=eq.${z.id}`, { is_hidden: nextState }, "PATCH")) {
      flash(nextState ? `"${z.title}" is now hidden from students.` : `"${z.title}" is now visible.`);
      await reload();
    }
  }

  async function handleCreateQuiz(p: QuizPayload) {
    await request("/rest/v1/rpc/create_quiz_with_settings", token, "POST", {
      p_title: p.title,
      p_kind: p.kind,
      p_question_ids: p.ids,
      p_opens_at: new Date(p.opens).toISOString(),
      p_closes_at: new Date(p.closes).toISOString(),
      p_duration_minutes: p.duration,
      p_result_visibility: p.visibility
    });
    await reload();
    flash("Quiz created and published.");
  }

  async function handleOpenEditQuiz(z: Quiz) {
    setError("");
    setMenuQuizId(null);
    try {
      const qRows = await request(
        `/rest/v1/quiz_questions?quiz_id=eq.${z.id}&select=question_id,position&order=position.asc`,
        token
      );
      setEditingQuiz({
        id: z.id,
        title: z.title,
        kind: z.kind,
        opens_at: z.opens_at,
        closes_at: z.closes_at,
        duration_minutes: z.duration_minutes,
        result_visibility: z.result_visibility,
        question_ids: (qRows || []).map((r: any) => r.question_id)
      });
      setBuilderOpen(true);
    } catch (e: any) {
      setError(e.message || "Failed to load quiz details for editing.");
    }
  }

  async function handleUpdateQuiz(id: string, p: QuizPayload) {
    await request(`/rest/v1/quizzes?id=eq.${id}`, token, "PATCH", {
      title: p.title,
      kind: p.kind,
      opens_at: new Date(p.opens).toISOString(),
      closes_at: new Date(p.closes).toISOString(),
      duration_minutes: p.duration,
      result_visibility: p.visibility
    });
    await request(`/rest/v1/quiz_questions?quiz_id=eq.${id}`, token, "DELETE");
    if (p.ids.length > 0) {
      const rows = p.ids.map((qId, idx) => ({ quiz_id: id, question_id: qId, position: idx + 1 }));
      await request("/rest/v1/quiz_questions", token, "POST", rows, "return=minimal");
    }
    await reload();
    flash("Quiz updated successfully.");
    setEditingQuiz(null);
    setBuilderOpen(false);
  }

  async function handleShowResult(z: Quiz) {
    try {
      const res = await request("/rest/v1/rpc/get_my_quiz_result", token, "POST", { p_quiz_id: z.id });
      setSelectedResult(res);
    } catch (e: any) {
      setError(e.message || "Failed to load quiz results");
    }
  }

  async function handleDeleteQuiz(z: Quiz) {
    if (!confirm(`Are you sure you want to delete "${z.title}"? This cannot be undone.`)) return;
    setError("");
    try {
      let deleted = false;
      try {
        await request("/rest/v1/rpc/delete_quiz_cascade", token, "POST", { p_quiz_id: z.id });
        deleted = true;
      } catch {
        await request(`/rest/v1/quiz_attempts?quiz_id=eq.${z.id}`, token, "DELETE");
        await request(`/rest/v1/quiz_attempt_starts?quiz_id=eq.${z.id}`, token, "DELETE");
        await request(`/rest/v1/quiz_questions?quiz_id=eq.${z.id}`, token, "DELETE");
        await request(`/rest/v1/quizzes?id=eq.${z.id}`, token, "DELETE");
        deleted = true;
      }
      if (deleted) {
        flash(`Deleted "${z.title}".`);
        await reload();
      }
    } catch (e: any) {
      setError(e.message || "Failed to delete quiz.");
    }
  }

  return (
    <>
     {canManageAcademics && (
        <div className="section-title">
          <p>Create timed quizzes from approved questions.</p>
          <button
            className="primary"
            onClick={() => {
              setEditingQuiz(null);
              setBuilderOpen(true);
            }}
          >
            <Plus size={16} /> Create quiz
          </button>
        </div>
      )}

      {builderOpen && canManageAcademics && (
        <QuizBuilder
          questions={approvedQuestions}
          memberName={memberName}
          onCreate={handleCreateQuiz}
          onUpdate={handleUpdateQuiz}
          onClose={() => {
            setBuilderOpen(false);
            setEditingQuiz(null);
          }}
          editingQuiz={editingQuiz}
        />
      )}

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
        {[
          { id: "all", label: "All" },
          { id: "live", label: "Live" },
          { id: "upcoming", label: "Upcoming" },
          { id: "closed", label: "Closed" }
        ].map(tab => {
          const count = quizzes.filter(q => {
            if (q.is_hidden && !isTeacher) return false;
            const o = new Date(q.opens_at).getTime();
            const e = new Date(q.closes_at).getTime();
            const isEnd = q.ended_early_at || clock > e;
            const isLive = clock >= o && clock <= e && !q.ended_early_at;
            const isUp = clock < o;
            if (tab.id === "live") return isLive;
            if (tab.id === "upcoming") return isUp;
            if (tab.id === "closed") return isEnd;
            return true;
          }).length;

          return (
            <button
              key={tab.id}
              type="button"
              className={quizFilter === tab.id ? "primary" : "outline"}
              style={{ padding: "6px 14px", borderRadius: "20px", fontSize: "13px" }}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label} <b style={{ marginLeft: "4px", opacity: 0.8 }}>{count}</b>
            </button>
          );
        })}
      </div>

      {/* Quiz Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {quizzes
          .filter(z => {
            if (z.is_hidden && !isTeacher) return false;
            const o = new Date(z.opens_at).getTime();
            const e = new Date(z.closes_at).getTime();
            const isEnd = z.ended_early_at || clock > e;
            const isLive = clock >= o && clock <= e && !z.ended_early_at;
            const isUp = clock < o;
            if (quizFilter === "live") return isLive;
            if (quizFilter === "upcoming") return isUp;
            if (quizFilter === "closed") return isEnd;
            return true;
          })
          .map(z => {
            const attempt = myAttempts.get(z.id);
            const isSubmitted = attempt?.status === "submitted";
            const isInProgress = attempt?.status === "in_progress";
            const o = new Date(z.opens_at).getTime();
            const e = new Date(z.closes_at).getTime();
            const isEndedEarly = Boolean(z.ended_early_at);
            const isLive = clock >= o && clock <= e && !isEndedEarly;
            const isUpcoming = clock < o;
            const isClosed = clock > e || isEndedEarly;
            const isHidden = Boolean(z.is_hidden);

            const statusTag = isHidden
              ? { label: "Hidden", cls: "danger" }
              : isLive
              ? { label: "Live", cls: "approved" }
              : isUpcoming
              ? { label: "Upcoming", cls: "pending" }
              : { label: isEndedEarly ? "Ended early" : "Closed", cls: "revision_requested" };

            const hoursUntil = Math.max(1, Math.ceil((o - clock) / 36e5));

            const canPublish = canManageAcademics && z.result_visibility === "after_release" && !z.results_published;
            const canViewAttendees = canManageAcademics || isLeader;
            const canViewQuestions = canManageAcademics;
            const canReviewAnswers =
              canTakeQuizzes &&
              isClosed &&
              isSubmitted &&
              (z.result_visibility === "immediate" || z.results_published);
            const canStartNow = canManageAcademics && isUpcoming;
            const canEditQuiz = canManageAcademics && isUpcoming;
            const canEndEarly = canManageAcademics && isLive;

            const hasDropdownActions = !canManageAcademics && !isLeader
              ? isClosed && canReviewAnswers
              : canViewAttendees || canViewQuestions || canPublish || canStartNow || canEditQuiz || canEndEarly || canManageAcademics;

            return (
              <section
                key={z.id}
                className="card"
                style={{
                  margin: 0,
                  padding: "14px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                  borderLeft: isLive ? "4px solid #10b981" : isUpcoming ? "4px solid #f59e0b" : "4px solid #94a3b8"
                }}
              >
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "16px" }}>{z.title}</strong>
                    <span className={`tag ${statusTag.cls}`}>{statusTag.label}</span>
                    {isHidden && <span className="tag pending">Teacher only</span>}
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--muted-fg,#64748b)", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <span>{z.kind}</span>
                    <span>•</span>
                    <span>{z.duration_minutes} mins</span>
                    <span>•</span>
                    <span>
                      {new Date(z.opens_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}{" "}
                      – {new Date(z.closes_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span>•</span>
                    <span>Results {z.result_visibility === "immediate" ? "immediate" : "after release"}</span>
                  </div>
                  {attempt && isSubmitted ? (
                    <small className="attended" style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px" }}>
                      <CheckCircle2 size={14} /> Attended • Submitted{" "}
                      {new Date(attempt.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </small>
                  ) : isInProgress && isLive ? (
                    <small style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px", color: "#d97706", fontWeight: 600 }}>
                      <Timer size={14} /> In progress • Answers autosaved
                    </small>
                  ) : null}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    position: "relative",
                    marginLeft: "auto",
                    justifyContent: "flex-end",
                    flexShrink: 0
                  }}
                >
                  {/* Primary Action Button */}
                  {canTakeQuizzes &&
                    (isSubmitted ? (
                      z.result_visibility === "after_release" && !z.results_published ? (
                        <span className="tag pending">Results pending</span>
                    ) : isLive ? (
                        <button className="outline" onClick={() => handleShowResult(z)}>
                          Review answers
                        </button>
                      ) : null
                    ) : isInProgress ? (
                      <button className="outline" disabled>
                        Finalizing submission…
                      </button>
                    ) : isLive ? (
                      <button className="primary" onClick={() => router.push(`/quizzes/${z.id}`)}>
                        Start quiz
                      </button>
                    ) : isUpcoming ? (
                      <button className="outline" disabled>
                        {hoursUntil <= 24
                          ? `Opens in ${hoursUntil}h`
                          : `Opens ${new Date(z.opens_at).toLocaleDateString([], { month: "short", day: "numeric" })}`}
                      </button>
                    ) : (
                      <button className="outline" disabled>
                        Closed
                      </button>
                    ))}

                  {/* Kebab Dropdown */}
                  {hasDropdownActions && (
                    <div style={{ position: "relative" }}>
                      <button
                        className="outline"
                        style={{ padding: "8px", borderRadius: "6px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        aria-label="More quiz actions"
                        onClick={e => {
                          e.stopPropagation();
                          setMenuQuizId(menuQuizId === z.id ? null : z.id);
                        }}
                      >
                        <MoreVertical size={16} />
                      </button>

                      {menuQuizId === z.id && (
                        <div
                          className="qz-pop"
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "calc(100% + 4px)",
                            background: "var(--surface,#ffffff)",
                            border: "1px solid var(--border,#e2e8f0)",
                            borderRadius: "8px",
                            boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                            minWidth: "190px",
                            zIndex: 60,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column"
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          {canViewAttendees && (
                            <button
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", display: "flex", alignItems: "center", gap: "8px" }}
                              onClick={() => {
                                setMenuQuizId(null);
                                setAttendeesQuiz(z);
                              }}
                            >
                              <Users size={15} /> Attendees
                            </button>
                          )}

                         {canReviewAnswers && (
                            <button
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", display: "flex", alignItems: "center", gap: "8px" }}
                              onClick={() => {
                                setMenuQuizId(null);
                                handleShowResult(z);
                              }}
                            >
                              <Eye size={15} /> Review answers
                            </button>
                          )}

                          {canViewQuestions && (
                            <button
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", display: "flex", alignItems: "center", gap: "8px" }}
                              onClick={() => {
                                setMenuQuizId(null);
                                flash("Question analysis opens in Step 2.4b.");
                              }}
                            >
                              <Eye size={15} /> View questions
                            </button>
                          )}

                          {canStartNow && (
                            <button
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", color: "#10b981", display: "flex", alignItems: "center", gap: "8px" }}
                              onClick={() => {
                                setMenuQuizId(null);
                                handleStartQuizNow(z);
                              }}
                            >
                              <Play size={15} /> Start now
                            </button>
                          )}

                         {canEditQuiz && (
                            <button
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", display: "flex", alignItems: "center", gap: "8px" }}
                              onClick={() => handleOpenEditQuiz(z)}
                            >
                              <Edit size={15} /> Edit quiz
                            </button>
                          )}

                          {canPublish && (
                            <button
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%" }}
                              onClick={() => {
                                setMenuQuizId(null);
                                handlePublishResults(z);
                              }}
                            >
                              Publish results
                            </button>
                          )}

                          {canEndEarly && (
                            <button
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", color: "#ef4444" }}
                              onClick={() => {
                                setMenuQuizId(null);
                                setEndQuizTarget(z);
                              }}
                            >
                              End quiz early
                            </button>
                          )}

                          {canManageAcademics && (
                            <>
                              <button
                                className="plain"
                                style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%" }}
                                onClick={() => {
                                  setMenuQuizId(null);
                                  handleRecalculateScores(z);
                                }}
                              >
                                Recalculate scores
                              </button>

                              <button
                                className="plain"
                                style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%" }}
                                onClick={() => {
                                  setMenuQuizId(null);
                                  handleToggleHideQuiz(z);
                                }}
                              >
                                {isHidden ? "Show to students" : "Hide from students"}
                              </button>

                              <button
                                className="plain"
                                style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", color: "#ef4444" }}
                                onClick={() => {
                                  setMenuQuizId(null);
                                  handleDeleteQuiz(z);
                                }}
                              >
                                Delete quiz
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            );
          })}

       {!quizzes.length && <div className="empty">No quizzes have been published.</div>}
      </div>

      <QuizAttendeesModal
        quiz={attendeesQuiz}
        isOpen={Boolean(attendeesQuiz)}
        onClose={() => setAttendeesQuiz(null)}
        token={token}
        flash={flash}
        setError={setError}
      />

      <StudentResultModal
        result={selectedResult}
        isOpen={Boolean(selectedResult)}
        onClose={() => setSelectedResult(null)}
      />

      <EndQuizEarlyModal
        quiz={endQuizTarget}
        isOpen={Boolean(endQuizTarget)}
        onClose={() => setEndQuizTarget(null)}
        token={token}
        flash={flash}
        setError={setError}
        onEnded={reload}
      />
    </>
  );
}

export default function QuizzesPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "32px", textAlign: "center" }}>Loading quizzes…</div>}>
      <QuizzesListContent />
    </Suspense>
  );
}
