"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Edit,
  ExternalLink,
  FileQuestion,
  Filter,
  MoreVertical,
  Play,
  Plus,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import { useAuth, request } from "../../../context/AuthContext";
import { useAppData, Question } from "../../../context/DataProvider";
import QuestionFilterDrawer from "../../../components/QuestionFilterDrawer";

const topics = [
  "Polity",
  "Economy",
  "Environment",
  "International relations",
  "Science & technology",
  "Government schemes",
  "History",
  "Reports & indices",
  "Other"
];

function Source({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const url = /^https?:\/\//i.test(value);
  return (
    <p className="source">
      <b>Source:</b>{" "}
      {url ? (
        <a href={value} target="_blank" rel="noopener noreferrer">
          {value} <ExternalLink size={13} />
        </a>
      ) : (
        value
      )}
    </p>
  );
}

export default function QuestionsPage() {
  const { session, profile, flash, setError } = useAuth();
  const { change } = useAppData();
  const token = session?.access_token || "";
  const isTeacher = profile?.role === "supervisor";

  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankUploaders, setBankUploaders] = useState<{ id: string; full_name: string; enrollment_number?: string | null }[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankOffset, setBankOffset] = useState(0);
  const [bankError, setBankError] = useState("");

  const [bankQuick, setBankQuick] = useState<"all" | "mine" | "approved" | "pending" | "revision_requested">("all");
  const [bankSearchInput, setBankSearchInput] = useState("");
  const [bankDebouncedSearch, setBankDebouncedSearch] = useState("");
  const [bankTopic, setBankTopic] = useState("all");
  const [bankAuthorId, setBankAuthorId] = useState("all");
  const [bankOnlyMine, setBankOnlyMine] = useState(false);
  const [bankStatus, setBankStatus] = useState("all");
  const [bankSpecial, setBankSpecial] = useState<"all" | "special" | "standard">("all");
  const [bankDateFrom, setBankDateFrom] = useState("");
  const [bankDateTo, setBankDateTo] = useState("");
  const [bankHasSource, setBankHasSource] = useState<"all" | "yes" | "no">("all");
  const [bankQuizUsage, setBankQuizUsage] = useState<"all" | "used" | "unused">("all");
  const [bankSort, setBankSort] = useState<"newest" | "oldest" | "topic" | "uploader" | "status">("newest");
  const [bankFilterPanelOpen, setBankFilterPanelOpen] = useState(false);

  const [bankMenuQId, setBankMenuQId] = useState<string | null>(null);
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<Question | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setBankDebouncedSearch(bankSearchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [bankSearchInput]);

  const loadQuestionBank = useCallback(async (offset = 0, append = false) => {
    if (!token) return;
    setBankLoading(true);
    setBankError("");
    try {
      const activeStatus =
        bankQuick === "approved" || bankQuick === "pending" || bankQuick === "revision_requested"
          ? bankQuick
          : bankStatus === "all" ? null : bankStatus;
      const onlyMine = bankQuick === "mine" || bankOnlyMine;

      const res = await request("/rest/v1/rpc/get_question_bank", token, "POST", {
        p_search: bankDebouncedSearch || null,
        p_topic: bankTopic === "all" ? null : bankTopic,
        p_author_id: bankAuthorId === "all" ? null : bankAuthorId,
        p_only_mine: onlyMine,
        p_status: activeStatus,
        p_is_special: bankSpecial === "all" ? null : bankSpecial === "special",
        p_date_from: bankDateFrom || null,
        p_date_to: bankDateTo || null,
        p_has_source: bankHasSource === "all" ? null : bankHasSource === "yes",
        p_quiz_usage: bankQuizUsage === "all" ? null : bankQuizUsage,
        p_sort: bankSort,
        p_limit: 25,
        p_offset: offset
      });

      if (res) {
        setBankTotal(res.total ?? 0);
        if (res.uploaders) setBankUploaders(res.uploaders);
        if (append) {
          setBankQuestions(prev => [...prev, ...(res.questions || [])]);
        } else {
          setBankQuestions(res.questions || []);
        }
        setBankOffset(offset);
      }
    } catch (e: any) {
      setBankError(e.message || "Failed to load question bank");
      setBankQuestions([]);
    } finally {
      setBankLoading(false);
    }
  }, [
    token, bankDebouncedSearch, bankQuick, bankTopic, bankAuthorId,
    bankOnlyMine, bankStatus, bankSpecial, bankDateFrom, bankDateTo,
    bankHasSource, bankQuizUsage, bankSort
  ]);

  useEffect(() => {
    if (token && profile?.active) {
      loadQuestionBank(0, false);
    }
  }, [token, profile?.active, loadQuestionBank]);

  useEffect(() => {
    if (!bankMenuQId) return;
    const close = () => setBankMenuQId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [bankMenuQId]);

  const resetBankFilters = () => {
    setBankSearchInput("");
    setBankDebouncedSearch("");
    setBankQuick("all");
    setBankTopic("all");
    setBankAuthorId("all");
    setBankOnlyMine(false);
    setBankStatus("all");
    setBankSpecial("all");
    setBankDateFrom("");
    setBankDateTo("");
    setBankHasSource("all");
    setBankQuizUsage("all");
    setBankSort("newest");
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (bankTopic !== "all") count++;
    if (bankAuthorId !== "all") count++;
    if (bankOnlyMine) count++;
    if (bankStatus !== "all") count++;
    if (bankSpecial !== "all") count++;
    if (bankDateFrom) count++;
    if (bankDateTo) count++;
    if (bankHasSource !== "all") count++;
    if (bankQuizUsage !== "all") count++;
    return count;
  }, [bankTopic, bankAuthorId, bankOnlyMine, bankStatus, bankSpecial, bankDateFrom, bankDateTo, bankHasSource, bankQuizUsage]);

  const handleDelete = async () => {
    if (!deleteQuestionTarget) return;
    setDeleteBusy(true);
    try {
      if (await change(`/rest/v1/questions?id=eq.${deleteQuestionTarget.id}`, null, "DELETE")) {
        flash("Question deleted.");
        setDeleteQuestionTarget(null);
        await loadQuestionBank(bankOffset, false);
      }
    } catch (e: any) {
      setError(e.message || "Failed to delete question.");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <div className="section-title qb-section-title">
        <p style={{ margin: 0 }}>Review submissions and study questions. Correct answers and explanations are clearly indicated.</p>
        <div className="qb-header-actions">
          {!isTeacher && (
            <button className="outline" onClick={() => flash("Practice test setup dialog opens in Step 2.2b.")}>
              <Play size={15} /> Practice
            </button>
          )}
          <button className="primary" onClick={() => flash("Question editor opens in Step 2.2b.")}>
            <Plus size={15} /> Add Question
          </button>
        </div>
      </div>

      <section className="card qb-filter-card" style={{ padding: "16px", marginBottom: "16px" }}>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: "220px" }}>
            <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
            <input
              type="search"
              placeholder="Search question stem, options, explanation..."
              value={bankSearchInput}
              onChange={e => setBankSearchInput(e.target.value)}
              style={{ paddingLeft: "36px", width: "100%", height: "42px" }}
            />
          </div>

          <div className="qb-filters-row" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="qb-quick-chips">
              {[
                { id: "all", label: "All" },
                ...(!isTeacher ? [{ id: "mine", label: "Mine" }] : []),
                { id: "approved", label: "Approved" },
                { id: "pending", label: "Waiting" },
                { id: "revision_requested", label: "Needs revision" }
              ].map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`qb-quick-btn ${bankQuick === c.id ? "active" : ""}`}
                  onClick={() => {
                    setBankQuick(c.id as any);
                    if (c.id === "all") {
                      setBankStatus("all");
                      setBankOnlyMine(false);
                    }
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {isTeacher && (
              <div className="qb-usage-toggle" title="Filter by whether question was tested in a quiz">
                <button
                  type="button"
                  className={`qb-usage-btn ${bankQuizUsage === "all" ? "active" : ""}`}
                  onClick={() => setBankQuizUsage("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`qb-usage-btn fresh ${bankQuizUsage === "unused" ? "active" : ""}`}
                  onClick={() => setBankQuizUsage(bankQuizUsage === "unused" ? "all" : "unused")}
                >
                  ★ Fresh only
                </button>
                <button
                  type="button"
                  className={`qb-usage-btn ${bankQuizUsage === "used" ? "active" : ""}`}
                  onClick={() => setBankQuizUsage(bankQuizUsage === "used" ? "all" : "used")}
                >
                  Used in quiz
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={bankSort}
              onChange={e => setBankSort(e.target.value as any)}
              style={{ height: "42px", padding: "0 12px", borderRadius: "9px", minWidth: "140px" }}
              aria-label="Sort questions"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="topic">Topic (A–Z)</option>
              <option value="uploader">Uploader (A–Z)</option>
              <option value="status">Status</option>
            </select>

            <button
              className={bankFilterPanelOpen || activeFilterCount > 0 ? "primary" : "outline"}
              style={{ height: "42px", padding: "0 14px", borderRadius: "9px" }}
              onClick={() => setBankFilterPanelOpen(!bankFilterPanelOpen)}
            >
              <Filter size={15} /> More filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
            </button>
          </div>
        </div>

        <div className="qb-active-bar">
          <span className="qb-count-text">
            Showing <b>{bankQuestions.length}</b> of <b>{bankTotal}</b> questions
          </span>

          <div className="qb-chip-list">
            {bankDebouncedSearch && (
              <span className="qb-chip">
                Search: &quot;{bankDebouncedSearch}&quot;
                <button onClick={() => { setBankSearchInput(""); setBankDebouncedSearch(""); }}>×</button>
              </span>
            )}
            {bankQuick !== "all" && (
              <span className="qb-chip">
                {bankQuick === "mine" ? "Mine only" : `Status: ${bankQuick.replace("_", " ")}`}
                <button onClick={() => setBankQuick("all")}>×</button>
              </span>
            )}
            {bankTopic !== "all" && (
              <span className="qb-chip">
                Topic: {bankTopic}
                <button onClick={() => setBankTopic("all")}>×</button>
              </span>
            )}
            {bankAuthorId !== "all" && (
              <span className="qb-chip">
                Uploader: {bankUploaders.find(u => u.id === bankAuthorId)?.full_name || "Author"}
                <button onClick={() => setBankAuthorId("all")}>×</button>
              </span>
            )}
            {(activeFilterCount > 0 || bankDebouncedSearch || bankQuick !== "all") && (
              <button className="plain qb-clear-all" onClick={resetBankFilters}>
                Clear all
              </button>
            )}
          </div>
        </div>

        <QuestionFilterDrawer
          open={bankFilterPanelOpen}
          onClose={() => setBankFilterPanelOpen(false)}
          topics={topics}
          topic={bankTopic}
          setTopic={setBankTopic}
          authorId={bankAuthorId}
          setAuthorId={setBankAuthorId}
          uploaders={bankUploaders}
          dateFrom={bankDateFrom}
          setDateFrom={setBankDateFrom}
          dateTo={bankDateTo}
          setDateTo={setBankDateTo}
          hasSource={bankHasSource}
          setHasSource={setBankHasSource}
          special={bankSpecial}
          setSpecial={setBankSpecial}
          quizUsage={bankQuizUsage}
          setQuizUsage={setBankQuizUsage}
          isStaff={isTeacher}
          total={bankTotal}
          onReset={resetBankFilters}
        />
      </section>

      {bankError && (
        <section className="card qb-error-card">
          <AlertCircle size={20} color="#ef4444" />
          <div>
            <strong>Failed to load questions</strong>
            <p>{bankError}</p>
          </div>
          <button className="outline" onClick={() => loadQuestionBank(0, false)}>
            Retry
          </button>
        </section>
      )}

      <section className="card" style={{ padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
          <h3 style={{ margin: 0 }}>
            Questions · <span style={{ opacity: 0.7 }}>Showing {bankQuestions.length} of {bankTotal}</span>
          </h3>
          {bankLoading && <span className="muted"><RefreshCw size={14} /> Updating list…</span>}
        </div>

        {bankQuestions.map(q => {
          const canStudentEdit = !isTeacher && q.author_id === profile?.id && ["pending", "revision_requested"].includes(q.status);
          const authorDisplay = q.author?.full_name
            ? `${q.author.full_name}${q.author.enrollment_number ? ` · ${q.author.enrollment_number}` : ""}`
            : "Contributor";
          const createdDate = new Date(q.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

          return (
            <details className="question qb-question-item" key={q.id}>
              <summary className="qb-question-summary">
                <div className="qb-question-stem">
                  <strong>{q.stem}</strong>
                </div>
                <div className="qb-question-footer">
                  <div className="qb-question-meta">
                    <span>{q.topic}</span>
                    {q.is_special && <span className="tag pending" style={{ padding: "2px 6px", fontSize: "11px" }}>Special</span>}
                    {isTeacher && (
                      <span className={`tag ${q.is_used_in_quiz ? "approved" : ""}`} style={{ padding: "2px 6px", fontSize: "11px" }}>
                        {q.is_used_in_quiz ? "In quiz" : "Unused"}
                      </span>
                    )}
                    <span>•</span>
                    <span>{authorDisplay}</span>
                    <span>•</span>
                    <span>{createdDate}</span>
                  </div>
                  <div className="qb-question-badge-kebab" onClick={e => e.stopPropagation()}>
                    <span className={`tag ${q.status}`}>{q.status.replace("_", " ")}</span>
                    {isTeacher && (
                      <div className="qz-menu-container" style={{ position: "relative" }} onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                        <button
                          type="button"
                          className="icon-button"
                          style={{ width: "32px", height: "32px", padding: 0 }}
                          aria-label="Question actions"
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setBankMenuQId(bankMenuQId === q.id ? null : q.id);
                          }}
                        >
                          <MoreVertical size={16} />
                        </button>

                        {bankMenuQId === q.id && (
                          <div
                            className="qz-pop"
                            style={{
                              position: "absolute",
                              right: 0,
                              top: "calc(100% + 4px)",
                              background: "var(--surface, #ffffff)",
                              border: "1px solid var(--border, #e2e8f0)",
                              borderRadius: "8px",
                              boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                              minWidth: "160px",
                              zIndex: 30,
                              overflow: "hidden",
                              display: "flex",
                              flexDirection: "column"
                            }}
                          >
                            <button
                              type="button"
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", display: "flex", alignItems: "center", gap: "8px" }}
                              onClick={() => {
                                setBankMenuQId(null);
                                flash("Question editor opens in Step 2.2b.");
                              }}
                            >
                              <Edit size={14} /> Edit question
                            </button>
                            <button
                              type="button"
                              className="plain"
                              style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%", color: "#ef4444", display: "flex", alignItems: "center", gap: "8px" }}
                              onClick={() => {
                                setBankMenuQId(null);
                                setDeleteQuestionTarget(q);
                              }}
                            >
                              <X size={14} /> Delete question
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </summary>

              <div className="qb-options-list" style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
                {q.options.map((opt, optIdx) => {
                  const isCorrect = optIdx === q.correct_index;
                  return (
                    <div
                      key={optIdx}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "8px",
                        fontSize: "14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        border: isCorrect ? "1.5px solid #10b981" : "1px solid var(--border,#e2e8f0)",
                        background: isCorrect ? "#f0fdf4" : "var(--surface,#ffffff)"
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <b style={{ color: isCorrect ? "#10b981" : "var(--muted-fg,#64748b)" }}>{"ABCD"[optIdx]}.</b>
                        <span>{opt}</span>
                      </span>
                      {isCorrect && (
                        <span style={{ color: "#10b981", fontWeight: 700, fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <CheckCircle size={15} /> Correct answer
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {q.explanation && (
                <div style={{ marginTop: "12px", padding: "10px 14px", background: "#f8fafc", borderRadius: "8px", fontSize: "13px", borderLeft: "3px solid #3b82f6" }}>
                  <b>Explanation:</b> {q.explanation}
                </div>
              )}

              <div style={{ marginTop: "8px" }}>
                <Source value={q.source_url} />
              </div>

              {canStudentEdit && (
                <div className="actions" style={{ marginTop: "12px" }}>
                  <button className="outline" onClick={() => flash("Question editor opens in Step 2.2b.")}>
                    Edit
                  </button>
                </div>
              )}
            </details>
          );
        })}

        {!bankQuestions.length && !bankLoading && !bankError && (
          <div className="qb-empty-box">
            <FileQuestion size={36} color="#94a3b8" />
            <h4>No questions match your current filters</h4>
            <p>
              {activeFilterCount > 0 || bankDebouncedSearch || bankQuick !== "all"
                ? "Some active filters are hiding results. Clear them to restore the question list."
                : "No questions are currently available in the question bank."}
            </p>
            {(activeFilterCount > 0 || bankDebouncedSearch || bankQuick !== "all") && (
              <button className="primary" onClick={resetBankFilters}>
                Clear all filters
              </button>
            )}
          </div>
        )}

        {bankQuestions.length < bankTotal && (
          <div style={{ marginTop: "20px", textAlign: "center" }}>
            <button
              className="outline"
              disabled={bankLoading}
              onClick={() => loadQuestionBank(bankQuestions.length, true)}
              style={{ minWidth: "220px", height: "42px" }}
            >
              {bankLoading ? "Loading…" : `Load more questions (${bankTotal - bankQuestions.length} remaining)`}
            </button>
          </div>
        )}
      </section>

      {deleteQuestionTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !deleteBusy) setDeleteQuestionTarget(null);
          }}
        >
          <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "480px" }}>
            <div className="modal-head">
              <div>
                <span className="eyebrow" style={{ color: "#ef4444" }}>CONFIRM DELETION</span>
                <h2>Delete Question?</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                disabled={deleteBusy}
                onClick={() => setDeleteQuestionTarget(null)}
              >
                <X />
              </button>
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <p style={{ margin: 0, fontSize: "14px", color: "#334155" }}>
                Are you sure you want to permanently delete this question?
              </p>
              <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <strong style={{ fontSize: "13px", display: "block", color: "#0f172a", marginBottom: "4px" }}>
                  {deleteQuestionTarget.stem}
                </strong>
                <small style={{ color: "#64748b" }}>{deleteQuestionTarget.topic}</small>
              </div>
              <div className="card" style={{ padding: "12px", background: "#fef2f2", border: "1px solid #fee2e2", margin: 0 }}>
                <p style={{ margin: 0, fontSize: "13px", color: "#991b1b" }}>
                  This question will also be removed from any quiz that uses it.
                </p>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
                <button
                  className="outline"
                  disabled={deleteBusy}
                  onClick={() => setDeleteQuestionTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger-outline"
                  style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
                  disabled={deleteBusy}
                  onClick={handleDelete}
                >
                  {deleteBusy ? "Deleting…" : "Yes, delete question"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
