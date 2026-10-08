"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Filter, Search, Shuffle, X } from "lucide-react";

type Q = {
  id: string;
  stem: string;
  topic: string;
  is_special: boolean;
  author_id: string;
  created_at: string;
  is_used_in_quiz?: boolean;
  author?: { full_name: string };
};

export type QuizPayload = {
  title: string;
  kind: string;
  ids: string[];
  opens: string;
  closes: string;
  duration: number;
  visibility: string;
};

type Props = {
  questions: Q[];
  memberName: (id: string, name: string) => string;
  onCreate: (p: QuizPayload) => Promise<void>; // should throw on failure
  onUpdate?: (id: string, p: QuizPayload) => Promise<void>;
  onClose: () => void;
  editingQuiz?: {
    id: string;
    title: string;
    kind: string;
    opens_at: string;
    closes_at: string;
    duration_minutes: number;
    result_visibility: "immediate" | "after_release" | "after_close";
    question_ids?: string[];
  } | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const toInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const nextHour = () => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
};
const windows: [string, number][] = [
  ["10 minutes", 6e5],
  ["20 minutes", 12e5],
  ["1 hour", 36e5],
  ["1 day", 864e5]
];

export default function QuizBuilder({
  questions,
  memberName,
  onCreate,
  onUpdate,
  onClose,
  editingQuiz
}: Props) {
  const [title, setTitle] = useState(editingQuiz?.title || "GPA Daily Quiz");
  const [kind, setKind] = useState(editingQuiz?.kind || "daily");
  const [opens, setOpens] = useState(
    editingQuiz ? toInput(new Date(editingQuiz.opens_at)) : toInput(nextHour())
  );
  const [closes, setCloses] = useState(
    editingQuiz
      ? toInput(new Date(editingQuiz.closes_at))
      : toInput(new Date(nextHour().getTime() + 9e5))
  );
  const [duration, setDuration] = useState(editingQuiz?.duration_minutes ?? 10);
  const [visibility, setVisibility] = useState(editingQuiz?.result_visibility || "after_release");
  const [search, setSearch] = useState("");
  const [usage, setUsage] = useState<"unused" | "used" | "all">("unused");
  const [todayOnly, setTodayOnly] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cat, setCat] = useState("all");
  const [topic, setTopic] = useState("all");
  const [authors, setAuthors] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<string[]>(
    editingQuiz?.question_ids ? [...editingQuiz.question_ids] : []
  );
  const [randomN, setRandomN] = useState(10);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const byId = useMemo(() => new Map(questions.map(q => [q.id, q])), [questions]);
  const topics = useMemo(() => Array.from(new Set(questions.map(q => q.topic))).sort(), [questions]);
  const contributors = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    questions.forEach(q => {
      const e = m.get(q.author_id);
      m.set(q.author_id, { name: q.author?.full_name || "Contributor", n: (e?.n || 0) + 1 });
    });
    return Array.from(m.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [questions]);

  const todayStr = useMemo(() => new Date().toLocaleDateString("en-CA"), []);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return questions.filter(
      q =>
        (usage === "all" || (usage === "unused" ? !q.is_used_in_quiz : Boolean(q.is_used_in_quiz))) &&
        (!todayOnly || localDay(q.created_at) === todayStr) &&
        (cat === "all" || (cat === "special" ? q.is_special : !q.is_special)) &&
        (topic === "all" || q.topic === topic) &&
        (!authors.length || authors.includes(q.author_id)) &&
        (!from || localDay(q.created_at) >= from) &&
        (!to || localDay(q.created_at) <= to) &&
        (!s || q.stem.toLowerCase().includes(s))
    );
  }, [questions, search, usage, todayOnly, todayStr, cat, topic, authors, from, to]);

  const moreFilterCount = useMemo(() => {
    let count = 0;
    if (cat !== "all") count++;
    if (topic !== "all") count++;
    if (authors.length > 0) count++;
    if (from) count++;
    if (to) count++;
    return count;
  }, [cat, topic, authors, from, to]);

  const filtersActive =
    !!search ||
    usage !== "unused" ||
    todayOnly ||
    cat !== "all" ||
    topic !== "all" ||
    authors.length > 0 ||
    !!from ||
    !!to;

  const resetFilters = () => {
    setSearch("");
    setUsage("unused");
    setTodayOnly(false);
    setCat("all");
    setTopic("all");
    setAuthors([]);
    setFrom("");
    setTo("");
  };
  const pickedSet = new Set(picked);
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const move = (i: number, d: number) =>
    setPicked(p => {
      const a = [...p],
        j = i + d;
      if (j < 0 || j >= a.length) return a;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
  const selectShown = () => setPicked(p => [...p, ...shown.filter(q => !p.includes(q.id)).map(q => q.id)]);
  const pickRandom = () => {
    const pool = shown
      .filter(q => !pickedSet.has(q.id))
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.max(0, randomN));
    setPicked(p => [...p, ...pool.map(q => q.id)]);
  };
  const toggleAuthor = (id: string) => setAuthors(a => (a.includes(id) ? a.filter(x => x !== id) : [...a, id]));

  const changeOpens = (v: string) => {
    setOpens(v);
    const o = new Date(v).getTime();
    if (!isNaN(o) && new Date(closes).getTime() <= o) setCloses(toInput(new Date(o + 864e5)));
  };
  const setWindow = (ms: number) => {
    const o = new Date(opens).getTime();
    if (!isNaN(o)) setCloses(toInput(new Date(o + ms)));
  };

  const oMs = new Date(opens).getTime(),
    cMs = new Date(closes).getTime();
  const problems: string[] = [];
  if (!title.trim()) problems.push("Give the quiz a title.");
  if (!picked.length) problems.push("Select at least one question.");
  if (isNaN(oMs) || isNaN(cMs)) problems.push("Set both opening and closing times.");
  else if (cMs <= oMs) problems.push("Closing time must be after opening time.");
  else if (cMs < Date.now()) problems.push("Closing time is already in the past.");
  if (!(duration >= 1 && duration <= 180)) problems.push("Duration must be between 1 and 180 minutes.");
  const windowMin = !isNaN(oMs) && !isNaN(cMs) ? Math.floor((cMs - oMs) / 60000) : 0;
  const warn =
    windowMin > 0 && duration > windowMin
      ? `The window is only ${windowMin} min, shorter than the ${duration}-minute timer. Students will be cut off at closing time.`
      : "";
  const fmt = (v: string) =>
    new Date(v).toLocaleString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit"
    });

  async function publish() {
    setBusy(true);
    setErr("");
    try {
      const payload: QuizPayload = {
        title: title.trim(),
        kind,
        ids: picked,
        opens,
        closes,
        duration,
        visibility
      };
      if (editingQuiz && onUpdate) {
        await onUpdate(editingQuiz.id, payload);
      } else {
        await onCreate(payload);
      }
      setReview(false);
      onClose();
    } catch (e: any) {
      setErr(e?.message || (editingQuiz ? "Could not update the quiz." : "Could not create the quiz."));
      setReview(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qb-overlay" role="dialog" aria-modal="true" aria-labelledby="qb-title">
      <header className="qb-top">
        <div>
          <span className="eyebrow">{editingQuiz ? "EDIT UPCOMING QUIZ" : "QUIZ BUILDER"}</span>
          <h2 id="qb-title">{editingQuiz ? "Edit quiz" : "Create a quiz"}</h2>
        </div>
        <button className="icon-button" aria-label="Close builder" onClick={onClose}>
          <X />
        </button>
      </header>

      <div className="qb-body">
        {err && (
          <div className="error" role="alert">
            {err}
            <button onClick={() => setErr("")}>×</button>
          </div>
        )}
        <section className="qb-card">
          <div className="qb-step">
            <span>1</span>
            <div>
              <h3>Quiz details</h3>
              <p>Name it, set when it opens, and choose when students see scores.</p>
            </div>
          </div>
          <div className="qb-grid">
            <label className="qb-wide">
              Title
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Weekly current affairs · 29 Sep"
                maxLength={120}
              />
            </label>
            <label>
              Type
              <select value={kind} onChange={e => setKind(e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label>
              Timer per student (minutes)
              <input
                type="number"
                min={1}
                max={180}
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
              />
              <span className="qb-chips">
                {[10, 15, 30, 60].map(m => (
                  <button
                    type="button"
                    key={m}
                    className={duration === m ? "on" : ""}
                    onClick={() => setDuration(m)}
                  >
                    {m}
                  </button>
                ))}
              </span>
            </label>
            <label>
              Opens
              <input type="datetime-local" value={opens} onChange={e => changeOpens(e.target.value)} />
            </label>
            <label>
              Closes
              <input type="datetime-local" value={closes} onChange={e => setCloses(e.target.value)} />
              <span className="qb-chips">
                <em>Open for</em>
                {windows.map(([l, ms]) => (
                  <button
                    type="button"
                    key={l}
                    className={windowMin === ms / 60000 ? "on" : ""}
                    onClick={() => setWindow(ms)}
                  >
                    {l}
                  </button>
                ))}
              </span>
            </label>
          </div>
          {warn && <p className="qb-warn">{warn}</p>}
          <fieldset className="qb-radios">
            <legend>When do students see their score?</legend>
            <label className={visibility === "immediate" ? "on" : ""}>
              <input
                type="radio"
                name="vis"
                checked={visibility === "immediate"}
                onChange={() => setVisibility("immediate")}
              />
              <span>
                <b>Right after they submit</b>
                <small>Answers and score are shown immediately.</small>
              </span>
            </label>
            <label className={visibility === "after_release" ? "on" : ""}>
              <input
                type="radio"
                name="vis"
                checked={visibility === "after_release"}
                onChange={() => setVisibility("after_release")}
              />
              <span>
                <b>After I publish results</b>
                <small>Hidden until you press &quot;Publish results&quot;.</small>
              </span>
            </label>
            <label className={visibility === "after_close" ? "on" : ""}>
              <input
                type="radio"
                name="vis"
                checked={visibility === "after_close"}
                onChange={() => setVisibility("after_close")}
              />
              <span>
                <b>When the quiz closes</b>
                <small>Scores stay hidden until the scheduled close or an early teacher close.</small>
              </span>
            </label>
          </fieldset>
        </section>

        <section className="qb-card">
          <div className="qb-step">
            <span>2</span>
            <div>
              <h3>Choose questions</h3>
              <p>Filters only change what you see. Your selection is kept while you filter.</p>
            </div>
          </div>
          <div className="qb-split">
            <div className="qb-left">
              <div className="qb-filters">
                {/* Search Input */}
                <label className="qb-search">
                  <Search size={16} />
                  <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search question text"
                  />
                </label>

                {/* Always-Visible Primary Filter Bar */}
                <div className="qb-picker-primary-bar">
                  <div className="qb-usage-toggle" role="group" aria-label="Filter by quiz usage">
                    <button
                      type="button"
                      className={`qb-usage-btn fresh ${usage === "unused" ? "active" : ""}`}
                      onClick={() => setUsage("unused")}
                    >
                      ★ Fresh (Never quizzed)
                    </button>
                    <button
                      type="button"
                      className={`qb-usage-btn ${usage === "used" ? "active" : ""}`}
                      onClick={() => setUsage("used")}
                    >
                      Already quizzed
                    </button>
                    <button
                      type="button"
                      className={`qb-usage-btn ${usage === "all" ? "active" : ""}`}
                      onClick={() => setUsage("all")}
                    >
                      All
                    </button>
                  </div>

                  <button
                    type="button"
                    className={`qb-chip-toggle ${todayOnly ? "active" : ""}`}
                    onClick={() => setTodayOnly(!todayOnly)}
                  >
                    Uploaded today
                  </button>

                  <button
                    type="button"
                    className={`qb-more-toggle ${moreOpen || moreFilterCount > 0 ? "active" : ""}`}
                    onClick={() => setMoreOpen(!moreOpen)}
                  >
                    <Filter size={14} /> More filters {moreFilterCount > 0 ? `(${moreFilterCount})` : ""}
                  </button>
                </div>

                {/* Collapsible Secondary Filters */}
                {moreOpen && (
                  <div className="qb-picker-drawer">
                    <div className="qb-seg" role="group" aria-label="Category">
                      {[
                        ["all", "All"],
                        ["daily", "Regular"],
                        ["special", "Special"]
                      ].map(([v, l]) => (
                        <button
                          type="button"
                          key={v}
                          className={cat === v ? "on" : ""}
                          onClick={() => setCat(v)}
                        >
                          {l}
                        </button>
                      ))}
                    </div>

                    <div className="qb-row2">
                      <label>
                        Topic
                        <select value={topic} onChange={e => setTopic(e.target.value)}>
                          <option value="all">All topics</option>
                          {topics.map(t => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        From
                        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
                      </label>
                      <label>
                        To
                        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
                      </label>
                    </div>

                    <div>
                      <span className="qb-label">Contributors</span>
                      <div className="qb-people">
                        {contributors.map(([id, c]) => (
                          <button
                            type="button"
                            key={id}
                            className={authors.includes(id) ? "on" : ""}
                            onClick={() => toggleAuthor(id)}
                          >
                            {memberName(id, c.name)} <i>{c.n}</i>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {filtersActive && (
                  <button type="button" className="plain qb-reset" onClick={resetFilters}>
                    Reset filters
                  </button>
                )}
              </div>

              <div className="qb-toolbar">
                <strong>
                  {shown.length} question{shown.length === 1 ? "" : "s"} shown
                </strong>
                <div>
                  <button type="button" className="outline" onClick={selectShown} disabled={!shown.length}>
                    Select all shown
                  </button>
                  <span className="qb-random">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={randomN}
                      onChange={e => setRandomN(Number(e.target.value))}
                      aria-label="Number of random questions"
                    />
                    <button type="button" className="outline" onClick={pickRandom} disabled={!shown.length}>
                      <Shuffle size={14} /> Pick random
                    </button>
                  </span>
                </div>
              </div>

             <div className="qb-list">
                {shown.map(q => (
                  <label key={q.id} className={pickedSet.has(q.id) ? "on" : ""}>
                    <input type="checkbox" checked={pickedSet.has(q.id)} onChange={() => toggle(q.id)} />
                    <span>
                      <b>{q.stem}</b>
                      <small style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "4px" }}>
                        <span
                          className={`tag ${q.is_used_in_quiz ? "" : "approved"}`}
                          style={{ fontSize: "11px", padding: "1px 7px" }}
                        >
                          {q.is_used_in_quiz ? "Used in quiz" : "Fresh"}
                        </span>
                        <span>{q.topic}</span>
                        {q.is_special && (
                          <span className="tag pending" style={{ fontSize: "11px", padding: "1px 6px" }}>
                            Special
                          </span>
                        )}
                        <span>•</span>
                        <span>{memberName(q.author_id, q.author?.full_name || "Contributor")}</span>
                        <span>•</span>
                        <span>{new Date(q.created_at).toLocaleDateString()}</span>
                      </small>
                    </span>
                  </label>
                ))}
                {!shown.length && <div className="empty">No approved questions match these filters.</div>}
              </div>
            </div>

            <aside className="qb-right">
              <div className="qb-right-head">
                <strong>Selected · {picked.length}</strong>
                <div>
                  <button
                    type="button"
                    className="plain"
                    onClick={() => setPicked(p => [...p].sort(() => Math.random() - 0.5))}
                    disabled={picked.length < 2}
                  >
                    Shuffle order
                  </button>
                  <button type="button" className="plain" onClick={() => setPicked([])} disabled={!picked.length}>
                    Clear
                  </button>
                </div>
              </div>
              <ol>
                {picked.map((id, i) => {
                  const q = byId.get(id);
                  return (
                    <li key={id}>
                      <span className="qb-n">{i + 1}</span>
                      <span className="qb-stem">{q?.stem || "Question"}</span>
                      <span className="qb-move">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={i === picked.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button type="button" aria-label="Remove" onClick={() => toggle(id)}>
                          <X size={14} />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
              {!picked.length && <div className="empty">Nothing selected yet. Tick questions on the left.</div>}
            </aside>
          </div>
        </section>
      </div>

      <footer className="qb-foot">
        <div className="qb-sum">
          <strong>
            {picked.length} question{picked.length === 1 ? "" : "s"} · {duration} min
          </strong>
          <small>
            {problems.length
              ? problems[0] + (problems.length > 1 ? ` (+${problems.length - 1} more)` : "")
              : `Opens ${fmt(opens)} · closes ${fmt(closes)}`}
          </small>
        </div>
        <button className="outline" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" disabled={problems.length > 0} onClick={() => setReview(true)}>
          {editingQuiz ? "Review & save" : "Review & publish"}
        </button>
      </footer>

      {review && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !busy) setReview(false);
          }}
        >
          <section className="modal qb-confirm" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <span className="eyebrow">CONFIRM</span>
                <h2>{editingQuiz ? "Save changes to this quiz?" : "Publish this quiz?"}</h2>
              </div>
            </div>
            <div className="modal-scroll">
              <dl className="qb-dl">
                <div>
                  <dt>Title</dt>
                  <dd>{title.trim()}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd style={{ textTransform: "capitalize" }}>{kind}</dd>
                </div>
                <div>
                  <dt>Questions</dt>
                  <dd>{picked.length}</dd>
                </div>
                <div>
                  <dt>Timer</dt>
                  <dd>{duration} minutes per student</dd>
                </div>
                <div>
                  <dt>Opens</dt>
                  <dd>{fmt(opens)}</dd>
                </div>
                <div>
                  <dt>Closes</dt>
                  <dd>{fmt(closes)}</dd>
                </div>
                <div>
                  <dt>Scores</dt>
                  <dd>
                    {visibility === "immediate"
                      ? "Shown right after submission"
                      : "Shown after you publish results"}
                  </dd>
                </div>
              </dl>
              {warn && <p className="qb-warn">{warn}</p>}
              <p className="qb-note">
                {editingQuiz
                  ? "These changes will update the quiz schedule and questions before students start taking it."
                  : "It goes live for students as soon as it is published. The questions cannot be changed afterwards."}
              </p>
            </div>
            <div className="dc-foot">
              <span className="grow" />
              <button className="outline" disabled={busy} onClick={() => setReview(false)}>
                Go back
              </button>
              <button className="primary" disabled={busy} onClick={publish}>
                {busy
                  ? editingQuiz
                    ? "Saving…"
                    : "Publishing…"
                  : editingQuiz
                  ? "Save changes"
                  : "Publish quiz"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
