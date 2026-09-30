"use client";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, TriangleAlert } from "lucide-react";

export const dutyStatuses: Record<string, string> = { assigned: "Assigned", confirmed: "Confirmed", in_progress: "In progress", submitted: "Questions submitted", reviewed: "Reviewed", change_requested: "Change requested", excused: "Excused", missed: "Missed" };
const steps = ["assigned", "confirmed", "in_progress", "submitted", "reviewed"];
const iso = (d: Date) => d.toLocaleDateString("en-CA");
const shift = (date: string, n: number) => { const x = new Date(`${date}T12:00:00`); x.setDate(x.getDate() + n); return iso(x) };
const weekStart = (date: string) => shift(date, -((new Date(`${date}T12:00:00`).getDay() + 6) % 7));

type Payload = { date: string; studentId: string; target: number; reason: string };
type Props = {
  profile: { id: string; role: string };
  duties: any[]; people: any[]; availability: any[]; progress: any | undefined;
  dutyDate: string; today: string; manage: boolean; review: boolean; busy: boolean;
  memberName: (id: string, name: string) => string;
  onSelectDate: (date: string) => void;
  onSave: (p: Payload) => Promise<boolean>;
  onDelete: (reason: string) => Promise<boolean>;
  onStatus: (duty: any, status: string, reason?: string) => void;
};

