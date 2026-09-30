"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type Api = (path: string, method?: string, body?: unknown, prefer?: string) => Promise<any>;
export type Person = { id: string; full_name: string; role: string; active: boolean; enrollment_number?: string | null };
export type Rotation = { cycle: number; rows: { profile_id: string; position: number; assigned_on: string | null }[] };

export const dutyStatuses: Record<string, string> = { assigned: "Assigned", confirmed: "Confirmed", in_progress: "In progress", submitted: "Questions submitted", reviewed: "Reviewed", change_requested: "Change requested", excused: "Excused", missed: "Missed" };
const iso = (d: Date) => d.toLocaleDateString("en-CA");
export const shiftDay = (date: string, n: number) => { const x = new Date(`${date}T12:00:00`); x.setDate(x.getDate() + n); return iso(x) };
export const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const isMember = (x: Person) => x.active && ["student", "student_leader"].includes(x.role);
const byEnrollment = (a: Person, b: Person, dir: 1 | -1) => {
  const x = a.enrollment_number || "", y = b.enrollment_number || "";
  if (!x && !y) return a.full_name.localeCompare(b.full_name);
  if (!x) return 1; if (!y) return -1;
  return dir * x.localeCompare(y, undefined, { numeric: true });
};
const shuffle = <T,>(arr: T[], seed: number) => {
  const a = [...arr]; let s = seed || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a;
};

/** Students still waiting for their turn in the current rotation, in queue order. New joiners go last. */
export function waitingList(rotation: Rotation | null, people: Person[]): Person[] {
  if (!rotation) return [];
  const active = people.filter(isMember);
  const inRows = new Set(rotation.rows.map(r => r.profile_id));
  const queued = rotation.rows.filter(r => !r.assigned_on).sort((a, b) => a.position - b.position)
    .map(r => active.find(x => x.id === r.profile_id)).filter((x): x is Person => !!x);
  return [...queued, ...active.filter(x => !inRows.has(x.id))];
}

/* ---------------- Rotation overview ---------------- */
export function RotationPanel({ rotation, people, onBulk }: { rotation: Rotation | null; people: Person[]; onBulk: () => void }) {
  const waiting = waitingList(rotation, people);
  const done = (rotation?.rows || []).filter(r => r.assigned_on).sort((a, b) => String(a.assigned_on).localeCompare(String(b.assigned_on)));
  const total = done.length + waiting.length, pct = total ? Math.round((done.length / total) * 100) : 0;
  return <section className="card rp">
    <div className="rp-head">
      <div><h3>Rotation {rotation?.cycle ?? "—"}</h3>
        <p>{rotation ? `${done.length} of ${total} students have had their turn` + (waiting.length ? ` · next in line: ${waiting[0].full_name}` : " · everyone is done, so the next assignment starts a new rotation") : "Rotation details are not available yet."}</p></div>
      <button className="outline" onClick={onBulk}>Bulk assign…</button>
    </div>
    {rotation && total > 0 && <>
      <div className="rp-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="rp-chips">
        {waiting.map((x, i) => <span key={x.id} className={i === 0 ? "next" : ""}>{i + 1}. {x.full_name}{x.enrollment_number && <i>{x.enrollment_number}</i>}</span>)}
        {done.map(r => { const x = people.find(y => y.id === r.profile_id); return <span key={r.profile_id} className="done" title={r.assigned_on || ""}>{x?.full_name || "Student"}</span> })}
      </div></>}
  </section>;
}

