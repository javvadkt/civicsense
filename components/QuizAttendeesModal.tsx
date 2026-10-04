"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Search, X } from "lucide-react";
import { request } from "../context/AuthContext";
import type { Quiz } from "../context/DataProvider";

type Props = {
  quiz: Quiz | null;
  isOpen: boolean;
  onClose: () => void;
  token: string;
  flash: (msg: string) => void;
  setError: (msg: string) => void;
};

export default function QuizAttendeesModal({
  quiz,
  isOpen,
  onClose,
  token,
  flash,
  setError
}: Props) {
  const [data, setData] = useState<any | null>(null);
  const [filter, setFilter] = useState<"all" | "submitted" | "in_progress" | "not_started">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !quiz || !token) {
      setData(null);
      return;
    }
    setLoading(true);
    setSearch("");
    setFilter("all");
    request("/rest/v1/rpc/get_quiz_attendees_list", token, "POST", { p_quiz_id: quiz.id })
      .then(res => setData(res))
      .catch((err: any) => setError(err.message || "Failed to load attendees"))
      .finally(() => setLoading(false));
  }, [isOpen, quiz, token, setError]);

  if (!isOpen || !quiz) return null;

  const copyWhatsApp = () => {
    if (!data) return;
    const attendees: any[] = data.attendees || [];
    const notStarted = attendees.filter(a => a.status === "not_started");
    const inProgress = attendees.filter(a => a.status === "in_progress");

    let text = `📢 *CivicPrep Quiz Attendance Update*\n*Quiz:* ${quiz.title}\n*Total Students:* ${data.total_students}\n*Submitted:* ${data.submitted_count}\n\n`;
    if (notStarted.length > 0) {
      text += `⚠️ *Not Started (${notStarted.length}):*\n`;
      notStarted.forEach((s, idx) => {
        text += `${idx + 1}. ${s.full_name}${s.enrollment_number ? ` (${s.enrollment_number})` : ""}\n`;
      });
      text += `\n`;
    }
    if (inProgress.length > 0) {
      text += `⏳ *In Progress (${inProgress.length}):*\n`;
      inProgress.forEach((s, idx) => {
        text += `${idx + 1}. ${s.full_name}${s.enrollment_number ? ` (${s.enrollment_number})` : ""}\n`;
      });
      text += `\n`;
    }
    text += notStarted.length === 0 && inProgress.length === 0 ? `🎉 *All students completed!*` : `Please complete the quiz before closing.`;
    navigator.clipboard.writeText(text).then(() => flash("Absentee list copied for WhatsApp!")).catch(() => setError("Failed to copy"));
  };

  const downloadCsv = () => {
    if (!data) return;
    const attendees: any[] = data.attendees || [];
    const headers = ["Full Name", "Enrollment Number", "Status", "Started At", "Submitted At", "Time Taken (s)"];
    if (!data.mask_scores) headers.push("Score", "Correct", "Wrong", "Skipped");

    const rows = attendees.map(a => {
      const baseCols = [
        `"${(a.full_name || "").replace(/"/g, '""')}"`,
        `"${(a.enrollment_number || "").replace(/"/g, '""')}"`,
        `"${a.status}"`,
        `"${a.started_at ? new Date(a.started_at).toLocaleString() : ""}"`,
        `"${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : ""}"`,
        a.time_taken_seconds || 0
      ];
      if (!data.mask_scores) baseCols.push(a.score ?? 0, a.correct_count ?? 0, a.wrong_count ?? 0, a.skipped_count ?? 0);
      return baseCols.join(",");
    });

    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `attendees_${quiz.title.replace(/\s+/g, "_").toLowerCase()}.csv`;
    link.click();
  };

  const attendees: any[] = (data?.attendees || []).filter((a: any) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (a.full_name || "").toLowerCase().includes(q) || (a.enrollment_number || "").toLowerCase().includes(q);
  });

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "780px", width: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div className="modal-head">
          <div><span className="eyebrow">ATTENDEE METRICS & PARTICIPATION</span><h2>{quiz.title}</h2></div>
          <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {loading || !data ? <div className="empty">Loading attendee metrics…</div> : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
                <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}><span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Total Students</span><strong style={{ fontSize: "20px", display: "block" }}>{data.total_students}</strong></article>
                <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}><span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Submitted</span><strong style={{ fontSize: "20px", display: "block", color: "#10b981" }}>{data.submitted_count}</strong></article>
                <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}><span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>In Progress</span><strong style={{ fontSize: "20px", display: "block", color: "#f59e0b" }}>{data.in_progress_count}</strong></article>
                <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}><span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Not Started</span><strong style={{ fontSize: "20px", display: "block", color: "#ef4444" }}>{data.not_started_count}</strong></article>
                {!data.mask_scores && <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}><span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Avg Score</span><strong style={{ fontSize: "20px", display: "block" }}>{data.average_score ?? 0}</strong></article>}
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
                  <Search size={15} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
                  <input type="search" placeholder="Search student or roll..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "32px", width: "100%" }} />
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" className="outline" onClick={copyWhatsApp}><Copy size={15} /> WhatsApp Absentees</button>
                  <button type="button" className="outline" onClick={downloadCsv}><Download size={15} /> Export CSV</button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(["all", "submitted", "in_progress", "not_started"] as const).map(f => (
                  <button key={f} type="button" className={filter === f ? "primary" : "outline"} style={{ padding: "4px 12px", borderRadius: "16px", fontSize: "12px" }} onClick={() => setFilter(f)}>
                    {f.replace("_", " ")}
                  </button>
                ))}
              </div>

              <div style={{ border: "1px solid var(--border,#e2e8f0)", borderRadius: "8px", overflow: "hidden", maxHeight: "320px", overflowY: "auto" }}>
                {attendees.map((a: any) => (
                  <div key={a.student_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border,#e2e8f0)", fontSize: "13px" }}>
                    <div>
                      <strong>{a.full_name}</strong>
                      <div style={{ color: "var(--muted-fg,#64748b)", fontSize: "12px", display: "flex", gap: "8px", marginTop: "2px" }}>
                        {a.enrollment_number && <span>Roll: {a.enrollment_number}</span>}
                        {a.time_taken_seconds > 0 && <span>• {Math.floor(a.time_taken_seconds / 60)}m {a.time_taken_seconds % 60}s</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {!data.mask_scores && a.status === "submitted" && <strong>{a.score} pts</strong>}
                      <span className={`tag ${a.status === "submitted" ? "approved" : a.status === "in_progress" ? "pending" : "revision_requested"}`}>{a.status.replace("_", " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