export default function DutyCalendar(p: Props) {
  const { duties, dutyDate, today, manage, review, busy, progress, memberName } = p;
  const selected = duties.find(d => d.duty_date === dutyDate);
  const byDate = new Map(duties.map(d => [d.duty_date, d]));
  const start = weekStart(dutyDate);
  const week = Array.from({ length: 7 }, (_, i) => shift(start, i));
  const covered = week.filter(d => byDate.has(d)).length;

  const [editOpen, setEditOpen] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [eDate, setEDate] = useState(dutyDate), [eStudent, setEStudent] = useState("auto"), [eTarget, setETarget] = useState("5"), [eReason, setEReason] = useState("");
  const [studentReason, setStudentReason] = useState(""), [showPast, setShowPast] = useState(false);

  useEffect(() => { setEDate(dutyDate); setEStudent(selected?.student_id || "auto"); setETarget(String(selected?.target_count || 5)); setEReason(""); setStudentReason(""); setConfirmDelete(false); setEditOpen(false) }, [dutyDate, selected?.id, selected?.student_id, selected?.target_count]);

  const pool = p.availability.length ? p.availability : p.people.filter(x => ["student", "student_leader"].includes(x.role) && x.active).map(x => ({ profile_id: x.id, full_name: x.full_name, status: "available", note: null, already_assigned: false }));
  const optionState = (a: any) => {
    if (a.status === "leave") return { off: true, tag: "on leave" };
    if (a.status === "unavailable") return { off: true, tag: "unavailable" };
    if (a.already_assigned && a.profile_id !== selected?.student_id) return { off: true, tag: "already assigned" };
    return { off: false, tag: "" };
  };
  const StudentSelect = ({ withAuto }: { withAuto?: boolean }) => (
    <select value={eStudent} onChange={e => setEStudent(e.target.value)}>
      {withAuto && <option value="auto">Next in rotation (automatic)</option>}
      {pool.map((a: any) => { const s = optionState(a); return <option key={a.profile_id} value={a.profile_id} disabled={s.off}>{memberName(a.profile_id, a.full_name)}{s.tag ? ` · ${s.tag}` : ""}{a.note && s.off ? ` (${a.note})` : ""}</option> })}
    </select>
  );
  const targetOk = Number(eTarget) >= 1 && Number(eTarget) <= 20;
  const dirty = !!selected && (eStudent !== selected.student_id || eDate !== selected.duty_date || Number(eTarget) !== selected.target_count);
  const submit = async () => { if (await p.onSave({ date: eDate, studentId: eStudent, target: Number(eTarget), reason: eReason.trim() })) setEditOpen(false) };

  const upcoming = duties.filter(d => d.duty_date >= today), past = duties.filter(d => d.duty_date < today).reverse();
  const list = showPast ? past : upcoming.slice(0, 14);
  const status = selected?.duty_status || "assigned", stepIndex = steps.indexOf(status);
  const mine = selected?.student_id === p.profile.id;
  const uploaded = progress?.submitted_count ?? 0, target = progress?.target_count ?? selected?.target_count ?? 5;
  const pct = Math.min(100, Math.round((uploaded / Math.max(1, target)) * 100));
  const isToday = dutyDate === today;
  const enough = uploaded >= target;

  return <div className="dc">
    <section className="card dc-bar">
      <div><span className="eyebrow">DUTY ROTATION</span><h2>Daily question duty</h2><p>{new Date(`${dutyDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}{isToday ? " · Today" : ""}</p></div>
      <div className="dc-nav">
        <button className="outline" aria-label="Previous week" onClick={() => p.onSelectDate(shift(dutyDate, -7))}><ChevronLeft size={16} /></button>
        <input type="date" aria-label="Duty date" value={dutyDate} onChange={e => e.target.value && p.onSelectDate(e.target.value)} />
        <button className="outline" aria-label="Next week" onClick={() => p.onSelectDate(shift(dutyDate, 7))}><ChevronRight size={16} /></button>
        <button className="outline" onClick={() => p.onSelectDate(today)}>Today</button>
      </div>
    </section>

    <div className="dc-week" role="tablist" aria-label="Week">
      {week.map(d => { const duty = byDate.get(d), x = new Date(`${d}T12:00:00`); return <button key={d} role="tab" aria-selected={d === dutyDate} className={`dc-day ${d === dutyDate ? "on" : ""} ${d === today ? "today" : ""} ${duty ? "" : "gap"}`} onClick={() => p.onSelectDate(d)}>
        <small>{x.toLocaleDateString(undefined, { weekday: "short" })}</small><b>{x.getDate()}</b>
        {duty ? <><span className={`dc-dot status-${duty.duty_status || "assigned"}`} /><em>{(duty.student?.full_name || "Student").split(" ")[0]}</em></> : <em className="none">Open</em>}
      </button> })}
    </div>

    <div className="dc-metrics">
      <article><span>This week</span><strong>{covered}<i> / 7 days</i></strong><small>{covered === 7 ? "Every day is covered" : `${7 - covered} day${7 - covered === 1 ? "" : "s"} still open`}</small></article>
      <article><span>Uploaded {isToday ? "today" : "on this date"}</span><strong>{selected ? uploaded : "—"}<i>{selected ? ` / ${target}` : ""}</i></strong><small>{selected ? "Questions for the selected duty" : "No duty on this date"}</small></article>
      <article><span>Awaiting review</span><strong>{progress?.pending_count ?? 0}</strong><small>{progress?.revision_requested_count ?? 0} need revision · {progress?.approved_count ?? 0} approved</small></article>
    </div>

    {selected ? <section className="card dc-focus">
      <div className="dc-head">
        <div><span className="eyebrow">{selected.rotation_cycle ? `ROTATION ${selected.rotation_cycle}` : "DUTY"} · {selected.duty_date}</span><h3>{memberName(selected.student_id, selected.student?.full_name || "Student")}{mine && <span className="dc-you">You</span>}</h3><p>Prepare {selected.target_count} current-affairs questions for this date.</p></div>
        <div className="dc-head-actions"><span className={`duty-status status-${status}`}>{dutyStatuses[status] || status}</span>{manage && <button className="outline" onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit duty</button>}</div>
      </div>

      {status === "change_requested" && <div className="dc-alert"><TriangleAlert size={18} /><div><strong>The student asked for a change</strong><p>{selected.status_note || "No reason given."}</p>{manage && <button className="primary" onClick={() => setEditOpen(true)}>Reassign or edit</button>}</div></div>}

      {steps.includes(status) ? <ol className="dc-steps">{steps.map((s, i) => <li key={s} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""}><span>{i < stepIndex ? "✓" : i + 1}</span>{dutyStatuses[s]}</li>)}</ol> : null}

      <div className="duty-progress-block"><div className="progress-label"><strong>{uploaded} of {target} questions uploaded</strong><span>{progress?.approved_count ?? 0} approved</span></div><div className="progress-track"><span style={{ width: `${pct}%` }} /></div><div className="duty-counts"><span>{progress?.pending_count ?? 0} waiting for review</span><span>{progress?.revision_requested_count ?? 0} need revision</span></div></div>

      {selected.status_note && status !== "change_requested" && <p className="duty-note"><b>Latest note:</b> {selected.status_note}</p>}

      {review && <div className="dc-staff"><strong>Teacher actions</strong><div className="actions">
        <button className="primary" disabled={busy || status === "reviewed" || !enough} onClick={() => p.onStatus(selected, "reviewed")}>Mark reviewed</button>
        {status === "assigned" && <button className="outline" disabled={busy} onClick={() => p.onStatus(selected, "confirmed")}>Mark confirmed</button>}
        <details className="dc-more"><summary className="outline">More status</summary><div>{["assigned", "in_progress", "submitted", "excused", "missed"].filter(s => s !== status && (s !== "submitted" || enough)).map(s => <button key={s} disabled={busy} onClick={() => p.onStatus(selected, s)}>{dutyStatuses[s]}</button>)}</div></details>
      </div>{!enough && <small className="dc-hint">Can be reviewed once all {target} questions are uploaded ({uploaded} so far).</small>}</div>}

      {mine && <div className="dc-staff"><strong>Your duty</strong><div className="actions">
        {status === "assigned" && <button className="primary" disabled={busy} onClick={() => p.onStatus(selected, "confirmed")}>Confirm duty</button>}
        {["assigned", "confirmed"].includes(status) && <button className="outline" disabled={busy} onClick={() => p.onStatus(selected, "in_progress")}>Start working</button>}
        {!["submitted", "reviewed"].includes(status) && uploaded >= selected.target_count && <button className="primary" disabled={busy} onClick={() => p.onStatus(selected, "submitted")}>Mark questions submitted</button>}
      </div>
        {!["change_requested", "reviewed", "submitted"].includes(status) && <div className="dc-urgent"><input value={studentReason} onChange={e => setStudentReason(e.target.value)} placeholder="Can't do this day? Tell the teacher why" /><button className="outline" disabled={busy || !studentReason.trim()} onClick={() => p.onStatus(selected, "change_requested", studentReason)}>Request change</button></div>}
      </div>}
    </section> : <section className="card dc-empty">
      <div className="empty-mark"><CalendarDays size={22} /></div>
      <div><h3>No duty on {new Date(`${dutyDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</h3>
        {manage ? <><p>Choose who takes this day. Students on leave or already used this cycle are greyed out.</p>
          <div className="dc-assign"><label>Student<StudentSelect withAuto /></label><label>Question target<input type="number" min={1} max={20} value={eTarget} onChange={e => setETarget(e.target.value)} /></label><button className="primary" disabled={busy || !targetOk} onClick={() => p.onSave({ date: dutyDate, studentId: eStudent, target: Number(eTarget), reason: "" })}>{busy ? "Assigning…" : eStudent === "auto" ? "Assign next student" : "Assign student"}</button></div></>
          : <p>No one is assigned for this date yet.</p>}
      </div>
    </section>}

    <section className="card duty-list">
      <div className="duty-list-heading"><div><h3>{showPast ? "Past duties" : "Upcoming duties"}</h3><p>Select a row to open that day.</p></div>
        <div className="dc-tabs"><button className={!showPast ? "on" : ""} onClick={() => setShowPast(false)}>Upcoming · {upcoming.length}</button><button className={showPast ? "on" : ""} onClick={() => setShowPast(true)}>Past · {past.length}</button></div></div>
      {list.map(d => <button key={d.id} className={`duty-list-row ${d.id === selected?.id ? "selected" : ""} ${d.student_id === p.profile.id ? "mine" : ""}`} onClick={() => p.onSelectDate(d.duty_date)}>
        <span className="schedule-date">{new Date(`${d.duty_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}<small>{d.duty_date}</small></span>
        <span className="schedule-person"><strong>{memberName(d.student_id, d.student?.full_name || "Student")}{d.student_id === p.profile.id && <span className="dc-you">You</span>}</strong><small>{d.target_count} questions</small></span>
        <span className={`duty-status status-${d.duty_status || "assigned"}`}>{dutyStatuses[d.duty_status] || "Assigned"}</span><span className="schedule-arrow">›</span></button>)}
      {!list.length && <div className="empty">{showPast ? "No past duties in the loaded range." : "No upcoming duties have been assigned."}</div>}
    </section>

    {editOpen && selected && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setEditOpen(false) }}><section className="modal dc-modal" role="dialog" aria-modal="true" aria-labelledby="dc-edit-title">
      <div className="modal-head"><div><span className="eyebrow">EDIT DUTY</span><h2 id="dc-edit-title">{selected.duty_date}</h2></div><button className="icon-button" aria-label="Close" onClick={() => setEditOpen(false)}>×</button></div>
      <div className="modal-scroll"><div className="dc-form">
        <label>Assignment date<input type="date" value={eDate} onChange={e => setEDate(e.target.value)} /></label>
        <label>Assigned student<StudentSelect /></label>
        <label>Question target<input type="number" min={1} max={20} value={eTarget} onChange={e => setETarget(e.target.value)} /></label>
        <label>Reason (optional)<textarea rows={2} value={eReason} onChange={e => setEReason(e.target.value)} placeholder="Add a note if helpful" /></label>
      </div></div>
      <div className="dc-foot">
        {confirmDelete ? <><span>Delete this duty and free the student's turn?</span><button className="outline" onClick={() => setConfirmDelete(false)}>Keep</button><button className="danger-outline" disabled={busy} onClick={async () => { if (await p.onDelete(eReason.trim())) setEditOpen(false) }}>Yes, delete</button></>
          : <><button className="danger-outline" onClick={() => setConfirmDelete(true)}>Delete duty</button><span className="grow" /><button className="outline" onClick={() => setEditOpen(false)}>Cancel</button><button className="primary" disabled={busy || !dirty || !eDate || !targetOk} onClick={submit}>{busy ? "Saving…" : "Save changes"}</button></>}
      </div>
    </section></div>}
  </div>;
}
