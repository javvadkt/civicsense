"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Pencil,
  TriangleAlert,
  X
} from "lucide-react";
import type { Api, Rotation } from "./DutyTools";
import {
  BulkAssign,
  DutyHistory,
  DutyQuestions,
  ReportLeaveModal,
  RotationPanel,
  dayLabel,
  dutyStatuses,
  shiftDay,
  waitingList
} from "./DutyTools";

const steps = ["assigned", "confirmed", "in_progress", "submitted", "reviewed"];
const swapBlocked = ["submitted", "reviewed", "excused", "missed"];
const openStates = ["assigned", "confirmed", "in_progress"];
const pad = (n: number) => String(n).padStart(2, "0");

type Payload = { date: string; studentId: string; target: number; reason: string };
type Props = {
  profile: { id: string; role: string };
  duties: any[];
  people: any[];
  availability: any[];
  progress: any | undefined;
  dutyDate: string;
  today: string;
  manage: boolean;
  review: boolean;
  busy: boolean;
  memberName: (id: string, name: string) => string;
  onSelectDate: (date: string) => void;
  onSave: (p: Payload) => Promise<boolean>;
  onDelete: (reason: string) => Promise<boolean>;
  onStatus: (duty: any, status: string, reason?: string) => void;
  onAddQuestions: () => void;
  goReview: () => void;
  api: Api;
  flash: (s: string) => void;
  fail: (s: string) => void;
  refresh: () => Promise<void>;
};

