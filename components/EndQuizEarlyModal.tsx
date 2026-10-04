"use client";

import { useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { request } from "../context/AuthContext";
import type { Quiz } from "../context/DataProvider";

type Props = {
  quiz: Quiz | null;
  isOpen: boolean;
  onClose: () => void;
  token: string;
  flash: (msg: string) => void;
  setError: (msg: string) => void;
  onEnded: () => Promise<void>;
};

export default function EndQuizEarlyModal({
  quiz,
  isOpen,
  onClose,
  token,
  flash,
  setError,
  onEnded
}: Props) {
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !quiz || !token) {
      setActiveCount(null);
      return;
    }
    request("/rest/v1/rpc/get_quiz_attendees_list", token, "POST", { p_quiz_id: quiz.id })
      .then(part => setActiveCount(part?.in_progress_count ?? 0))
      .catch(() => setActiveCount(null));
  }, [isOpen, quiz, token]);

  if (!isOpen || !quiz) return null;

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await request("/rest/v1/rpc/end_quiz_early", token, "POST", { p_quiz_id: quiz.id });
      flash(`Quiz "${quiz.title}" ended. ${res?.auto_submitted_count ?? 0} active student attempt(s) were submitted automatically.`);
      onClose();
      await onEnded();
    } catch (e: any) {
      setError(e?.message || "Failed to end quiz early");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "480px" }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow" style={{ color: "#ef4444" }}>WARNING · EARLY CLOSURE</span>
            <h2>End Quiz Early?</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose} disabled={loading}><X size={18} /></button>
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <p style={{ margin: 0, fontSize: "14px" }}>
            Are you sure you want to end <strong>{quiz.title}</strong> right now?
          </p>
          <div className="card" style={{ padding: "12px", background: "#fef2f2", border: "1px solid #fee2e2", margin: 0 }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#991b1b", display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
              <span>
                {activeCount !== null ? `There are currently ${activeCount} student(s) actively taking this quiz. ` : "Students actively taking this quiz: "}
                Their autosaved answers will be submitted immediately, and no further attempts will be accepted.
              </span>
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button type="button" className="outline" onClick={onClose} disabled={loading}>Cancel</button>
            <button
              type="button"
              className="danger-outline"
              style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? "Ending quiz…" : "End quiz immediately"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
