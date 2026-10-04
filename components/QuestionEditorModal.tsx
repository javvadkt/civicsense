"use client";

import { useEffect, useState } from "react";
import { CircleHelp, Copy, FileQuestion, Upload, X } from "lucide-react";
import { request } from "../context/AuthContext";
import type { Question } from "../context/DataProvider";

export const TOPICS = [
  "Polity", "Economy", "Environment", "International relations",
  "Science & technology", "Government schemes", "History", "Reports & indices", "Other"
];

const PROMPT_TEXT = `Convert the supplied UPSC current-affairs material into importable multiple-choice questions. Return only valid JSON (no Markdown fences) in this shape:
{
  "questions": [{
    "stem": "Question text",
    "topic": "One of: Polity, Economy, Environment, International relations, Science & technology, Government schemes, History, Reports & indices, Other",
    "options": ["A", "B", "C", "D"],
    "correct_answer": "Exact text of the correct option",
    "explanation": "",
    "source": ""
  }]
}
If the source gives only a question and correct answer, write three plausible, clearly incorrect distractors that are compatible in form and topic. Keep exactly four options. Do not invent facts or a source; leave explanation and source as empty strings when missing. If a source URL or publication name is supplied, preserve it in source. Ensure correct_answer exactly matches one option.`;

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one question.");
  const headers = rows.shift()!.map(x => x.trim().toLowerCase().replace(/[ -]+/g, "_"));
  return rows.map(cols => Object.fromEntries(headers.map((h, idx) => [h, (cols[idx] || "").trim()])));
}

function parseImported(raw: string) {
  let records: any[];
  try {
    const parsed = JSON.parse(raw);
    records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.questions) ? parsed.questions : [parsed];
  } catch {
    records = parseCsv(raw);
  }
  if (!records.length) throw new Error("No questions were found in that file.");
  return records.map((r: any, i: number) => {
    const stem = String(r.stem ?? r.question ?? "").trim();
    const opts = Array.isArray(r.options) ? r.options : Array.isArray(r.choices) ? r.choices : [r.option_a ?? r.a, r.option_b ?? r.b, r.option_c ?? r.c, r.option_d ?? r.d];
    const clean: string[] = opts.map((v: any) => String(v ?? "").trim());
    const ans = r.correct_index ?? r.answer_index ?? r.correct_answer ?? r.answer ?? r.correct_option;
    const ansText = String(ans ?? "").trim();
    let idx = -1;
    if (typeof ans === "number" && Number.isInteger(ans) && ans >= 0 && ans <= 3) idx = ans;
    else if (/^[0-4]$/.test(ansText)) { idx = Number(ansText); if (idx > 0) idx -= 1; }
    if (idx < 0) idx = clean.findIndex(v => v.toLowerCase() === ansText.toLowerCase());
    if (idx < 0 && /^[a-d]$/i.test(ansText)) idx = ansText.toUpperCase().charCodeAt(0) - 65;
    if (stem.length < 12) throw new Error(`Question ${i + 1}: question text must have at least 12 characters.`);
    if (clean.length !== 4 || clean.some((v: string) => !v)) throw new Error(`Question ${i + 1}: provide exactly four options.`);
    if (idx < 0 || idx > 3) throw new Error(`Question ${i + 1}: correct answer must match an option.`);
    return {
      stem, topic: String(r.topic || "Other"), options: clean, correct_index: idx,
      explanation: String(r.explanation || "").trim() || null, source_url: String(r.source_url ?? r.source ?? "").trim() || null
    };
  });
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  questionToEdit?: Question | null;
  onSaved: () => void;
  isTeacher: boolean;
  token: string;
  flash: (msg: string) => void;
  setError: (msg: string) => void;
};

