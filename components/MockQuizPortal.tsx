"use client";

import { useEffect, useState } from "react";
import { CheckCircle, ExternalLink, Timer, X, XCircle } from "lucide-react";
import type { MockQuizSession, PreparedMockQuestion } from "./MockQuizModal";

type MockResult = {
  score: number;
  total: number;
  wrong: number;
  skipped: number;
  pct: number;
  topicStats: { topic: string; total: number; correct: number; pct: number }[];
  questions: (PreparedMockQuestion & { userPick?: number })[];
};

type Props = {
  session: MockQuizSession | null;
  onClose: () => void;
  onRestart: () => void;
};

export default function MockQuizPortal({ session, onClose, onRestart }: Props) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scrollMode, setScrollMode] = useState<"scroll" | "single">(session?.scrollMode || "scroll");
  const [timeRemaining, setTimeRemaining] = useState<number | null>(
    session && session.timerMinutes > 0 ? session.timerMinutes * 60 : null
  );
  const [result, setResult] = useState<MockResult | null>(null);

  const questions = session?.questions || [];

  const handleFinish = () => {
    let score = 0;
    let wrong = 0;
    let skipped = 0;
    const topicMap: Record<string, { total: number; correct: number }> = {};

    questions.forEach(q => {
      const t = q.topic || "General";
      if (!topicMap[t]) topicMap[t] = { total: 0, correct: 0 };
      topicMap[t].total++;

      const userPick = answers[q.id];
      if (userPick === undefined) {
        skipped++;
      } else if (userPick === q.correct_index) {
        score++;
        topicMap[t].correct++;
      } else {
        wrong++;
      }
    });

    const total = questions.length;
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const topicStats = Object.entries(topicMap).map(([t, data]) => ({
      topic: t,
      total: data.total,
      correct: data.correct,
      pct: Math.round((data.correct / data.total) * 100)
    }));

    setResult({
      score,
      total,
      wrong,
      skipped,
      pct,
      topicStats,
      questions: questions.map(q => ({ ...q, userPick: answers[q.id] }))
    });
    setTimeRemaining(null);
  };

  useEffect(() => {
    if (!session || result || timeRemaining === null) return;
    if (timeRemaining <= 0) {
      handleFinish();
      return;
    }
    const timer = setInterval(() => {
      setTimeRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [session, result, timeRemaining]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return null;

  if (result) {
    return (
      <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "860px", width: "96%", maxHeight: "94vh", display: "flex", flexDirection: "column" }}>
          <div className="modal-head">
            <div>
              <span className="eyebrow">PRACTICE EVALUATION · UNGRADED</span>
              <h2>Practice test scorecard</h2>
            </div>
            <button className="icon-button" aria-label="Close scorecard" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
              <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center", background: "#f8fafc" }}>
                <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Final Score</span>
                <strong style={{ fontSize: "22px", display: "block" }}>{result.score} / {result.total}</strong>
                <small style={{ color: "#10b981", fontWeight: 600 }}>{result.pct}% Accuracy</small>
              </article>
              <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Correct</span>
                <strong style={{ fontSize: "22px", display: "block", color: "#10b981" }}>{result.score}</strong>
              </article>
              <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Wrong</span>
                <strong style={{ fontSize: "22px", display: "block", color: "#ef4444" }}>{result.wrong}</strong>
              </article>
              <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Skipped</span>
                <strong style={{ fontSize: "22px", display: "block", color: "#64748b" }}>{result.skipped}</strong>
              </article>
            </div>

            {result.topicStats.length > 0 && (
              <div className="card" style={{ padding: "14px", margin: 0, background: "var(--surface,#fff)" }}>
                <strong style={{ fontSize: "13px", display: "block", marginBottom: "8px" }}>Topic-Wise Accuracy</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                  {result.topicStats.map(stat => (
                    <div key={stat.topic} style={{ fontSize: "12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                        <span>{stat.topic}</span>
                        <b>{stat.correct}/{stat.total} ({stat.pct}%)</b>
                      </div>
                      <div style={{ height: "6px", width: "100%", background: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${stat.pct}%`, background: stat.pct >= 70 ? "#10b981" : stat.pct >= 40 ? "#f59e0b" : "#ef4444" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {result.questions.map((q, i) => {
                const isCorrect = q.userPick === q.correct_index;
                const isSkipped = q.userPick === undefined;
                return (
                  <article key={q.id} className="card" style={{ padding: "16px", margin: 0, borderLeft: isCorrect ? "4px solid #10b981" : isSkipped ? "4px solid #64748b" : "4px solid #ef4444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                      <strong>{i + 1}. {q.stem}</strong>
                      <span className={`tag ${isCorrect ? "approved" : isSkipped ? "pending" : "revision_requested"}`}>
                        {isCorrect ? "Correct" : isSkipped ? "Skipped" : "Wrong"}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "10px 0" }}>
                      {q.options.map((opt, optIdx) => {
                        const isCorrectOpt = optIdx === q.correct_index;
                        const isUserPick = optIdx === q.userPick;
                        return (
                          <div key={optIdx} style={{ padding: "8px 12px", borderRadius: "6px", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "space-between", border: isCorrectOpt ? "1px solid #10b981" : isUserPick && !isCorrect ? "1px solid #ef4444" : "1px solid var(--border,#e2e8f0)", background: isCorrectOpt ? "#f0fdf4" : isUserPick && !isCorrect ? "#fef2f2" : "transparent" }}>
                            <span><b>{"ABCD"[optIdx]}.</b> {opt}</span>
                            {isCorrectOpt && <span style={{ color: "#10b981", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}><CheckCircle size={14} /> Correct Answer</span>}
                            {isUserPick && !isCorrectOpt && <span style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}><XCircle size={14} /> Your Choice</span>}
                          </div>
                        );
                      })}
                    </div>
                    {q.explanation && <p style={{ fontSize: "13px", background: "#f8fafc", padding: "10px", borderRadius: "6px", margin: "8px 0" }}><b>Explanation:</b> {q.explanation}</p>}
                    {q.source_url && <p className="source"><b>Source:</b> <a href={q.source_url} target="_blank" rel="noopener noreferrer">{q.source_url} <ExternalLink size={13} /></a></p>}
                  </article>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
              <button type="button" className="primary" onClick={onRestart}>Start another practice quiz</button>
              <button type="button" className="outline" onClick={onClose}>Back to Question Bank</button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="quiz-portal" style={{ zIndex: 90 }}>
      <header className="portal-header">
        <div>
          <span className="eyebrow" style={{ color: "#2563eb" }}>PRACTICE ONLY · UNGRADED MOCK QUIZ</span>
          <h1>Self-run practice quiz</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "auto" }}>
          <div style={{ display: "flex", gap: "4px", background: "#f1f5f9", padding: "4px", borderRadius: "8px" }}>
            <button type="button" className={scrollMode === "single" ? "primary" : "plain"} style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "6px" }} onClick={() => setScrollMode("single")}>Single</button>
            <button type="button" className={scrollMode === "scroll" ? "primary" : "plain"} style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "6px" }} onClick={() => setScrollMode("scroll")}>Scroll</button>
          </div>
          {timeRemaining !== null && (
            <div className={`timer ${timeRemaining < 60 ? "timer-low" : ""}`}>
              <Timer size={18} />
              <span>{String(Math.floor(timeRemaining / 60)).padStart(2, "0")}:{String(timeRemaining % 60).padStart(2, "0")}</span>
            </div>
          )}
          <button type="button" className="outline" onClick={() => { if (confirm("Exit practice quiz? Your answers will not be saved.")) onClose(); }}>Exit</button>
        </div>
      </header>
      <div className="portal-body">
        <aside className="question-nav">
          <strong>Questions ({Object.keys(answers).length}/{questions.length})</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", margin: "12px 0" }}>
            {questions.map((q, i) => (
              <button key={q.id} type="button" className={answers[q.id] !== undefined ? "answered" : ""} onClick={() => { if (scrollMode === "single") setCurrentIndex(i); else document.getElementById(`mock-q-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} style={{ border: scrollMode === "single" && currentIndex === i ? "2px solid #2563eb" : undefined }}>{i + 1}</button>
            ))}
          </div>
          <button type="button" className="primary" style={{ width: "100%", marginTop: "14px" }} onClick={handleFinish}>Submit practice quiz</button>
        </aside>
        <section className="portal-questions">
          {scrollMode === "single" ? (
            (() => {
              const q = questions[currentIndex];
              if (!q) return null;
              return (
                <article className="portal-question" key={q.id}>
                  <span className="eyebrow">QUESTION {currentIndex + 1} OF {questions.length} · {q.topic}</span>
                  <h2>{q.stem}</h2>
                  <div className="portal-options">
                    {q.options.map((opt, j) => (
                      <label key={j} className={answers[q.id] === j ? "chosen" : ""}>
                        <input type="radio" name={q.id} checked={answers[q.id] === j} onChange={() => setAnswers({ ...answers, [q.id]: j })} />
                        <span className="option-letter">{"ABCD"[j]}</span>
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "24px" }}>
                    <button type="button" className="outline" disabled={currentIndex === 0} onClick={() => setCurrentIndex(currentIndex - 1)}>Previous</button>
                    {currentIndex < questions.length - 1 ? (
                      <button type="button" className="primary" onClick={() => setCurrentIndex(currentIndex + 1)}>Next question</button>
                    ) : (
                      <button type="button" className="primary" onClick={handleFinish}>Submit answers</button>
                    )}
                  </div>
                </article>
              );
            })()
          ) : (
            <>
              {questions.map((q, i) => (
                <article className="portal-question" id={`mock-q-${i}`} key={q.id}>
                  <span className="eyebrow">QUESTION {i + 1} OF {questions.length} · {q.topic}</span>
                  <h2>{q.stem}</h2>
                  <div className="portal-options">
                    {q.options.map((opt, j) => (
                      <label key={j} className={answers[q.id] === j ? "chosen" : ""}>
                        <input type="radio" name={q.id} checked={answers[q.id] === j} onChange={() => setAnswers({ ...answers, [q.id]: j })} />
                        <span className="option-letter">{"ABCD"[j]}</span>
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                </article>
              ))}
              <button type="button" className="primary portal-submit" onClick={handleFinish}>Submit practice quiz</button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