/* ---------------- Bulk assign ---------------- */
type BulkProps = {
  people: Person[]; duties: any[]; rotation: Rotation | null; api: Api;
  flash: (s: string) => void; fail: (s: string) => void; refresh: () => Promise<void>;
  defaultStart: string; onClose: () => void;
};
export function BulkAssign({ people, duties, rotation, api, flash, fail, refresh, defaultStart, onClose }: BulkProps) {
  const apiRef = useRef(api); apiRef.current = api;
  const waiting = waitingList(rotation, people), fresh = waiting.length === 0;
  const pool = fresh ? people.filter(isMember) : waiting;
  const [start, setStart] = useState(defaultStart), [skip, setSkip] = useState("none"), [order, setOrder] = useState(fresh ? "enrol_asc" : "queue");
  const [target, setTarget] = useState("5"), [off, setOff] = useState<Set<string>>(new Set());
  const [skipDates, setSkipDates] = useState<string[]>([]), [skipInput, setSkipInput] = useState("");
  const [seed, setSeed] = useState(7), [leave, setLeave] = useState<any[]>([]), [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!start) return;
    let live = true;
    apiRef.current(`/rest/v1/duty_availability?select=profile_id,availability_date,status&availability_date=gte.${start}&availability_date=lte.${shiftDay(start, 150)}&status=in.(leave,unavailable)&limit=1000`)
      .then(r => { if (live) setLeave(r || []) }).catch(() => { if (live) setLeave([]) });
    return () => { live = false };
  }, [start]);

  const leaveMap = new Map<string, Set<string>>();
  leave.forEach(r => { if (!leaveMap.has(r.availability_date)) leaveMap.set(r.availability_date, new Set()); leaveMap.get(r.availability_date)!.add(r.profile_id) });

  let ordered = [...pool];
  if (order === "enrol_asc") ordered.sort((a, b) => byEnrollment(a, b, 1));
  else if (order === "enrol_desc") ordered.sort((a, b) => byEnrollment(a, b, -1));
  else if (order === "random") ordered = shuffle(ordered, seed);

  const taken = new Set(duties.map((d: any) => d.duty_date));
  const left = ordered.filter(x => !off.has(x.id));
  const rows: { date: string; student: Person }[] = [];
  const todayStr = iso(new Date()), past = !!start && start < todayStr;
  if (start && !past) {
    let day = start, guard = 0;
    while (left.length && guard < 150 && rows.length < 100) {
      guard++;
      const dow = new Date(`${day}T12:00:00`).getDay();
      const dayOff = (skip === "sun" && dow === 0) || (skip === "weekend" && (dow === 0 || dow === 6)) || skipDates.includes(day) || taken.has(day);
      if (!dayOff) { const i = left.findIndex(x => !leaveMap.get(day)?.has(x.id)); if (i >= 0) { rows.push({ date: day, student: left[i] }); left.splice(i, 1) } }
      day = shiftDay(day, 1);
    }
  }
  const targetOk = Number(target) >= 1 && Number(target) <= 20;
  const toggle = (id: string) => setOff(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n });

  async function run() {
    if (!rows.length) return;
    setBusy(true);
    try {
      await apiRef.current("/rest/v1/rpc/bulk_assign_duties", "POST", { p_dates: rows.map(r => r.date), p_student_ids: rows.map(r => r.student.id), p_target_count: Number(target) });
      flash(`${rows.length} duties assigned.`); await refresh(); onClose();
    } catch (e: any) { fail(e?.message || "Bulk assignment failed") } finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <section className="modal bk-modal" role="dialog" aria-modal="true" aria-labelledby="bk-title">
      <div className="modal-head"><div><span className="eyebrow">BULK ASSIGN</span><h2 id="bk-title">Assign many days at once</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="modal-scroll">
        <div className="bk-note">{fresh
          ? (rotation?.rows.length ? "Everyone has had a turn in the current rotation, so this starts a new rotation with everyone." : "No rotation has started yet, so this starts the first one.")
          : `This finishes rotation ${rotation?.cycle}: ${waiting.length} student${waiting.length === 1 ? " is" : "s are"} still waiting for a turn.`}</div>
        <div className="dc-form bk-grid">
          <label>Start date<input type="date" min={todayStr} value={start} onChange={e => setStart(e.target.value)} /></label>
          <label>Question target per day<input type="number" min={1} max={20} value={target} onChange={e => setTarget(e.target.value)} /></label>
          <label>Order<select value={order} onChange={e => setOrder(e.target.value)}>
            {!fresh && <option value="queue">Rotation queue order</option>}
            <option value="enrol_asc">Enrollment number, low to high</option>
            <option value="enrol_desc">Enrollment number, high to low</option>
            <option value="random">Random</option></select>
            {order === "random" && <button type="button" className="plain bk-shuffle" onClick={() => setSeed(s => s + 1)}>Shuffle again</button>}</label>
          <label>Days to skip<select value={skip} onChange={e => setSkip(e.target.value)}>
            <option value="none">None, use every day</option><option value="sun">Skip Sundays</option><option value="weekend">Skip Saturdays and Sundays</option></select></label>
          <label className="bk-wide">Skip specific dates (holidays, exams)
            <span className="bk-skip"><input type="date" min={todayStr} value={skipInput} onChange={e => setSkipInput(e.target.value)} />
              <button type="button" className="outline" disabled={!skipInput || skipDates.includes(skipInput)} onClick={() => { setSkipDates(s => [...s, skipInput].sort()); setSkipInput("") }}>Add</button></span>
            {skipDates.length > 0 && <span className="bk-chips">{skipDates.map(d => <button type="button" key={d} onClick={() => setSkipDates(s => s.filter(x => x !== d))}>{dayLabel(d)} ×</button>)}</span>}</label>
        </div>

        <div className="bk-block"><span className="qb-label">Who is included ({pool.length - off.size} of {pool.length})</span>
          <div className="bk-people">{pool.map(x => <button type="button" key={x.id} className={off.has(x.id) ? "" : "on"} onClick={() => toggle(x.id)}>{x.full_name}{x.enrollment_number ? ` · ${x.enrollment_number}` : ""}</button>)}</div>
          <small className="dc-sub">Untick anyone who should be left out of this batch. People on leave are skipped automatically for those days.</small></div>

        <div className="bk-block"><span className="qb-label">Preview</span>
          {past && <p className="qb-warn">Choose today or a later start date.</p>}
          {!past && !rows.length && <div className="empty">No days available with these settings.</div>}
          {rows.length > 0 && <div className="bk-preview">{rows.map((r, i) => <div className="bk-row" key={r.date}><span><b>{dayLabel(r.date)}</b><small>{r.date}</small></span><span>{i + 1}. {r.student.full_name}{r.student.enrollment_number ? <i> · {r.student.enrollment_number}</i> : null}</span></div>)}</div>}
          {left.length > 0 && !past && <p className="qb-warn">Could not place: {left.map(x => x.full_name).join(", ")}. They were unavailable on every day tried, or there are too many days skipped.</p>}
        </div>
      </div>
      <div className="dc-foot">
        <span className="grow bk-sum">{rows.length ? `${rows.length} duties · ${dayLabel(rows[0].date)} to ${dayLabel(rows[rows.length - 1].date)}` : "Nothing to assign yet"}</span>
        <button className="outline" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !rows.length || !targetOk || past} onClick={run}>{busy ? "Assigning…" : `Assign ${rows.length} duties`}</button>
      </div>
    </section>
  </div>;
}

