"use client";

import { useCallback, useState } from "react";
import { AlertCircle, ExternalLink, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, request } from "../../../context/AuthContext";
import type { Question } from "../../../context/DataProvider";
import QuestionEditorModal from "../../../components/QuestionEditorModal";

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

export default function ReviewPage() {
  const { session, profile, flash, setError } = useAuth();
  const queryClient = useQueryClient();
  const token = session?.access_token || "";
  const isTeacher = profile?.role === "supervisor";

  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  // 1. Fetch pending questions via RPC (with direct REST fallback)
  const {
    data: pending = [],
    isLoading: pendingLoading,
    isFetching: pendingFetching,
    error: pendingQueryError,
    refetch: refetchPending
  } = useQuery<Question[]>({
    queryKey: ["pending_review_questions"],
    queryFn: async () => {
      try {
        const rpcRes = await request("/rest/v1/rpc/get_review_questions", token, "POST", {});
        return rpcRes || [];
      } catch {
        // Fallback to direct REST without the broken embedded join
        const restRes = await request(
          "/rest/v1/questions?status=in.(pending,revision_requested)&select=id,stem,topic,options,correct_index,explanation,source_url,status,is_special,author_id,created_at&order=created_at.asc",
          token
        );
        return restRes || [];
      }
    },
    enabled: Boolean(token && isTeacher)
  });

  // 2. People directory to ensure author names always resolve
  const { data: people = [] } = useQuery<any[]>({
    queryKey: ["people_directory"],
    queryFn: () =>
      request(
        "/rest/v1/profiles?select=id,full_name,role,active,enrollment_number&order=full_name.asc",
        token
      ).catch(() => []),
    enabled: Boolean(token && isTeacher)
  });

  const memberName = (q: Question) => {
    if (q.author?.full_name) {
      return q.author.enrollment_number
        ? `${q.author.full_name} · ${q.author.enrollment_number}`
        : q.author.full_name;
    }
    const author = people.find((p: any) => p.id === q.author_id);
    if (!author) return "Contributor";
    return author.enrollment_number
      ? `${author.full_name} · ${author.enrollment_number}`
      : author.full_name;
  };

  const invalidateReviewAndRelated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["pending_review_questions"] });
    queryClient.invalidateQueries({ queryKey: ["question_bank"] });
    queryClient.invalidateQueries({ queryKey: ["overview_stats"] });
    queryClient.invalidateQueries({ queryKey: ["approved_questions_for_builder"] });
  }, [queryClient]);

  async function handleStatusUpdate(questionId: string, status: "approved" | "revision_requested") {
    setActionBusy(true);
    try {
      await request(`/rest/v1/questions?id=eq.${questionId}`, token, "PATCH", { status });
      flash(status === "approved" ? "Question approved." : "Correction requested.");
      invalidateReviewAndRelated();
    } catch (e: any) {
      setError(e.message || "Failed to update question status.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete(questionId: string) {
    if (!confirm("Delete this question?")) return;
    setActionBusy(true);
    try {
      await request(`/rest/v1/questions?id=eq.${questionId}`, token, "DELETE");
      flash("Question deleted.");
      invalidateReviewAndRelated();
    } catch (e: any) {
      setError(e.message || "Failed to delete question.");
    } finally {
      setActionBusy(false);
    }
  }

  if (!isTeacher) return null;

  return (
    <>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <div>
            <h3 style={{ margin: 0 }}>Questions to review ({pending.length})</h3>
            <p style={{ margin: "4px 0 0 0" }}>
              Review first submissions and requested revisions. You can edit questions directly before or after approval.
            </p>
          </div>
          {pendingFetching && !pendingLoading && (
            <span className="muted" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <RefreshCw size={13} /> Updating queue…
            </span>
          )}
        </div>

        {pendingQueryError && (
          <div style={{ marginTop: "12px", padding: "10px 14px", background: "#fef2f2", border: "1px solid #fee2e2", borderRadius: "8px", color: "#991b1b", display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={16} />
            <span>Failed to load questions: {(pendingQueryError as any)?.message}</span>
          </div>
        )}

        {pendingLoading ? (
          <div className="empty">Loading pending submissions…</div>
        ) : (
          pending.map(q => (
            <div className="review-item" key={q.id}>
              <strong>{q.stem}</strong>
              <small>
                {q.topic} · {memberName(q)} · {q.status.replace("_", " ")}
              </small>
              <ol type="A">
                {q.options.map((o, i) => (
                  <li key={i}>
                    {o}
                    {i === q.correct_index ? " ✓ correct" : ""}
                  </li>
                ))}
              </ol>
              {q.explanation && <p>{q.explanation}</p>}
              <Source value={q.source_url} />
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={actionBusy}
                  onClick={() => handleStatusUpdate(q.id, "approved")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="outline"
                  disabled={actionBusy}
                  onClick={() => handleStatusUpdate(q.id, "revision_requested")}
                >
                  Request correction
                </button>
                <button
                  type="button"
                  className="outline"
                  disabled={actionBusy}
                  onClick={() => {
                    setEditingQuestion(q);
                    setEditorOpen(true);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger-outline"
                  disabled={actionBusy}
                  onClick={() => handleDelete(q.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}

        {!pending.length && !pendingLoading && !pendingQueryError && (
          <div className="empty">Nothing is waiting for review.</div>
        )}
      </section>

      <QuestionEditorModal
        isOpen={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingQuestion(null);
        }}
        questionToEdit={editingQuestion}
        onSaved={invalidateReviewAndRelated}
        isTeacher={isTeacher}
        token={token}
        flash={flash}
        setError={setError}
      />
    </>
  );
}
