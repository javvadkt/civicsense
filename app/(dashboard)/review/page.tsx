"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useAppData, Question } from "../../../context/DataProvider";
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
  const { questions, change, reload } = useAppData();
  const token = session?.access_token || "";
  const isTeacher = profile?.role === "supervisor";

  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const pending = useMemo(
    () => questions.filter(q => ["pending", "revision_requested"].includes(q.status)),
    [questions]
  );

  const memberName = (q: Question) => {
    const author = q.author;
    if (!author) return "Contributor";
    return author.enrollment_number
      ? `${author.full_name} · ${author.enrollment_number}`
      : author.full_name;
  };

  async function handleStatusUpdate(questionId: string, status: "approved" | "revision_requested") {
    setActionBusy(true);
    try {
      const success = await change(
        `/rest/v1/questions?id=eq.${questionId}`,
        { status },
        "PATCH"
      );
      if (success) {
        flash(status === "approved" ? "Question approved." : "Correction requested.");
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete(questionId: string) {
    if (!confirm("Delete this question?")) return;
    setActionBusy(true);
    try {
      const success = await change(`/rest/v1/questions?id=eq.${questionId}`, null, "DELETE");
      if (success) {
        flash("Question deleted.");
      }
    } finally {
      setActionBusy(false);
    }
  }

  if (!isTeacher) return null;

  return (
    <>
      <section className="card">
        <h3>Questions to review ({pending.length})</h3>
        <p>
          Review first submissions and requested revisions. You can edit the question directly, including after approval,
          from the question bank.
        </p>

        {pending.map(q => (
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
        ))}

        {!pending.length && <div className="empty">Nothing is waiting for review.</div>}
      </section>

      <QuestionEditorModal
        isOpen={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingQuestion(null);
        }}
        questionToEdit={editingQuestion}
        onSaved={reload}
        isTeacher={isTeacher}
        token={token}
        flash={flash}
        setError={setError}
      />
    </>
  );
}