/* ---------------- Student / leader availability ---------------- */
export function MyAvailability({ profile, duties, today, api, flash, fail }: { profile: { id: string }; duties: any[]; today: string; api: Api; flash: (s: string) => void; fail: (s: string) => void }) {
  const apiRef = useRef(api); apiRef.current = api;
  const [date, setDate] = useState(shiftDay(today, 1)), [status, setStatus] = useState("leave"), [note, setNote] = useState("");
  const [rows, setRows] = useState<any[]>([]), [busy, setBusy] = useState(false);
  const load = async () => {
    try { const r = await apiRef.current(`/rest/v1/duty_availability?select=availability_date,status,note&profile_id=eq.${profile.id}&availability_date=gte.${today}&status=neq.available&order=availability_date.asc&limit=60`); setRows(r || []) }
    catch { setRows([]) }
  };
  useEffect(() => { load() }, [profile.id, today]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(nextStatus: string, forDate: string, forNote: string) {
    if (!forDate || forDate < today) { fail("Choose today or a future date."); return }
    if (nextStatus !== "available" && duties.some(d => d.student_id === profile.id && d.duty_date === forDate)) { fail("You already have a duty on that date. Open it and use Request change instead."); return }
    setBusy(true);
    try {
      await apiRef.current("/rest/v1/duty_availability", "POST", { profile_id: profile.id, availability_date: forDate, status: nextStatus, note: forNote.trim() || null }, "resolution=merge-duplicates,return=minimal");
      flash(nextStatus === "available" ? "Marked available again." : "Saved. You will not be picked for that day.");
      if (nextStatus !== "available") setNote("");
      await load();
    } catch (e: any) { fail(e?.message || "Could not save") } finally { setBusy(false) }
  }
  return <section className="card av">
    <h3>My availability</h3>
    <p>Away on a day? Mark it here and you won't be picked for that duty.</p>
    <div className="av-form">
      <label>Date<input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="leave">On leave</option><option value="unavailable">Unavailable</option></select></label>
      <label>Note (optional)<input value={note} maxLength={120} onChange={e => setNote(e.target.value)} placeholder="e.g. exam, travel" /></label>
      <button className="primary" disabled={busy || !date} onClick={() => save(status, date, note)}>{busy ? "Saving…" : "Save"}</button>
    </div>
    {rows.length > 0 && <ul className="av-list">{rows.map(r => <li key={r.availability_date}><span><b>{dayLabel(r.availability_date)}</b> · {r.status === "leave" ? "On leave" : "Unavailable"}{r.note ? ` · ${r.note}` : ""}</span><button className="plain" disabled={busy} onClick={() => save("available", r.availability_date, "")}>Remove</button></li>)}</ul>}
  </section>;
}

/* ---------------- Duty history (staff) ---------------- */
export function DutyHistory({ dutyId, api, people }: { dutyId: string; api: Api; people: Person[] }) {
  const apiRef = useRef(api); apiRef.current = api;
  const [rows, setRows] = useState<any[] | null>(null);
  const nm = (id: string | null) => people.find(x => x.id === id)?.full_name || "Someone";
  const text = (r: any) => {
    const a: string = r.action;
    if (a === "reassigned") return `Reassigned from ${nm(r.old_student_id)} to ${nm(r.new_student_id)}`;
    if (a === "edited") return "Details edited";
    if (a === "manually_assigned") return `Assigned to ${nm(r.new_student_id)}`;
    if (a === "bulk_assigned") return `Assigned to ${nm(r.new_student_id)} (bulk)`;
    if (a === "swapped") return `Days swapped: ${nm(r.old_student_id)} and ${nm(r.new_student_id)}`;
    if (a === "deleted") return "Deleted";
    if (a.startsWith("status:")) return `Status changed to ${dutyStatuses[a.slice(7)] || a.slice(7)}`;
    return a;
  };
  const load = () => {
    if (rows) return;
    apiRef.current(`/rest/v1/duty_change_log?select=action,old_student_id,new_student_id,reason,changed_at,changed_by&duty_id=eq.${dutyId}&order=changed_at.desc&limit=25`)
      .then(r => setRows(r || [])).catch(() => setRows([]));
  };
  return <details className="dc-history" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) load() }}>
    <summary>History</summary>
    {rows === null ? <p>Loading…</p> : !rows.length ? <p>No changes recorded yet.</p> :
      <ul>{rows.map((r, i) => <li key={i}><b>{text(r)}</b><small>{new Date(r.changed_at).toLocaleString()}{r.changed_by ? ` · by ${nm(r.changed_by)}` : ""}{r.reason ? ` · ${r.reason}` : ""}</small></li>)}</ul>}
  </details>;
}

