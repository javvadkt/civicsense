"use client";

import { useEffect, useState } from "react";
import { CheckCircle, ExternalLink, X } from "lucide-react";
import { request } from "../context/AuthContext";
import type { Quiz } from "../context/DataProvider";

type AnalyzedQuestion = {
  id: string;
  stem: string;
  topic: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  source_url: string | null;
  position: number;
  correct: number;
  wrong: number;
  skipped: number;
  correctPct: number;
  wrongPct: number;
  skippedPct: number;
  optionPicks: [number, number, number, number];
};

type Props = {
  quiz: Quiz | null;
  isOpen: boolean;
  onClose: () => void;
  token: string;
  setError: (msg: string) => void;
};

export default function QuestionItemAnalysisModal({
  quiz,
  isOpen,
  onClose,
  token,
  setError
}: Props) {
  const [data, setData] = useState<AnalyzedQuestion[]>([]);
  const [attemptsCount, setAttemptsCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !quiz || !token) {
      setData([]);
      setAttemptsCount(0);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const [qqRows, attemptsRows] = await Promise.all([
          request(
            `/rest/v1/quiz_questions?quiz_id=eq.${quiz.id}&select=position,question:questions(id,stem,topic,options,correct_index,explanation,source_url)&order=position.asc`,
            token
          ),
          request(
            `/rest/v1/quiz_attempts?quiz_id=eq.${quiz.id}&status=eq.submitted&select=answers`,
            token
          )
        ]);

        const items = (qqRows || [])
          .map((r: any) => ({ ...r.question, position: r.position }))
          .filter((q: any) => Boolean(q && q.id));

        const totalAttempts = (attemptsRows || []).length;
        setAttemptsCount(totalAttempts);

        const analyzed: AnalyzedQuestion[] = items.map((q: any) => {
          let correct = 0;
          let wrong = 0;
          let skipped = 0;
          const optionPicks: [number, number, number, number] = [0, 0, 0, 0];

          (attemptsRows || []).forEach((att: any) => {
            const userAns = att.answers?.[q.id];
            if (userAns === undefined || userAns === null || userAns === "") {
              skipped++;
            } else {
              const idx = Number(userAns);
              if (idx >= 0 && idx < 4) optionPicks[idx]++;
              if (idx === q.correct_index) correct++;
              else wrong++;
            }
          });

          return {
            ...q,
            correct,
            wrong,
            skipped,
            correctPct: totalAttempts > 0 ? Math.round((correct / totalAttempts) * 100) : 0,
            wrongPct: totalAttempts > 0 ? Math.round((wrong / totalAttempts) * 100) : 0,
            skippedPct: totalAttempts > 0 ? Math.round((skipped / totalAttempts) * 100) : 0,
            optionPicks
          };
        });

        setData(analyzed);
      } catch (err: any) {
        setError(err.message || "Failed to load question analysis.");
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, quiz, token, setError]);

  if (!isOpen || !quiz) return null;

  const totalQuestions = data.length;
  const overallAccuracy =
    attemptsCount > 0 && totalQuestions > 0
      ? Math.round(
          (data.reduce((acc, q) => acc + q.correct, 0) / (attemptsCount * totalQuestions)) * 100
        )
      : 0;

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "860px", width: "96%", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">QUESTION BREAKDOWN & ITEM ANALYSIS</span>
            <h2>{quiz.title}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {loading ? (
            <div className="empty">Loading question analysis…</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
                <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                  <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Total Questions</span>
                  <strong style={{ fontSize: "20px", display: "block" }}>{totalQuestions}</strong>
                </article>
                <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                  <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Students Submitted</span>
                  <strong style={{ fontSize: "20px", display: "block", color: "#10b981" }}>{attemptsCount}</strong>
                </article>
                <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                  <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Overall Accuracy</span>
                  <strong style={{ fontSize: "20px", display: "block", color: "#3b82f6" }}>
                    {attemptsCount > 0 ? `${overallAccuracy}%` : "N/A"}
                  </strong>
                </article>
              </div>

              {attemptsCount === 0 && (
                <div className="card" style={{ padding: "12px", background: "#f8fafc", margin: 0 }}>
                  <small style={{ color: "var(--muted-fg,#64748b)" }}>
                    No students have submitted attempts for this quiz yet. Showing questions and answer key below.
                  </small>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {data.map((q, idx) => (
                  <article key={q.id || idx} className="card" style={{ padding: "16px", margin: 0, borderLeft: "4px solid var(--accent, #3b82f6)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                      <div>
                        <span className="eyebrow" style={{ fontSize: "11px" }}>QUESTION {idx + 1} · {q.topic}</span>
                        <h4 style={{ margin: "4px 0 0 0", fontSize: "15px", fontWeight: 600 }}>{q.stem}</h4>
                      </div>
                      {attemptsCount > 0 && (
                        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                          <span className="tag approved">{q.correct} correct ({q.correctPct}%)</span>
                          <span className="tag revision_requested">{q.wrong} wrong ({q.wrongPct}%)</span>
                          {q.skipped > 0 && <span className="tag pending">{q.skipped} skipped</span>}
                        </div>
                      )}
                    </div>

                    {attemptsCount > 0 && (
                      <div style={{ width: "100%", height: "6px", background: "#fee2e2", borderRadius: "3px", overflow: "hidden", margin: "8px 0 12px 0", display: "flex" }}>
                        <div style={{ width: `${q.correctPct}%`, background: "#10b981", transition: "width 0.3s" }} title={`Correct: ${q.correctPct}%`} />
                        <div style={{ width: `${q.skippedPct}%`, background: "#94a3b8", transition: "width 0.3s" }} title={`Skipped: ${q.skippedPct}%`} />
                      </div>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "10px 0" }}>
                      {(q.options || []).map((opt, optIdx) => {
                        const isCorrect = optIdx === q.correct_index;
                        const pickCount = q.optionPicks[optIdx] ?? 0;
                        const pickPct = attemptsCount > 0 ? Math.round((pickCount / attemptsCount) * 100) : 0;

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
                              border: isCorrect ? "1px solid #10b981" : "1px solid var(--border,#e2e8f0)",
                              background: isCorrect ? "#f0fdf4" : "transparent"
                            }}
                          >
                            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <b>{"ABCD"[optIdx]}.</b>
                              <span>{opt}</span>
                              {isCorrect && (
                                <span style={{ color: "#10b981", fontWeight: 600, fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                  <CheckCircle size={13} /> Correct Answer
                                </span>
                              )}
                            </span>
                            {attemptsCount > 0 && (
                              <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)", fontWeight: 500 }}>
                                {pickCount} students ({pickPct}%)
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {q.explanation && (
                      <p style={{ fontSize: "12px", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px", margin: "6px 0" }}>
                        <b>Explanation:</b> {q.explanation}
                      </p>
                    )}
                    {q.source_url && (
                      <p className="source">
                        <b>Source:</b>{" "}
                        {/^https?:\/\//i.test(q.source_url) ? (
                          <a href={q.source_url} target="_blank" rel="noopener noreferrer">{q.source_url} <ExternalLink size={13} /></a>
                        ) : (
                          q.source_url
                        )}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