export default function DutyCalendar(p: Props) {
  const { duties, dutyDate, today, manage, review, busy, memberName } = p;
  const isParticipant = ["student", "student_leader"].includes(p.profile.role);
  const apiRef = useRef(p.api);
  apiRef.current = p.api;

  // Month navigation state
  const [viewYear, setViewYear] = useState(() => {
    const d = new Date(`${dutyDate}T12:00:00`);
    return isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(`${dutyDate}T12:00:00`);
    return isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth();
  });

  // Fetch duties of the currently viewed month
  const [monthDuties, setMonthDuties] = useState<any[]>([]);
  const fetchMonthDuties = useCallback(async (year: number, month: number) => {
    const startStr = `${year}-${pad(month + 1)}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endStr = `${year}-${pad(month + 1)}-${pad(lastDay)}`;
    try {
      const res = await apiRef.current(
        `/rest/v1/duties?select=id,duty_date,student_id,target_count,rotation_cycle,duty_status,status_note,student:profiles!duties_student_id_fkey(full_name,enrollment_number)&duty_date=gte.${startStr}&duty_date=lte.${endStr}&order=duty_date.asc`
      );
      if (Array.isArray(res)) setMonthDuties(res);
    } catch {
      try {
        const fallback = await apiRef.current(
          `/rest/v1/duties?select=id,duty_date,student_id,target_count,rotation_cycle,student:profiles!duties_student_id_fkey(full_name,enrollment_number)&duty_date=gte.${startStr}&duty_date=lte.${endStr}&order=duty_date.asc`
        );
        if (Array.isArray(fallback)) {
          setMonthDuties(fallback.map((d: any) => ({ ...d, duty_status: "assigned", status_note: null })));
        }
      } catch {
        setMonthDuties([]);
      }
    }
  }, []);

  useEffect(() => {
    fetchMonthDuties(viewYear, viewMonth);
  }, [viewYear, viewMonth, fetchMonthDuties]);

  // Combine shared duties with visible month duties
  const byDate = useMemo(() => {
    const map = new Map<string, any>();
    duties.forEach(d => map.set(d.duty_date, d));
    monthDuties.forEach(d => map.set(d.duty_date, d));
    return map;
  }, [duties, monthDuties]);

  const selected = byDate.get(dutyDate);

  // Month navigation handlers
  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(y => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth(m => m - 1);
    }
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(y => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth(m => m + 1);
    }
  };
  const goToToday = () => {
    const t = new Date(`${today}T12:00:00`);
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    p.onSelectDate(today);
  };

  // Rotation data
  const [rotation, setRotation] = useState<Rotation | null>(null);
  const [showRotation, setShowRotation] = useState(false);
  useEffect(() => {
    if (!manage) return;
    let live = true;
    (async () => {
      try {
        const st = await apiRef.current("/rest/v1/duty_rotation_state?select=current_cycle");
        const c = st?.[0]?.current_cycle;
        if (!c) {
          if (live) setRotation(null);
          return;
        }
        const rows = await apiRef.current(
          `/rest/v1/duty_rotation_members?select=profile_id,position,assigned_on&cycle_no=eq.${c}&order=position.asc`
        );
        if (live) setRotation({ cycle: c, rows: rows || [] });
      } catch {
        if (live) setRotation(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [manage, duties]);
  const waiting = waitingList(rotation, p.people);

  // Leave & Roster
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveCount, setLeaveCount] = useState(0);
  const loadLeaveCount = useCallback(async () => {
    if (!isParticipant) return;
    try {
      const res = await apiRef.current(
        `/rest/v1/duty_availability?select=availability_date&profile_id=eq.${p.profile.id}&availability_date=gte.${today}&status=neq.available`
      );
      setLeaveCount(Array.isArray(res) ? res.length : 0);
    } catch {
      setLeaveCount(0);
    }
  }, [isParticipant, p.profile.id, today]);

  useEffect(() => {
    loadLeaveCount();
  }, [loadLeaveCount]);

  const upcomingDuties = useMemo(() => duties.filter(d => d.duty_date >= today), [duties, today]);
  const copyRoster = () => {
    const text =
      "Duty roster\n" +
      upcomingDuties
        .slice(0, 14)
        .map(d => `${dayLabel(d.duty_date)} - ${memberName(d.student_id, d.student?.full_name || "Student")}`)
        .join("\n");
    navigator.clipboard.writeText(text).then(
      () => p.flash("Roster copied."),
      () => p.fail("Could not copy the roster.")
    );
  };

  // Modals & Sub-states
  const [editOpen, setEditOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [requestChangeOpen, setRequestChangeOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<"questions" | "history">("questions");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

  // Edit form state
  const [eDate, setEDate] = useState(dutyDate);
  const [eStudent, setEStudent] = useState("auto");
  const [eTarget, setETarget] = useState("5");
  const [eReason, setEReason] = useState("");
  const [studentReason, setStudentReason] = useState("");

  // Swap form state
  const [swapId, setSwapId] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [swapBusy, setSwapBusy] = useState(false);


  // Outside click listener for menus
  useEffect(() => {
    if (!actionsMenuOpen && !statusDropdownOpen) return;
    const close = () => {
      setActionsMenuOpen(false);
      setStatusDropdownOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [actionsMenuOpen, statusDropdownOpen]);

  const pool = p.availability.length
    ? p.availability
    : p.people
        .filter(x => ["student", "student_leader"].includes(x.role) && x.active)
        .map(x => ({
          profile_id: x.id,
          full_name: x.full_name,
          status: "available",
          note: null,
          already_assigned: false
        }));

  const optionState = (a: any) => {
    if (a.status === "leave") return { off: true, tag: "on leave" };
    if (a.status === "unavailable") return { off: true, tag: "unavailable" };
    if (a.already_assigned && a.profile_id !== selected?.student_id) return { off: true, tag: "already assigned" };
    return { off: false, tag: "" };
  };

  const studentSelect = (withAuto?: boolean) => (
    <select value={eStudent} onChange={e => setEStudent(e.target.value)}>
      {withAuto && <option value="auto">Next in rotation (automatic)</option>}
      {pool.map((a: any) => {
        const s = optionState(a);
        return (
          <option key={a.profile_id} value={a.profile_id} disabled={s.off}>
            {memberName(a.profile_id, a.full_name)}
            {s.tag ? ` · ${s.tag}` : ""}
            {a.note && s.off ? ` (${a.note})` : ""}
          </option>
        );
      })}
    </select>
  );

  const targetOk = Number(eTarget) >= 1 && Number(eTarget) <= 20;
  const dirty =
    !!selected &&
    (eStudent !== selected.student_id || eDate !== selected.duty_date || Number(eTarget) !== selected.target_count);

  const submitEdit = async () => {
    if (await p.onSave({ date: eDate, studentId: eStudent, target: Number(eTarget), reason: eReason.trim() })) {
      setEditOpen(false);
    }
  };

  const status = selected?.duty_status || "assigned";
  const stepIndex = steps.indexOf(status);
  const mine = selected?.student_id === p.profile.id;
  const canSee = review || mine;
  useEffect(() => {
    setEDate(dutyDate);
    setEStudent(selected?.student_id || "auto");
    setETarget(String(selected?.target_count || 5));
    setEReason("");
    setStudentReason("");
    setSwapId("");
    setSwapReason("");
    setActionsMenuOpen(false);
    setStatusDropdownOpen(false);
    setSelectedTab(canSee ? "questions" : "history");
  }, [dutyDate, selected?.id, selected?.student_id, selected?.target_count, canSee]);
  const prog = p.progress && selected && p.progress.duty_id === selected.id ? p.progress : undefined;
  const target = selected?.target_count ?? 5;
  const uploaded = Number(prog?.submitted_count ?? 0);
  const approvedN = Number(prog?.approved_count ?? 0);
  const pendingN = Number(prog?.pending_count ?? 0);
  const revisionN = Number(prog?.revision_requested_count ?? 0);
  const pct = Math.min(100, Math.round((uploaded / Math.max(1, target)) * 100));
  const enough = uploaded >= target;
  const isToday = dutyDate === today;
  const isOverdue = (d: any) => d && d.duty_date < today && openStates.includes(d.duty_status || "assigned");
  const overdue = !!selected && isOverdue(selected);

  // Swap options
  const swapOptions = selected
    ? duties.filter(
        d =>
          d.id !== selected.id &&
          d.duty_date >= today &&
          d.student_id !== selected.student_id &&
          !swapBlocked.includes(d.duty_status || "assigned")
      )
    : [];
  const selectedSwappable = !!selected && selected.duty_date >= today && !swapBlocked.includes(status);
  const swapTarget = swapOptions.find(d => d.id === swapId);

  async function doSwap() {
    if (!selected || !swapTarget) return;
    setSwapBusy(true);
    try {
      await p.api("/rest/v1/rpc/swap_duties", "POST", {
        p_duty_a: selected.id,
        p_duty_b: swapTarget.id,
        p_reason: swapReason.trim() || null
      });
      p.flash(`Swapped ${dayLabel(selected.duty_date)} and ${dayLabel(swapTarget.duty_date)}.`);
      await p.refresh();
      setSwapOpen(false);
    } catch (e: any) {
      p.fail(e?.message || "Could not swap the duties");
    } finally {
      setSwapBusy(false);
    }
  }

  // Month grid generation (Monday start)
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayDow = (new Date(viewYear, viewMonth, 1, 12).getDay() + 6) % 7; // 0 = Mon, 6 = Sun
  const monthCells = useMemo(() => {
    const cells: { dateStr: string; dayNum: number; inMonth: boolean }[] = [];
    for (let i = 0; i < firstDayDow; i++) {
      cells.push({ dateStr: "", dayNum: 0, inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        dateStr: `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`,
        dayNum: d,
        inMonth: true
      });
    }
    return cells;
  }, [viewYear, viewMonth, daysInMonth, firstDayDow]);

  const statusShortLabels: Record<string, string> = {
    assigned: "Assigned",
    confirmed: "Confirmed",
    in_progress: "In prog",
    submitted: "Submitted",
    reviewed: "Reviewed",
    change_requested: "Change req",
    excused: "Excused",
    missed: "Missed"
  };

  return (
    <div className="dc">
      {/* 5. a) Top Toolbar */}
      <section className="card dc-toolbar">
        <div className="dc-month-nav">
          <button className="icon-button" aria-label="Previous month" onClick={prevMonth}>
            <ChevronLeft size={18} />
          </button>
          <span className="dc-month-title">
            {new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <button className="icon-button" aria-label="Next month" onClick={nextMonth}>
            <ChevronRight size={18} />
          </button>
          <button className="outline dc-today-btn" onClick={goToToday}>
            Today
          </button>
        </div>

        <div className="dc-toolbar-actions">
          {manage && (
            <button
              className={showRotation ? "primary" : "outline"}
              onClick={() => setShowRotation(r => !r)}
            >
              Rotation
            </button>
          )}
          {manage && (
            <button className="outline" onClick={() => setBulkOpen(true)}>
              Bulk assign
            </button>
          )}
          <button className="outline" onClick={copyRoster} disabled={!upcomingDuties.length}>
            Copy roster
          </button>
          {isParticipant && (
            <button className="outline dc-leave-btn" onClick={() => setLeaveOpen(true)}>
              Report leave
              {leaveCount > 0 && <span className="dc-badge">{leaveCount}</span>}
            </button>
          )}
        </div>
      </section>

      {/* Rotation Panel (collapsible behind toggle) */}
      {showRotation && manage && (
        <RotationPanel rotation={rotation} people={p.people} onBulk={() => setBulkOpen(true)} />
      )}

      {/* 6. Month Grid */}
      <section className="card dc-calendar-card">
        <div className="dc-month-grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(w => (
            <div key={w} className="dc-grid-header">
              {w}
            </div>
          ))}

          {monthCells.map((cell, idx) => {
            if (!cell.inMonth) {
              return <div key={`pad-${idx}`} className="dc-month-cell pad" />;
            }
            const dStr = cell.dateStr;
            const duty = byDate.get(dStr);
            const isSel = dStr === dutyDate;
            const isTod = dStr === today;
            const cellStatus = duty?.duty_status || "assigned";
            const cellOverdue = isOverdue(duty);
            const isViewerDuty = duty && duty.student_id === p.profile.id;
            const studentFirstName = duty ? (duty.student?.full_name || "Student").split(" ")[0] : "";

            return (
              <button
                type="button"
                key={dStr}
                onClick={() => p.onSelectDate(dStr)}
                className={`dc-month-cell ${duty ? `duty cell-${cellStatus}` : "open"} ${isSel ? "selected" : ""} ${isTod ? "today" : ""}`}
              >
                <div className="dc-cell-top">
                  <span className={`dc-day-num ${isTod ? "today-badge" : ""}`}>{cell.dayNum}</span>
                  {cellOverdue && <span className="dc-overdue-tag">Overdue</span>}
                  {isViewerDuty && <span className="dc-you-tag">You</span>}
                </div>
                {duty ? (
                  <div className="dc-cell-info">
                    <strong className="dc-cell-name">{studentFirstName}</strong>
                    <span className="dc-cell-status">{statusShortLabels[cellStatus] || cellStatus}</span>
                  </div>
                ) : (
                  <div className="dc-cell-empty">Open</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Single-line Color Legend */}
        <div className="dc-legend">
          <span className="legend-item"><span className="legend-swatch swatch-assigned" /> Assigned</span>
          <span className="legend-item"><span className="legend-swatch swatch-confirmed" /> Confirmed</span>
          <span className="legend-item"><span className="legend-swatch swatch-in_progress" /> In progress</span>
          <span className="legend-item"><span className="legend-swatch swatch-submitted" /> Submitted</span>
          <span className="legend-item"><span className="legend-swatch swatch-reviewed" /> Reviewed</span>
          <span className="legend-item"><span className="legend-swatch swatch-change_requested" /> Change req</span>
          <span className="legend-item"><span className="legend-swatch swatch-excused" /> Excused</span>
          <span className="legend-item"><span className="legend-swatch swatch-missed" /> Missed</span>
          <span className="legend-item"><span className="legend-swatch swatch-overdue" /> Overdue</span>
          <span className="legend-item"><span className="legend-swatch swatch-open" /> Open</span>
        </div>
      </section>

      {/* 5. c) Selected Day Area */}
      {selected ? (
        <section className="card dc-focus">
          {/* 5. e) Slim Banner for Change Requested */}
          {status === "change_requested" && (
            <div className="dc-alert-slim">
              <TriangleAlert size={16} />
              <div className="dc-alert-text">
                <strong>Change requested:</strong> {selected.status_note || "No reason given."}
              </div>
              {manage && (
                <button
                  className="primary dc-alert-btn"
                  onClick={() => {
                    setEDate(selected.duty_date);
                    setEditOpen(true);
                  }}
                >
                  Reassign or swap
                </button>
              )}
            </div>
          )}

          <div className="dc-selected-header">
            <div>
              <span className="eyebrow">
                {selected.rotation_cycle ? `ROTATION ${selected.rotation_cycle}` : "DUTY"} · {selected.duty_date}
                {isToday ? " · Today" : ""}
              </span>
              <h3>
                {memberName(selected.student_id, selected.student?.full_name || "Student")}
                {mine && <span className="dc-you">You</span>}
              </h3>
              <p>Prepare {selected.target_count} current-affairs questions for this date.</p>
            </div>

            {/* ONE Fixed Action Bar at Top-Right */}
            <div className="dc-action-bar">
              {/* Teacher and Admin Actions */}
              {review && (
                <>
                  {status !== "reviewed" && (
                    <button
                      className="primary"
                      disabled={busy || !enough}
                      onClick={() => p.onStatus(selected, "reviewed")}
                    >
                      Mark reviewed
                    </button>
                  )}
                  {pendingN + revisionN > 0 && (
                    <button className="outline" onClick={p.goReview}>
                      Open review queue
                    </button>
                  )}
                  <div className="dc-menu-anchor" onClick={e => e.stopPropagation()}>
                    <button
                      className="outline"
                      type="button"
                      onClick={() => setStatusDropdownOpen(o => !o)}
                    >
                      Status ▾
                    </button>
                    {statusDropdownOpen && (
                      <div className="qz-pop dc-popover">
                        {["assigned", "excused", "missed"]
                          .filter(s => s !== status)
                          .map(s => (
                            <button
                              key={s}
                              type="button"
                              className="plain"
                              onClick={() => {
                                setStatusDropdownOpen(false);
                                p.onStatus(selected, s);
                              }}
                            >
                              {s === "assigned" ? "Reset to Assigned" : dutyStatuses[s]}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Student actions (for assigned student, including when student is a leader) */}
              {mine && (
                <>
                  {status === "assigned" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => p.onStatus(selected, "confirmed")}
                    >
                      Confirm duty
                    </button>
                  )}
                  {status !== "reviewed" && (
                    <button className="outline" onClick={p.onAddQuestions}>
                      Add questions
                    </button>
                  )}
                  {openStates.includes(status) && (
                    <button className="outline" onClick={() => setRequestChangeOpen(true)}>
                      Request change
                    </button>
                  )}
                </>
              )}

              {/* Leader & Staff Kebab Menu for rare actions */}
              {manage && (
                <div className="dc-menu-anchor" onClick={e => e.stopPropagation()}>
                  <button
                    className="icon-button"
                    aria-label="Duty actions"
                    type="button"
                    onClick={() => setActionsMenuOpen(o => !o)}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {actionsMenuOpen && (
                    <div className="qz-pop dc-popover">
                      <button
                        type="button"
                        className="plain"
                        onClick={() => {
                          setActionsMenuOpen(false);
                          setEditOpen(true);
                        }}
                      >
                        <Pencil size={14} /> Edit duty
                      </button>
                      {selectedSwappable && (
                        <button
                          type="button"
                          className="plain"
                          onClick={() => {
                            setActionsMenuOpen(false);
                            setSwapOpen(true);
                          }}
                        >
                          Swap day
                        </button>
                      )}
                      <button
                        type="button"
                        className="plain dc-danger-item"
                        onClick={() => {
                          setActionsMenuOpen(false);
                          setDeleteOpen(true);
                        }}
                      >
                        Delete duty
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Read-Only Details */}
          <div className="dc-details-zone">
            <div className="dc-details-meta">
              <span className={`duty-status status-${status}`}>
                {dutyStatuses[status] || status}
                {overdue ? " · Overdue" : ""}
              </span>
              <span className="dc-target-label">Target: {selected.target_count} questions</span>
            </div>

            {steps.includes(status) && (
              <ol className="dc-steps">
                {steps.map((s, i) => (
                  <li key={s} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""}>
                    <span>{i < stepIndex ? "✓" : i + 1}</span>
                    {dutyStatuses[s]}
                  </li>
                ))}
              </ol>
            )}

            {canSee && (
              <div className="duty-progress-block">
                <div className="progress-label">
                  <strong>
                    {uploaded} of {target} questions added
                  </strong>
                  <span>{approvedN} approved</span>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="duty-counts">
                  <span>{pendingN} waiting for review</span>
                  <span>{revisionN} need revision</span>
                </div>
              </div>
            )}

            {selected.status_note && status !== "change_requested" && (
              <p className="duty-note">
                <b>Latest note:</b> {selected.status_note}
              </p>
            )}
          </div>

       {/* Sub-Tabs: Questions | History (only rendered if user can view at least one) */}
          {(canSee || manage) && (
            <div className="dc-subtabs">
              {canSee && (
                <button
                  className={selectedTab === "questions" ? "on" : ""}
                  onClick={() => setSelectedTab("questions")}
                >
                  Questions
                </button>
              )}
              {manage && (
                <button
                  className={selectedTab === "history" ? "on" : ""}
                  onClick={() => setSelectedTab("history")}
                >
                  History
                </button>
              )}
            </div>
          )}

          {selectedTab === "questions" && canSee && (
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

          {selectedTab === "history" && manage && (
            <DutyHistory key={`h-${selected.id}`} dutyId={selected.id} api={p.api} people={p.people} />
          )}
        </section>
      ) : (
        /* 5. d) Empty Day Form */
        <section className="card dc-empty">
          <div className="empty-mark">
            <CalendarDays size={22} />
          </div>
          <div>
            <h3>
              No duty on{" "}
              {new Date(`${dutyDate}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "short"
              })}
            </h3>
            {manage ? (
              <>
                <p>Choose who takes this day. Students on leave or already used this cycle are greyed out.</p>
                <div className="dc-assign">
                  <label>
                    Student
                    {studentSelect(true)}
                    {eStudent === "auto" && waiting[0] && (
                      <small className="dc-sub">
                        Next in line: {memberName(waiting[0].id, waiting[0].full_name)} (unless on leave)
                      </small>
                    )}
                  </label>
                  <label>
                    Question target
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={eTarget}
                      onChange={e => setETarget(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !targetOk}
                    onClick={() =>
                      p.onSave({
                        date: dutyDate,
                        studentId: eStudent,
                        target: Number(eTarget),
                        reason: ""
                      })
                    }
                  >
                    {busy ? "Assigning…" : eStudent === "auto" ? "Assign next student" : "Assign student"}
                  </button>
                </div>
              </>
            ) : (
              <p>No one is assigned for this date yet.</p>
            )}
          </div>
        </section>
      )}

      {/* Edit Duty Modal */}
      {editOpen && selected && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setEditOpen(false);
          }}
        >
          <section className="modal dc-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <span className="eyebrow">EDIT DUTY</span>
                <h2>{selected.duty_date}</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setEditOpen(false)}>
                <X />
              </button>
            </div>
            <div className="modal-scroll">
              <div className="dc-form">
                <label>
                  Assignment date
                  <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} />
                </label>
                <label>Assigned student{studentSelect()}</label>
                <label>
                  Question target
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={eTarget}
                    onChange={e => setETarget(e.target.value)}
                  />
                </label>
                <label>
                  Reason (optional)
                  <textarea
                    rows={2}
                    value={eReason}
                    onChange={e => setEReason(e.target.value)}
                    placeholder="Add a note if helpful"
                  />
                </label>
              </div>
            </div>
            <div className="dc-foot">
              <span className="grow" />
              <button className="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !dirty || !eDate || !targetOk}
                onClick={submitEdit}
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Swap Day Modal */}
      {swapOpen && selected && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setSwapOpen(false);
          }}
        >
          <section className="modal dc-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <span className="eyebrow">SWAP DUTY</span>
                <h2>Swap with another day</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setSwapOpen(false)}>
                <X />
              </button>
            </div>
            <div className="modal-scroll">
              {!selectedSwappable ? (
                <p className="qb-warn">
                  This duty cannot be swapped because it is in the past or already closed.
                </p>
              ) : !swapOptions.length ? (
                <div className="empty">There is no other upcoming duty to swap with.</div>
              ) : (
                <div className="dc-swap">
                  <p>Pick an upcoming duty to trade dates.</p>
                  <div className="dc-swap-list">
                    {swapOptions.map(d => (
                      <label key={d.id} className={swapId === d.id ? "on" : ""}>
                        <input
                          type="radio"
                          name="swap"
                          checked={swapId === d.id}
                          onChange={() => setSwapId(d.id)}
                        />
                        <span>
                          <b>
                            {dayLabel(d.duty_date)} · {memberName(d.student_id, d.student?.full_name || "Student")}
                          </b>
                          <small>{dutyStatuses[d.duty_status || "assigned"]}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {swapTarget && (
                    <div className="dc-swap-preview">
                      After swapping, <b>{selected.student?.full_name || "this student"}</b> takes{" "}
                      {dayLabel(swapTarget.duty_date)} and <b>{swapTarget.student?.full_name || "the other student"}</b>{" "}
                      takes {dayLabel(selected.duty_date)}.
                    </div>
                  )}
                  <label className="dc-swap-reason">
                    Reason (optional)
                    <textarea
                      rows={2}
                      value={swapReason}
                      onChange={e => setSwapReason(e.target.value)}
                      placeholder="Why are these days being swapped?"
                    />
                  </label>
                </div>
              )}
            </div>
            <div className="dc-foot">
              <span className="grow" />
              <button className="outline" onClick={() => setSwapOpen(false)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={swapBusy || !swapTarget || !selectedSwappable}
                onClick={doSwap}
              >
                {swapBusy ? "Swapping…" : "Swap days"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Delete Duty Confirmation Modal */}
      {deleteOpen && selected && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setDeleteOpen(false);
          }}
        >
          <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "460px" }}>
            <div className="modal-head">
              <div>
                <span className="eyebrow" style={{ color: "#ef4444" }}>
                  CONFIRM DELETION
                </span>
                <h2>Delete Duty?</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setDeleteOpen(false)}>
                <X />
              </button>
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <p style={{ margin: 0 }}>
                Delete this duty for <b>{dayLabel(selected.duty_date)}</b> and return this turn to the rotation queue?
              </p>
              <label style={{ fontSize: "13px", fontWeight: 700 }}>
                Reason (optional)
                <input
                  type="text"
                  value={eReason}
                  onChange={e => setEReason(e.target.value)}
                  placeholder="Reason for deletion"
                  style={{ width: "100%", padding: "8px", marginTop: "4px" }}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button className="outline" onClick={() => setDeleteOpen(false)}>
                  Keep
                </button>
                <button
                  className="danger-outline"
                  style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
                  disabled={busy}
                  onClick={async () => {
                    if (await p.onDelete(eReason.trim())) setDeleteOpen(false);
                  }}
                >
                  {busy ? "Deleting…" : "Yes, delete duty"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Student Request Change Dialog */}
      {requestChangeOpen && selected && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setRequestChangeOpen(false);
          }}
        >
          <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "460px" }}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">REQUEST DUTY CHANGE</span>
                <h2>Can't do this day?</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setRequestChangeOpen(false)}>
                <X />
              </button>
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <p style={{ margin: 0, fontSize: "14px", color: "#64748b" }}>
                Send a reassignment request to your class supervisor or leader.
              </p>
              <label style={{ fontSize: "13px", fontWeight: 700 }}>
                Reason for change request
                <textarea
                  rows={3}
                  value={studentReason}
                  onChange={e => setStudentReason(e.target.value)}
                  placeholder="Explain why you cannot take this date..."
                  style={{ width: "100%", padding: "10px", marginTop: "6px", borderRadius: "8px" }}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button className="outline" onClick={() => setRequestChangeOpen(false)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy || !studentReason.trim()}
                  onClick={() => {
                    p.onStatus(selected, "change_requested", studentReason);
                    setRequestChangeOpen(false);
                  }}
                >
                  Submit request
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Leave Modal */}
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

      {/* Bulk Assign Modal */}
      {bulkOpen && manage && (
        <BulkAssign
          people={p.people}
          duties={duties}
          rotation={rotation}
          api={p.api}
          flash={p.flash}
          fail={p.fail}
          refresh={p.refresh}
          defaultStart={dutyDate >= today ? dutyDate : today}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}
