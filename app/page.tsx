"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  ShieldCheck,
  Users,
  LogOut,
  Plus,
  X,
  CircleHelp,
  Upload,
  Timer,
  CheckCircle2,
  RefreshCw,
  Copy,
  ExternalLink,
  FileQuestion,
  MoreVertical,
  Download,
  Search,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
  Edit,
  Eye
} from "lucide-react";
import DutyCalendar from "./DutyCalendar";
import QuizBuilder, { QuizPayload } from "./QuizBuilder";

const base = "https://dclxjishlusibfiedroo.supabase.co",
  key = "sb_publishable_TdCaDw8CU8M0H1dvBHL-MQ_S3sc_PfE";

type Session = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string };
};

type Profile = {
  id: string;
  full_name: string;
  role: "super_admin" | "supervisor" | "student_leader" | "student";
  active: boolean;
  requested_role?: ("supervisor" | "student") | null;
  enrollment_number?: string | null;
};

type Question = {
  id: string;
  stem: string;
  topic: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  source_url: string | null;
  status: string;
  author_id: string;
  created_at: string;
  is_special: boolean;
  author?: { full_name: string; enrollment_number?: string | null };
};

type Duty = {
  id: string;
  duty_date: string;
  student_id: string;
  target_count: number;
  rotation_cycle?: number | null;
  duty_status: string;
  status_note?: string | null;
  student?: { full_name: string; enrollment_number?: string | null };
};

type Quiz = {
  id: string;
  title: string;
  kind: string;
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  published: boolean;
  result_visibility: "immediate" | "after_release";
  results_published: boolean;
  ended_early_at?: string | null;
  is_hidden?: boolean;
};

type Attempt = {
  quiz_id: string;
  score: number;
  total: number;
  submitted_at: string;
};

type Availability = {
  profile_id: string;
  full_name: string;
  role: string;
  status: string;
  note: string | null;
  already_assigned: boolean;
};

const dutyStatuses: { [key: string]: string } = {
  assigned: "Assigned",
  confirmed: "Confirmed",
  in_progress: "In progress",
  submitted: "Questions submitted",
  reviewed: "Reviewed",
  change_requested: "Change requested",
  excused: "Excused",
  missed: "Missed"
};

const labels = {
  super_admin: "Super admin",
  supervisor: "Teacher",
  student_leader: "Student leader",
  student: "Student"
};

const topics = [
  "Polity",
  "Economy",
  "Environment",
  "International relations",
  "Science & technology",
  "Government schemes",
  "History",
  "Reports & indices",
  "Other"
];