/* ---------------- Questions that count for a duty ---------------- */
const qLabel: Record<string, string> = { approved: "Approved", pending: "Waiting for review", revision_requested: "Needs revision" };
export function DutyQuestions({ duty, mine, manage, target, signal, api, flash, fail, refresh, onAdd }: {
  duty: { id: string; duty_status?: string }; mine: boolean; manage: boolean; target: number; signal: string; api: Api;
  flash: (s: string) => void; fail: (s: string) => void; refresh: () => Promise<void>; onAdd: () => void;
}) {
  const apiRef = useRef(api); apiRef.current = api;
  const [rows, setRows] = useState<any[] | null>(null), [pool, setPool] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false), [pick, setPick] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false);
  const loadLinked = async () => { try { setRows((await apiRef.current("/rest/v1/rpc/get_duty_questions", "POST", { p_duty_id: duty.id })) || []) } catch { setRows([]) } };
  const loadPool = async () => { try { setPool((await apiRef.current("/rest/v1/rpc/get_my_unlinked_questions", "POST", {})) || []) } catch { setPool([]) } };
  useEffect(() => { loadLinked() }, [duty.id, signal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) loadPool() }, [open, signal]); // eslint-disable-line react-hooks/exhaustive-deps

  const have = rows?.length ?? 0, remaining = Math.max(0, target - have);
  const canEdit = (mine || manage) && !(duty.duty_status === "reviewed" && !manage);
  const tagClass = (s: string) => `tag ${s === "pending" ? "pending" : s === "revision_requested" ? "revision_requested" : ""}`;
  const reloadAll = async () => { await Promise.all([loadLinked(), open ? loadPool() : Promise.resolve(), refresh()]) };

  async function attach() {
    if (!pick.size) return;
    setBusy(true);
    try {
      const n = await apiRef.current("/rest/v1/rpc/attach_questions_to_duty", "POST", { p_duty_id: duty.id, p_question_ids: Array.from(pick) });
      flash(`${n} question${n === 1 ? "" : "s"} added to this duty.`); setPick(new Set()); await reloadAll();
    } catch (e: any) { fail(e?.message || "Could not add the questions") } finally { setBusy(false) }
  }
  async function detach(id: string) {
    setBusy(true);
    try { await apiRef.current("/rest/v1/rpc/detach_question_from_duty", "POST", { p_question_id: id }); flash("Question removed from this duty."); await reloadAll() }
    catch (e: any) { fail(e?.message || "Could not remove the question") } finally { setBusy(false) }
  }
  const toggle = (id: string) => setPick(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n });

  return <div className="dq">
    <div className="dq-head"><strong>Questions for this duty</strong>
      {mine && canEdit && remaining > 0 && <div className="actions"><button className="primary" onClick={onAdd}>Add questions</button><button className="outline" onClick={() => setOpen(o => !o)}>{open ? "Hide earlier questions" : "Use earlier questions"}</button></div>}</div>
    {rows === null ? <p className="dq-empty">Loading…</p> : !rows.length
      ? <p className="dq-empty">{mine ? "Nothing yet. Questions you add are counted here automatically." : "No questions added yet."}</p>
      : <ul className="dq-list">{rows.map(q => <li key={q.question_id}>
        <span><b>{q.stem}</b><small>{q.topic} · {new Date(q.created_at).toLocaleDateString()}</small></span>
        <span className={tagClass(q.status)}>{qLabel[q.status] || q.status}</span>
        {canEdit && <button className="plain" disabled={busy} onClick={() => detach(q.question_id)}>Unlink</button>}</li>)}</ul>}
    {open && mine && <div className="dq-pool">
      <p>Questions you added earlier that don't count for any duty yet. Pick up to {remaining}.</p>
      {pool === null ? <p className="dq-empty">Loading…</p> : !pool.length ? <p className="dq-empty">You have no unlinked questions.</p> :
        <div className="dq-pool-list">{pool.map(q => <label key={q.question_id} className={pick.has(q.question_id) ? "on" : ""}>
          <input type="checkbox" checked={pick.has(q.question_id)} disabled={!pick.has(q.question_id) && pick.size >= remaining} onChange={() => toggle(q.question_id)} />
          <span><b>{q.stem}</b><small>{q.topic} · {qLabel[q.status] || q.status} · {new Date(q.created_at).toLocaleDateString()}</small></span></label>)}</div>}
      <div className="actions"><button className="primary" disabled={busy || !pick.size} onClick={attach}>{busy ? "Adding…" : `Add ${pick.size || ""} to this duty`}</button></div>
    </div>}
  </div>;
}
