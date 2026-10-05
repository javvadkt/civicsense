"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Timer } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, request } from "../../../context/AuthContext";
import StudentResultModal, { QuizResultData } from "../../../components/StudentResultModal";

export default function QuizPortalPage() {
  const params = useParams();
  const quizId = params?.id as string;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, profile, loading: authLoading, flash } = useAuth();
  const token = session?.access_token || "";

  const [quiz, setQuiz] = useState<any | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [quizBusy, setQuizBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resultData, setResultData] = useState<QuizResultData | null>(null);

  const timerSubmitRef = useRef(false);
  const autosaveTimerRef = useRef<any>(null);

  const invalidateQuizCaches = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["my_quiz_attempts"] }),
      queryClient.invalidateQueries({ queryKey: ["quizzes_list"] }),
      queryClient.invalidateQueries({ queryKey: ["overview_stats"] }),
      queryClient.invalidateQueries({ queryKey: ["my_quiz_summary"] }),
      queryClient.invalidateQueries({ queryKey: ["question_bank"] })
    ]);
  }, [queryClient]);

  const submitQuiz = useCallback(async (auto = false) => {
    if (!quiz || quizBusy || timerSubmitRef.current) return;
    timerSubmitRef.current = true;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setQuizBusy(true);
    try {
      await request("/rest/v1/rpc/submit_quiz", token, "POST", { p_quiz_id: quiz.id, p_answers: answers });
      try {
        localStorage.removeItem(`civicprep_answers_${quiz.id}`);
        sessionStorage.removeItem("civicprep_active_quiz_id");
        sessionStorage.removeItem(`civicprep_deadline_${quiz.id}`);
      } catch {}
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

      // Invalidate cache before navigating so /quizzes immediately displays updated status
      await invalidateQuizCaches();

      if (quiz.result_visibility === "immediate") {
        const res = await request("/rest/v1/rpc/get_my_quiz_result", token, "POST", { p_quiz_id: quiz.id });
        setResultData(res);
      } else {
        flash(auto ? "Time ended. Quiz submitted automatically." : "Quiz submitted successfully.");
        router.replace("/quizzes");
      }
    } catch (e: any) {
      timerSubmitRef.current = false;
      setError(e.message || "Failed to submit quiz.");
    } finally {
      setQuizBusy(false);
    }
  }, [quiz, quizBusy, token, answers, flash, router, invalidateQuizCaches]);

  useEffect(() => {
    if (authLoading) return;
    if (!session || !profile?.active) {
      router.replace("/login");
      return;
    }
    let isMounted = true;
    (async () => {
      try {
        const [qRows, started] = await Promise.all([
          request(`/rest/v1/quizzes?id=eq.${quizId}&select=id,title,kind,duration_minutes,closes_at,result_visibility,ended_early_at,published`, token),
          request("/rest/v1/rpc/start_quiz", token, "POST", { p_quiz_id: quizId })
        ]);
        const z = qRows?.[0];
        if (!z || !z.published) throw new Error("Quiz not found or not published.");
        if (z.ended_early_at || new Date(z.closes_at).getTime() <= Date.now()) {
          throw new Error("This quiz has closed.");
        }

        const qqRows = await request(
          `/rest/v1/quiz_questions?quiz_id=eq.${quizId}&select=position,question:questions(id,stem,options,topic)&order=position.asc`,
          token
        );
        const items = (qqRows || []).map((x: any) => x.question).filter(Boolean);
        if (!items.length) throw new Error("This quiz has no available questions.");

        const startTime = started?.started_at ? new Date(started.started_at).getTime() : Date.now();
        const serverEnd = Math.min(startTime + z.duration_minutes * 60_000, new Date(z.closes_at).getTime());
        const savedDeadlineStr = sessionStorage.getItem(`civicprep_deadline_${z.id}`);
        const savedDeadline = savedDeadlineStr ? Number(savedDeadlineStr) : null;
        const end = savedDeadline && !isNaN(savedDeadline) && savedDeadline <= serverEnd ? savedDeadline : serverEnd;

        let restoredAnswers: Record<string, number> = started?.autosaved_answers || {};
        if (!Object.keys(restoredAnswers).length) {
          try {
            const local = localStorage.getItem(`civicprep_answers_${z.id}`);
            if (local) restoredAnswers = JSON.parse(local);
          } catch {}
        }

        try {
          sessionStorage.setItem("civicprep_active_quiz_id", z.id);
          sessionStorage.setItem(`civicprep_deadline_${z.id}`, String(end));
        } catch {}

        if (isMounted) {
          setQuiz(z);
          setQuizQuestions(items);
          setAnswers(restoredAnswers);
          setDeadline(end);
          setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
          document.documentElement.requestFullscreen?.().catch(() => {});
        }
      } catch (e: any) {
        if (isMounted) setError(e.message || "Failed to start quiz.");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, [quizId, token, session, profile, authLoading, router]);

  useEffect(() => {
    if (!quiz || deadline === null) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [quiz, deadline]);

  useEffect(() => {
    if (quiz && remaining === 0 && !quizBusy && !timerSubmitRef.current && deadline !== null) {
      submitQuiz(true);
    }
  }, [remaining, quiz, quizBusy, deadline, submitQuiz]);

  useEffect(() => {
    if (!quiz || !token || timerSubmitRef.current) return;
    try {
      localStorage.setItem(`civicprep_answers_${quiz.id}`, JSON.stringify(answers));
    } catch {}
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const timeTaken = Math.max(0, quiz.duration_minutes * 60 - remaining);
        const res = await request("/rest/v1/rpc/autosave_quiz_progress", token, "POST", {
          p_quiz_id: quiz.id,
          p_answers: answers,
          p_time_taken_seconds: timeTaken
        });
        if (res && res.status === "closed") submitQuiz(true);
      } catch {}
    }, 1500);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [answers, quiz, token, remaining, submitQuiz]);

  useEffect(() => {
    if (!quiz || !token) return;
    const poller = setInterval(async () => {
      try {
        const rows = await request(`/rest/v1/quizzes?id=eq.${quiz.id}&select=ended_early_at,closes_at`, token);
        const qz = rows?.[0];
        if (qz && (qz.ended_early_at || new Date(qz.closes_at).getTime() <= Date.now())) {
          clearInterval(poller);
          submitQuiz(true);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(poller);
  }, [quiz, token, submitQuiz]);

  useEffect(() => {
    if (!quiz) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Closing or leaving this page will automatically submit your quiz. Are you sure?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [quiz]);

  if (loading) return <main className="center">Loading quiz session…</main>;

  if (error) {
    return (
      <main className="center">
        <div className="auth" style={{ textAlign: "center" }}>
          <h2>Quiz Unavailable</h2>
          <p className="error" role="alert">{error}</p>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              await invalidateQuizCaches();
              router.replace("/quizzes");
            }}
          >
            Return to Quizzes
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="quiz-portal">
        <header className="portal-header">
          <div>
            <span className="eyebrow">CIVICPREP · QUIZ IN PROGRESS</span>
            <h1>{quiz?.title}</h1>
          </div>
          <div className={`timer ${remaining < 60 ? "timer-low" : ""}`}>
            <Timer size={20} />
            <span>
              {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
            </span>
          </div>
        </header>

        <div className="portal-body">
          <aside className="question-nav">
            <strong>Questions</strong>
            <div>
              {quizQuestions.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  className={answers[q.id] !== undefined ? "answered" : ""}
                  onClick={() => document.getElementById(`portal-q-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <small>{Object.keys(answers).length} of {quizQuestions.length} answered</small>
            <p>Unanswered questions are submitted as blank when time ends.</p>
          </aside>

          <section className="portal-questions">
            {quizQuestions.map((q, i) => (
              <article className="portal-question" id={`portal-q-${i}`} key={q.id}>
                <span className="eyebrow">QUESTION {i + 1} OF {quizQuestions.length} · {q.topic}</span>
                <h2>{q.stem}</h2>
                <div className="portal-options">
                  {q.options.map((option: string, j: number) => (
                    <label key={j} className={answers[q.id] === j ? "chosen" : ""}>
                      <input
                        type="radio"
                        name={q.id}
                        checked={answers[q.id] === j}
                        onChange={() => setAnswers(old => ({ ...old, [q.id]: j }))}
                      />
                      <span className="option-letter">{"ABCD"[j]}</span>
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </article>
            ))}

            <button
              type="button"
              className="primary portal-submit"
              disabled={quizBusy}
              onClick={() => {
                const left = quizQuestions.length - Object.keys(answers).length;
                if (left > 0 && !confirm(`${left} question${left === 1 ? "" : "s"} unanswered. Submit anyway?`)) return;
                submitQuiz(false);
              }}
            >
              {quizBusy ? "Submitting…" : "Submit answers"}
            </button>
          </section>
        </div>
      </div>

      <StudentResultModal
        result={resultData}
        isOpen={Boolean(resultData)}
        onClose={async () => {
          await invalidateQuizCaches();
          router.replace("/quizzes");
        }}
      />
    </>
  );
}
