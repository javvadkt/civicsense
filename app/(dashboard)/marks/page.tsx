"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { useAuth, request } from "../../../context/AuthContext";
import { useAppData } from "../../../context/DataProvider";

export default function MarksPage() {
  const { session, profile, setError } = useAuth();
  const { quizzes, people } = useAppData();
  const token = session?.access_token || "";
  const isTeacher = profile?.role === "supervisor";

  const [allAttempts, setAllAttempts] = useState<any[]>([]);
  const [gradebookLoading, setGradebookLoading] = useState(false);
  const [gradebookSearch, setGradebookSearch] = useState("");
  const [gradebookSort, setGradebookSort] = useState<"total_desc" | "attended_desc" | "name_asc">("total_desc");
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const loadGradebook = useCallback(async () => {
    if (!token || !isTeacher) return;
    setGradebookLoading(true);
    try {
      const data = await request(
        "/rest/v1/quiz_attempts?select=quiz_id,student_id,score,status,submitted_at&order=submitted_at.desc",
        token
      );
      setAllAttempts(data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load class marks.");
    } finally {
      setGradebookLoading(false);
    }
  }, [token, isTeacher, setError]);

  useEffect(() => {
    loadGradebook();
  }, [loadGradebook]);

  const gradebookData = useMemo(() => {
    if (!isTeacher) return { matrix: [], quizzesList: [] };

    const relevantQuizzes = [...quizzes]
      .filter(q => q.published)
      .sort((a, b) => new Date(a.opens_at).getTime() - new Date(b.opens_at).getTime());

    const eligibleStudents = people
      .filter(p => ["student", "student_leader"].includes(p.role) && p.active)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    const attemptLookup = new Map<string, any>();
    allAttempts.forEach(att => {
      attemptLookup.set(`${att.student_id}_${att.quiz_id}`, att);
    });

    const rows = eligibleStudents.map(s => {
      let totalMarks = 0;
      let attendedCount = 0;
      const quizScores: Record<string, { status: "attended" | "absent" | "open"; score: number | null }> = {};

      relevantQuizzes.forEach(z => {
        const att = attemptLookup.get(`${s.id}_${z.id}`);
        const isClosed = Boolean(z.ended_early_at) || new Date(z.closes_at).getTime() <= clock;

        if (att && (att.status === "submitted" || (att.score !== null && att.score !== undefined))) {
          const sc = Number(att.score || 0);
          totalMarks += sc;
          attendedCount++;
          quizScores[z.id] = { status: "attended", score: sc };
        } else if (isClosed) {
          quizScores[z.id] = { status: "absent", score: null };
        } else {
          quizScores[z.id] = { status: "open", score: null };
        }
      });

      return {
        student: s,
        scores: quizScores,
        totalMarks,
        attendedCount,
        eligibleCount: relevantQuizzes.length
      };
    });

    const query = gradebookSearch.trim().toLowerCase();
    const filtered = rows.filter(r => {
      if (!query) return true;
      return (
        r.student.full_name.toLowerCase().includes(query) ||
        (r.student.enrollment_number || "").toLowerCase().includes(query)
      );
    });

    filtered.sort((a, b) => {
      if (gradebookSort === "total_desc") return b.totalMarks - a.totalMarks;
      if (gradebookSort === "attended_desc") return b.attendedCount - a.attendedCount;
      return a.student.full_name.localeCompare(b.student.full_name);
    });

    return { matrix: filtered, quizzesList: relevantQuizzes };
  }, [isTeacher, quizzes, people, allAttempts, clock, gradebookSearch, gradebookSort]);

  const downloadGradebookCSV = () => {
    const { matrix, quizzesList } = gradebookData;
    if (!matrix.length) return;

    const quizHeaders = quizzesList.map(q => `"${q.title.replace(/"/g, '""')}"`);
    const headers = ["Student Name", "Enrollment Number", ...quizHeaders, "Attended", "Total Marks"];

    const rows = matrix.map(r => {
      const cols = [
        `"${r.student.full_name.replace(/"/g, '""')}"`,
        `"${(r.student.enrollment_number || "").replace(/"/g, '""')}"`
      ];
      quizzesList.forEach(z => {
        const cell = r.scores[z.id];
        if (cell?.status === "attended") cols.push(String(cell.score ?? 0));
        else if (cell?.status === "absent") cols.push('"Absent"');
        else cols.push('"Open"');
      });
      cols.push(`"${r.attendedCount} / ${r.eligibleCount}"`);
      cols.push(String(r.totalMarks));
      return cols.join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `civicprep_marks_summary_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  return (
    <>
      <div className="section-title qb-section-title">
        <div>
          <p style={{ margin: 0 }}>Class-wide student marks scorecard across all conducted quizzes.</p>
        </div>
        <div className="qb-header-actions">
          <button
            type="button"
            className="outline"
            onClick={loadGradebook}
            disabled={gradebookLoading}
            title="Refresh marks data"
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            type="button"
            className="primary"
            onClick={downloadGradebookCSV}
            disabled={!gradebookData.matrix.length}
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      <section className="card" style={{ padding: "16px", marginBottom: "16px" }}>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: "220px" }}>
            <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
            <input
              type="search"
              placeholder="Search by student name or roll number..."
              value={gradebookSearch}
              onChange={e => setGradebookSearch(e.target.value)}
              style={{ paddingLeft: "36px", width: "100%", height: "42px" }}
            />
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <label style={{ fontSize: "13px", fontWeight: 700, color: "#64748b" }}>Sort by:</label>
            <select
              value={gradebookSort}
              onChange={e => setGradebookSort(e.target.value as any)}
              style={{ height: "42px", padding: "0 12px", borderRadius: "9px" }}
            >
              <option value="total_desc">Total Marks (Highest first)</option>
              <option value="attended_desc">Most Quizzes Attended</option>
              <option value="name_asc">Student Name (A–Z)</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        {gradebookLoading ? (
          <div className="empty">Loading marks matrix…</div>
        ) : !gradebookData.matrix.length ? (
          <div className="empty">No student records match the search filter.</div>
        ) : (
          <div className="gb-table-wrap">
            <table className="gb-table">
              <thead>
                <tr>
                  <th className="gb-sticky-col">Student</th>
                  {gradebookData.quizzesList.map(qz => (
                    <th key={qz.id} title={qz.title}>
                      <span className="gb-quiz-title">{qz.title}</span>
                      <small className="gb-quiz-date">
                        {new Date(qz.opens_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </small>
                    </th>
                  ))}
                  <th style={{ textAlign: "center" }}>Attended</th>
                  <th style={{ textAlign: "right", paddingRight: "20px" }}>Total Marks</th>
                </tr>
              </thead>
              <tbody>
                {gradebookData.matrix.map(row => (
                  <tr key={row.student.id}>
                    <td className="gb-sticky-col">
                      <strong>{row.student.full_name}</strong>
                      {row.student.enrollment_number && (
                        <small>Roll: {row.student.enrollment_number}</small>
                      )}
                    </td>
                    {gradebookData.quizzesList.map(qz => {
                      const item = row.scores[qz.id];
                      return (
                        <td key={qz.id} style={{ textAlign: "center" }}>
                          {item?.status === "attended" ? (
                            <span className="gb-score-pill">{item.score} pts</span>
                          ) : item?.status === "absent" ? (
                            <span className="gb-absent-pill" title="Not attended">—</span>
                          ) : (
                            <span className="gb-open-pill">Open</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "center" }}>
                      <span className="gb-attended-badge">
                        {row.attendedCount} / {row.eligibleCount}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: "20px" }}>
                      <strong className="gb-total-score">{row.totalMarks} pts</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