export default function QuestionEditorModal({
  isOpen, onClose, questionToEdit, onSaved, isTeacher, token, flash, setError
}: Props) {
  const [modalTab, setModalTab] = useState<"single" | "import">("single");
  const [stem, setStem] = useState("");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correct, setCorrect] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [source, setSource] = useState("");
  const [isSpecial, setIsSpecial] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setModalTab(questionToEdit ? "single" : "single");
    setStem(questionToEdit?.stem || "");
    setTopic(questionToEdit?.topic || TOPICS[0]);
    setOptions(questionToEdit?.options?.length === 4 ? [...questionToEdit.options] : ["", "", "", ""]);
    setCorrect(questionToEdit?.correct_index ?? 0);
    setExplanation(questionToEdit?.explanation || "");
    setSource(questionToEdit?.source_url || "");
    setIsSpecial(questionToEdit?.is_special || false);
    setImportText("");
    setImportMessage("");
    setHelpOpen(false);

    if (questionToEdit) {
      request("/rest/v1/rpc/get_question_editor", token, "POST", { p_question_id: questionToEdit.id })
        .then((full: any) => {
          if (!full) return;
          setStem(full.stem); setTopic(full.topic); setOptions(full.options);
          setCorrect(full.correct_index); setExplanation(full.explanation || "");
          setSource(full.source_url || ""); setIsSpecial(full.is_special || false);
        })
        .catch((e: any) => setError(e.message));
    }
  }, [isOpen, questionToEdit, token, setError]);

  if (!isOpen) return null;

  async function handleSaveSingle(e: React.FormEvent) {
    e.preventDefault();
    if (options.some(o => !o.trim())) { setError("Complete all four answer options."); return; }
    const body = {
      stem: stem.trim(), topic, options: options.map(o => o.trim()),
      correct_index: correct, explanation: explanation.trim() || null,
      source_url: source.trim() || null, ...(isTeacher ? { is_special: isSpecial } : {})
    };
    try {
      const path = questionToEdit ? `/rest/v1/questions?id=eq.${questionToEdit.id}` : "/rest/v1/questions";
      await request(path, token, questionToEdit ? "PATCH" : "POST", body, "return=minimal");
      flash(questionToEdit ? "Question updated." : "Question submitted for review.");
      onSaved();
      onClose();
    } catch (err: any) { setError(err.message || "Failed to save question"); }
  }

  async function handleImport() {
    setImportBusy(true); setImportMessage("");
    try {
      const parsed = parseImported(importText);
      const payload = parsed.map(q => ({ ...q, ...(isTeacher ? { is_special: isSpecial } : {}) }));
      await request("/rest/v1/questions", token, "POST", payload, "return=minimal");
      flash(`${payload.length} question(s) imported.`);
      onSaved();
      onClose();
    } catch (err: any) { setError(err.message || "Import failed"); } finally { setImportBusy(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <span className="eyebrow">{questionToEdit ? "QUESTION EDITOR" : "QUESTION CONTRIBUTION"}</span>
            <h2>{questionToEdit ? "Edit question" : modalTab === "import" ? "Import questions" : "Add question"}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        {!questionToEdit && (
          <div className="dc-subtabs" style={{ padding: "0 24px", margin: 0, background: "#fff" }}>
            <button type="button" className={modalTab === "single" ? "on" : ""} onClick={() => setModalTab("single")}>Single question</button>
            <button type="button" className={modalTab === "import" ? "on" : ""} onClick={() => setModalTab("import")}>Bulk import</button>
          </div>
        )}

        <div className="modal-scroll">
          {(questionToEdit || modalTab === "single") ? (
            <form className="form-card modal-form" onSubmit={handleSaveSingle}>
              <label>
                Question
                <textarea required minLength={12} maxLength={1500} value={stem} onChange={e => setStem(e.target.value)} />
              </label>
              <div className="form-grid">
                {options.map((o, i) => (
                  <label key={i}>
                    Option {"ABCD"[i]}
                    <span><input type="radio" name="correct" checked={correct === i} onChange={() => setCorrect(i)} /> Correct answer</span>
                    <input required value={o} onChange={e => setOptions(options.map((v, idx) => (i === idx ? e.target.value : v)))} />
                  </label>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  Topic
                  <select value={topic} onChange={e => setTopic(e.target.value)}>
                    {TOPICS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label>
                  Source (optional)
                  <input value={source} onChange={e => setSource(e.target.value)} placeholder="A URL or publication name" />
                </label>
              </div>
              <label>
                Explanation (optional)
                <textarea value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="Why this option is correct" />
              </label>
              {isTeacher && (
                <label className="check-row">
                  <input type="checkbox" checked={isSpecial} onChange={e => setIsSpecial(e.target.checked)} /> Mark as special question
                </label>
              )}
              <button className="primary">{questionToEdit ? "Save question" : "Submit for review"}</button>
            </form>
          ) : (
            <div className="import-panel">
              <div className="import-heading">
                <div>
                  <h3><Upload size={17} /> Import questions</h3>
                  <p>Paste JSON or CSV, or upload a .json, .csv, or .txt file.</p>
                </div>
                <button type="button" className="help-button" onClick={() => setHelpOpen(!helpOpen)}>
                  <CircleHelp size={16} /> How to import
                </button>
              </div>
              {helpOpen && (
                <div className="help-box">
                  <strong>Ask AI to format your questions</strong>
                  <p>This prompt asks for four options and fills in three distractors.</p>
                  <pre>{PROMPT_TEXT}</pre>
                  <button type="button" className="outline" onClick={() => navigator.clipboard.writeText(PROMPT_TEXT).then(() => flash("Prompt copied."))}>
                    <Copy size={15} /> Copy prompt
                  </button>
                </div>
              )}
              <textarea className="import-text" value={importText} onChange={e => setImportText(e.target.value)} placeholder={'Paste JSON or CSV here...'} />
              <div className="import-actions">
                <label className="outline file-button">
                  <FileQuestion size={15} /> Choose file
                  <input type="file" accept=".json,.csv,.txt" onChange={async e => {
                    const f = e.target.files?.[0];
                    if (f) { setImportText(await f.text()); setImportMessage(`Loaded ${f.name}`); }
                  }} />
                </label>
                <button type="button" className="primary" disabled={importBusy || !importText.trim()} onClick={handleImport}>
                  {importBusy ? "Importing..." : "Import to review queue"}
                </button>
              </div>
              {importMessage && <p className="success">{importMessage}</p>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
