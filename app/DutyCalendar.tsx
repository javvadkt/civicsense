"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, TriangleAlert } from "lucide-react";
import type { Api, Rotation } from "./DutyTools";
import { BulkAssign, DutyHistory, DutyQuestions, ReportLeaveModal, RotationPanel, dayLabel, dutyStatuses, shiftDay, waitingList } from "./DutyTools";

const steps = ["assigned", "confirmed", "in_progress", "submitted", "reviewed"];
const swapBlocked = ["submitted", "reviewed", "excused", "missed"];
const openStates = ["assigned", "confirmed", "in_progress"];
const iso = (d: Date) => d.toLocaleDateString("en-CA");
const shift = shiftDay;
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
  onAddQuestions: () => void; goReview: () => void;
  api: Api; flash: (s: string) => void; fail: (s: string) => void; refresh: () => Promise<void>;
};

export default function DutyCalendar(p: Props) {
  const { duties, dutyDate, today, manage, review, busy, memberName } = p;
  const selected = duties.find(d => d.duty_date === dutyDate);
  const byDate = new Map(duties.map(d => [d.duty_date, d]));
  const start = weekStart(dutyDate);
  const week = Array.from({ length: 7 }, (_, i) => shift(start, i));
  const covered = week.filter(d => byDate.has(d)).length;
  const isParticipant = ["student", "student_leader"].includes(p.profile.role);

  const apiRef = useRef(p.api); apiRef.current = p.api;
  const [rotation, setRotation] = useState<Rotation | null>(null);
  useEffect(() => {
    if (!manage) return;
    let live = true;
    (async () => {
      try {
        const st = await apiRef.current("/rest/v1/duty_rotation_state?select=current_cycle");
        const c = st?.[0]?.current_cycle;
        if (!c) { if (live) setRotation(null); return }
        const rows = await apiRef.current(`/rest/v1/duty_rotation_members?select=profile_id,position,assigned_on&cycle_no=eq.${c}&order=position.asc`);
        if (live) setRotation({ cycle: c, rows: rows || [] });
      } catch { if (live) setRotation(null) }
    })();
    return () => { live = false };
  }, [manage, duties]);
  const waiting = waitingList(rotation, p.people);

  const [editOpen, setEditOpen] = useState(false), [confirmDelete, setConfirmDelete] = useState(false), [tab, setTab] = useState<"details" | "swap">("details");
  const [eDate, setEDate] = useState(dutyDate), [eStudent, setEStudent] = useState("auto"), [eTarget, setETarget] = useState("5"), [eReason, setEReason] = useState("");
  const [swapId, setSwapId] = useState(""), [swapReason, setSwapReason] = useState(""), [swapBusy, setSwapBusy] = useState(false), [bulkOpen, setBulkOpen] = useState(false);
  const [studentReason, setStudentReason] = useState(""), [showPast, setShowPast] = useState(false);

  useEffect(() => {
    setEDate(dutyDate); setEStudent(selected?.student_id || "auto"); setETarget(String(selected?.target_count || 5)); setEReason(""); setStudentReason("");
    setConfirmDelete(false); setEditOpen(false); setTab("details"); setSwapId(""); setSwapReason("");
  }, [dutyDate, selected?.id, selected?.student_id, selected?.target_count]);

  const pool = p.availability.length ? p.availability : p.people.filter(x => ["student", "student_leader"].includes(x.role) && x.active).map(x => ({ profile_id: x.id, full_name: x.full_name, status: "available", note: null, already_assigned: false }));
  const optionState = (a: any) => {
    if (a.status === "leave") return { off: true, tag: "on leave" };
    if (a.status === "unavailable") return { off: true, tag: "unavailable" };
    if (a.already_assigned && a.profile_id !== selected?.student_id) return { off: true, tag: "already assigned" };
    return { off: false, tag: "" };
  };
  const studentSelect = (withAuto?: boolean) => (
    <select value={eStudent} onChange={e => setEStudent(e.target.value)}>
      {withAuto && <option value="auto">Next in rotation (automatic)</option>}
      {pool.map((a: any) => { const s = optionState(a); return <option key={a.profile_id} value={a.profile_id} disabled={s.off}>{memberName(a.profile_id, a.full_name)}{s.tag ? ` · ${s.tag}` : ""}{a.note && s.off ? ` (${a.note})` : ""}</option> })}
    </select>
  );
  const targetOk = Number(eTarget) >= 1 && Number(eTarget) <= 20;
  const dirty = !!selected && (eStudent !== selected.student_id || eDate !== selected.duty_date || Number(eTarget) !== selected.target_count);
  const submit = async () => { if (await p.onSave({ date: eDate, studentId: eStudent, target: Number(eTarget), reason: eReason.trim() })) setEditOpen(false) };

  const status = selected?.duty_status || "assigned", stepIndex = steps.indexOf(status);
  const mine = selected?.student_id === p.profile.id;
  // Teachers and admin can review all; students see their own; leaders only see their own
  const canSee = review || mine;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveCount, setLeaveCount] = useState(0);

  const loadLeaveCount = useCallback(async () => {
    if (!isParticipant) return;
    try {
      const res = await p.api(
        `/rest/v1/duty_availability?select=availability_date&profile_id=eq.${p.profile.id}&availability_date=gte.${today}&status=neq.available`
      );
      setLeaveCount(Array.isArray(res) ? res.length : 0);
    } catch {
      setLeaveCount(0);
    }
  }, [isParticipant, p.profile.id, p.api, today]);

  useEffect(() => {
    loadLeaveCount();
  }, [loadLeaveCount]);
  
  const prog = p.progress && selected && p.progress.duty_id === selected.id ? p.progress : undefined;
  const target = selected?.target_count ?? 5;
  const uploaded = Number(prog?.submitted_count ?? 0), approvedN = Number(prog?.approved_count ?? 0), pendingN = Number(prog?.pending_count ?? 0), revisionN = Number(prog?.revision_requested_count ?? 0);
  const pct = Math.min(100, Math.round((uploaded / Math.max(1, target)) * 100));
  const enough = uploaded >= target;
  const isToday = dutyDate === today;
  const isOverdue = (d: any) => d.duty_date < today && openStates.includes(d.duty_status || "assigned");
  const overdue = !!selected && isOverdue(selected);

  const hint = (() => {
    if (!selected || !canSee) return "";
    if (status === "reviewed") return "This duty is reviewed.";
    if (status === "excused") return "Excused from this duty.";
    if (status === "missed") return "Marked as missed.";
    if (status === "change_requested") return "The student asked for a change. Waiting for a reassignment.";
    if (status === "submitted") return revisionN ? `All ${target} questions are in. ${revisionN} need${revisionN === 1 ? "s" : ""} revision.` : pendingN ? `All ${target} questions are in. ${pendingN} waiting for review.` : `All ${target} questions are in.`;
    if (uploaded > 0) return `${uploaded} of ${target} questions added so far.`;
    return "No questions added yet.";
  })();

  const swapOptions = selected ? duties.filter(d => d.id !== selected.id && d.duty_date >= today && d.student_id !== selected.student_id && !swapBlocked.includes(d.duty_status || "assigned")) : [];
  const selectedSwappable = !!selected && selected.duty_date >= today && !swapBlocked.includes(status);
  const swapTarget = swapOptions.find(d => d.id === swapId);
  async function doSwap() {
    if (!selected || !swapTarget) return;
    setSwapBusy(true);
    try {
      await p.api("/rest/v1/rpc/swap_duties", "POST", { p_duty_a: selected.id, p_duty_b: swapTarget.id, p_reason: swapReason.trim() || null });
      p.flash(`Swapped ${dayLabel(selected.duty_date)} and ${dayLabel(swapTarget.duty_date)}.`); await p.refresh(); setEditOpen(false);
    } catch (e: any) { p.fail(e?.message || "Could not swap the duties") } finally { setSwapBusy(false) }
  }

  const upcoming = duties.filter(d => d.duty_date >= today), past = duties.filter(d => d.duty_date < today).reverse();
  const list = showPast ? past : upcoming.slice(0, 14);
  const copyRoster = () => {
    const text = "Duty roster\n" + upcoming.slice(0, 14).map(d => `${dayLabel(d.duty_date)} - ${memberName(d.student_id, d.student?.full_name || "Student")}`).join("\n");
    navigator.clipboard.writeText(text).then(() => p.flash("Roster copied."), () => p.fail("Could not copy the roster."));
  };
  const moreLabel = (s: string) => s === "assigned" ? "Reset to Assigned" : dutyStatuses[s];

  return <div className="dc">
    <section className="card dc-bar">
      <div><span className="eyebrow">DUTY ROTATION</span><h2>Daily question duty</h2><p>{new Date(`${dutyDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}{isToday ? " · Today" : ""}</p></div>
     <div className="dc-nav">
        <button className="outline" aria-label="Previous week" onClick={() => p.onSelectDate(shift(dutyDate, -7))}><ChevronLeft size={16} /></button>
        <input type="date" aria-label="Duty date" value={dutyDate} onChange={e => e.target.value && p.onSelectDate(e.target.value)} />
        <button className="outline" aria-label="Next week" onClick={() => p.onSelectDate(shift(dutyDate, 7))}><ChevronRight size={16} /></button>
        <button className="outline" onClick={() => p.onSelectDate(today)}>Today</button>
        {isParticipant && (
          <button className="outline dc-leave-btn" onClick={() => setLeaveOpen(true)}>
            Report leave
            {leaveCount > 0 && <span className="dc-badge">{leaveCount}</span>}
          </button>
        )}
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
      <article><span>Questions added</span><strong>{selected && canSee ? uploaded : "—"}<i>{selected && canSee ? ` / ${target}` : ""}</i></strong><small>{selected ? (canSee ? "Counted for the selected duty" : "Visible to the assigned student and staff") : "No duty on this date"}</small></article>
      <article><span>Awaiting review</span><strong>{selected && canSee ? pendingN : "—"}</strong><small>{selected && canSee ? `${revisionN} need revision · ${approvedN} approved` : ""}</small></article>
    </div>

    {manage && <RotationPanel rotation={rotation} people={p.people} onBulk={() => setBulkOpen(true)} />}

    {selected ? <section className="card dc-focus">
      <div className="dc-head">
        <div><span className="eyebrow">{selected.rotation_cycle ? `ROTATION ${selected.rotation_cycle}` : "DUTY"} · {selected.duty_date}</span><h3>{memberName(selected.student_id, selected.student?.full_name || "Student")}{mine && <span className="dc-you">You</span>}</h3><p>Prepare {selected.target_count} current-affairs questions for this date.</p></div>
        <div className="dc-head-actions"><span className={`duty-status status-${status}`}>{dutyStatuses[status] || status}{overdue ? " · Overdue" : ""}</span>{manage && <button className="outline" onClick={() => { setTab("details"); setEditOpen(true) }}><Pencil size={14} /> Edit or swap</button>}</div>
      </div>
      {manage && !review && <p className="dc-caption">Class leader: you can edit, swap or delete duties. Teachers review and close them.</p>}

      {status === "change_requested" && <div className="dc-alert"><TriangleAlert size={18} /><div><strong>The student asked for a change</strong><p>{selected.status_note || "No reason given."}</p>{manage && <button className="primary" onClick={() => { setTab("details"); setEditOpen(true) }}>Reassign or swap</button>}</div></div>}

      {steps.includes(status) ? <ol className="dc-steps">{steps.map((s, i) => <li key={s} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""}><span>{i < stepIndex ? "✓" : i + 1}</span>{dutyStatuses[s]}</li>)}</ol> : null}

      {canSee && <div className="duty-progress-block"><div className="progress-label"><strong>{uploaded} of {target} questions added</strong><span>{approvedN} approved</span></div><div className="progress-track"><span style={{ width: `${pct}%` }} /></div><div className="duty-counts"><span>{pendingN} waiting for review</span><span>{revisionN} need revision</span></div>{hint && <p className="dc-nextstep">{hint}</p>}</div>}

      {selected.status_note && status !== "change_requested" && <p className="duty-note"><b>Latest note:</b> {selected.status_note}</p>}

      {canSee && (
        <DutyQuestions
          key={selected.id}
          duty={selected}
          mine={mine}
          manage={manage}
          review={review}
          counts={{ uploaded, approved: approvedN, waiting: pendingN + revisionN }}
          target={target}
          signal={`${uploaded}-${approvedN}-${pendingN}-${revisionN}-${status}`}
          api={p.api}
          flash={p.flash}
          fail={p.fail}
          refresh={p.refresh}
          onAdd={p.onAddQuestions}
        />
      )}

      {review && <div className="dc-staff"><strong>Teacher actions</strong><div className="actions">
        {status !== "reviewed" && <button className="primary" disabled={busy || !enough} onClick={() => p.onStatus(selected, "reviewed")}>Mark reviewed</button>}
        {pendingN + revisionN > 0 && <button className="outline" onClick={p.goReview}>Open review queue</button>}
        <details className="dc-more"><summary className="outline">More</summary><div>{["assigned", "excused", "missed"].filter(s => s !== status).map(s => <button key={s} disabled={busy} onClick={() => p.onStatus(selected, s)}>{moreLabel(s)}</button>)}</div></details>
      </div>{status !== "reviewed" && !enough && <small className="dc-hint">Can be marked reviewed once all {target} questions are added ({uploaded} so far). It also happens automatically when every question is approved.</small>}</div>}

      {mine && (status === "assigned" || openStates.includes(status)) && <div className="dc-staff"><strong>Your duty</strong>
        {status === "assigned" && <div className="actions"><button className="primary" disabled={busy} onClick={() => p.onStatus(selected, "confirmed")}>Confirm duty</button></div>}
        <div className="dc-urgent"><input value={studentReason} onChange={e => setStudentReason(e.target.value)} placeholder="Can't do this day? Tell the teacher why" /><button className="outline" disabled={busy || !studentReason.trim()} onClick={() => p.onStatus(selected, "change_requested", studentReason)}>Request change</button></div>
      </div>}

      {manage && <DutyHistory key={`h-${selected.id}`} dutyId={selected.id} api={p.api} people={p.people} />}
    </section> : <section className="card dc-empty">
      <div className="empty-mark"><CalendarDays size={22} /></div>
      <div><h3>No duty on {new Date(`${dutyDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</h3>
        {manage ? <><p>Choose who takes this day. Students on leave or already used this cycle are greyed out.</p>
          <div className="dc-assign"><label>Student{studentSelect(true)}{eStudent === "auto" && waiting[0] && <small className="dc-sub">Next in line: {memberName(waiting[0].id, waiting[0].full_name)} (unless on leave)</small>}</label><label>Question target<input type="number" min={1} max={20} value={eTarget} onChange={e => setETarget(e.target.value)} /></label><button className="primary" disabled={busy || !targetOk} onClick={() => p.onSave({ date: dutyDate, studentId: eStudent, target: Number(eTarget), reason: "" })}>{busy ? "Assigning…" : eStudent === "auto" ? "Assign next student" : "Assign student"}</button></div>
          <button className="plain dc-bulk-link" onClick={() => setBulkOpen(true)}>Assign many days at once…</button></>
          : <p>No one is assigned for this date yet.</p>}
      </div>
    </section>}

    {isParticipant && leaveOpen && (
      <ReportLeaveModal
        profile={p.profile}
        duties={duties}
        today={today}
        api={p.api}
        flash={p.flash}
        fail={p.fail}
        onClose={() => setLeaveOpen(false)}
        onChanged={() => {
          loadLeaveCount();
          p.refresh();
        }}
      />
    )}

    <section className="card duty-list">
      <div className="duty-list-heading"><div><h3>{showPast ? "Past duties" : "Upcoming duties"}</h3><p>Select a row to open that day.</p></div>
        <div className="dc-list-tools"><button className="outline" onClick={copyRoster} disabled={!upcoming.length}>Copy roster</button>
          <div className="dc-tabs"><button className={!showPast ? "on" : ""} onClick={() => setShowPast(false)}>Upcoming · {upcoming.length}</button><button className={showPast ? "on" : ""} onClick={() => setShowPast(true)}>Past · {past.length}</button></div></div></div>
      {list.map(d => <button key={d.id} className={`duty-list-row ${d.id === selected?.id ? "selected" : ""} ${d.student_id === p.profile.id ? "mine" : ""}`} onClick={() => p.onSelectDate(d.duty_date)}>
        <span className="schedule-date">{dayLabel(d.duty_date)}<small>{d.duty_date}</small></span>
        <span className="schedule-person"><strong>{memberName(d.student_id, d.student?.full_name || "Student")}{d.student_id === p.profile.id && <span className="dc-you">You</span>}</strong><small>{d.target_count} questions</small></span>
        <span className={`duty-status status-${d.duty_status || "assigned"}`}>{dutyStatuses[d.duty_status] || "Assigned"}{isOverdue(d) ? " · Overdue" : ""}</span><span className="schedule-arrow">›</span></button>)}
      {!list.length && <div className="empty">{showPast ? "No past duties in the loaded range." : "No upcoming duties have been assigned."}</div>}
    </section>

    {editOpen && selected && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setEditOpen(false) }}><section className="modal dc-modal" role="dialog" aria-modal="true" aria-labelledby="dc-edit-title">
      <div className="modal-head"><div><span className="eyebrow">EDIT DUTY</span><h2 id="dc-edit-title">{selected.duty_date}</h2></div><button className="icon-button" aria-label="Close" onClick={() => setEditOpen(false)}>×</button></div>
      <div className="dc-tabs dc-modal-tabs"><button className={tab === "details" ? "on" : ""} onClick={() => setTab("details")}>Details</button><button className={tab === "swap" ? "on" : ""} onClick={() => setTab("swap")}>Swap day</button></div>
      <div className="modal-scroll">{tab === "details" ? <div className="dc-form">
        <label>Assignment date<input type="date" value={eDate} onChange={e => setEDate(e.target.value)} /></label>
        <label>Assigned student{studentSelect()}</label>
        <label>Question target<input type="number" min={1} max={20} value={eTarget} onChange={e => setETarget(e.target.value)} /></label>
        <label>Reason (optional)<textarea rows={2} value={eReason} onChange={e => setEReason(e.target.value)} placeholder="Add a note if helpful" /></label>
      </div> : <div className="dc-swap">
        {!selectedSwappable ? <p className="qb-warn">This duty can't be swapped because it is in the past or already submitted, reviewed, excused or missed.</p>
          : !swapOptions.length ? <div className="empty">There is no other upcoming duty to swap with.</div> : <>
            <p>Pick the upcoming duty to swap with. The two students trade days.</p>
            <div className="dc-swap-list">{swapOptions.map(d => <label key={d.id} className={swapId === d.id ? "on" : ""}><input type="radio" name="swap" checked={swapId === d.id} onChange={() => setSwapId(d.id)} /><span><b>{dayLabel(d.duty_date)} · {memberName(d.student_id, d.student?.full_name || "Student")}</b><small>{dutyStatuses[d.duty_status || "assigned"]}</small></span></label>)}</div>
            {swapTarget && <div className="dc-swap-preview">After swapping, <b>{selected.student?.full_name || "this student"}</b> does {dayLabel(swapTarget.duty_date)} and <b>{swapTarget.student?.full_name || "the other student"}</b> does {dayLabel(selected.duty_date)}.</div>}
            <label className="dc-swap-reason">Reason (optional)<textarea rows={2} value={swapReason} onChange={e => setSwapReason(e.target.value)} placeholder="Why are these days being swapped?" /></label></>}
      </div>}</div>
      <div className="dc-foot">
        {tab === "swap" ? <><span className="grow" /><button className="outline" onClick={() => setEditOpen(false)}>Cancel</button><button className="primary" disabled={swapBusy || !swapTarget || !selectedSwappable} onClick={doSwap}>{swapBusy ? "Swapping…" : "Swap days"}</button></>
          : confirmDelete ? <><span>Delete this duty and free the student's turn?</span><button className="outline" onClick={() => setConfirmDelete(false)}>Keep</button><button className="danger-outline" disabled={busy} onClick={async () => { if (await p.onDelete(eReason.trim())) setEditOpen(false) }}>Yes, delete</button></>
            : <><button className="danger-outline" onClick={() => setConfirmDelete(true)}>Delete duty</button><span className="grow" /><button className="outline" onClick={() => setEditOpen(false)}>Cancel</button><button className="primary" disabled={busy || !dirty || !eDate || !targetOk} onClick={submit}>{busy ? "Saving…" : "Save changes"}</button></>}
      </div>
    </section></div>}

    {bulkOpen && manage && <BulkAssign people={p.people} duties={duties} rotation={rotation} api={p.api} flash={p.flash} fail={p.fail} refresh={p.refresh} defaultStart={dutyDate >= today ? dutyDate : today} onClose={() => setBulkOpen(false)} />}
  </div>;
}
