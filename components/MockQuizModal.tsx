"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { request } from "../context/AuthContext";
import type { Question } from "../context/DataProvider";

export type PreparedMockQuestion = Question & {
  original_correct_text?: string;
};

export type MockQuizSession = {
  questions: PreparedMockQuestion[];
  timerMinutes: number;
  scrollMode: "scroll" | "single";
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  topics: string[];
  approvedFallback: Question[];
  onStart: (session: MockQuizSession) => void;
  setError: (msg: string) => void;
};

export default function MockQuizModal({
  isOpen,
  onClose,
  token,
  topics,
  approvedFallback,
  onStart,
  setError
}: Props) {
  const [mockTopics, setMockTopics] = useState<string[]>([]);
  const [mockCount, setMockCount] = useState<number>(10);
  const [mockTimerMinutes, setMockTimerMinutes] = useState<number>(15);
  const [mockScrollMode, setMockScrollMode] = useState<"scroll" | "single">("scroll");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleStart = async () => {
    setLoading(true);
    setError("");
    try {
      let rawPool: any[] = [];
      try {
        rawPool = await request("/rest/v1/rpc/get_mock_quiz_pool", token, "POST", {
          p_topics: mockTopics.length ? mockTopics : null,
          p_count: mockCount === 0 ? 1000 : mockCount
        });
      } catch {
        rawPool = approvedFallback.filter(q => q.status === "approved");
        if (mockTopics.length) rawPool = rawPool.filter(q => mockTopics.includes(q.topic));
      }

      if (!rawPool || !rawPool.length) {
        throw new Error("No approved questions found in your bank matching the selected criteria.");
      }

      const prepared: PreparedMockQuestion[] = [...rawPool]
        .sort(() => Math.random() - 0.5)
        .slice(0, mockCount === 0 ? rawPool.length : mockCount)
        .map(q => {
          const originalOpts: string[] = Array.isArray(q.options) ? q.options : [];
          const correctText = originalOpts[q.correct_index];
          const indexed = originalOpts.map((opt, idx) => ({ text: opt, isCorrect: idx === q.correct_index }));
          const shuffledIndexed = indexed.sort(() => Math.random() - 0.5);
          const newCorrectIndex = shuffledIndexed.findIndex(item => item.isCorrect);
          return {
            ...q,
            options: shuffledIndexed.map(item => item.text),
            correct_index: newCorrectIndex >= 0 ? newCorrectIndex : q.correct_index,
            original_correct_text: correctText
          };
        });

      onStart({
        questions: prepared,
        timerMinutes: mockTimerMinutes,
        scrollMode: mockScrollMode
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to start practice quiz");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "560px", width: "95%" }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">SELF-STUDY · PRACTICE TEST</span>
            <h2>Practice mock quiz</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose} disabled={loading}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="card" style={{ padding: "12px", background: "#f0f7ff", border: "1px solid #dbeafe", margin: 0 }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#1e40af" }}>
              <b>Practice only:</b> Questions are drawn randomly from your approved bank. Shuffled options and questions. Evaluated instantly in browser without affecting attendance or grades.
            </p>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>
              Select topics ({mockTopics.length ? mockTopics.length : "All topics"})
            </label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                className={mockTopics.length === 0 ? "primary" : "outline"}
                style={{ padding: "4px 12px", borderRadius: "16px", fontSize: "12px" }}
                onClick={() => setMockTopics([])}
              >
                All topics
              </button>
              {topics.map(t => {
                const active = mockTopics.includes(t);
                return (
                  <button
                    type="button"
                    key={t}
                    className={active ? "primary" : "outline"}
                    style={{ padding: "4px 12px", borderRadius: "16px", fontSize: "12px" }}
                    onClick={() => {
                      if (active) setMockTopics(mockTopics.filter(x => x !== t));
                      else setMockTopics([...mockTopics, t]);
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>
              Number of questions
            </label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {[5, 10, 20, 0].map(cnt => (
                <button
                  type="button"
                  key={cnt}
                  className={mockCount === cnt ? "primary" : "outline"}
                  style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "13px" }}
                  onClick={() => setMockCount(cnt)}
                >
                  {cnt === 0 ? "All available" : `${cnt} questions`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>Timer</label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {[
                { m: 0, label: "Untimed" },
                { m: 5, label: "5 mins" },
                { m: 10, label: "10 mins" },
                { m: 15, label: "15 mins" },
                { m: 30, label: "30 mins" }
              ].map(tm => (
                <button
                  type="button"
                  key={tm.m}
                  className={mockTimerMinutes === tm.m ? "primary" : "outline"}
                  style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "13px" }}
                  onClick={() => setMockTimerMinutes(tm.m)}
                >
                  {tm.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>Display mode</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className={mockScrollMode === "scroll" ? "primary" : "outline"}
                style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "13px", flex: 1 }}
                onClick={() => setMockScrollMode("scroll")}
              >
                Single scroll
              </button>
              <button
                type="button"
                className={mockScrollMode === "single" ? "primary" : "outline"}
                style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "13px", flex: 1 }}
                onClick={() => setMockScrollMode("single")}
              >
                One question at a time
              </button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
            <button type="button" className="outline" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={handleStart} disabled={loading}>
              {loading ? "Generating practice test…" : "Start practice test"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
