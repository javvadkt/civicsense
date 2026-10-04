"use client";

import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  topics: string[];
  topic: string;
  setTopic: (t: string) => void;
  authorId: string;
  setAuthorId: (a: string) => void;
  uploaders: { id: string; full_name: string; enrollment_number?: string | null }[];
  dateFrom: string;
  setDateFrom: (d: string) => void;
  dateTo: string;
  setDateTo: (d: string) => void;
  hasSource: "all" | "yes" | "no";
  setHasSource: (s: "all" | "yes" | "no") => void;
  special: "all" | "special" | "standard";
  setSpecial: (s: "all" | "special" | "standard") => void;
  quizUsage: "all" | "used" | "unused";
  setQuizUsage: (u: "all" | "used" | "unused") => void;
  isStaff: boolean;
  total: number;
  onReset: () => void;
};

export default function QuestionFilterDrawer(props: Props) {
  if (!props.open) return null;

  return (
    <div
      className="qb-sheet-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="qb-sheet-panel">
        <div className="qb-sheet-head">
          <h3>More filters</h3>
          <button className="icon-button" aria-label="Close filters" onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="qb-filter-grid">
          <label>
            Topic
            <select value={props.topic} onChange={e => props.setTopic(e.target.value)}>
              <option value="all">All topics</option>
              {props.topics.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>

          <label>
            Uploader
            <select value={props.authorId} onChange={e => props.setAuthorId(e.target.value)}>
              <option value="all">All uploaders</option>
              {props.uploaders.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name}{u.enrollment_number ? ` (${u.enrollment_number})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Upload date from
            <input type="date" value={props.dateFrom} onChange={e => props.setDateFrom(e.target.value)} />
          </label>

          <label>
            Upload date to
            <input type="date" value={props.dateTo} onChange={e => props.setDateTo(e.target.value)} />
          </label>

          <label>
            Source citation
            <select value={props.hasSource} onChange={e => props.setHasSource(e.target.value as any)}>
              <option value="all">Any</option>
              <option value="yes">With source URL/citation</option>
              <option value="no">Without source</option>
            </select>
          </label>

          {props.isStaff && (
            <label>
              Question type (Staff)
              <select value={props.special} onChange={e => props.setSpecial(e.target.value as any)}>
                <option value="all">All questions</option>
                <option value="special">Special questions only</option>
                <option value="standard">Standard only</option>
              </select>
            </label>
          )}

          {props.isStaff && (
            <label>
              Quiz usage (Staff)
              <select value={props.quizUsage} onChange={e => props.setQuizUsage(e.target.value as any)}>
                <option value="all">All</option>
                <option value="used">Used in a quiz</option>
                <option value="unused">Never used in any quiz</option>
              </select>
            </label>
          )}
        </div>

        <div className="qb-sheet-foot">
          <button className="outline" onClick={props.onReset}>
            Reset all
          </button>
          <button className="primary" onClick={props.onClose}>
            Show {props.total} results
          </button>
        </div>
      </div>
    </div>
  );
}
