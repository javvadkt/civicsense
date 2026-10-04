"use client";

import { useMemo, useState } from "react";
import { CheckCircle, ExternalLink, X, XCircle } from "lucide-react";

export type QuizResultData = {
  quiz_id?: string;
  title: string;
  score: number;
  total: number;
  submitted_at?: string;
  questions: {
    id: string;
    stem: string;
    topic?: string;
    options: string[];
    selected_index: number | null;
    correct_index: number;
    is_correct: boolean;
    explanation?: string | null;
    source?: string | null;
  }[];
};

type Props = {
  result: QuizResultData | null;
  isOpen: boolean;
  onClose: () => void;
};

export default function StudentResultModal({ result, isOpen, onClose }: Props) {
  const [reviewFilter, setReviewFilter] = useState<"all" | "correct" | "wrong" | "skipped">("all");

  const topicStats = useMemo(() => {
    if (!result?.questions) return [];
    const map: Record<string, { total: number; correct: number }> = {};
    result.questions.forEach(q => {
      const t = q.topic || "General";
      if (!map[t]) map[t] = { total: 0, correct: 0 };
      map[t].total++;
      if (q.is_correct) map[t].correct++;
    });
    return Object.entries(map).map(([topic, stat]) => ({
      topic,
      total: stat.total,
      correct: stat.correct,
      pct: Math.round((stat.correct / stat.total) * 100)
    }));
  }, [result]);

  if (!isOpen || !result) return null;

  const correctCount = result.questions.filter(q => q.is_correct).length;
  const wrongCount = result.questions.filter(q => !q.is_correct && q.selected_index !== null && q.selected_index !== undefined).length;
  const skippedCount = result.questions.filter(q => q.selected_index === null || q.selected_index === undefined).length;

  const filteredQuestions = result.questions.filter(q => {
    const isSkipped = q.selected_index === null || q.selected_index === undefined;
    if (reviewFilter === "correct") return q.is_correct;
    if (reviewFilter === "wrong") return !q.is_correct && !isSkipped;
    if (reviewFilter === "skipped") return isSkipped;
    return true;
  });

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "860px", width: "96%", maxHeight: "94vh", display: "flex", flexDirection: "column" }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">UPSC PERFORMANCE & ANSWER REVIEW</span>
            <h2>{result.title}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
            <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center", background: "#f8fafc" }}>
              <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Final Score</span>
              <strong style={{ fontSize: "22px", display: "block" }}>{result.score} / {result.total}</strong>
              <small style={{ color: "#10b981", fontWeight: 600 }}>{Math.round((result.score / (result.total || 1)) * 100)}% Accuracy</small>
            </article>
            <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Correct</span>
              <strong style={{ fontSize: "22px", display: "block", color: "#10b981" }}>{correctCount}</strong>
            </article>
            <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Wrong</span>
              <strong style={{ fontSize: "22px", display: "block", color: "#ef4444" }}>{wrongCount}</strong>
            </article>
            <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Skipped</span>
              <strong style={{ fontSize: "22px", display: "block", color: "#64748b" }}>{skippedCount}</strong>
            </article>
          </div>

          {topicStats.length > 0 && (
            <div className="card" style={{ padding: "14px", margin: 0, background: "var(--surface,#fff)" }}>
              <strong style={{ fontSize: "13px", display: "block", marginBottom: "8px" }}>Topic-Wise Accuracy (UPSC Revision)</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                {topicStats.map(stat => (
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

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {[
              { id: "all", label: "All Questions", count: result.questions.length },
              { id: "correct", label: "Correct", count: correctCount },
              { id: "wrong", label: "Wrong", count: wrongCount },
              { id: "skipped", label: "Skipped", count: skippedCount }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                className={reviewFilter === tab.id ? "primary" : "outline"}
                style={{ padding: "4px 12px", borderRadius: "16px", fontSize: "12px" }}
                onClick={() => setReviewFilter(tab.id as any)}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {filteredQuestions.map((q, i) => {
              const isSkipped = q.selected_index === null || q.selected_index === undefined;
              return (
                <article key={q.id} className="card" style={{ padding: "16px", margin: 0, borderLeft: q.is_correct ? "4px solid #10b981" : isSkipped ? "4px solid #64748b" : "4px solid #ef4444" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                    <strong>{i + 1}. {q.stem}</strong>
                    <span className={`tag ${q.is_correct ? "approved" : isSkipped ? "pending" : "revision_requested"}`}>
                      {q.is_correct ? "Correct" : isSkipped ? "Skipped" : "Wrong"}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "10px 0" }}>
                    {q.options.map((opt, optIdx) => {
                      const isCorrectOpt = optIdx === q.correct_index;
                      const isUserPick = optIdx === q.selected_index;
                      return (
                        <div
                          key={optIdx}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            border: isCorrectOpt ? "1px solid #10b981" : isUserPick && !q.is_correct ? "1px solid #ef4444" : "1px solid var(--border,#e2e8f0)",
                            background: isCorrectOpt ? "#f0fdf4" : isUserPick && !q.is_correct ? "#fef2f2" : "transparent"
                          }}
                        >
                          <span><b>{"ABCD"[optIdx]}.</b> {opt}</span>
                          {isCorrectOpt && <span style={{ color: "#10b981", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}><CheckCircle size={14} /> Correct Answer</span>}
                          {isUserPick && !isCorrectOpt && <span style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}><XCircle size={14} /> Your Pick</span>}
                        </div>
                      );
                    })}
                  </div>
                  {q.explanation && (
                    <p style={{ fontSize: "13px", background: "#f8fafc", padding: "10px", borderRadius: "6px", margin: "8px 0" }}>
                      <b>Explanation:</b> {q.explanation}
                    </p>
                  )}
                  {q.source && (
                    <p className="source">
                      <b>Source:</b>{" "}
                      {/^https?:\/\//i.test(q.source) ? (
                        <a href={q.source} target="_blank" rel="noopener noreferrer">{q.source} <ExternalLink size={13} /></a>
                      ) : (
                        q.source
                      )}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
