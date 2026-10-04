"use client";

import { useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, request } from "../../../context/AuthContext";

type QuizHeader = {
  id: string;
  title: string;
  opens_at: string;
  closes_at: string;
  ended_early_at?: string | null;
};

type StudentScoreCell = {
  status: "attended" | "absent" | "open";
  score: number | null;
};

type StudentRow = {
  id: string;
  full_name: string;
  enrollment_number?: string | null;
  total_marks: number;
  attended_count: number;
  eligible_count: number;
  scores: Record<string, StudentScoreCell>;
};

type GradebookMatrixResponse = {
  quizzes: QuizHeader[];
  students: StudentRow[];
};

export default function MarksPage() {
  const { session, profile, setError } = useAuth();
  const token = session?.access_token || "";
  const isTeacher = profile?.role === "supervisor";

  const [gradebookSearch, setGradebookSearch] = useState("");
  const [gradebookSort, setGradebookSort] = useState<"total_desc" | "attended_desc" | "name_asc">("total_desc");

  const {
    data,
    isLoading: gradebookLoading,
    isFetching: gradebookFetching,
    refetch: refetchGradebook,
    error: gradebookError
  } = useQuery<GradebookMatrixResponse>({
    queryKey: ["gradebook_matrix"],
    queryFn: () => request("/rest/v1/rpc/get_gradebook_matrix", token, "POST", {}),
    enabled: Boolean(token && isTeacher)
  });

  if (gradebookError) {
    setError((gradebookError as any)?.message || "Failed to load class marks.");
  }

  const quizzesList = data?.quizzes || [];
  const rawStudents = data?.students || [];

  const filteredStudents = useMemo(() => {
    const query = gradebookSearch.trim().toLowerCase();
    const list = rawStudents.filter(s => {
      if (!query) return true;
      return (
        s.full_name.toLowerCase().includes(query) ||
        (s.enrollment_number || "").toLowerCase().includes(query)
      );
    });

    return [...list].sort((a, b) => {
      if (gradebookSort === "total_desc") return b.total_marks - a.total_marks;
      if (gradebookSort === "attended_desc") return b.attended_count - a.attended_count;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [rawStudents, gradebookSearch, gradebookSort]);

  const downloadGradebookCSV = () => {
    if (!filteredStudents.length) return;

    const quizHeaders = quizzesList.map(q => `"${q.title.replace(/"/g, '""')}"`);
    const headers = ["Student Name", "Enrollment Number", ...quizHeaders, "Attended", "Total Marks"];

    const rows = filteredStudents.map(s => {
      const cols = [
        `"${s.full_name.replace(/"/g, '""')}"`,
        `"${(s.enrollment_number || "").replace(/"/g, '""')}"`
      ];
      quizzesList.forEach(qz => {
        const cell = s.scores[qz.id];
        if (cell?.status === "attended") cols.push(String(cell.score ?? 0));
        else if (cell?.status === "absent") cols.push('"Absent"');
        else cols.push('"Open"');
      });
      cols.push(`"${s.attended_count} / ${s.eligible_count}"`);
      cols.push(String(s.total_marks));
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

  if (!isTeacher) return null;

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
            onClick={() => refetchGradebook()}
            disabled={gradebookFetching}
            title="Refresh marks data"
          >
            <RefreshCw size={15} /> {gradebookFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="primary"
            onClick={downloadGradebookCSV}
            disabled={!filteredStudents.length}
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
        ) : !filteredStudents.length ? (
          <div className="empty">No student records match the search filter.</div>
        ) : (
          <div className="gb-table-wrap">
            <table className="gb-table">
              <thead>
                <tr>
                  <th className="gb-sticky-col">Student</th>
                  {quizzesList.map(qz => (
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
                {filteredStudents.map(row => (
                  <tr key={row.id}>
                    <td className="gb-sticky-col">
                      <strong>{row.full_name}</strong>
                      {row.enrollment_number && (
                        <small>Roll: {row.enrollment_number}</small>
                      )}
                    </td>
                    {quizzesList.map(qz => {
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
                        {row.attended_count} / {row.eligible_count}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: "20px" }}>
                      <strong className="gb-total-score">{row.total_marks} pts</strong>
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