const promptText = `Convert the supplied UPSC current-affairs material into importable multiple-choice questions. Return only valid JSON (no Markdown fences) in this shape:
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

async function request(path: string, token: string, method = "GET", body?: unknown, prefer?: string) {
  const r = await fetch(base + path, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body === undefined || method === "DELETE" ? undefined : JSON.stringify(body)
  });
  const raw = await r.text();
  let data: any;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!r.ok) throw Error(data?.message || data?.error_description || data?.error || `Request failed (${r.status})`);
  return data;
}

const route = (table: string, query = "") => `/rest/v1/${table}${query ? `?${query}` : ""}`;

async function loadDutyRows(token: string) {
  const since = new Date(Date.now() - 45 * 864e5).toLocaleDateString("en-CA");
  const filter = `&duty_date=gte.${since}&order=duty_date.asc&limit=200`;
  try {
    return await request(
      route(
        "duties",
        `select=id,duty_date,student_id,target_count,rotation_cycle,duty_status,status_note,student:profiles!duties_student_id_fkey(full_name,enrollment_number)${filter}`
      ),
      token
    );
  } catch (e: any) {
    if (!/duty_status|schema cache/i.test(e.message || "")) throw e;
    const rows = await request(
      route(
        "duties",
        `select=id,duty_date,student_id,target_count,rotation_cycle,student:profiles!duties_student_id_fkey(full_name,enrollment_number)${filter}`
      ),
      token
    );
    return rows.map((d: any) => ({ ...d, duty_status: "assigned", status_note: null }));
  }
}

function csvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  if (rows.length < 2) throw Error("CSV needs a header row and at least one question.");
  const headers = rows.shift()!.map(x => x.trim().toLowerCase().replace(/[ -]+/g, "_"));
  return rows.map(cols => Object.fromEntries(headers.map((h, i) => [h, (cols[i] || "").trim()])));
}

function parseImported(raw: string) {
  let records: any[];
  try {
    const parsed = JSON.parse(raw);
    records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.questions) ? parsed.questions : [parsed];
  } catch {
    records = csvRows(raw);
  }
  if (!records.length) throw Error("No questions were found in that file.");
  return records.map((r: any, i: number) => {
    const stem = String(r.stem ?? r.question ?? "").trim(),
      options = Array.isArray(r.options)
        ? r.options
        : Array.isArray(r.choices)
        ? r.choices
        : [r.option_a ?? r.a, r.option_b ?? r.b, r.option_c ?? r.c, r.option_d ?? r.d];
    const clean: string[] = options.map((v: any) => String(v ?? "").trim());
    const answer = r.correct_index ?? r.answer_index ?? r.correct_answer ?? r.answer ?? r.correct_option,
      answerText = String(answer ?? "").trim();
    let index = -1;
    if (typeof answer === "number" && Number.isInteger(answer) && answer >= 0 && answer <= 3) index = answer;
    else if (/^[0-4]$/.test(answerText)) {
      index = Number(answerText);
      if (index > 0) index -= 1;
    }
    if (index < 0) index = clean.findIndex(v => v.toLowerCase() === answerText.toLowerCase());
    if (index < 0 && /^[a-d]$/i.test(answerText)) index = answerText.toUpperCase().charCodeAt(0) - 65;
    if (stem.length < 12) throw Error(`Question ${i + 1}: question text must have at least 12 characters.`);
    if (clean.length !== 4 || clean.some((v: string) => !v))
      throw Error(`Question ${i + 1}: provide exactly four options.`);
    if (index < 0 || index > 3)
      throw Error(`Question ${i + 1}: correct answer must match an option or be a zero-based/one-based index or A–D.`);
    return {
      stem,
      topic: String(r.topic || "Other"),
      options: clean,
      correct_index: index,
      explanation: String(r.explanation || "").trim() || null,
      source_url: String(r.source_url ?? r.source ?? "").trim() || null
    };
  });
}

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

export default function Home() {
  const [session, setSession] = useState<Session | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [view, setView] = useState("Overview"),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]),
    [duties, setDuties] = useState<Duty[]>([]),
    [quizzes, setQuizzes] = useState<Quiz[]>([]),
    [people, setPeople] = useState<Profile[]>([]),
    [attempts, setAttempts] = useState<Attempt[]>([]);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [newName, setNewName] = useState(""),
    [newEnrollment, setNewEnrollment] = useState(""),
    [newEmail, setNewEmail] = useState(""),
    [newMemberPassword, setNewMemberPassword] = useState(""),
    [newMemberRole, setNewMemberRole] = useState("student"),
    [signupEnrollment, setSignupEnrollment] = useState(""),
    [memberBusy, setMemberBusy] = useState(false),
    [passwordSetup, setPasswordSetup] = useState(false),
    [recoveryMode, setRecoveryMode] = useState(false),
    [signupMode, setSignupMode] = useState(false),
    [signupRole, setSignupRole] = useState("student"),
    [memberSearch, setMemberSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [editQuestion, setEditQuestion] = useState<Question | null>(null),
    [stem, setStem] = useState(""),
    [topic, setTopic] = useState(topics[0]),
    [options, setOptions] = useState(["", "", "", ""]),
    [correct, setCorrect] = useState(0),
    [explanation, setExplanation] = useState(""),
    [source, setSource] = useState(""),
    [isSpecial, setIsSpecial] = useState(false),
    [importText, setImportText] = useState(""),
    [importMessage, setImportMessage] = useState(""),
    [importBusy, setImportBusy] = useState(false);
  const [dutyDate, setDutyDate] = useState(new Date().toLocaleDateString("en-CA")),
    [dutyProgress, setDutyProgress] = useState<any[]>([]),
    [dutyAvailability, setDutyAvailability] = useState<Availability[]>([]),
    [dutyChoice, setDutyChoice] = useState("auto"),
    [manualDutyStudent, setManualDutyStudent] = useState("auto"),
    [editedDutyDate, setEditedDutyDate] = useState(new Date().toLocaleDateString("en-CA")),
    [dutyTargetCount, setDutyTargetCount] = useState("5"),
    [dutyChangeReason, setDutyChangeReason] = useState(""),
    [dutyBusy, setDutyBusy] = useState(false),
    [attendanceQuiz, setAttendanceQuiz] = useState<string | null>(null),
    [attendance, setAttendance] = useState<any[]>([]),
    [enrollmentEdits, setEnrollmentEdits] = useState<Record<string, string>>({});
  const [quizTitle, setQuizTitle] = useState(""),
    [quizKind, setQuizKind] = useState("weekly"),
    [quizSpecialFilter, setQuizSpecialFilter] = useState("all"),
    [quizAuthorFilter, setQuizAuthorFilter] = useState<string[]>([]),
    [quizDateFilter, setQuizDateFilter] = useState(""),
    [quizVisibility, setQuizVisibility] = useState("immediate"),
    [selectedResult, setSelectedResult] = useState<any>(null);
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null),
    [quizQuestions, setQuizQuestions] = useState<any[]>([]),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [deadline, setDeadline] = useState<number | null>(null),
    [remaining, setRemaining] = useState(0),
    [quizBusy, setQuizBusy] = useState(false),
    [roles, setRoles] = useState<Record<string, string>>({});
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<any | null>(null);
  const [memberModal, setMemberModal] = useState(false);
  const [clock, setClock] = useState(Date.now());

  // Step 1 Refs
  const timerSubmitRef = useRef(false);
  const autosaveTimerRef = useRef<any>(null);
  const token = session?.access_token || "";

  // Cards, Filters & Dropdown
  const [quizFilter, setQuizFilter] = useState<"all" | "live" | "upcoming" | "closed">("all");
  const [menuQuizId, setMenuQuizId] = useState<string | null>(null);

  // Attendees Modal
  const [attendeesData, setAttendeesData] = useState<any | null>(null);
  const [attendeeFilter, setAttendeeFilter] = useState<"all" | "submitted" | "in_progress" | "not_started">("all");
  const [attendeeSearch, setAttendeeSearch] = useState("");

  // Review Screen
  const [reviewFilter, setReviewFilter] = useState<"all" | "correct" | "wrong" | "skipped">("all");

  // End Quiz Early
  const [endQuizTarget, setEndQuizTarget] = useState<Quiz | null>(null);
  const [endQuizLoading, setEndQuizLoading] = useState(false);
  const [activeStudentCount, setActiveStudentCount] = useState<number | null>(null);

  // Questions & Performance Item Analysis Modal
  const [questionsModalQuiz, setQuestionsModalQuiz] = useState<Quiz | null>(null);
  const [questionsModalData, setQuestionsModalData] = useState<any[]>([]);
  const [questionsModalLoading, setQuestionsModalLoading] = useState(false);
  const [questionsModalAttempts, setQuestionsModalAttempts] = useState<number>(0);

  const review = profile?.role === "super_admin" || profile?.role === "supervisor",
    manage = review || profile?.role === "student_leader",
    today = new Date().toLocaleDateString("en-CA");

  const load = useCallback(async (s: Session) => {
    const p = await request(
        route("profiles", `id=eq.${s.user.id}&select=id,full_name,role,active,requested_role,enrollment_number`),
        s.access_token
      ),
      me = p[0] as Profile | undefined;
    setProfile(me || null);
    if (!me?.active) {
      setQuestions([]);
      setDuties([]);
      setQuizzes([]);
      setPeople([]);
      setAttempts([]);
      return;
    }
    const showDirectory = ["super_admin", "supervisor", "student_leader"].includes(me.role);
    const [q, d, z, m, a] = await Promise.all([
      me.role === "super_admin" || me.role === "supervisor"
        ? request("/rest/v1/rpc/get_review_questions", s.access_token, "POST", {}).then((rows: any[]) =>
            rows.map(x => ({ ...x, author: { full_name: x.author_full_name, enrollment_number: x.author_enrollment } }))
          )
        : request(
            route(
              "questions",
              "select=id,stem,topic,options,source_url,status,author_id,created_at,is_special,author:profiles!questions_author_id_fkey(full_name,enrollment_number)&order=created_at.desc&limit=400"
            ),
            s.access_token
          ),
      loadDutyRows(s.access_token),
      request(
        route(
          "quizzes",
          "select=id,title,kind,opens_at,closes_at,duration_minutes,published,result_visibility,results_published,ended_early_at,is_hidden&order=opens_at.desc&limit=120"
        ),
        s.access_token
      ),
      showDirectory
        ? request(
            route("profiles", "select=id,full_name,role,active,requested_role,enrollment_number&order=full_name.asc"),
            s.access_token
          )
        : Promise.resolve([]),
      request(route("quiz_attempts", `select=quiz_id,submitted_at,score&student_id=eq.${me.id}`), s.access_token)
    ]);
    setQuestions(q || []);
    setDuties(d || []);
    setQuizzes(z || []);
    setPeople(m || []);
    setAttempts(a || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        let s: Session | null = null;
        const params = new URLSearchParams(window.location.hash.slice(1));
        const inviteToken = params.get("access_token"),
          inviteRefresh = params.get("refresh_token"),
          inviteType = params.get("type");
        if (params.get("error_code")) {
          setError("That email link has expired or was already used. Request a fresh password link below.");
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
        if (inviteToken && inviteRefresh) {
          const user = await request("/auth/v1/user", inviteToken);
          s = {
            access_token: inviteToken,
            refresh_token: inviteRefresh,
            expires_at: Math.floor(Date.now() / 1000) + Number(params.get("expires_in") || 3600),
            user
          };
          localStorage.setItem("civicprep_session", JSON.stringify(s));
          if (inviteType === "invite" || inviteType === "recovery") setPasswordSetup(true);
          history.replaceState(null, "", window.location.pathname + window.location.search);
        } else s = JSON.parse(localStorage.getItem("civicprep_session") || "null");
        if (s?.refresh_token && (s.expires_at || 0) < Date.now() / 1000 + 60) {
          try {
            const n = await request("/auth/v1/token?grant_type=refresh_token", key, "POST", {
              refresh_token: s.refresh_token
            });
            s = { ...n, expires_at: Math.floor(Date.now() / 1000) + n.expires_in };
            localStorage.setItem("civicprep_session", JSON.stringify(s));
          } catch {
            s = null;
            localStorage.removeItem("civicprep_session");
          }
        }
        setSession(s);
        if (s) await load(s);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  useEffect(() => {
    if (session && profile?.active) {
      setRefreshing(true);
      load(session)
        .catch((e: any) => setError(e.message))
        .finally(() => setRefreshing(false));
    }
  }, [view, session, profile?.active, load]);

  // Auto-reopen quiz if refreshed during an active session
  useEffect(() => {
    if (!session || !profile?.active || activeQuiz || !quizzes.length) return;
    try {
      const savedQuizId = sessionStorage.getItem("civicprep_active_quiz_id");
      if (!savedQuizId) return;
      const matchQuiz = quizzes.find(q => q.id === savedQuizId);
      const hasSubmitted = attempts.some(a => a.quiz_id === savedQuizId);
      if (matchQuiz && !hasSubmitted) {
        openQuiz(matchQuiz);
      } else {
        sessionStorage.removeItem("civicprep_active_quiz_id");
      }
    } catch {}
  }, [session, profile?.active, quizzes, attempts, activeQuiz]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && session) load(session).catch((e: any) => setError(e.message));
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, load]);

  useEffect(() => {
    if (!session || !profile?.active || view !== "Duty calendar") return;
    Promise.all([
      request("/rest/v1/rpc/get_duty_progress", token, "POST", { p_duty_date: dutyDate }),
      manage ? request("/rest/v1/rpc/get_duty_availability", token, "POST", { p_duty_date: dutyDate }) : Promise.resolve([])
    ])
      .then(([progress, avail]) => {
        setDutyProgress(progress || []);
        setDutyAvailability(avail || []);
      })
      .catch((e: any) => setError(e.message));
  }, [session, profile?.active, profile?.id, manage, view, dutyDate, token, questions, duties]);

  useEffect(() => {
    const duty = duties.find(d => d.duty_date === dutyDate);
    if (duty) {
      setDutyChoice(duty.student_id);
      setEditedDutyDate(duty.duty_date);
      setDutyTargetCount(String(duty.target_count));
    } else {
      setDutyChoice("auto");
      setEditedDutyDate(dutyDate);
      setDutyTargetCount("5");
    }
  }, [duties, dutyDate]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModalOpen(false);
        setHelpOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  useEffect(() => {
    if (!activeQuiz || deadline === null) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [activeQuiz, deadline]);

  // Debounced Autosave Hook
  useEffect(() => {
    if (!activeQuiz || !token || timerSubmitRef.current) return;
    try {
      localStorage.setItem(`civicprep_answers_${activeQuiz.id}`, JSON.stringify(answers));
    } catch {}
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const timeTaken = Math.max(0, activeQuiz.duration_minutes * 60 - remaining);
        const res = await request("/rest/v1/rpc/autosave_quiz_progress", token, "POST", {
          p_quiz_id: activeQuiz.id,
          p_answers: answers,
          p_time_taken_seconds: timeTaken
        });
        if (res && res.status === "closed") {
          submitQuiz(true);
        }
      } catch {}
    }, 1500);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [answers, activeQuiz, token, remaining]);

  // Early-End Heartbeat
  useEffect(() => {
    if (!activeQuiz || !token) return;
    const poller = setInterval(async () => {
      try {
        const rows = await request(
          route("quizzes", `id=eq.${activeQuiz.id}&select=ended_early_at,closes_at`),
          token
        );
        const qz = rows?.[0];
        if (qz && (qz.ended_early_at || new Date(qz.closes_at).getTime() <= Date.now())) {
          clearInterval(poller);
          timerSubmitRef.current = true;
          const endedTitle = activeQuiz.title;
          const endedEarly = Boolean(qz.ended_early_at);
          setActiveQuiz(null);
          setDeadline(null);
          setQuizQuestions([]);
          setAnswers({});
          setQuizBusy(false);
          timerSubmitRef.current = false;
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          try {
            localStorage.removeItem(`civicprep_answers_${activeQuiz.id}`);
            sessionStorage.removeItem("civicprep_active_quiz_id");
          } catch {}
          if (session) await load(session);
          flash(
            endedEarly
              ? `"${endedTitle}" was ended early by the instructor. Your autosaved answers were submitted.`
              : `"${endedTitle}" time has closed.`
          );
        }
      } catch {}
    }, 5000);
    return () => clearInterval(poller);
  }, [activeQuiz, token, session, load]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Global click listener to close dropdown menu
  useEffect(() => {
    if (!menuQuizId) return;
    const closeMenu = () => setMenuQuizId(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [menuQuizId]);

  const flash = (s: string) => {
    setNotice(s);
    window.setTimeout(() => setNotice(""), 4500);
  };

  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(""), 8000);
    return () => window.clearTimeout(id);
  }, [error]);

  useEffect(() => {
    if (!memberModal) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMemberModal(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [memberModal]);

  async function change(path: string, body: any, method = "POST", prefer = "return=minimal") {
    setError("");
    try {
      await request(path, token, method, body, prefer);
      if (session) await load(session);
      flash("Saved successfully.");
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const n = await request("/auth/v1/token?grant_type=password", key, "POST", { email, password }),
        s = { ...n, expires_at: Math.floor(Date.now() / 1000) + n.expires_in };
      localStorage.setItem("civicprep_session", JSON.stringify(s));
      setSession(s);
      setPassword("");
      await load(s);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch(base + "/functions/v1/public-signup", {
          method: "POST",
          headers: { apikey: key, "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            full_name: newName,
            requested_role: signupRole,
            enrollment_number: signupRole === "student" ? signupEnrollment : null
          })
        }),
        n: any = await r.json();
      if (!r.ok) throw Error(n.error || "Could not create your account.");
      if (
        signupRole === "student" &&
        (n.signup_version !== "enrollment-v2" || String(n.member?.enrollment_number || "").trim() !== signupEnrollment.trim())
      )
        throw Error(
          "Supabase accepted the signup but did not confirm the enrollment number. The account may already exist, so do not submit again yet. Ask the super admin to check People, then deploy the updated public-signup function."
        );
      setNotice("Account created and enrollment number saved. Wait for a super admin to activate your account.");
      setSignupMode(false);
      setPassword("");
      setNewName("");
      setSignupEnrollment("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function recover(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const destination = "https://upsc-current-affairs-hub.mohammedjavvadkt.chatgpt.site";
      await request(`/auth/v1/recover?redirect_to=${encodeURIComponent(destination)}`, key, "POST", { email });
      flash("If this address has an account, a fresh password link is on its way.");
    } catch (e: any) {
      setError(e.message);
    }
  }

  function logout() {
    request("/auth/v1/logout", token, "POST").catch(() => {});
    localStorage.removeItem("civicprep_session");
    setSession(null);
    setProfile(null);
    setQuestions([]);
    setView("Overview");
  }

  const enrollmentFor = (id: string) => people.find(p => p.id === id)?.enrollment_number;
  const memberName = (id: string, name: string) => {
    const enrollment = enrollmentFor(id) || questions.find(q => q.author_id === id)?.author?.enrollment_number;
    return enrollment ? `${name} · ${enrollment}` : name;
  };
  const selectedDuty = duties.find(d => d.duty_date === dutyDate);
  const dutyCandidates = dutyAvailability.length
    ? dutyAvailability.filter(a => !a.already_assigned || a.profile_id === selectedDuty?.student_id)
    : people
        .filter(p => ["student", "student_leader"].includes(p.role))
        .map(p => ({
          profile_id: p.id,
          full_name: p.full_name,
          role: p.role,
          status: "available",
          note: null,
          already_assigned: false
        }));
  const approved = questions.filter(q => q.status === "approved"),
    pending = questions.filter(q => ["pending", "revision_requested"].includes(q.status)),
    myAttempts = new Map(attempts.map(a => [a.quiz_id, a]));
  const liveUnsubmitted = quizzes.filter(
    q =>
      q.published &&
      new Date(q.opens_at).getTime() <= clock &&
      new Date(q.closes_at).getTime() >= clock &&
      !(q as any).ended_early_at &&
      !myAttempts.has(q.id)
  ).length;

  const links = ["Overview", "Question bank", "Duty calendar", "Quizzes", ...(review ? ["Review queue"] : []), ...(review ? ["People"] : [])];
  const navIcons: any = {
    Overview: BookOpen,
    "Question bank": BookOpen,
    "Duty calendar": CalendarDays,
    Quizzes: ClipboardList,
    "Review queue": ShieldCheck,
    People: Users
  };

  async function openQuestion(q?: Question) {
    setEditQuestion(q || null);
    setStem(q?.stem || "");
    setTopic(q?.topic || topics[0]);
    setOptions(q?.options?.length === 4 ? [...q.options] : ["", "", "", ""]);
    setCorrect(q?.correct_index ?? 0);
    setExplanation(q?.explanation || "");
    setSource(q?.source_url || "");
    setIsSpecial(q?.is_special || false);
    setImportText("");
    setImportMessage("");
    setHelpOpen(false);
    setModalOpen(true);
    if (q) {
      try {
        const full = await request("/rest/v1/rpc/get_question_editor", token, "POST", { p_question_id: q.id });
        setEditQuestion({ ...q, ...full });
        setStem(full.stem);
        setTopic(full.topic);
        setOptions(full.options);
        setCorrect(full.correct_index);
        setExplanation(full.explanation || "");
        setSource(full.source_url || "");
        setIsSpecial(full.is_special || false);
      } catch (e: any) {
        setModalOpen(false);
        setError(e.message);
      }
    }
  }

  async function saveQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (options.some(o => !o.trim())) {
      setError("Complete all four answer options.");
      return;
    }
    const body = {
      stem: stem.trim(),
      topic,
      options: options.map(o => o.trim()),
      correct_index: correct,
      explanation: explanation.trim() || null,
      source_url: source.trim() || null,
      ...(review ? { is_special: isSpecial } : {})
    };
    if (
      await change(editQuestion ? route("questions", `id=eq.${editQuestion.id}`) : route("questions"), body, editQuestion ? "PATCH" : "POST")
    ) {
      setModalOpen(false);
      setEditQuestion(null);
      setStem("");
      setOptions(["", "", "", ""]);
      setExplanation("");
      setSource("");
    }
  }

  async function importQuestions() {
    setError("");
    setImportMessage("");
    setImportBusy(true);
    try {
      const parsed = parseImported(importText),
        payload = parsed.map(q => ({ ...q, ...(review ? { is_special: isSpecial } : {}) }));
      await request(route("questions"), token, "POST", payload, "return=minimal");
      if (session) await load(session);
      setImportText("");
      setImportMessage(`${payload.length} question${payload.length === 1 ? "" : "s"} added to the review queue.`);
      flash(`${payload.length} imported for review.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImportBusy(false);
    }
  }

  async function chooseImportFile(file?: File) {
    if (!file) return;
    try {
      setImportText(await file.text());
      setImportMessage(`Loaded ${file.name}. Review the text, then import it.`);
    } catch (e: any) {
      setError(`Could not read that file: ${e.message}`);
    }
  }

  // submitQuiz with storage cleanup
  async function submitQuiz(auto = false) {
    if (!activeQuiz || quizBusy || timerSubmitRef.current) return;
    timerSubmitRef.current = true;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setQuizBusy(true);
    try {
      await request("/rest/v1/rpc/submit_quiz", token, "POST", { p_quiz_id: activeQuiz.id, p_answers: answers });
      const quiz = activeQuiz;
      try {
        localStorage.removeItem(`civicprep_answers_${quiz.id}`);
        sessionStorage.removeItem("civicprep_active_quiz_id");
      } catch {}
      setActiveQuiz(null);
      setDeadline(null);
      setQuizQuestions([]);
      setAnswers({});
      setQuizBusy(false);
      timerSubmitRef.current = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (session) await load(session);
      if (quiz.result_visibility === "immediate")
        setSelectedResult(await request("/rest/v1/rpc/get_my_quiz_result", token, "POST", { p_quiz_id: quiz.id }));
      flash(auto ? `Time ended. ${quiz.title} was submitted automatically.` : "Quiz submitted. Attendance is recorded.");
    } catch (e: any) {
      setQuizBusy(false);
      timerSubmitRef.current = false;
      setError(e.message);
    }
  }

  useEffect(() => {
    if (activeQuiz && remaining === 0 && !quizBusy && !timerSubmitRef.current) submitQuiz(true);
  }, [remaining, activeQuiz, quizBusy]);

  // openQuiz with state restoration
  async function openQuiz(z: Quiz) {
    setError("");
    try {
      const started = await request("/rest/v1/rpc/start_quiz", token, "POST", { p_quiz_id: z.id });
      const q = await request(
        route(
          "quiz_questions",
          `quiz_id=eq.${z.id}&select=position,question:questions!quiz_questions_question_id_fkey(id,stem,options,topic)&order=position.asc`
        ),
        token
      );
      const items = q.map((x: any) => x.question).filter(Boolean);
      if (!items.length) throw Error("This quiz has no available questions.");
      const end = Math.min(new Date(started.started_at).getTime() + z.duration_minutes * 60_000, new Date(z.closes_at).getTime());

      let restoredAnswers: Record<string, number> = {};
      if (started?.autosaved_answers && typeof started.autosaved_answers === "object") {
        restoredAnswers = started.autosaved_answers;
      } else {
        try {
          const prev = await request(
            route("quiz_attempts", `quiz_id=eq.${z.id}&student_id=eq.${profile?.id}&select=autosaved_answers`),
            token
          );
          if (prev?.[0]?.autosaved_answers) restoredAnswers = prev[0].autosaved_answers;
        } catch {}
      }
      if (!Object.keys(restoredAnswers).length) {
        try {
          const local = localStorage.getItem(`civicprep_answers_${z.id}`);
          if (local) restoredAnswers = JSON.parse(local);
        } catch {}
      }

      try {
        sessionStorage.setItem("civicprep_active_quiz_id", z.id);
      } catch {}

      setQuizQuestions(items);
      setActiveQuiz(z);
      setAnswers(restoredAnswers);
      timerSubmitRef.current = false;
      setDeadline(end);
      setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
      setSelectedResult(null);
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function showResult(z: Quiz) {
    try {
      const res = await request("/rest/v1/rpc/get_my_quiz_result", token, "POST", { p_quiz_id: z.id });
      setSelectedResult(res);
      setReviewFilter("all");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function publishResults(z: Quiz) {
    if (await change("/rest/v1/rpc/publish_quiz_results", { p_quiz_id: z.id })) {
      setQuizzes(old => old.map(q => (q.id === z.id ? { ...q, results_published: true } : q)));
      flash("Results published to students.");
    }
  }

  async function recalculateScores(z: Quiz) {
    setError("");
    try {
      const res = await request("/rest/v1/rpc/recalculate_quiz_scores", token, "POST", { p_quiz_id: z.id });
      flash(`Scores recalculated for ${res?.updated_submissions || 0} attempts.`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleHideQuiz(z: Quiz) {
    const nextState = !z.is_hidden;
    if (await change(route("quizzes", `id=eq.${z.id}`), { is_hidden: nextState }, "PATCH")) {
      setQuizzes(old => old.map(q => (q.id === z.id ? { ...q, is_hidden: nextState } : q)));
      flash(nextState ? `"${z.title}" is now hidden from students.` : `"${z.title}" is now visible.`);
    }
  }

  // Update 1: Safe Cascade Deletion without Foreign Key Constraint Failures
  async function deleteQuizRecord(z: Quiz) {
    if (!confirm(`Are you sure you want to delete "${z.title}"? This cannot be undone.`)) return;
    setError("");
    try {
      let deleted = false;
      try {
        await request("/rest/v1/rpc/delete_quiz_cascade", token, "POST", { p_quiz_id: z.id });
        deleted = true;
      } catch {
        // Fallback: Delete children explicitly in relational sequence before deleting the quiz
        await request(route("quiz_attempts", `quiz_id=eq.${z.id}`), token, "DELETE");
        await request(route("quiz_attempt_starts", `quiz_id=eq.${z.id}`), token, "DELETE");
        await request(route("quiz_questions", `quiz_id=eq.${z.id}`), token, "DELETE");
        await request(route("quizzes", `id=eq.${z.id}`), token, "DELETE");
        deleted = true;
      }
      if (deleted) {
        setQuizzes(old => old.filter(q => q.id !== z.id));
        flash(`Deleted "${z.title}".`);
      }
    } catch (e: any) {
      setError(e.message || "Failed to delete quiz.");
    }
  }

  // Update 2: Open and Save Upcoming Quiz Edits
  async function openEditQuiz(z: Quiz) {
    setError("");
    setMenuQuizId(null);
    try {
      const qRows = await request(
        route("quiz_questions", `quiz_id=eq.${z.id}&select=question_id,position&order=position.asc`),
        token
      );
      const questionIds = (qRows || []).map((r: any) => r.question_id);
      setEditingQuiz({
        id: z.id,
        title: z.title,
        kind: z.kind,
        opens_at: z.opens_at,
        closes_at: z.closes_at,
        duration_minutes: z.duration_minutes,
        result_visibility: z.result_visibility,
        question_ids: questionIds
      });
      setBuilderOpen(true);
    } catch (e: any) {
      setError(e.message || "Failed to load quiz details for editing.");
    }
  }

  async function updateQuiz(id: string, p: QuizPayload) {
    setError("");
    try {
      await request(route("quizzes", `id=eq.${id}`), token, "PATCH", {
        title: p.title,
        kind: p.kind,
        opens_at: new Date(p.opens).toISOString(),
        closes_at: new Date(p.closes).toISOString(),
        duration_minutes: p.duration,
        result_visibility: p.visibility
      });
      // Replace questions
      await request(route("quiz_questions", `quiz_id=eq.${id}`), token, "DELETE");
      if (p.ids.length > 0) {
        const rows = p.ids.map((qId, idx) => ({
          quiz_id: id,
          question_id: qId,
          position: idx + 1
        }));
        await request(route("quiz_questions"), token, "POST", rows, "return=minimal");
      }
      if (session) await load(session);
      flash("Quiz updated successfully.");
      setEditingQuiz(null);
      setBuilderOpen(false);
    } catch (e: any) {
      throw e;
    }
  }

  // Update 4: Start Upcoming Quiz Now
  async function startQuizNow(z: Quiz) {
    if (!confirm(`Start "${z.title}" right now? It will become live immediately for students.`)) return;
    setError("");
    try {
      const now = new Date();
      const opens_at = now.toISOString();
      const currentCloses = new Date(z.closes_at).getTime();
      const minCloses = now.getTime() + z.duration_minutes * 60_000;
      const closes_at = currentCloses < minCloses ? new Date(minCloses + 36e5).toISOString() : z.closes_at;

      await request(route("quizzes", `id=eq.${z.id}`), token, "PATCH", {
        opens_at,
        closes_at
      });
      setQuizzes(old => old.map(q => (q.id === z.id ? { ...q, opens_at, closes_at } : q)));
      flash(`"${z.title}" is now Live!`);
      if (session) await load(session);
    } catch (e: any) {
      setError(e.message || "Failed to start quiz now.");
    }
  }

  // Update 5: View Quiz Questions & Performance Item Analysis
  async function openQuizQuestionsAnalysis(z: Quiz) {
    setError("");
    setMenuQuizId(null);
    setQuestionsModalQuiz(z);
    setQuestionsModalLoading(true);
    setQuestionsModalData([]);
    setQuestionsModalAttempts(0);
    try {
      const qqRows = await request(
        route(
          "quiz_questions",
          `quiz_id=eq.${z.id}&select=position,question:questions(id,stem,topic,options,correct_index,explanation,source_url)&order=position.asc`
        ),
        token
      );
      const items = (qqRows || [])
        .map((r: any) => ({
          ...r.question,
          position: r.position
        }))
        .filter((q: any) => Boolean(q && q.id));

      const attemptsRows = await request(
        route("quiz_attempts", `quiz_id=eq.${z.id}&status=eq.submitted&select=answers`),
        token
      );

      const totalAttempts = (attemptsRows || []).length;
      setQuestionsModalAttempts(totalAttempts);

      const analyzed = items.map((q: any) => {
        let correct = 0;
        let wrong = 0;
        let skipped = 0;
        const optionPicks = [0, 0, 0, 0];

        (attemptsRows || []).forEach((att: any) => {
          const userAns = att.answers?.[q.id];
          if (userAns === undefined || userAns === null || userAns === "") {
            skipped++;
          } else {
            const idx = Number(userAns);
            if (idx >= 0 && idx < 4) {
              optionPicks[idx]++;
            }
            if (idx === q.correct_index) {
              correct++;
            } else {
              wrong++;
            }
          }
        });

        const correctPct = totalAttempts > 0 ? Math.round((correct / totalAttempts) * 100) : 0;
        const wrongPct = totalAttempts > 0 ? Math.round((wrong / totalAttempts) * 100) : 0;
        const skippedPct = totalAttempts > 0 ? Math.round((skipped / totalAttempts) * 100) : 0;

        return {
          ...q,
          correct,
          wrong,
          skipped,
          correctPct,
          wrongPct,
          skippedPct,
          optionPicks
        };
      });

      setQuestionsModalData(analyzed);
    } catch (e: any) {
      setError(e.message || "Failed to load question analysis.");
      setQuestionsModalQuiz(null);
    } finally {
      setQuestionsModalLoading(false);
    }
  }

  // Attendees Helpers
  async function openAttendees(z: Quiz) {
    setError("");
    try {
      const res = await request("/rest/v1/rpc/get_quiz_attendees_list", token, "POST", { p_quiz_id: z.id });
      setAttendeesData(res);
      setAttendanceQuiz(z.id);
      setAttendeeFilter("all");
      setAttendeeSearch("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  function copyWhatsAppAbsentees() {
    if (!attendeesData || !attendanceQuiz) return;
    const currentQuiz = quizzes.find(q => q.id === attendanceQuiz);
    const attendees: any[] = attendeesData.attendees || [];
    const notStarted = attendees.filter(a => a.status === "not_started");
    const inProgress = attendees.filter(a => a.status === "in_progress");

    let text = `📢 *CivicPrep Quiz Attendance Update*\n`;
    text += `*Quiz:* ${currentQuiz?.title || "Quiz"}\n`;
    text += `*Total Students:* ${attendeesData.total_students}\n`;
    text += `*Submitted:* ${attendeesData.submitted_count}\n\n`;

    if (notStarted.length > 0) {
      text += `⚠️ *Not Started (${notStarted.length}):*\n`;
      notStarted.forEach((s, idx) => {
        const enroll = s.enrollment_number ? ` (${s.enrollment_number})` : "";
        text += `${idx + 1}. ${s.full_name}${enroll}\n`;
      });
      text += `\n`;
    }

    if (inProgress.length > 0) {
      text += `⏳ *In Progress (${inProgress.length}):*\n`;
      inProgress.forEach((s, idx) => {
        const enroll = s.enrollment_number ? ` (${s.enrollment_number})` : "";
        text += `${idx + 1}. ${s.full_name}${enroll}\n`;
      });
      text += `\n`;
    }

    if (notStarted.length === 0 && inProgress.length === 0) {
      text += `🎉 *All students have completed the quiz!*\n`;
    } else {
      text += `Please complete the quiz before the closing time.`;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => flash("Absentee list copied for WhatsApp!"))
      .catch(() => setError("Failed to copy to clipboard."));
  }

  function downloadAttendeesCSV() {
    if (!attendeesData || !attendanceQuiz) return;
    const currentQuiz = quizzes.find(q => q.id === attendanceQuiz);
    const attendees: any[] = attendeesData.attendees || [];
    const mask = attendeesData.mask_scores;

    const headers = ["Full Name", "Enrollment Number", "Phone Number", "Status", "Started At", "Submitted At", "Time Taken (seconds)"];
    if (!mask) headers.push("Score", "Correct", "Wrong", "Skipped");

    const rows = attendees.map(a => {
      const baseCols = [
        `"${(a.full_name || "").replace(/"/g, '""')}"`,
        `"${(a.enrollment_number || "").replace(/"/g, '""')}"`,
        `"${(a.phone_number || "").replace(/"/g, '""')}"`,
        `"${a.status}"`,
        `"${a.started_at ? new Date(a.started_at).toLocaleString() : ""}"`,
        `"${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : ""}"`,
        a.time_taken_seconds || 0
      ];
      if (!mask) {
        baseCols.push(a.score ?? 0, a.correct_count ?? 0, a.wrong_count ?? 0, a.skipped_count ?? 0);
      }
      return baseCols.join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `attendees_${(currentQuiz?.title || "quiz").replace(/\s+/g, "_").toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // End Quiz Early Handlers
  async function triggerEndQuiz(z: Quiz) {
    setEndQuizTarget(z);
    setActiveStudentCount(null);
    try {
      const part = await request("/rest/v1/rpc/get_quiz_attendees_list", token, "POST", { p_quiz_id: z.id });
      setActiveStudentCount(part?.in_progress_count ?? 0);
    } catch {
      setActiveStudentCount(null);
    }
  }

  async function confirmEndQuiz() {
    if (!endQuizTarget) return;
    setEndQuizLoading(true);
    setError("");
    try {
      const res = await request("/rest/v1/rpc/end_quiz_early", token, "POST", { p_quiz_id: endQuizTarget.id });
      const endedId = endQuizTarget.id;
      setQuizzes(old => old.map(q => (q.id === endedId ? { ...q, ended_early_at: new Date().toISOString() } : q)));
      flash(
        `Quiz "${endQuizTarget.title}" ended. ${res?.auto_submitted_count ?? 0} active student attempt(s) were submitted automatically.`
      );
      setEndQuizTarget(null);
      if (session) await load(session);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEndQuizLoading(false);
    }
  }

  // Topic performance analytics for UPSC review
  const topicStats = useMemo(() => {
    if (!selectedResult?.questions) return [];
    const map: Record<string, { total: number; correct: number }> = {};
    selectedResult.questions.forEach((q: any) => {
      const t = q.topic || "General";
      if (!map[t]) map[t] = { total: 0, correct: 0 };
      map[t].total++;
      if (q.is_correct) map[t].correct++;
    });
    return Object.entries(map).map(([tName, stat]) => ({
      topic: tName,
      total: stat.total,
      correct: stat.correct,
      pct: Math.round((stat.correct / stat.total) * 100)
    }));
  }, [selectedResult]);

  async function setDutyStatus(duty: Duty, status: string, reason = "") {
    setError("");
    setDutyBusy(true);
    try {
      await request("/rest/v1/rpc/update_duty_status", token, "POST", {
        p_duty_id: duty.id,
        p_status: status,
        p_reason: reason || null
      });
      if (session) await load(session);
      flash(`Duty status updated: ${dutyStatuses[status] || status}.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDutyBusy(false);
    }
  }

  async function dutySave(p: { date: string; studentId: string; target: number; reason: string }) {
    setError("");
    setDutyBusy(true);
    try {
      let r: any;
      if (selectedDuty) {
        r = await request("/rest/v1/rpc/save_duty", token, "POST", {
          p_duty_id: selectedDuty.id,
          p_duty_date: p.date,
          p_student_id: p.studentId,
          p_target_count: p.target,
          p_reason: p.reason || null
        });
        setDutyDate(p.date);
      } else if (p.studentId === "auto") {
        r = await request("/rest/v1/rpc/assign_next_duty", token, "POST", { p_duty_date: dutyDate, p_target_count: p.target });
      } else {
        r = await request("/rest/v1/rpc/assign_duty_manually", token, "POST", {
          p_duty_date: dutyDate,
          p_student_id: p.studentId,
          p_target_count: p.target
        });
      }
      if (session) await load(session);
      flash(`${r?.[0]?.full_name || "Duty"} saved for ${selectedDuty ? p.date : dutyDate}.`);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setDutyBusy(false);
    }
  }

  async function dutyDelete(reason: string) {
    if (!selectedDuty) return false;
    setError("");
    setDutyBusy(true);
    try {
      await request("/rest/v1/rpc/delete_duty", token, "POST", { p_duty_id: selectedDuty.id, p_reason: reason || null });
      if (session) await load(session);
      flash(`Duty for ${dutyDate} deleted.`);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setDutyBusy(false);
    }
  }

  async function createQuiz(p: QuizPayload) {
    await request("/rest/v1/rpc/create_quiz_with_settings", token, "POST", {
      p_title: p.title,
      p_kind: p.kind,
      p_question_ids: p.ids,
      p_opens_at: new Date(p.opens).toISOString(),
      p_closes_at: new Date(p.closes).toISOString(),
      p_duration_minutes: p.duration,
      p_result_visibility: p.visibility
    });
    if (session) await load(session);
    flash("Quiz created and published.");
  }

  async function activateMember(p: Profile) {
    const role = roles[p.id] || p.requested_role || p.role;
    const enrollment = (enrollmentEdits[p.id] ?? p.enrollment_number ?? "").trim();
    await change("/rest/v1/rpc/activate_member", {
      p_profile_id: p.id,
      p_role: role,
      p_enrollment_number: ["student", "student_leader"].includes(role) ? enrollment : null
    });
  }

  if (loading) return <main className="center">Loading workspace…</main>;
  if (!session)
    return (
      <main className="center">
        <div className="auth">
          <span className="logo">
            <BookOpen />
          </span>
          <h1>{recoveryMode ? "Set or reset password" : signupMode ? "Create your account" : "CivicPrep"}</h1>
          <p>
            {recoveryMode
              ? "We will email you a fresh link to choose a password."
              : signupMode
              ? "Student and teacher accounts need super admin approval before they can enter."
              : "UPSC current affairs workspace"}
          </p>
          <form onSubmit={recoveryMode ? recover : signupMode ? signup : login}>
            {signupMode && (
              <>
                <label>
                  Full name
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                  />
                </label>
                <label>
                  I am a
                  <select value={signupRole} onChange={e => setSignupRole(e.target.value)}>
                    <option value="student">Student</option>
                    <option value="supervisor">Teacher</option>
                  </select>
                </label>
                {signupRole === "student" && (
                  <label>
                    Enrollment number
                    <input
                      required
                      maxLength={40}
                      value={signupEnrollment}
                      onChange={e => setSignupEnrollment(e.target.value)}
                      placeholder="Your college enrollment number"
                    />
                  </label>
                )}
              </>
            )}
            <label>
              Email
              <input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            </label>
            {!recoveryMode && (
              <label>
                Password
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete={signupMode ? "new-password" : "current-password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </label>
            )}
            <button className="primary">{recoveryMode ? "Send password link" : signupMode ? "Sign up" : "Sign in"}</button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          <button
            className="plain"
            onClick={() => {
              setRecoveryMode(!recoveryMode);
              setSignupMode(false);
              setError("");
            }}
          >
            {recoveryMode ? "Back to sign in" : "Forgot password?"}
          </button>
          {!recoveryMode && (
            <button
              className="plain"
              onClick={() => {
                setSignupMode(!signupMode);
                setError("");
              }}
            >
              {signupMode ? "Already have an account? Sign in" : "New student or teacher? Sign up"}
            </button>
          )}
        </div>
      </main>
    );

  if (!profile || !profile.active)
    return (
      <main className="center">
        <div className="auth">
          <h1>Approval pending</h1>
          <p>
            Your account was created and is waiting for super admin approval
            {profile?.requested_role ? ` as ${profile.requested_role === "supervisor" ? "teacher" : "student"}` : ""}. Once
            approved, sign in again to open the workspace.
          </p>
          {error && <p className="error">{error}</p>}
          <button className="primary" onClick={() => load(session).catch((e: any) => setError(e.message))}>
            Check approval
          </button>
          <button className="plain" onClick={logout}>
            Sign out
          </button>
        </div>
      </main>
    );

  if (passwordSetup)
    return (
      <main className="center">
        <div className="auth">
          <span className="logo">
            <BookOpen />
          </span>
          <h1>Set your password</h1>
          <p>Your email link is verified. Choose a password to finish joining.</p>
          <form
            onSubmit={async e => {
              e.preventDefault();
              setError("");
              try {
                await request("/auth/v1/user", token, "PUT", { password });
                setPassword("");
                setPasswordSetup(false);
                flash("Password set. Welcome to CivicPrep.");
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <label>
              New password
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </label>
            <button className="primary">Save password</button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      </main>
    );

  return (
    <main className="shell">
      <aside className="side">
        <div className="brand">
          <span className="logo">
            <BookOpen />
          </span>
          <span>
            <strong>CivicPrep</strong>
            <small>Current affairs hub</small>
          </span>
        </div>
        <nav>
          {links.map(x => {
            const Icon = navIcons[x];
            return (
              <button
                key={x}
                className={view === x ? "active" : ""}
                onClick={() => {
                  setView(x);
                  setActiveQuiz(null);
                  setSelectedResult(null);
                }}
              >
                <span className="nav-icon">
                  <Icon size={18} />
                </span>
                {x}
                {x === "Review queue" && pending.length > 0 && <b>{pending.length}</b>}
                {x === "Quizzes" && liveUnsubmitted > 0 && <b className="live-count">{liveUnsubmitted}</b>}
              </button>
            );
          })}
        </nav>
        <div className="identity">
          <strong>
            {profile.full_name}
            {profile.enrollment_number ? ` · ${profile.enrollment_number}` : ""}
          </strong>
          <small>{labels[profile.role]}</small>
          <button onClick={logout}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header>
          <div>
            <span className="eyebrow">UPSC FOUNDATION · LIVE WORKSPACE</span>
            <h1>{view}</h1>
          </div>
          <div className="header-tools">
            {refreshing && (
              <span className="muted">
                <RefreshCw size={14} /> Updating
              </span>
            )}
            <button className="pill">{labels[profile.role]}</button>
          </div>
        </header>

        <div className="toasts">
          {error && (
            <div className="toast toast-error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="toast toast-success" role="status">
              <span>{notice}</span>
              <button aria-label="Dismiss" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
        </div>

        {view === "Overview" && (
          <>
            <div className="intro">
              <h2>Welcome, {profile.full_name.split(" ")[0]}</h2>
              <p>
                {profile.role === "super_admin"
                  ? "Create and activate accounts, oversee question review, and manage quizzes."
                  : profile.role === "supervisor"
                  ? "Review and revise questions, monitor duty progress, and publish class quiz results."
                  : profile.role === "student_leader"
                  ? "Do your own question duty like every student, and help run the rotation: assign, swap and edit duties."
                  : "Confirm your assigned duty, submit your questions, and complete live class quizzes."}
              </p>
            </div>
            <div className="stats">
              <article>
                <span>Approved questions</span>
                <strong>{approved.length}</strong>
                <small>Available for study</small>
              </article>
              <article>
                <span>My contributions</span>
                <strong>{questions.filter(q => q.author_id === profile.id).length}</strong>
                <small>All statuses</small>
              </article>
              <article>
                <span>{review ? "Needs review" : "Live quizzes"}</span>
                <strong>{review ? pending.length : liveUnsubmitted}</strong>
                <small>{review ? "Submitted questions" : "Open now, not yet taken"}</small>
              </article>
              <article>
                <span>My next duty</span>
                <strong>{duties.find(d => d.student_id === profile.id && d.duty_date >= today)?.duty_date || "None"}</strong>
                <small>Five questions per day</small>
              </article>
            </div>
            <div className="columns">
              <section className="card">
                <h3>Recent questions</h3>
                {questions.slice(0, 5).map(q => (
                  <div className="row" key={q.id}>
                    <div>
                      <strong>{q.stem}</strong>
                      <small>
                        {q.topic} · {memberName(q.author_id, q.author?.full_name || "Contributor")}
                      </small>
                    </div>
                    <span className={`tag ${q.status}`}>{q.status.replace("_", " ")}</span>
                  </div>
                ))}
                {!questions.length && <Empty text="No questions yet. Add the first one in the question bank." />}
              </section>
              <section className="card">
                <h3>Upcoming duties</h3>
                {duties
                  .filter(d => d.duty_date >= today)
                  .slice(0, 5)
                  .map(d => (
                    <div className="row" key={d.id}>
                      <div>
                        <strong>{memberName(d.student_id, d.student?.full_name || "Student")}</strong>
                        <small>{d.duty_date}</small>
                      </div>
                      <span>{d.target_count} questions</span>
                    </div>
                  ))}
                {!duties.some(d => d.duty_date >= today) && <Empty text="No upcoming duties assigned." />}
              </section>
            </div>
          </>
        )}

        {view === "Question bank" && (
          <>
            <div className="section-title">
              <p>Review your submissions and study approved questions. Sources and explanations are optional.</p>
              <button className="primary" onClick={() => openQuestion()}>
                <Plus size={16} /> Add question
              </button>
            </div>
            <section className="card">
              <h3>Questions · {questions.length}</h3>
              {questions.map(q => {
                const canEdit = review || (q.author_id === profile.id && ["pending", "revision_requested"].includes(q.status));
                return (
                  <details className="question" key={q.id}>
                    <summary>
                      <div>
                        <strong>{q.stem}</strong>
                        <small>
                          {q.topic}
                          {q.is_special ? " · Special" : ""} · {memberName(q.author_id, q.author?.full_name || "Contributor")} ·{" "}
                          {new Date(q.created_at).toLocaleDateString()}
                        </small>
                      </div>
                      <span className={`tag ${q.status}`}>{q.status.replace("_", " ")}</span>
                    </summary>
                    <ol type="A">
                      {q.options.map((o, i) => (
                        <li key={i}>
                          {o}
                          {q.status === "approved" && i === q.correct_index ? " ✓" : ""}
                        </li>
                      ))}
                    </ol>
                    {q.status === "approved" && q.explanation && <p><b>Explanation:</b> {q.explanation}</p>}
                    <Source value={q.source_url} />
                    {canEdit && (
                      <div className="actions">
                        <button className="outline" onClick={() => openQuestion(q)}>
                          Edit question
                        </button>
                        {review && (
                          <button
                            className="danger-outline"
                            onClick={async () => {
                              if (confirm("Delete this question and remove it from quiz question lists?"))
                                await change(route("questions", `id=eq.${q.id}`), null, "DELETE");
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </details>
                );
              })}
              {!questions.length && <Empty text="The question bank is empty." />}
            </section>
          </>
        )}

        {view === "Review queue" && review && (
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
                  {q.topic} · {memberName(q.author_id, q.author?.full_name || "Contributor")} · {q.status.replace("_", " ")}
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
                  <button className="primary" onClick={() => change(route("questions", `id=eq.${q.id}`), { status: "approved" }, "PATCH")}>
                    Approve
                  </button>
                  <button className="outline" onClick={() => change(route("questions", `id=eq.${q.id}`), { status: "revision_requested" }, "PATCH")}>
                    Request correction
                  </button>
                  <button className="outline" onClick={() => openQuestion(q)}>
                    Edit
                  </button>
                  <button
                    className="danger-outline"
                    onClick={async () => {
                      if (confirm("Delete this question?")) await change(route("questions", `id=eq.${q.id}`), null, "DELETE");
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!pending.length && <Empty text="Nothing is waiting for review." />}
          </section>
        )}

        {view === "Duty calendar" && (
          <DutyCalendar
            profile={profile}
            duties={duties}
            people={people}
            availability={dutyAvailability}
            progress={dutyProgress[0]}
            dutyDate={dutyDate}
            today={today}
            manage={manage}
            review={review}
            busy={dutyBusy}
            memberName={memberName}
            onSelectDate={setDutyDate}
            onSave={dutySave}
            onDelete={dutyDelete}
            onStatus={setDutyStatus}
            onAddQuestions={() => openQuestion()}
            goReview={() => setView("Review queue")}
            api={(path, method, body, prefer) => request(path, token, method, body, prefer)}
            flash={flash}
            fail={setError}
            refresh={async () => {
              if (session) await load(session);
            }}
          />
        )}

        {view === "Quizzes" && (
          <>
            {review && (
              <div className="section-title">
                <p>Create timed quizzes from approved questions.</p>
                <button
                  className="primary"
                  onClick={() => {
                    setEditingQuiz(null);
                    setBuilderOpen(true);
                  }}
                >
                  <Plus size={16} /> Create quiz
                </button>
              </div>
            )}
            {builderOpen && review && (
              <QuizBuilder
                questions={approved}
                memberName={memberName}
                onCreate={createQuiz}
                onUpdate={updateQuiz}
                onClose={() => {
                  setBuilderOpen(false);
                  setEditingQuiz(null);
                }}
                editingQuiz={editingQuiz}
              />
            )}

            {/* Filter Chips */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
              {[
                { id: "all", label: "All" },
                { id: "live", label: "Live" },
                { id: "upcoming", label: "Upcoming" },
                { id: "closed", label: "Closed" }
              ].map(tab => {
                const count = quizzes.filter(q => {
                  if (q.is_hidden && !review) return false;
                  const o = new Date(q.opens_at).getTime(),
                    e = new Date(q.closes_at).getTime();
                  const isEnd = q.ended_early_at || clock > e;
                  const isLive = clock >= o && clock <= e && !q.ended_early_at;
                  const isUp = clock < o;
                  if (tab.id === "live") return isLive;
                  if (tab.id === "upcoming") return isUp;
                  if (tab.id === "closed") return isEnd;
                  return true;
                }).length;
                return (
                  <button
                    key={tab.id}
                    className={quizFilter === tab.id ? "primary" : "outline"}
                    style={{ padding: "6px 14px", borderRadius: "20px", fontSize: "13px" }}
                    onClick={() => setQuizFilter(tab.id as any)}
                  >
                    {tab.label} <b style={{ marginLeft: "4px", opacity: 0.8 }}>{count}</b>
                  </button>
                );
              })}
            </div>

            {/* Quiz Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {quizzes
                .filter(z => {
                  if (z.is_hidden && !review) return false;
                  const o = new Date(z.opens_at).getTime(),
                    e = new Date(z.closes_at).getTime();
                  const isEnd = z.ended_early_at || clock > e;
                  const isLive = clock >= o && clock <= e && !z.ended_early_at;
                  const isUp = clock < o;
                  if (quizFilter === "live") return isLive;
                  if (quizFilter === "upcoming") return isUp;
                  if (quizFilter === "closed") return isEnd;
                  return true;
                })
                .map(z => {
                  const attempt = myAttempts.get(z.id);
                  const o = new Date(z.opens_at).getTime(),
                    e = new Date(z.closes_at).getTime();
                  const isEndedEarly = Boolean(z.ended_early_at);
                  const isLive = clock >= o && clock <= e && !isEndedEarly;
                  const isUpcoming = clock < o;
                  const isClosed = clock > e || isEndedEarly;
                  const isHidden = Boolean(z.is_hidden);

                  const statusTag = isHidden
                    ? { label: "Hidden", cls: "danger" }
                    : isLive
                    ? { label: "Live", cls: "approved" }
                    : isUpcoming
                    ? { label: "Upcoming", cls: "pending" }
                    : { label: isEndedEarly ? "Ended early" : "Closed", cls: "revision_requested" };

                  const isStudent = profile.role === "student";
                  const isLeader = profile.role === "student_leader";
                  const isTeacher = profile.role === "supervisor";
                  const isAdmin = profile.role === "super_admin";

                  const hasDraft = !attempt && typeof window !== "undefined" && Boolean(localStorage.getItem(`civicprep_answers_${z.id}`));
                  const hoursUntil = Math.max(1, Math.ceil((o - clock) / 36e5));

                  // What actions are available
                  const canPublish = review && z.result_visibility === "after_release" && !z.results_published;
                  const canViewAttendees = isTeacher || isAdmin || isLeader;
                  const canViewQuestions = review;
                  const canReviewAnswers =
                    (isStudent || isLeader) &&
                    isClosed &&
                    attempt &&
                    (z.result_visibility === "immediate" || z.results_published);
                  const canStartNow = (isTeacher || isAdmin) && isUpcoming;
                  const canEditQuiz = (isTeacher || isAdmin) && isUpcoming;
                  const canEndEarly = (isTeacher || isAdmin) && isLive;
                  const canRecalculate = isAdmin;
                  const canToggleHide = isAdmin;
                  const canDelete = isAdmin || (isTeacher && isUpcoming);

                  // Kebab menu visibility rules:
                  // 1. Regular students: ONLY visible on Closed quizzes when they can review answers (hidden on Live & Upcoming)
                  // 2. Teachers / Admins / Leaders: always visible (e.g. Attendees, Edit, End early)
                  const hasDropdownActions = isStudent
                    ? (isClosed && canReviewAnswers)
                    : (canViewAttendees ||
                       canViewQuestions ||
                       canPublish ||
                       canStartNow ||
                       canEditQuiz ||
                       canEndEarly ||
                       canRecalculate ||
                       canToggleHide ||
                       canDelete);

                  return (
                    <section
                      key={z.id}
                      className="card"
                      style={{
                        margin: 0,
                        padding: "14px 18px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "10px",
                        borderLeft: isLive ? "4px solid #10b981" : isUpcoming ? "4px solid #f59e0b" : "4px solid #94a3b8"
                      }}
                    >
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                          <strong style={{ fontSize: "16px" }}>{z.title}</strong>
                          <span className={`tag ${statusTag.cls}`}>{statusTag.label}</span>
                          {isHidden && <span className="tag pending">Admin only</span>}
                        </div>
                        <div style={{ fontSize: "13px", color: "var(--muted-fg,#64748b)", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <span>{z.kind}</span>
                          <span>•</span>
                          <span>{z.duration_minutes} mins</span>
                          <span>•</span>
                          <span>
                            {new Date(z.opens_at).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            })}{" "}
                            – {new Date(z.closes_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span>•</span>
                          <span>Results {z.result_visibility === "immediate" ? "immediate" : "after release"}</span>
                        </div>
                        {attempt && (
                          <small className="attended" style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px" }}>
                            <CheckCircle2 size={14} /> Attended • Submitted{" "}
                            {new Date(attempt.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </small>
                        )}
                      </div>

                      {/* Action Area: Pinned to the far right on both desktop and mobile */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          position: "relative",
                          marginLeft: "auto",
                          justifyContent: "flex-end",
                          flexShrink: 0
                        }}
                      >
                        {/* Student Primary Card Button (Start/Resume on live, countdown on upcoming) */}
                        {(isStudent || isLeader) &&
                          (attempt ? (
                            z.result_visibility === "after_release" && !z.results_published ? (
                              <span className="tag pending">Results pending</span>
                            ) : isLive ? (
                              <button className="outline" onClick={() => showResult(z)}>
                                Review answers
                              </button>
                            ) : null /* On closed quizzes, review is inside kebab menu */
                          ) : isLive ? (
                            <button className="primary" onClick={() => openQuiz(z)}>
                              {hasDraft ? "Resume quiz" : "Start quiz"}
                            </button>
                          ) : isUpcoming ? (
                            <button className="outline" disabled>
                              {hoursUntil <= 24
                                ? `Opens in ${hoursUntil}h`
                                : `Opens ${new Date(z.opens_at).toLocaleDateString([], { month: "short", day: "numeric" })}`}
                            </button>
                          ) : (
                            <button className="outline" disabled>
                              Closed
                            </button>
                          ))}

                        {/* Kebab [ ⋮ ] Menu */}
                        {hasDropdownActions && (
                          <div style={{ position: "relative" }}>
                            <button
                              className="outline"
                              style={{
                                padding: "8px",
                                borderRadius: "6px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center"
                              }}
                              aria-label="More quiz actions"
                              onClick={e => {
                                e.stopPropagation();
                                setMenuQuizId(menuQuizId === z.id ? null : z.id);
                              }}
                            >
                              <MoreVertical size={16} />
                            </button>

                            {/* Dropdown Popup */}
                            {menuQuizId === z.id && (
                              <div
                                style={{
                                  position: "absolute",
                                  right: 0,
                                  top: "calc(100% + 4px)",
                                  background: "var(--surface,#ffffff)",
                                  border: "1px solid var(--border,#e2e8f0)",
                                  borderRadius: "8px",
                                  boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                                  minWidth: "190px",
                                  zIndex: 60,
                                  overflow: "hidden",
                                  display: "flex",
                                  flexDirection: "column"
                                }}
                                onClick={e => e.stopPropagation()}
                              >
                                {/* Attendees action inside kebab menu for Teacher, Admin, and Leader */}
                                {canViewAttendees && (
                                  <button
                                    className="plain"
                                    style={{
                                      textAlign: "left",
                                      padding: "10px 14px",
                                      fontSize: "13px",
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px"
                                    }}
                                    onClick={() => {
                                      setMenuQuizId(null);
                                      openAttendees(z);
                                    }}
                                  >
                                    <Users size={15} /> Attendees
                                  </button>
                                )}

                                {/* Review answers in kebab menu on closed quizzes for students/leaders */}
                                {canReviewAnswers && (
                                  <button
                                    className="plain"
                                    style={{
                                      textAlign: "left",
                                      padding: "10px 14px",
                                      fontSize: "13px",
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px"
                                    }}
                                    onClick={() => {
                                      setMenuQuizId(null);
                                      showResult(z);
                                    }}
                                  >
                                    <Eye size={15} /> Review answers
                                  </button>
                                )}

                                {/* View questions for Teachers and Admins */}
                                {canViewQuestions && (
                                  <button
                                    className="plain"
                                    style={{
                                      textAlign: "left",
                                      padding: "10px 14px",
                                      fontSize: "13px",
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px"
                                    }}
                                    onClick={() => openQuizQuestionsAnalysis(z)}
                                  >
                                    <Eye size={15} /> View questions
                                  </button>
                                )}

                                {/* Start upcoming quiz now */}
                                {canStartNow && (
                                  <button
                                    className="plain"
                                    style={{
                                      textAlign: "left",
                                      padding: "10px 14px",
                                      fontSize: "13px",
                                      width: "100%",
                                      color: "#10b981",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px"
                                    }}
                                    onClick={() => {
                                      setMenuQuizId(null);
                                      startQuizNow(z);
                                    }}
                                  >
                                    <Play size={15} /> Start now
                                  </button>
                                )}

                                {/* Edit upcoming quiz */}
                                {canEditQuiz && (
                                  <button
                                    className="plain"
                                    style={{
                                      textAlign: "left",
                                      padding: "10px 14px",
                                      fontSize: "13px",
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px"
                                    }}
                                    onClick={() => openEditQuiz(z)}
                                  >
                                    <Edit size={15} /> Edit quiz
                                  </button>
                                )}

                                {canPublish && (
                                  <button
                                    className="plain"
                                    style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%" }}
                                    onClick={() => {
                                      setMenuQuizId(null);
                                      publishResults(z);
                                    }}
                                  >
                                    Publish results
                                  </button>
                                )}

                                {canEndEarly && (
                                  <button
                                    className="plain"
                                    style={{
                                      textAlign: "left",
                                      padding: "10px 14px",
                                      fontSize: "13px",
                                      width: "100%",
                                      color: "#ef4444"
                                    }}
                                    onClick={() => {
                                      setMenuQuizId(null);
                                      triggerEndQuiz(z);
                                    }}
                                  >
                                    End quiz early
                                  </button>
                                )}

                                {canRecalculate && (
                                  <button
                                    className="plain"
                                    style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%" }}
                                    onClick={() => {
                                      setMenuQuizId(null);
                                      recalculateScores(z);
                                    }}
                                  >
                                    Recalculate scores
                                  </button>
                                )}

                                {canToggleHide && (
                                  <button
                                    className="plain"
                                    style={{ textAlign: "left", padding: "10px 14px", fontSize: "13px", width: "100%" }}
                                    onClick={() => {
                                      setMenuQuizId(null);
                                      toggleHideQuiz(z);
                                    }}
                                  >
                                    {isHidden ? "Show to students" : "Hide from students"}
                                  </button>
                                )}

                                {canDelete && (
                                  <button
                                    className="plain"
                                    style={{
                                      textAlign: "left",
                                      padding: "10px 14px",
                                      fontSize: "13px",
                                      width: "100%",
                                      color: "#ef4444"
                                    }}
                                    onClick={() => {
                                      setMenuQuizId(null);
                                      deleteQuizRecord(z);
                                    }}
                                  >
                                    Delete quiz
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              {!quizzes.length && <Empty text="No quizzes have been published." />}
            </div>
              {!quizzes.length && <Empty text="No quizzes have been published." />}
            </div>

            {/* Attendees Modal */}
            {attendeesData && attendanceQuiz && manage && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget) {
                    setAttendeesData(null);
                    setAttendanceQuiz(null);
                  }
                }}
              >
                <section
                  className="modal form-card"
                  role="dialog"
                  aria-modal="true"
                  style={{ maxWidth: "780px", width: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
                >
                  <div className="modal-head">
                    <div>
                      <span className="eyebrow">ATTENDEE METRICS & PARTICIPATION</span>
                      <h2>{quizzes.find(q => q.id === attendanceQuiz)?.title || "Quiz Attendees"}</h2>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Close"
                      onClick={() => {
                        setAttendeesData(null);
                        setAttendanceQuiz(null);
                      }}
                    >
                      <X />
                    </button>
                  </div>

                  <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Total Students</span>
                        <strong style={{ fontSize: "20px", display: "block" }}>{attendeesData.total_students}</strong>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Submitted</span>
                        <strong style={{ fontSize: "20px", display: "block", color: "#10b981" }}>{attendeesData.submitted_count}</strong>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>In Progress</span>
                        <strong style={{ fontSize: "20px", display: "block", color: "#f59e0b" }}>{attendeesData.in_progress_count}</strong>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Not Started</span>
                        <strong style={{ fontSize: "20px", display: "block", color: "#ef4444" }}>{attendeesData.not_started_count}</strong>
                      </article>
                      {!attendeesData.mask_scores && (
                        <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                          <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Avg Score</span>
                          <strong style={{ fontSize: "20px", display: "block" }}>{attendeesData.average_score ?? 0}</strong>
                        </article>
                      )}
                    </div>

                    <div style={{ width: "100%", background: "var(--muted-bg,#e2e8f0)", borderRadius: "8px", height: "10px", overflow: "hidden", display: "flex" }}>
                      <div
                        style={{
                          width: `${attendeesData.total_students ? (attendeesData.submitted_count / attendeesData.total_students) * 100 : 0}%`,
                          background: "#10b981",
                          transition: "width 0.3s"
                        }}
                        title="Submitted"
                      />
                      <div
                        style={{
                          width: `${attendeesData.total_students ? (attendeesData.in_progress_count / attendeesData.total_students) * 100 : 0}%`,
                          background: "#f59e0b",
                          transition: "width 0.3s"
                        }}
                        title="In Progress"
                      />
                    </div>

                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
                        <Search size={15} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
                        <input
                          type="search"
                          placeholder="Search by student name or roll..."
                          value={attendeeSearch}
                          onChange={e => setAttendeeSearch(e.target.value)}
                          style={{ paddingLeft: "32px", width: "100%" }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button className="outline" onClick={copyWhatsAppAbsentees} title="Copy absent and in-progress students for WhatsApp">
                          <Copy size={15} /> WhatsApp Absentees
                        </button>
                        <button className="outline" onClick={downloadAttendeesCSV} title="Download CSV Report">
                          <Download size={15} /> Export CSV
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {[
                        { id: "all", label: "All", count: attendeesData.total_students },
                        { id: "submitted", label: "Submitted", count: attendeesData.submitted_count },
                        { id: "in_progress", label: "In Progress", count: attendeesData.in_progress_count },
                        { id: "not_started", label: "Not Started", count: attendeesData.not_started_count }
                      ].map(f => (
                        <button
                          key={f.id}
                          className={attendeeFilter === f.id ? "primary" : "outline"}
                          style={{ padding: "4px 12px", borderRadius: "16px", fontSize: "12px" }}
                          onClick={() => setAttendeeFilter(f.id as any)}
                        >
                          {f.label} ({f.count})
                        </button>
                      ))}
                    </div>

                    <div style={{ border: "1px solid var(--border,#e2e8f0)", borderRadius: "8px", overflow: "hidden", maxHeight: "340px", overflowY: "auto" }}>
                      {(attendeesData.attendees || [])
                        .filter((a: any) => {
                          if (attendeeFilter !== "all" && a.status !== attendeeFilter) return false;
                          if (!attendeeSearch.trim()) return true;
                          const q = attendeeSearch.toLowerCase();
                          return (a.full_name || "").toLowerCase().includes(q) || (a.enrollment_number || "").toLowerCase().includes(q);
                        })
                        .map((a: any) => (
                          <div
                            key={a.student_id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "10px 14px",
                              borderBottom: "1px solid var(--border,#e2e8f0)",
                              fontSize: "13px"
                            }}
                          >
                            <div>
                              <strong>{a.full_name}</strong>
                              <div style={{ color: "var(--muted-fg,#64748b)", fontSize: "12px", display: "flex", gap: "8px", marginTop: "2px" }}>
                                {a.enrollment_number && <span>Roll: {a.enrollment_number}</span>}
                                {a.time_taken_seconds > 0 && (
                                  <span>
                                    • {Math.floor(a.time_taken_seconds / 60)}m {a.time_taken_seconds % 60}s
                                  </span>
                                )}
                                {a.submitted_at && (
                                  <span>• {new Date(a.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              {!attendeesData.mask_scores && a.status === "submitted" && (
                                <strong style={{ fontSize: "14px" }}>{a.score} pts</strong>
                              )}
                              <span
                                className={`tag ${
                                  a.status === "submitted" ? "approved" : a.status === "in_progress" ? "pending" : "revision_requested"
                                }`}
                              >
                                {a.status === "submitted" ? "Submitted" : a.status === "in_progress" ? "In Progress" : "Not Started"}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* End Quiz Early Confirm Dialog */}
            {endQuizTarget && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget && !endQuizLoading) setEndQuizTarget(null);
                }}
              >
                <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "480px" }}>
                  <div className="modal-head">
                    <div>
                      <span className="eyebrow" style={{ color: "#ef4444" }}>
                        WARNING · EARLY CLOSURE
                      </span>
                      <h2>End Quiz Early?</h2>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={() => setEndQuizTarget(null)} disabled={endQuizLoading}>
                      <X />
                    </button>
                  </div>
                  <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <p style={{ margin: 0, fontSize: "14px" }}>
                      Are you sure you want to end <strong>{endQuizTarget.title}</strong> right now?
                    </p>
                    <div className="card" style={{ padding: "12px", background: "#fef2f2", border: "1px solid #fee2e2", margin: 0 }}>
                      <p style={{ margin: 0, fontSize: "13px", color: "#991b1b", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                        <AlertCircle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
                        <span>
                          {activeStudentCount !== null
                            ? `There are currently ${activeStudentCount} student(s) actively taking this quiz.`
                            : "Students actively taking this quiz"}
                          {" "}Their autosaved answers will be submitted immediately, and no further attempts will be accepted.
                        </span>
                      </p>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                      <button className="outline" onClick={() => setEndQuizTarget(null)} disabled={endQuizLoading}>
                        Cancel
                      </button>
                      <button
                        className="danger-outline"
                        style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
                        onClick={confirmEndQuiz}
                        disabled={endQuizLoading}
                      >
                        {endQuizLoading ? "Ending quiz…" : "End quiz immediately"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* Update 5: Questions & Performance Item Analysis Modal */}
            {questionsModalQuiz && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget) {
                    setQuestionsModalQuiz(null);
                    setQuestionsModalData([]);
                  }
                }}
              >
                <section
                  className="modal form-card"
                  role="dialog"
                  aria-modal="true"
                  style={{ maxWidth: "860px", width: "96%", maxHeight: "92vh", display: "flex", flexDirection: "column" }}
                >
                  <div className="modal-head">
                    <div>
                      <span className="eyebrow">QUESTION BREAKDOWN & ITEM ANALYSIS</span>
                      <h2>{questionsModalQuiz.title}</h2>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Close"
                      onClick={() => {
                        setQuestionsModalQuiz(null);
                        setQuestionsModalData([]);
                      }}
                    >
                      <X />
                    </button>
                  </div>

                  <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                    {questionsModalLoading ? (
                      <div className="empty">Loading question analysis…</div>
                    ) : (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
                          <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                            <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Total Questions</span>
                            <strong style={{ fontSize: "20px", display: "block" }}>{questionsModalData.length}</strong>
                          </article>
                          <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                            <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Students Submitted</span>
                            <strong style={{ fontSize: "20px", display: "block", color: "#10b981" }}>{questionsModalAttempts}</strong>
                          </article>
                          <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                            <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Overall Accuracy</span>
                            <strong style={{ fontSize: "20px", display: "block", color: "#3b82f6" }}>
                              {questionsModalAttempts > 0 && questionsModalData.length > 0
                                ? Math.round(
                                    (questionsModalData.reduce((acc, q) => acc + q.correct, 0) /
                                      (questionsModalAttempts * questionsModalData.length)) *
                                      100
                                  ) + "%"
                                : "N/A"}
                            </strong>
                          </article>
                        </div>

                        {questionsModalAttempts === 0 && (
                          <div className="card" style={{ padding: "12px", background: "#f8fafc", margin: 0 }}>
                            <small style={{ color: "var(--muted-fg,#64748b)" }}>
                              No students have submitted attempts for this quiz yet. Showing questions and answer key below.
                            </small>
                          </div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {questionsModalData.map((q: any, i: number) => (
                            <article
                              key={q.id || i}
                              className="card"
                              style={{ padding: "16px", margin: 0, borderLeft: "4px solid var(--accent, #3b82f6)" }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                                <div>
                                  <span className="eyebrow" style={{ fontSize: "11px" }}>
                                    QUESTION {i + 1} · {q.topic}
                                  </span>
                                  <h4 style={{ margin: "4px 0 0 0", fontSize: "15px", fontWeight: 600 }}>{q.stem}</h4>
                                </div>
                                {questionsModalAttempts > 0 && (
                                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                    <span className="tag approved" title="Correct">
                                      {q.correct} correct ({q.correctPct}%)
                                    </span>
                                    <span className="tag revision_requested" title="Wrong">
                                      {q.wrong} wrong ({q.wrongPct}%)
                                    </span>
                                    {q.skipped > 0 && (
                                      <span className="tag pending" title="Skipped">
                                        {q.skipped} skipped
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                              {questionsModalAttempts > 0 && (
                                <div style={{ width: "100%", height: "6px", background: "#fee2e2", borderRadius: "3px", overflow: "hidden", margin: "8px 0 12px 0", display: "flex" }}>
                                  <div
                                    style={{ width: `${q.correctPct}%`, background: "#10b981", transition: "width 0.3s" }}
                                    title={`Correct: ${q.correctPct}%`}
                                  />
                                  <div
                                    style={{ width: `${q.skippedPct}%`, background: "#94a3b8", transition: "width 0.3s" }}
                                    title={`Skipped: ${q.skippedPct}%`}
                                  />
                                </div>
                              )}

                              <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "10px 0" }}>
                                {(q.options || []).map((opt: string, optIdx: number) => {
                                  const isCorrect = optIdx === q.correct_index;
                                  const pickCount = q.optionPicks ? q.optionPicks[optIdx] : 0;
                                  const pickPct = questionsModalAttempts > 0 ? Math.round((pickCount / questionsModalAttempts) * 100) : 0;

                                  return (
                                    <div
                                      key={optIdx}
                                      style={{
                                        padding: "8px 12px",
                                        borderRadius: "6px",
                                        fontSize: "13px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        border: isCorrect ? "1px solid #10b981" : "1px solid var(--border,#e2e8f0)",
                                        background: isCorrect ? "#f0fdf4" : "transparent"
                                      }}
                                    >
                                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <b>{"ABCD"[optIdx]}.</b>
                                        <span>{opt}</span>
                                        {isCorrect && (
                                          <span style={{ color: "#10b981", fontWeight: 600, fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                            <CheckCircle size={13} /> Correct Answer
                                          </span>
                                        )}
                                      </span>
                                      {questionsModalAttempts > 0 && (
                                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)", fontWeight: 500 }}>
                                          {pickCount} students ({pickPct}%)
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {q.explanation && (
                                <p style={{ fontSize: "12px", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px", margin: "6px 0" }}>
                                  <b>Explanation:</b> {q.explanation}
                                </p>
                              )}
                              <Source value={q.source_url} />
                            </article>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* Student Review Modal */}
            {selectedResult && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget) setSelectedResult(null);
                }}
              >
                <section
                  className="modal form-card"
                  role="dialog"
                  aria-modal="true"
                  style={{ maxWidth: "860px", width: "96%", maxHeight: "94vh", display: "flex", flexDirection: "column" }}
                >
                  <div className="modal-head">
                    <div>
                      <span className="eyebrow">UPSC PERFORMANCE & ANSWER REVIEW</span>
                      <h2>{selectedResult.title}</h2>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={() => setSelectedResult(null)}>
                      <X />
                    </button>
                  </div>

                  <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center", background: "#f8fafc" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Final Score</span>
                        <strong style={{ fontSize: "22px", display: "block" }}>
                          {selectedResult.score} / {selectedResult.total}
                        </strong>
                        <small style={{ color: "#10b981", fontWeight: 600 }}>
                          {Math.round((selectedResult.score / (selectedResult.total || 1)) * 100)}% Accuracy
                        </small>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Correct</span>
                        <strong style={{ fontSize: "22px", display: "block", color: "#10b981" }}>
                          {selectedResult.questions.filter((q: any) => q.is_correct).length}
                        </strong>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Wrong</span>
                        <strong style={{ fontSize: "22px", display: "block", color: "#ef4444" }}>
                          {selectedResult.questions.filter((q: any) => !q.is_correct && q.selected_index !== null && q.selected_index !== undefined).length}
                        </strong>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Skipped</span>
                        <strong style={{ fontSize: "22px", display: "block", color: "#64748b" }}>
                          {selectedResult.questions.filter((q: any) => q.selected_index === null || q.selected_index === undefined).length}
                        </strong>
                      </article>
                    </div>

                    {topicStats.length > 0 && (
                      <div className="card" style={{ padding: "14px", margin: 0, background: "var(--surface,#fff)" }}>
                        <strong style={{ fontSize: "13px", display: "block", marginBottom: "8px" }}>Topic-Wise Accuracy (UPSC Revision)</strong>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                          {topicStats.map(stat => (
                            <div key={stat.topic} style={{ fontSize: "12px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                                <span>{stat.topic}</span>
                                <b>
                                  {stat.correct}/{stat.total} ({stat.pct}%)
                                </b>
                              </div>
                              <div style={{ height: "6px", width: "100%", background: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                                <div
                                  style={{
                                    height: "100%",
                                    width: `${stat.pct}%`,
                                    background: stat.pct >= 70 ? "#10b981" : stat.pct >= 40 ? "#f59e0b" : "#ef4444"
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      {[
                        { id: "all", label: "All Questions", count: selectedResult.questions.length },
                        {
                          id: "correct",
                          label: "Correct",
                          count: selectedResult.questions.filter((q: any) => q.is_correct).length
                        },
                        {
                          id: "wrong",
                          label: "Wrong",
                          count: selectedResult.questions.filter((q: any) => !q.is_correct && q.selected_index !== null && q.selected_index !== undefined).length
                        },
                        {
                          id: "skipped",
                          label: "Skipped",
                          count: selectedResult.questions.filter((q: any) => q.selected_index === null || q.selected_index === undefined).length
                        }
                      ].map(tab => (
                        <button
                          key={tab.id}
                          className={reviewFilter === tab.id ? "primary" : "outline"}
                          style={{ padding: "4px 12px", borderRadius: "16px", fontSize: "12px" }}
                          onClick={() => setReviewFilter(tab.id as any)}
                        >
                          {tab.label} ({tab.count})
                        </button>
                      ))}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {selectedResult.questions
                        .filter((q: any) => {
                          const isSkipped = q.selected_index === null || q.selected_index === undefined;
                          if (reviewFilter === "correct") return q.is_correct;
                          if (reviewFilter === "wrong") return !q.is_correct && !isSkipped;
                          if (reviewFilter === "skipped") return isSkipped;
                          return true;
                        })
                        .map((q: any, i: number) => {
                          const isSkipped = q.selected_index === null || q.selected_index === undefined;
                          return (
                            <article
                              key={q.id}
                              className="card"
                              style={{
                                padding: "16px",
                                margin: 0,
                                borderLeft: q.is_correct ? "4px solid #10b981" : isSkipped ? "4px solid #64748b" : "4px solid #ef4444"
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                                <strong>
                                  {i + 1}. {q.stem}
                                </strong>
                                <span className={`tag ${q.is_correct ? "approved" : isSkipped ? "pending" : "revision_requested"}`}>
                                  {q.is_correct ? "Correct" : isSkipped ? "Skipped" : "Wrong"}
                                </span>
                              </div>

                              <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "10px 0" }}>
                                {q.options.map((opt: string, optIdx: number) => {
                                  const isCorrectOpt = optIdx === q.correct_index;
                                  const isUserPick = optIdx === q.selected_index;
                                  const optStyle: React.CSSProperties = {
                                    padding: "8px 12px",
                                    borderRadius: "6px",
                                    fontSize: "13px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    border: isCorrectOpt
                                      ? "1px solid #10b981"
                                      : isUserPick && !q.is_correct
                                      ? "1px solid #ef4444"
                                      : "1px solid var(--border,#e2e8f0)",
                                    background: isCorrectOpt
                                      ? "#f0fdf4"
                                      : isUserPick && !q.is_correct
                                      ? "#fef2f2"
                                      : "transparent"
                                  };

                                  return (
                                    <div key={optIdx} style={optStyle}>
                                      <span>
                                        <b>{"ABCD"[optIdx]}.</b> {opt}
                                      </span>
                                      {isCorrectOpt && (
                                        <span style={{ color: "#10b981", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}>
                                          <CheckCircle size={14} /> Correct Answer
                                        </span>
                                      )}
                                      {isUserPick && !isCorrectOpt && (
                                        <span style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}>
                                          <XCircle size={14} /> Your Pick
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {q.explanation && (
                                <p style={{ fontSize: "13px", background: "#f8fafc", padding: "10px", borderRadius: "6px", margin: "8px 0" }}>
                                  <b>Explanation:</b> {q.explanation}
                                </p>
                              )}
                              <Source value={q.source} />
                            </article>
                          );
                        })}
                    </div>
                  </div>
                </section>
              </div>
            )}
          </>
        )}

        {view === "People" && review && (
          <>
            {profile.role === "super_admin" && (
              <div className="section-title">
                <p>Add accounts directly, or approve sign-ups below.</p>
                <button
                  className="primary"
                  onClick={() => setMemberModal(true)}
                >
                  <Plus size={16} /> Add member
                </button>
              </div>
            )}
            {profile.role === "super_admin" && memberModal && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget) setMemberModal(false);
                }}
              >
                <section className="modal member-modal form-card" role="dialog" aria-modal="true" aria-labelledby="member-modal-title">
                  <div className="modal-head">
                    <div>
                      <span className="eyebrow">NEW ACCOUNT</span>
                      <h2 id="member-modal-title">Add member</h2>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={() => setMemberModal(false)}>
                      <X />
                    </button>
                  </div>
                  <div className="modal-scroll">
                    <p>Set their sign-in email and initial password.</p>
                    <form
                      onSubmit={async e => {
                        e.preventDefault();
                        setMemberBusy(true);
                        setError("");
                        try {
                          const r = await fetch(base + "/functions/v1/admin-create-member", {
                              method: "POST",
                              headers: {
                                apikey: key,
                                Authorization: `Bearer ${token}`,
                                "Content-Type": "application/json"
                              },
                              body: JSON.stringify({
                                full_name: newName,
                                email: newEmail,
                                password: newMemberPassword,
                                role: newMemberRole,
                                enrollment_number: newMemberRole === "supervisor" ? null : newEnrollment
                              })
                            }),
                            x: any = await r.json();
                          if (!r.ok) throw Error(x.error || "Account creation failed.");
                          setNewName("");
                          setNewEmail("");
                          setNewMemberPassword("");
                          setNewEnrollment("");
                          if (session) await load(session);
                          flash(x.message || "Account created.");
                          setMemberModal(false);
                        } catch (e: any) {
                          setError(e.message);
                        } finally {
                          setMemberBusy(false);
                        }
                      }}
                    >
                      <div className="form-grid">
                        <label>
                          Full name
                          <input required minLength={2} maxLength={100} value={newName} onChange={e => setNewName(e.target.value)} />
                        </label>
                        <label>
                          Email address
                          <input required type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                        </label>
                        <label>
                          Initial password
                          <input
                            required
                            minLength={8}
                            type="password"
                            autoComplete="new-password"
                            value={newMemberPassword}
                            onChange={e => setNewMemberPassword(e.target.value)}
                          />
                        </label>
                        <label>
                          Role
                          <select value={newMemberRole} onChange={e => setNewMemberRole(e.target.value)}>
                            <option value="student">Student</option>
                            <option value="student_leader">Student leader</option>
                            <option value="supervisor">Teacher</option>
                          </select>
                        </label>
                        {newMemberRole !== "supervisor" && (
                          <label>
                            Enrollment number
                            <input
                              required
                              maxLength={40}
                              value={newEnrollment}
                              onChange={e => setNewEnrollment(e.target.value)}
                            />
                          </label>
                        )}
                      </div>
                      <button className="primary" disabled={memberBusy}>
                        {memberBusy ? "Creating account…" : "Create account"}
                      </button>
                    </form>
                  </div>
                </section>
              </div>
            )}
            <section className="card">
              <h3>Members ({people.length})</h3>
              <p>Approve student and teacher sign-ups, update enrollment numbers, and manage access.</p>
              <label className="member-search">
                Find a member
                <input
                  type="search"
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Search by name or enrollment number"
                />
              </label>
              {people
                .filter(p => `${p.full_name} ${p.enrollment_number || ""}`.toLowerCase().includes(memberSearch.toLowerCase()))
                .map(p => (
                  <div className="row member" key={p.id}>
                    <div>
                      <strong>
                        {p.full_name}
                        {p.enrollment_number ? ` · ${p.enrollment_number}` : ""}
                      </strong>
                      <small>
                        {p.active
                          ? "Active"
                          : p.requested_role
                          ? `Waiting for approval · requested ${p.requested_role === "supervisor" ? "teacher" : "student"}`
                          : "Inactive"}
                      </small>
                      {["student", "student_leader"].includes(roles[p.id] || p.requested_role || p.role) && (
                        <label>
                          Enrollment number{!p.active ? " · from signup" : ""}
                          <input
                            disabled={profile.role !== "super_admin"}
                            maxLength={40}
                            placeholder="Saved at signup; enter here only if missing"
                            value={enrollmentEdits[p.id] ?? p.enrollment_number ?? ""}
                            onChange={e => setEnrollmentEdits({ ...enrollmentEdits, [p.id]: e.target.value })}
                          />
                        </label>
                      )}
                    </div>
                    <select
                      disabled={profile.role !== "super_admin"}
                      value={roles[p.id] || p.requested_role || p.role}
                      onChange={e => setRoles({ ...roles, [p.id]: e.target.value })}
                    >
                      {Object.entries(labels).map(([r, label]) => (
                        <option key={r} value={r}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {profile.role === "super_admin" && p.id !== profile.id && (
                      <>
                        {!p.active && p.requested_role && (
                          <button className="primary" onClick={() => activateMember(p)}>
                            Approve & activate
                          </button>
                        )}
                        {(!p.requested_role || p.active) && (
                          <button
                            className="outline"
                            onClick={() =>
                              p.active
                                ? change(route("profiles", `id=eq.${p.id}`), { role: roles[p.id] || p.role, active: false }, "PATCH")
                                : activateMember(p)
                            }
                          >
                            {p.active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                        {p.active && (
                          <button
                            className="plain"
                            onClick={() =>
                              change(
                                route("profiles", `id=eq.${p.id}`),
                                {
                                  role: roles[p.id] || p.role,
                                  enrollment_number:
                                    (roles[p.id] || p.role) === "supervisor" ? null : enrollmentEdits[p.id] ?? p.enrollment_number ?? null
                                },
                                "PATCH"
                              )
                            }
                          >
                            Save changes
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
            </section>
          </>
        )}
      </div>

      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="question-modal-title">
            <div className="modal-head">
              <div>
                <span className="eyebrow">{editQuestion ? "QUESTION EDITOR" : "QUESTION CONTRIBUTION"}</span>
                <h2 id="question-modal-title">{editQuestion ? "Edit question" : "Add questions"}</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setModalOpen(false)}>
                <X />
              </button>
            </div>
            <div className="modal-scroll">
              <form className="form-card modal-form" onSubmit={saveQuestion}>
                <label>
                  Question
                  <textarea
                    required
                    minLength={12}
                    maxLength={1500}
                    value={stem}
                    onChange={e => setStem(e.target.value)}
                  />
                </label>
                <div className="form-grid">
                  {options.map((o, i) => (
                    <label key={i}>
                      Option {"ABCD"[i]}{" "}
                      <span>
                        <input type="radio" name="correct" checked={correct === i} onChange={() => setCorrect(i)} /> Correct answer
                      </span>
                      <input required value={o} onChange={e => setOptions(options.map((v, j) => (i === j ? e.target.value : v)))} />
                    </label>
                  ))}
                </div>
                <div className="form-grid">
                  <label>
                    Topic
                    <select value={topic} onChange={e => setTopic(e.target.value)}>
                      {topics.map(t => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Source (optional)
                    <input
                      value={source}
                      onChange={e => setSource(e.target.value)}
                      placeholder="A URL or publication name, e.g. The Hindu"
                    />
                  </label>
                </div>
                <label>
                  Explanation (optional)
                  <textarea
                    value={explanation}
                    onChange={e => setExplanation(e.target.value)}
                    placeholder="Why this option is correct"
                  />
                </label>
                {review && (
                  <label className="check-row">
                    <input type="checkbox" checked={isSpecial} onChange={e => setIsSpecial(e.target.checked)} /> Mark as a special
                    question for targeted quizzes
                  </label>
                )}
                <button className="primary">{editQuestion ? "Save question" : "Submit for review"}</button>
              </form>

              <div className="import-panel">
                <div className="import-heading">
                  <div>
                    <h3>
                      <Upload size={17} /> Import questions
                    </h3>
                    <p>Paste JSON or CSV, or upload a .json, .csv, or .txt file.</p>
                  </div>
                  <button className="help-button" onClick={() => setHelpOpen(!helpOpen)} aria-expanded={helpOpen}>
                    <CircleHelp size={16} /> How to import
                  </button>
                </div>
                {helpOpen && (
                  <div className="help-box">
                    <strong>Ask AI to format your questions</strong>
                    <p>This prompt asks for four options and fills in three distractors if you provide only the correct answer.</p>
                    <pre>{promptText}</pre>
                    <button
                      className="outline"
                      onClick={() => navigator.clipboard.writeText(promptText).then(() => flash("Import prompt copied."))}
                    >
                      <Copy size={15} /> Copy prompt
                    </button>
                    <div className="format-hint">
                      <b>CSV headers:</b> stem, topic, option_a, option_b, option_c, option_d, correct_answer, explanation, source
                      <br />
                      <b>Correct answer:</b> exact option text, A–D, or a 0–3 / 1–4 index.
                    </div>
                  </div>
                )}
                <textarea
                  className="import-text"
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  placeholder={
                    'Paste JSON or CSV here…\nJSON example: {"questions":[{"stem":"…","topic":"Polity","options":["A","B","C","D"],"correct_answer":"B"}]}'
                  }
                  aria-label="Question import text"
                />
                <div className="import-actions">
                  <label className="outline file-button">
                    <FileQuestion size={15} /> Choose file
                    <input
                      type="file"
                      accept=".json,.csv,.txt,application/json,text/csv,text/plain"
                      onChange={e => chooseImportFile(e.target.files?.[0])}
                    />
                  </label>
                  <button className="primary" disabled={importBusy || !importText.trim()} onClick={importQuestions}>
                    {importBusy ? "Importing…" : "Import to review queue"}
                  </button>
                </div>
                {importMessage && <p className="success">{importMessage}</p>}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Active Quiz Screen with Autosave */}
      {activeQuiz && (
        <div className="quiz-portal">
          <header className="portal-header">
            <div>
              <span className="eyebrow">CIVICPREP · QUIZ IN PROGRESS</span>
              <h1>{activeQuiz.title}</h1>
            </div>
            <div className={`timer ${remaining < 60 ? "timer-low" : ""}`}>
              <Timer size={20} />
              <span>
                {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
              </span>
            </div>
          </header>
          <div className="portal-body">
            <aside className="question-nav">
              <strong>Questions</strong>
              <div>
                {quizQuestions.map((q, i) => (
                  <button
                    key={q.id}
                    className={answers[q.id] !== undefined ? "answered" : ""}
                    onClick={() => document.getElementById(`portal-q-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <small>
                {Object.keys(answers).length} of {quizQuestions.length} answered
              </small>
              <p>Unanswered questions are submitted as blank when time ends.</p>
            </aside>
            <section className="portal-questions">
              {quizQuestions.map((q, i) => (
                <article className="portal-question" id={`portal-q-${i}`} key={q.id}>
                  <span className="eyebrow">
                    QUESTION {i + 1} OF {quizQuestions.length} · {q.topic}
                  </span>
                  <h2>{q.stem}</h2>
                  <div className="portal-options">
                    {q.options.map((option: string, j: number) => (
                      <label key={j} className={answers[q.id] === j ? "chosen" : ""}>
                        <input
                          type="radio"
                          name={q.id}
                          checked={answers[q.id] === j}
                          onChange={() => setAnswers(old => ({ ...old, [q.id]: j }))}
                        />
                        <span className="option-letter">{"ABCD"[j]}</span>
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </article>
              ))}
              <button
                className="primary portal-submit"
                onClick={() => {
                  const left = quizQuestions.length - Object.keys(answers).length;
                  if (left > 0 && !confirm(`${left} question${left === 1 ? "" : "s"} unanswered. Submit anyway?`)) return;
                  submitQuiz(false);
                }}
                disabled={quizBusy}
              >
                {quizBusy ? "Submitting…" : "Submit answers"}
              </button>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
