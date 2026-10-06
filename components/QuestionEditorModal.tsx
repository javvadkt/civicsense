"use client";

import { useEffect, useState } from "react";
import { 
  ArrowRight, 
  Check, 
  CircleHelp, 
  Copy, 
  ExternalLink, 
  FileQuestion, 
  RotateCcw, 
  Upload, 
  X 
} from "lucide-react";
import { request } from "../context/AuthContext";
import type { Question } from "../context/DataProvider";

export const TOPICS = [
  "Polity", "Economy", "Environment", "International relations",
  "Science & technology", "Government schemes", "History", "Reports & indices", "Other"
];

const PROMPT_BASE = `Act as a strict MCQ data ingestion parser. Convert the text below into raw JSON for database import.

OUTPUT RULES:
- Output ONLY valid JSON matching the schema below. No markdown fences (\`\`\`json), no conversational filler.
- Schema:
{
  "questions": [
    {
      "stem": "Exact question text. Preserve \\n for multi-statement items (1., 2.).",
      "topic": "Polity" | "Economy" | "Environment" | "International Relations" | "Science & Technology" | "Government Schemes" | "History" | "Reports & Indices" | "Other",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
      "correct_answer": "Exact match to one string in options",
      "explanation": "Verbatim text if provided, else empty string",
      "source": "Verbatim source if provided, else empty string"
    }
  ]
}

EXTRACTION RULES:
1. VERBATIM: Do not rephrase, edit, fix grammar, or summarize existing stems or answers.
2. SANITIZE: Strip all "A)", "B.", "(a)" prefixes from options. Store only raw option text.
3. MATCH: "correct_answer" must be a character-for-character match to one item in "options".
4. DISTRACTORS: If only the correct answer is given, create 3 plausible UPSC distractors and shuffle the options.
5. NO HALLUCINATION: If explanation or source is missing, use "". Do not invent them.`;

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
  // Clean markdown backticks before JSON parsing
  const sanitized = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let records: any[];
  try {
    const parsed = JSON.parse(sanitized);
    records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.questions) ? parsed.questions : [parsed];
  } catch {
    records = parseCsv(sanitized);
  }
  if (!records.length) throw new Error("No questions were found in that input.");
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

  // Import State & Accordion Steps
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [rawText, setRawText] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setModalTab("single");
    setStem(questionToEdit?.stem || "");
    setTopic(questionToEdit?.topic || TOPICS[0]);
    setOptions(questionToEdit?.options?.length === 4 ? [...questionToEdit.options] : ["", "", "", ""]);
    setCorrect(questionToEdit?.correct_index ?? 0);
    setExplanation(questionToEdit?.explanation || "");
    setSource(questionToEdit?.source_url || "");
    setIsSpecial(questionToEdit?.is_special || false);
    
    // Reset import wizard state
    setImportStep(1);
    setRawText("");
    setCopiedPrompt(false);
    setImportText("");
    setImportMessage("");

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

  async function handleCopyBundledPrompt() {
    const fullPrompt = `${PROMPT_BASE}\n\n--- INPUT MATERIAL ---\n${rawText.trim()}`;
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopiedPrompt(true);
      flash("Prompt with your questions copied!");
      setTimeout(() => {
        setCopiedPrompt(false);
        setImportStep(3); // Advance to paste box
      }, 900);
    } catch {
      setError("Unable to copy to clipboard. Please copy manually.");
    }
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
            <div className="import-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="import-heading">
                <div>
                  <h3><Upload size={17} /> 3-Step AI Question Importer</h3>
                  <p>Convert raw notes or questions into clean database JSON with AI.</p>
                </div>
                {importStep !== 3 && (
                  <button 
                    type="button" 
                    className="help-button" 
                    style={{ fontSize: "12px", border: "none", background: "none", cursor: "pointer", color: "#64748b" }}
                    onClick={() => setImportStep(3)}
                  >
                    Skip to direct paste / upload &rarr;
                  </button>
                )}
              </div>

              {/* STEP 1: PASTE RAW CONTENT */}
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "14px 16px",
                background: importStep === 1 ? "#fff" : "#f8fafc"
              }}>
                <div 
                  onClick={() => setImportStep(1)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{
                      width: "24px", height: "24px", borderRadius: "50%",
                      background: importStep === 1 ? "#2563eb" : "#cbd5e1",
                      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "12px", fontWeight: "bold"
                    }}>1</span>
                    <strong style={{ fontSize: "14px" }}>Paste raw questions & answers</strong>
                  </div>
                  {importStep !== 1 && rawText.trim() && (
                    <span style={{ fontSize: "12px", color: "#059669", background: "#ecfdf5", padding: "2px 8px", borderRadius: "12px" }}>
                      ✓ {rawText.length} chars loaded (Click to edit)
                    </span>
                  )}
                </div>

                {importStep === 1 && (
                  <div style={{ marginTop: "12px" }}>
                    <textarea 
                      className="import-text" 
                      rows={5}
                      value={rawText} 
                      onChange={e => setRawText(e.target.value)} 
                      placeholder="Paste your UPSC text, rough MCQ drafts, or stems with correct answers here..." 
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                      <button 
                        type="button" 
                        className="primary" 
                        disabled={!rawText.trim()}
                        onClick={() => setImportStep(2)}
                      >
                        Next: Generate Prompt <ArrowRight size={14} style={{ marginLeft: "4px" }} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* STEP 2: COPY AI PROMPT */}
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "14px 16px",
                background: importStep === 2 ? "#fff" : "#f8fafc"
              }}>
                <div 
                  onClick={() => rawText.trim() && setImportStep(2)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: rawText.trim() ? "pointer" : "default" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{
                      width: "24px", height: "24px", borderRadius: "50%",
                      background: importStep === 2 ? "#2563eb" : "#cbd5e1",
                      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "12px", fontWeight: "bold"
                    }}>2</span>
                    <strong style={{ fontSize: "14px" }}>Copy prompt with questions</strong>
                  </div>
                  {importStep === 3 && (
                    <span style={{ fontSize: "12px", color: "#059669", background: "#ecfdf5", padding: "2px 8px", borderRadius: "12px" }}>
                      ✓ Copied
                    </span>
                  )}
                </div>

                {importStep === 2 && (
                  <div style={{ marginTop: "12px" }}>
                    <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 12px 0" }}>
                      Click below to copy your material bundled with the exact UPSC JSON formatting prompt. Paste it into your AI of choice:
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                      <button 
                        type="button" 
                        className="primary"
                        onClick={handleCopyBundledPrompt}
                        style={{ display: "flex", alignItems: "center", gap: "6px" }}
                      >
                        {copiedPrompt ? <Check size={16} /> : <Copy size={16} />}
                        {copiedPrompt ? "Copied to Clipboard!" : "Copy Prompt + Questions"}
                      </button>

                      <div style={{ display: "flex", gap: "8px", fontSize: "12px", color: "#64748b", alignItems: "center" }}>
                        <span>Open:</span>
                        <a href="https://chatgpt.com" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>ChatGPT <ExternalLink size={10} /></a>
                        <a href="https://gemini.google.com" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>Gemini <ExternalLink size={10} /></a>
                        <a href="https://claude.ai" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>Claude <ExternalLink size={10} /></a>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button type="button" className="outline" onClick={() => setImportStep(3)}>
                        Skip to Paste Response <ArrowRight size={14} style={{ marginLeft: "4px" }} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* STEP 3: PASTE AI RESPONSE & IMPORT */}
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "14px 16px",
                background: importStep === 3 ? "#fff" : "#f8fafc"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{
                      width: "24px", height: "24px", borderRadius: "50%",
                      background: importStep === 3 ? "#2563eb" : "#cbd5e1",
                      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "12px", fontWeight: "bold"
                    }}>3</span>
                    <strong style={{ fontSize: "14px" }}>Paste AI result & import</strong>
                  </div>
                </div>

                {importStep === 3 && (
                  <div style={{ marginTop: "12px" }}>
                    <textarea 
                      className="import-text" 
                      rows={6}
                      value={importText} 
                      onChange={e => setImportText(e.target.value)} 
                      placeholder="Paste the JSON response returned by the AI (or paste CSV / JSON directly)..." 
                    />
                    <div className="import-actions" style={{ marginTop: "12px" }}>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <label className="outline file-button">
                          <FileQuestion size={15} /> Upload file
                          <input type="file" accept=".json,.csv,.txt" onChange={async e => {
                            const f = e.target.files?.[0];
                            if (f) { setImportText(await f.text()); setImportMessage(`Loaded ${f.name}`); }
                          }} />
                        </label>
                        <button 
                          type="button" 
                          className="outline" 
                          onClick={() => { setRawText(""); setImportText(""); setImportStep(1); }}
                          title="Reset wizard"
                        >
                          <RotateCcw size={14} /> Start over
                        </button>
                      </div>

                      <button 
                        type="button" 
                        className="primary" 
                        disabled={importBusy || !importText.trim()} 
                        onClick={handleImport}
                      >
                        {importBusy ? "Importing..." : "Import to review queue"}
                      </button>
                    </div>
                    {importMessage && <p className="success" style={{ marginTop: "8px" }}>{importMessage}</p>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
