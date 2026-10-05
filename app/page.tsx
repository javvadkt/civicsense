"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
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
  Eye,
  Filter,
 ChevronDown,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import DutyCalendar from "./DutyCalendar";
import QuizBuilder, { QuizPayload } from "./QuizBuilder";

const base = "https://dclxjishlusibfiedroo.supabase.co",
  key = "sb_publishable_TdCaDw8CU8M0H1dvBHL-MQ_S3sc_PfE";

export const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

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
  role: "supervisor" | "student_leader" | "student";
  active: boolean;
  requested_role?: ("supervisor" | "student") | null;
  enrollment_number?: string | null;
};

const labels: Record<string, string> = {
  supervisor: "Teacher",
  student_leader: "Student leader",
  student: "Student"
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
  is_used_in_quiz?: boolean;
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
  score: number | null;
  total?: number;
  submitted_at: string;
  status: "submitted" | "in_progress" | "abandoned";
  autosaved_answers?: any;
};

type Availability = {
  profile_id: string;
  full_name: string;
  role: string;
  status: string;
  note: string | null;
  already_assigned: boolean;
};

type QuizSummary = {
  attended: number;
  eligible: number;
  marks_got: number;
  marks_total: number;
  percent: number;
  pending_results: number;
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
const tabSlugs: Record<string, string> = {
  Overview: "overview",
  "Question bank": "question-bank",
  Quizzes: "quizzes",
  "Duty calendar": "duty-calendar",
  "Marks summary": "marks-summary",
  "Review queue": "review-queue",
  People: "people"
};

const slugToTab: Record<string, string> = Object.fromEntries(
  Object.entries(tabSlugs).map(([tab, slug]) => [slug, tab])
);
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
    [view, setView] = useState(() => {
      if (typeof window !== "undefined") {
        const h = window.location.hash.replace(/^#/, "");
        if (h && !h.includes("access_token") && slugToTab[h]) {
          return slugToTab[h];
        }
      }
      return "Overview";
    }),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]),
    [duties, setDuties] = useState<Duty[]>([]),
    [myDuties, setMyDuties] = useState<Duty[]>([]),
    [quizSummary, setQuizSummary] = useState<QuizSummary | null>(null),
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
    [modalTab, setModalTab] = useState<"single" | "import">("single"),
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
  // Mobile Profile Menu State (screens <= 750px)
    const [mobileProfileOpen, setMobileProfileOpen] = useState(false);

  // Question Bank Kebab & Modal Delete State
  const [bankMenuQId, setBankMenuQId] = useState<string | null>(null);
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<Question | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [quizTitle, setQuizTitle] = useState(""),
    [quizKind, setQuizKind] = useState("weekly"),
    [quizSpecialFilter, setQuizSpecialFilter] = useState("all"),
    [quizAuthorFilter, setQuizAuthorFilter] = useState<string[]>([]),
    [quizDateFilter, setQuizDateFilter] = useState(""),
    [quizVisibility, setQuizVisibility] = useState("immediate"),
    [selectedResult, setSelectedResult] = useState<any>(null);
const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null),
    [quizQuestions, setQuizQuestions] = useState<any[]>([]),
    [currentQuizIndex, setCurrentQuizIndex] = useState(0),
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

// Dedicated Question Bank State
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankUploaders, setBankUploaders] = useState<{ id: string; full_name: string; enrollment_number?: string | null }[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankOffset, setBankOffset] = useState(0);

  // Question Bank Filters & Sorters
  const [bankSearch, setBankSearch] = useState("");
  const [bankTopic, setBankTopic] = useState("all");
  const [bankAuthorId, setBankAuthorId] = useState("all");
  const [bankOnlyMine, setBankOnlyMine] = useState(false);
  const [bankStatus, setBankStatus] = useState("all");
  const [bankSpecial, setBankSpecial] = useState<"all" | "special" | "standard">("all");
  const [bankDateFrom, setBankDateFrom] = useState("");
  const [bankDateTo, setBankDateTo] = useState("");
  const [bankHasSource, setBankHasSource] = useState<"all" | "yes" | "no">("all");
  const [bankQuizUsage, setBankQuizUsage] = useState<"all" | "used" | "unused">("all");
  const [bankSort, setBankSort] = useState<"newest" | "oldest" | "topic" | "uploader" | "status">("newest");
  const [bankFilterPanelOpen, setBankFilterPanelOpen] = useState(false);

  // Redesigned Question Bank Search & Quick Filters
  const [bankQuick, setBankQuick] = useState<"all" | "mine" | "approved" | "pending" | "revision_requested">("all");
  const [bankSearchInput, setBankSearchInput] = useState("");
  const [bankDebouncedSearch, setBankDebouncedSearch] = useState("");
  const [bankError, setBankError] = useState("");

  // People Dialogs & Kebab States (Admin)
  const [roleModalTarget, setRoleModalTarget] = useState<Profile | null>(null);
  const [roleModalRole, setRoleModalRole] = useState<string>("student");
  const [roleModalEnrollment, setRoleModalEnrollment] = useState<string>("" );
  const [deactivateModalTarget, setDeactivateModalTarget] = useState<Profile | null>(null);
  const [approveModalTarget, setApproveModalTarget] = useState<Profile | null>(null);
  const [approveModalRole, setApproveModalRole] = useState<string>("student");
  const [approveModalEnrollment, setApproveModalEnrollment] = useState<string>("" );
  const [memberKebabId, setMemberKebabId] = useState<string | null>(null);
  // Self-Run Mock Quiz State (Student & Leader)
  const [mockModalOpen, setMockModalOpen] = useState(false);
  const [mockTopics, setMockTopics] = useState<string[]>([]);
  const [mockCount, setMockCount] = useState<number>(10);
  const [mockTimerMinutes, setMockTimerMinutes] = useState<number>(15);
  const [mockScrollMode, setMockScrollMode] = useState<"scroll" | "single">("scroll");
  const [mockSessionActive, setMockSessionActive] = useState(false);
  const [mockQuestionsList, setMockQuestionsList] = useState<any[]>([]);
  const [mockAnswers, setMockAnswers] = useState<Record<string, number>>({});
  const [mockCurrentIndex, setMockCurrentIndex] = useState(0);
  const [mockTimeRemaining, setMockTimeRemaining] = useState<number | null>(null);
  const [mockResult, setMockResult] = useState<any | null>(null);
  const [mockLoading, setMockLoading] = useState(false);

// Cards, Filters & Dropdown
  const [quizFilter, setQuizFilter] = useState<"all" | "live" | "upcoming" | "closed">("all");
  const [menuQuizId, setMenuQuizId] = useState<string | null>(null);

  // Student Marks Matrix State (Admin & Teacher)
  const [allAttempts, setAllAttempts] = useState<any[]>([]);
  const [gradebookLoading, setGradebookLoading] = useState(false);
  const [gradebookSearch, setGradebookSearch] = useState("");
  const [gradebookSort, setGradebookSort] = useState<"total_desc" | "name_asc" | "attended_desc">("total_desc");

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

 const isTeacher = profile?.role === "supervisor",
    canManageAcademics = isTeacher,
    canManagePeople = isTeacher,
    canManageDuties = isTeacher || profile?.role === "student_leader",
    canTakeQuizzes = ["student", "student_leader"].includes(profile?.role || ""),
    review = isTeacher,
    manage = canManageDuties,
    today = getTodayIST();
  
// Switch tab and push browser history entry
  const navigateToTab = useCallback((nextTab: string, replace = false) => {
    setView(nextTab);
    setActiveQuiz(null);
    setSelectedResult(null);

    const slug = tabSlugs[nextTab] || "overview";
    const newHash = `#${slug}`;
    if (window.location.hash !== newHash) {
      if (replace) {
        window.history.replaceState({ tab: nextTab }, "", newHash);
      } else {
        window.history.pushState({ tab: nextTab }, "", newHash);
      }
    }
  }, []);

  // Listen to browser Back / Forward navigation
  useEffect(() => {
    const onPopState = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (h && !h.includes("access_token") && slugToTab[h]) {
        setView(slugToTab[h]);
        setActiveQuiz(null);
        setSelectedResult(null);
      } else if (!h) {
        setView("Overview");
        setActiveQuiz(null);
        setSelectedResult(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
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
      setMyDuties([]);
      setQuizSummary(null);
      setQuizzes([]);
      setPeople([]);
      setAttempts([]);
      return;
    }
    const isTeacherRole = me.role === "supervisor";
    const showDirectory = isTeacherRole || me.role === "student_leader";
    const canTakeQuizzesRole = ["student", "student_leader"].includes(me.role);
    const [q, d, z, m, a, myDutyRows, summaryRes, usedQRows] = await Promise.all([
      isTeacherRole
        ? Promise.all([
            request("/rest/v1/rpc/get_review_questions", s.access_token, "POST", {}).then((rows: any[]) =>
              (rows || []).map(x => ({ ...x, author: { full_name: x.author_full_name, enrollment_number: x.author_enrollment } }))
            ),
            request(
              route(
                "questions",
                "select=id,stem,topic,options,source_url,status,author_id,created_at,is_special,author:profiles!questions_author_id_fkey(full_name,enrollment_number)&status=eq.approved&order=created_at.desc&limit=500"
              ),
              s.access_token
            )
          ]).then(([rev, app]) => [...rev, ...(app || [])])
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
     request(route("quiz_attempts", `select=quiz_id,submitted_at,score,status,autosaved_answers&student_id=eq.${me.id}`), s.access_token),
      canTakeQuizzesRole
        ? request(
            route(
              "duties",
              `select=id,duty_date,student_id,target_count,rotation_cycle,duty_status,status_note&student_id=eq.${me.id}&order=duty_date.desc&limit=200`
            ),
            s.access_token
          ).catch(() => [])
        : Promise.resolve([]),
      canTakeQuizzesRole
        ? request("/rest/v1/rpc/get_my_quiz_summary", s.access_token, "POST", {}).catch(() => null)
        : Promise.resolve(null),
      request(route("quiz_questions", "select=question_id"), s.access_token).catch(() => [])
    ]);

    const usedIds = new Set((usedQRows || []).map((r: any) => r.question_id));
    const questionsWithUsage = (q || []).map((item: any) => ({
      ...item,
      is_used_in_quiz: item.is_used_in_quiz !== undefined ? Boolean(item.is_used_in_quiz) : usedIds.has(item.id)
    }));
    setQuestions(questionsWithUsage);
    setDuties(d || []);
    setQuizzes(z || []);
    setPeople(m || []);
    setAttempts(a || []);
    setMyDuties(myDutyRows || []);
    setQuizSummary(summaryRes || null);
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

  // Debounce search input for Question Bank
  useEffect(() => {
    const timer = setTimeout(() => {
      setBankDebouncedSearch(bankSearchInput.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [bankSearchInput]);

  const loadQuestionBank = useCallback(async (offset = 0, append = false) => {
    if (!token) return;
    setBankLoading(true);
    setBankError("");
    try {
      const activeStatus = bankQuick === "approved" || bankQuick === "pending" || bankQuick === "revision_requested"
        ? bankQuick
        : bankStatus === "all" ? null : bankStatus;
      const onlyMine = bankQuick === "mine" || bankOnlyMine;

      const res = await request("/rest/v1/rpc/get_question_bank", token, "POST", {
        p_search: bankDebouncedSearch || null,
        p_topic: bankTopic === "all" ? null : bankTopic,
        p_author_id: bankAuthorId === "all" ? null : bankAuthorId,
        p_only_mine: onlyMine,
        p_status: activeStatus,
        p_is_special: bankSpecial === "all" ? null : bankSpecial === "special",
        p_date_from: bankDateFrom || null,
        p_date_to: bankDateTo || null,
        p_has_source: bankHasSource === "all" ? null : bankHasSource === "yes",
        p_quiz_usage: bankQuizUsage === "all" ? null : bankQuizUsage,
        p_sort: bankSort,
        p_limit: 25,
        p_offset: offset
      });
      if (res) {
        setBankTotal(res.total ?? 0);
        if (res.uploaders) setBankUploaders(res.uploaders);
        if (append) {
          setBankQuestions(prev => [...prev, ...(res.questions || [])]);
        } else {
          setBankQuestions(res.questions || []);
        }
        setBankOffset(offset);
      }
    } catch (e: any) {
      setBankError(e.message || "Failed to load question bank");
      setBankQuestions([]);
    } finally {
      setBankLoading(false);
    }
  }, [
    token,
    bankDebouncedSearch,
    bankQuick,
    bankTopic,
    bankAuthorId,
    bankOnlyMine,
    bankStatus,
    bankSpecial,
    bankDateFrom,
    bankDateTo,
    bankHasSource,
    bankQuizUsage,
    bankSort
  ]);

  useEffect(() => {
    if (session && profile?.active && view === "Question bank") {
      loadQuestionBank(0, false);
    }
  }, [view, session, profile?.active, loadQuestionBank]);

  const resetBankFilters = () => {
    setBankSearchInput("");
    setBankDebouncedSearch("");
    setBankQuick("all");
    setBankTopic("all");
    setBankAuthorId("all");
    setBankOnlyMine(false);
    setBankStatus("all");
    setBankSpecial("all");
    setBankDateFrom("");
    setBankDateTo("");
    setBankHasSource("all");
    setBankQuizUsage("all");
    setBankSort("newest");
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (bankTopic !== "all") count++;
    if (bankAuthorId !== "all") count++;
    if (bankOnlyMine) count++;
    if (bankStatus !== "all") count++;
    if (bankSpecial !== "all") count++;
    if (bankDateFrom) count++;
    if (bankDateTo) count++;
    if (bankHasSource !== "all") count++;
    if (bankQuizUsage !== "all") count++;
    return count;
  }, [bankTopic, bankAuthorId, bankOnlyMine, bankStatus, bankSpecial, bankDateFrom, bankDateTo, bankHasSource, bankQuizUsage]);

  // Mock Quiz Timer
  useEffect(() => {
    if (!mockSessionActive || mockTimeRemaining === null) return;
    if (mockTimeRemaining <= 0) {
      finishMockQuiz();
      return;
    }
    const timer = setInterval(() => {
      setMockTimeRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [mockSessionActive, mockTimeRemaining]);

  const startMockQuiz = async () => {
    setMockLoading(true);
    setError("");
    try {
      let rawPool: any[] = [];
      try {
        rawPool = await request("/rest/v1/rpc/get_mock_quiz_pool", token, "POST", {
          p_topics: mockTopics.length ? mockTopics : null,
          p_count: mockCount === 0 ? 1000 : mockCount
        });
      } catch {
        rawPool = bankQuestions.filter(q => q.status === "approved");
        if (mockTopics.length) rawPool = rawPool.filter(q => mockTopics.includes(q.topic));
      }

      if (!rawPool || !rawPool.length) {
        throw new Error("No approved questions found in your bank matching the selected criteria.");
      }

      // Shuffle questions and options with mapped correct indices
      const prepared = [...rawPool]
        .sort(() => Math.random() - 0.5)
        .slice(0, mockCount === 0 ? rawPool.length : mockCount)
        .map(q => {
          const originalOpts: string[] = Array.isArray(q.options) ? q.options : [];
          const correctText = originalOpts[q.correct_index];
          const indexed = originalOpts.map((opt, idx) => ({ text: opt, isCorrect: idx === q.correct_index }));
          const shuffledIndexed = indexed.sort(() => Math.random() - 0.5);
          const newCorrectIndex = shuffledIndexed.findIndex(item => item.isCorrect);
          return {
            ...q,
            options: shuffledIndexed.map(item => item.text),
            correct_index: newCorrectIndex >= 0 ? newCorrectIndex : q.correct_index,
            original_correct_text: correctText
          };
        });

      setMockQuestionsList(prepared);
      setMockAnswers({});
      setMockCurrentIndex(0);
      setMockTimeRemaining(mockTimerMinutes > 0 ? mockTimerMinutes * 60 : null);
      setMockModalOpen(false);
      setMockSessionActive(true);
      setMockResult(null);
    } catch (e: any) {
      setError(e.message || "Failed to start practice quiz");
    } finally {
      setMockLoading(false);
    }
  };

  const finishMockQuiz = () => {
    let score = 0;
    let wrong = 0;
    let skipped = 0;
    const topicMap: Record<string, { total: number; correct: number }> = {};

    mockQuestionsList.forEach(q => {
      const t = q.topic || "General";
      if (!topicMap[t]) topicMap[t] = { total: 0, correct: 0 };
      topicMap[t].total++;

      const userPick = mockAnswers[q.id];
      if (userPick === undefined) {
        skipped++;
      } else if (userPick === q.correct_index) {
        score++;
        topicMap[t].correct++;
      } else {
        wrong++;
      }
    });

    const total = mockQuestionsList.length;
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const topicStats = Object.entries(topicMap).map(([t, data]) => ({
      topic: t,
      total: data.total,
      correct: data.correct,
      pct: Math.round((data.correct / data.total) * 100)
    }));

    setMockResult({
      score,
      total,
      wrong,
      skipped,
      pct,
      topicStats,
      questions: mockQuestionsList.map(q => ({
        ...q,
        user_pick: mockAnswers[q.id]
      }))
    });
    setMockSessionActive(false);
    setMockTimeRemaining(null);
  };

 // Auto-reopen quiz if refreshed during an active session with synchronized timer
  useEffect(() => {
    if (!session || !profile?.active || activeQuiz || !quizzes.length) return;
    try {
      const savedQuizId = sessionStorage.getItem("civicprep_active_quiz_id");
      if (!savedQuizId) return;
      const matchQuiz = quizzes.find(q => q.id === savedQuizId);
      const hasSubmitted = attempts.some(a => a.quiz_id === savedQuizId && a.status === "submitted");
      if (matchQuiz && !hasSubmitted) {
        // If the saved deadline has already expired while the user was away, clear session
        const savedDeadline = Number(sessionStorage.getItem(`civicprep_deadline_${savedQuizId}`) || "0");
        if (savedDeadline > 0 && savedDeadline <= Date.now()) {
          sessionStorage.removeItem("civicprep_active_quiz_id");
          sessionStorage.removeItem(`civicprep_deadline_${savedQuizId}`);
          return;
        }
        openQuiz(matchQuiz);
      } else if (hasSubmitted) {
        sessionStorage.removeItem("civicprep_active_quiz_id");
        sessionStorage.removeItem(`civicprep_deadline_${savedQuizId}`);
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

  // Load class-wide quiz attempts for the Marks summary matrix (Teachers & Admins)
  const loadGradebook = useCallback(async () => {
    if (!token || !review) return;
    setGradebookLoading(true);
    try {
      const data = await request(
        route("quiz_attempts", "select=quiz_id,student_id,score,status,submitted_at&order=submitted_at.desc"),
        token
      );
      setAllAttempts(data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load class marks.");
    } finally {
      setGradebookLoading(false);
    }
  }, [token, review]);

  useEffect(() => {
    if (session && profile?.active && view === "Marks summary" && review) {
      loadGradebook();
    }
  }, [view, session, profile?.active, review, loadGradebook]);

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

// Debounced Autosave Hook (detached from clock ticks to prevent cancellation)
  useEffect(() => {
    if (!activeQuiz || !token || timerSubmitRef.current) return;
    try {
      localStorage.setItem(`civicprep_answers_${activeQuiz.id}`, JSON.stringify(answers));
    } catch {}
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const timeTaken = deadline
          ? Math.max(0, activeQuiz.duration_minutes * 60 - Math.ceil((deadline - Date.now()) / 1000))
          : 0;
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
  }, [answers, activeQuiz, token, deadline]);

 // Warn before leaving or closing during an active quiz
  useEffect(() => {
    if (!activeQuiz) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Closing or leaving this page will automatically submit your quiz. Are you sure?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeQuiz]);

  // Automatically submit and finalize any quiz whose browser tab/window was closed
  useEffect(() => {
    if (!session || !profile?.active || activeQuiz || !attempts.length) return;
    const activeSessionQuizId = typeof window !== "undefined" ? sessionStorage.getItem("civicprep_active_quiz_id") : null;
    const orphaned = attempts.find(
      a => a.status === "in_progress" && a.quiz_id !== activeSessionQuizId
    );
    if (orphaned) {
      (async () => {
        try {
          let ans = orphaned.autosaved_answers;
          if (!ans || Object.keys(ans).length === 0) {
            try {
              const local = localStorage.getItem(`civicprep_answers_${orphaned.quiz_id}`);
              if (local) ans = JSON.parse(local);
            } catch {}
          }
          await request("/rest/v1/rpc/submit_quiz", token, "POST", {
            p_quiz_id: orphaned.quiz_id,
            p_answers: ans || {}
          });
          try {
            localStorage.removeItem(`civicprep_answers_${orphaned.quiz_id}`);
            sessionStorage.removeItem(`civicprep_deadline_${orphaned.quiz_id}`);
          } catch {}
          flash("Your quiz was finalized and submitted because the previous tab or window was closed.");
          await load(session);
        } catch (e: any) {
          console.error("Failed to auto-submit closed quiz attempt:", e);
        }
      })();
    }
  }, [session, profile?.active, attempts, activeQuiz, token, load]);

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
            sessionStorage.removeItem(`civicprep_deadline_${activeQuiz.id}`);
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

  // Global click listeners to close dropdown menus
  useEffect(() => {
    if (!menuQuizId && !bankMenuQId && !mobileProfileOpen) return;
    const closeMenus = (e: MouseEvent) => {
      if (menuQuizId) setMenuQuizId(null);
      if (bankMenuQId) setBankMenuQId(null);
           if (mobileProfileOpen && !(e.target as HTMLElement | null)?.closest(".profile-menu")) {
        setMobileProfileOpen(false);
      }
    };
    window.addEventListener("click", closeMenus);
    return () => window.removeEventListener("click", closeMenus);
  }, [menuQuizId, bankMenuQId, mobileProfileOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setBankMenuQId(null);
        setMobileProfileOpen(false);
        if (deleteQuestionTarget && !deleteBusy) setDeleteQuestionTarget(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteQuestionTarget, deleteBusy]);

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
          "Supabase accepted the signup but did not confirm the enrollment number. The account may already exist. Ask your teacher to verify People, then deploy the updated public-signup function."
        );
      setNotice("Account created and enrollment number saved. Wait for a teacher to activate your account.");
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
    setMyDuties([]);
    setQuizSummary(null);
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
const links = [
    "Overview",
    "Question bank",
    "Quizzes",
    "Duty calendar",
    ...(isTeacher ? ["Marks summary", "Review queue", "People"] : [])
  ];
  const navIcons: any = {
    Overview: BookOpen,
    "Question bank": BookOpen,
    Quizzes: ClipboardList,
    "Duty calendar": CalendarDays,
    "Marks summary": Award,
    "Review queue": ShieldCheck,
    People: Users
  };

 async function openQuestion(q?: Question, initialTab: "single" | "import" = "single") {
    setEditQuestion(q || null);
    setModalTab(q ? "single" : initialTab);
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
      setImportMessage("");
      setModalOpen(false);
      flash(`${payload.length} question${payload.length === 1 ? "" : "s"} imported successfully.`);
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
        sessionStorage.removeItem(`civicprep_deadline_${quiz.id}`);
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

      // Calculate server ceiling from started_at and closes_at
      const startTime = started?.started_at ? new Date(started.started_at).getTime() : Date.now();
      const serverCalculatedEnd = Math.min(
        startTime + z.duration_minutes * 60_000,
        new Date(z.closes_at).getTime()
      );

      // Check for an already active session deadline to eliminate timer resets on reload
      const savedDeadlineStr = sessionStorage.getItem(`civicprep_deadline_${z.id}`);
      const savedDeadline = savedDeadlineStr ? Number(savedDeadlineStr) : null;
      const end = savedDeadline && !isNaN(savedDeadline) && savedDeadline <= serverCalculatedEnd
        ? savedDeadline
        : serverCalculatedEnd;

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
        sessionStorage.setItem(`civicprep_deadline_${z.id}`, String(end));
      } catch {}

     setQuizQuestions(items);
      setCurrentQuizIndex(0);
      setActiveQuiz(z);
      setAnswers(restoredAnswers);
      timerSubmitRef.current = false;
      setDeadline(end);
      setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
      setSelectedResult(null);
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
// Marks Summary / Gradebook Matrix Computation
  const gradebookData = useMemo(() => {
    if (!review) return { matrix: [], quizzesList: [] };

    const relevantQuizzes = [...quizzes]
      .filter(q => q.published)
      .sort((a, b) => new Date(a.opens_at).getTime() - new Date(b.opens_at).getTime());

const eligibleStudents = people
  .filter(p => ["student", "student_leader"].includes(p.role) && p.active)
  .sort((a, b) => a.full_name.localeCompare(b.full_name));

    // Fast lookup: `${student_id}_${quiz_id}` -> attempt
    const attemptLookup = new Map<string, any>();
    allAttempts.forEach(att => {
      attemptLookup.set(`${att.student_id}_${att.quiz_id}`, att);
    });

    const rows = eligibleStudents.map(s => {
      let totalMarks = 0;
      let attendedCount = 0;
      const quizScores: Record<string, { status: "attended" | "absent" | "open"; score: number | null }> = {};

      relevantQuizzes.forEach(z => {
        const att = attemptLookup.get(`${s.id}_${z.id}`);
        const isClosed = Boolean(z.ended_early_at) || new Date(z.closes_at).getTime() <= clock;

        if (att && (att.status === "submitted" || (att.score !== null && att.score !== undefined))) {
          const sc = Number(att.score || 0);
          totalMarks += sc;
          attendedCount++;
          quizScores[z.id] = { status: "attended", score: sc };
        } else if (isClosed) {
          quizScores[z.id] = { status: "absent", score: null };
        } else {
          quizScores[z.id] = { status: "open", score: null };
        }
      });

      return {
        student: s,
        scores: quizScores,
        totalMarks,
        attendedCount,
        eligibleCount: relevantQuizzes.length
      };
    });

    // Search filter
    const query = gradebookSearch.trim().toLowerCase();
    const filtered = rows.filter(r => {
      if (!query) return true;
      return (
        r.student.full_name.toLowerCase().includes(query) ||
        (r.student.enrollment_number || "").toLowerCase().includes(query)
      );
    });

    // Sorting
    filtered.sort((a, b) => {
      if (gradebookSort === "total_desc") return b.totalMarks - a.totalMarks;
      if (gradebookSort === "attended_desc") return b.attendedCount - a.attendedCount;
      return a.student.full_name.localeCompare(b.student.full_name);
    });

    return {
      matrix: filtered,
      quizzesList: relevantQuizzes
    };
  }, [review, quizzes, people, allAttempts, clock, gradebookSearch, gradebookSort]);

  const downloadGradebookCSV = () => {
    const { matrix, quizzesList } = gradebookData;
    if (!matrix.length) return;

    const quizHeaders = quizzesList.map(q => `"${q.title.replace(/"/g, '""')}"`);
    const headers = ["Student Name", "Enrollment Number", ...quizHeaders, "Attended", "Total Marks"];

    const rows = matrix.map(r => {
      const cols = [
        `"${r.student.full_name.replace(/"/g, '""')}"`,
        `"${(r.student.enrollment_number || "").replace(/"/g, '""')}"`
      ];
      quizzesList.forEach(z => {
        const cell = r.scores[z.id];
        if (cell?.status === "attended") cols.push(String(cell.score ?? 0));
        else if (cell?.status === "absent") cols.push('"Absent"');
        else cols.push('"Open"');
      });
      cols.push(`"${r.attendedCount} / ${r.eligibleCount}"`);
      cols.push(String(r.totalMarks));
      return cols.join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `civicprep_marks_summary_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
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
          <h1>{recoveryMode ? "Set or reset password" : signupMode ? "Create your account" : "GPA-DHIU"}</h1>
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
            Your account was created and is waiting for teacher approval
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

  const recognizedRoles = ["supervisor", "student_leader", "student"];
  if (!recognizedRoles.includes(profile.role))
    return (
      <main className="center">
        <div className="auth">
          <h1>Invalid Account Role</h1>
          <p>
            Your account is assigned a legacy or unrecognized role (<code>{String(profile.role)}</code>).
            The &quot;super admin&quot; role has been decommissioned. Please contact your teacher to update your role.
          </p>
          {error && <p className="error">{error}</p>}
          <button className="primary" onClick={logout}>
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
  const initials = (() => {
    const parts = profile.full_name.trim().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : profile.full_name.trim().slice(0, 2)).toUpperCase();
  })();

  const renderProfileMenu = (variant: "header" | "side") => (
    <div className={`profile-menu profile-menu--${variant}`}>
      <button
        type="button"
        className="profile-btn"
        aria-haspopup="menu"
        aria-expanded={mobileProfileOpen}
        aria-label="Account profile and options"
        onClick={e => {
          e.stopPropagation();
          setMobileProfileOpen(o => !o);
        }}
      >
        <span className="profile-avatar">{initials}</span>
        <span className="profile-name">{profile.full_name.split(" ")[0]}</span>
        <span className="profile-role">{labels[profile.role]}</span>
        <ChevronDown size={14} />
      </button>

      {mobileProfileOpen && (
        <div className="profile-dropdown" role="menu" onClick={e => e.stopPropagation()}>
          <div className="profile-dropdown-head">
            <strong>{profile.full_name}</strong>
            {profile.enrollment_number && <small>Roll: {profile.enrollment_number}</small>}
            <span className="pill profile-pill">{labels[profile.role]}</span>
          </div>
          <hr className="profile-divider" />
          <button
            type="button"
            role="menuitem"
            className="profile-signout"
            onClick={() => {
              setMobileProfileOpen(false);
              logout();
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );

  return (
    <main className="shell">
     <aside className="side">
        <div className="side-top-row">
          <div className="brand">
            <span className="logo">
              <BookOpen />
            </span>
            <span>
              <strong>GPA-DHIU</strong>
              <small>Current Affairs Hub</small>
            </span>
          </div>

          {/* Profile menu (phones only) */}
          {renderProfileMenu("side")}
        </div>

        <div className="side-nav-wrap">
          <nav>
            {links.map(x => {
              const Icon = navIcons[x];
              return (
                <button
                  key={x}
                  className={view === x ? "active" : ""}
                  onClick={() => navigateToTab(x)}
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
          <span className="nav-scroll-hint" aria-hidden="true">
            <ChevronRight size={16} />
          </span>
        </div>

        {/* Pinned Desktop Profile / Sign out Box */}
        <div className="desktop-identity identity">
          <div className="identity-user">
            <strong>{profile.full_name}</strong>
            <small>{labels[profile.role]}{profile.enrollment_number ? ` · ${profile.enrollment_number}` : ""}</small>
          </div>
          <button type="button" onClick={logout} className="identity-signout">
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

   {view === "Overview" && (() => {
          const todayDuty = duties.find(d => d.duty_date === today);
          const isViewerToday = todayDuty?.student_id === profile.id;
          const todayPerson = todayDuty
            ? (todayDuty.student?.full_name || people.find(p => p.id === todayDuty.student_id)?.full_name || "Student")
            : null;
          const todayEnrollment = todayDuty
            ? (todayDuty.student?.enrollment_number ?? enrollmentFor(todayDuty.student_id))
            : null;
          const isStudentParticipant = ["student", "student_leader"].includes(profile.role); 

          const sortedDuties = [...myDuties].sort((a, b) => {
            const aFuture = a.duty_date >= today;
            const bFuture = b.duty_date >= today;
            if (aFuture && bFuture) return a.duty_date.localeCompare(b.duty_date);
            if (aFuture) return -1;
            if (bFuture) return 1;
            return b.duty_date.localeCompare(a.duty_date);
          });

          return (
            <>
              <div className="intro">
                <h2>Welcome, {profile.full_name.split(" ")[0]}</h2>
                <p>
                  {profile.role === "supervisor"
                    ? "Review questions, manage members, schedule duties, and publish quizzes."
                    : profile.role === "student_leader"
                    ? "Do your question duties, and assist with managing the rotation: assign, swap and edit duties."
                    : "Confirm your assigned duty, submit your questions, and take class quizzes."}
                </p>
              </div>

              {/* Today's Duty Card (All Roles) */}
              <section className="card today-duty-card">
                <div className="card-head-row">
                  <div>
                    <span className="eyebrow">
                      TODAY'S DUTY · {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                    </span>
                    <h3>{todayDuty ? todayPerson : "No duty assigned today"}</h3>
                  </div>
                  {todayDuty && (
                    <span className={`duty-status status-${todayDuty.duty_status || "assigned"}`}>
                      {dutyStatuses[todayDuty.duty_status] || "Assigned"}
                    </span>
                  )}
                </div>
                {todayDuty ? (
                  <div className="today-duty-body">
                    <div className="today-duty-meta">
                      {todayEnrollment && (
                        <span>
                          <strong>Roll:</strong> {todayEnrollment}
                        </span>
                      )}
                      <span>
                        <strong>Target:</strong> {todayDuty.target_count} questions
                      </span>
                    </div>
                    {isViewerToday && (
                      <div className="today-duty-banner">
                        <CheckCircle2 size={16} />
                        <span>You are on duty today</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted-desc">No student is scheduled for question duty today.</p>
                )}
              </section>

          {/* 3 Stat Cards (Approved questions removed for all roles) */}
              <div className="stats">
                {canManageAcademics ? (
                  (() => {
                    const pendingNew = questions.filter(q => q.status === "pending").length;
                    const revisionReq = questions.filter(q => q.status === "revision_requested").length;
                    const conducted = quizzes.filter(
                      q => q.published && (clock > new Date(q.closes_at).getTime() || Boolean((q as any).ended_early_at))
                    );
                    const waitingPublish = conducted.filter(
                      q => q.result_visibility === "after_release" && !q.results_published
                    ).length;
                    const scheduled = quizzes
                      .filter(q => q.published && clock < new Date(q.opens_at).getTime() && !(q as any).ended_early_at)
                      .sort((a, b) => new Date(a.opens_at).getTime() - new Date(b.opens_at).getTime());
                    const nextUp = scheduled[0];

                    return (
                      <>
                        <article
                          style={{ cursor: "pointer" }}
                          onClick={() => setView("Review queue")}
                          title="Click to open Review queue"
                        >
                          <span>Questions to approve</span>
                          <strong>{pending.length}</strong>
                          <small>
                            {pendingNew} new · {revisionReq} correction{revisionReq === 1 ? "" : "s"}
                          </small>
                        </article>
                        <article>
                          <span>Quizzes conducted</span>
                          <strong>{conducted.length}</strong>
                          <small>
                            {waitingPublish > 0
                              ? `${waitingPublish} result${waitingPublish === 1 ? "" : "s"} waiting to publish`
                              : "All results released"}
                          </small>
                        </article>
                        <article>
                          <span>Quizzes scheduled</span>
                          <strong>{scheduled.length}</strong>
                          <small>
                            {nextUp
                              ? `Next: ${nextUp.title} · ${new Date(nextUp.opens_at).toLocaleDateString([], {
                                  month: "short",
                                  day: "numeric"
                                })}`
                              : "None scheduled"}
                          </small>
                        </article>
                      </>
                    );
                  })()
                ) : (
                  <>
                    <article>
                      <span>My contributions</span>
                      <strong>{questions.filter(q => q.author_id === profile.id).length}</strong>
                      <small>All statuses</small>
                    </article>
                    <article>
                      <span>Live quizzes</span>
                      <strong>{liveUnsubmitted}</strong>
                      <small>Open now, not yet taken</small>
                    </article>
                    <article>
                      <span>My next duty</span>
                      <strong>
                        {duties.find(d => d.student_id === profile.id && d.duty_date >= today)?.duty_date || "None"}
                      </strong>
                      <small>Five questions per day</small>
                    </article>
                  </>
                )}
              </div>

              {/* Quiz Scorecard (Student and Student Leader) */}
              {canTakeQuizzes && (
                <section className="card quiz-scorecard">
                  <div className="card-head-row">
                    <div>
                      <span className="eyebrow">ACADEMIC PERFORMANCE</span>
                      <h3>Quiz scorecard</h3>
                    </div>
                    {quizSummary && quizSummary.pending_results > 0 && (
                      <span className="tag pending">
                        {quizSummary.pending_results} result{quizSummary.pending_results === 1 ? "" : "s"} pending
                      </span>
                    )}
                  </div>
                  {quizSummary ? (
                    <div className="scorecard-grid">
                      <article className="scorecard-stat">
                        <span>Quizzes attended</span>
                        <strong>
                          {quizSummary.attended} <i>of {quizSummary.eligible}</i>
                        </strong>
                        <small>Published quizzes opened so far</small>
                      </article>
                      <article className="scorecard-stat">
                        <span>Total marks</span>
                        <strong>
                          {quizSummary.marks_got} / {quizSummary.marks_total} <i>({quizSummary.percent}%)</i>
                        </strong>
                        <small>
                          {quizSummary.pending_results > 0
                            ? "Excludes quizzes awaiting result release"
                            : "Across all completed eligible quizzes"}
                        </small>
                      </article>
                    </div>
                  ) : (
                    <p className="muted-desc">Loading quiz performance summary…</p>
                  )}
                </section>
              )}

            {/* My Duties List (Students & Student Leaders) */}
              {isStudentParticipant && (
                <section className="card my-duties-card">
                  <div className="card-head-row">
                    <div>
                      <span className="eyebrow">SCHEDULE & HISTORY</span>
                      <h3>My duties</h3>
                    </div>
                    <span className="pill">{myDuties.length} total</span>
                  </div>
                  <div className="my-duties-list">
                    {sortedDuties.map(d => {
                      const isLive = d.duty_date === today;
                      const isOpenLate =
                        d.duty_date < today && ["assigned", "confirmed", "in_progress"].includes(d.duty_status || "assigned");
                      const isPast = d.duty_date < today;
                      const rowClass = `my-duty-row ${isLive ? "live" : isPast ? "past" : "upcoming"}`;
                      const formattedDate = new Date(`${d.duty_date}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short"
                      });

                      return (
                        <div key={d.id} className={rowClass}>
                          <div className="my-duty-info">
                            <span className="my-duty-date">
                              <strong>{formattedDate}</strong>
                              <small>{d.duty_date}</small>
                            </span>
                            <span className="my-duty-target">{d.target_count} questions</span>
                          </div>
                          <div className="my-duty-badges">
                            {isLive && <span className="duty-status status-live">Live</span>}
                            <span className={`duty-status status-${isOpenLate ? "missed" : d.duty_status || "assigned"}`}>
                              {dutyStatuses[d.duty_status] || d.duty_status}
                              {isOpenLate ? " · Overdue" : ""}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {!sortedDuties.length && <Empty text="No duties have been assigned to you." />}
                  </div>
                </section>
              )}
            </>
          );
        })()}

        {view === "Question bank"  && (
          <>
<div className="section-title qb-section-title">
              <p style={{ margin: 0 }}>Review submissions and study questions. Correct answers and explanations are clearly indicated.</p>
              <div className="qb-header-actions">
                {!review && (
                  <button className="outline" onClick={() => { setMockTopics([]); setMockModalOpen(true); }}>
                    <Play size={15} /> Practice
                  </button>
                )}
                <button className="primary" onClick={() => openQuestion()}>
                  <Plus size={15} /> Add Question
                </button>
              </div>
            </div>

{/* Always Visible Filter Bar */}
            <section className="card qb-filter-card" style={{ padding: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                {/* Search Box */}
                <div style={{ position: "relative", flex: "1 1 240px", minWidth: "220px" }}>
                  <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
                  <input
                    type="search"
                    placeholder="Search question stem, options, explanation..."
                    value={bankSearchInput}
                    onChange={e => setBankSearchInput(e.target.value)}
                    style={{ paddingLeft: "36px", width: "100%", height: "42px" }}
                  />
                </div>

             {/* Quick Chips & Staff Quiz Usage Filter */}
                <div className="qb-filters-row" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <div className="qb-quick-chips">
                    {[
                      { id: "all", label: "All" },
                      ...(!review ? [{ id: "mine", label: "Mine" }] : []),
                      { id: "approved", label: "Approved" },
                      { id: "pending", label: "Waiting" },
                      { id: "revision_requested", label: "Needs revision" }
                    ].map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className={`qb-quick-btn ${bankQuick === c.id ? "active" : ""}`}
                        onClick={() => {
                          setBankQuick(c.id as any);
                          if (c.id === "all") {
                            setBankStatus("all");
                            setBankOnlyMine(false);
                          }
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {/* Staff 1-Click Quiz Usage Toggle */}
                  {review && (
                    <div className="qb-usage-toggle" title="Filter by whether question was tested in a quiz">
                      <button
                        type="button"
                        className={`qb-usage-btn ${bankQuizUsage === "all" ? "active" : ""}`}
                        onClick={() => setBankQuizUsage("all")}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className={`qb-usage-btn fresh ${bankQuizUsage === "unused" ? "active" : ""}`}
                        onClick={() => setBankQuizUsage(bankQuizUsage === "unused" ? "all" : "unused")}
                      >
                        ★ Fresh only
                      </button>
                      <button
                        type="button"
                        className={`qb-usage-btn ${bankQuizUsage === "used" ? "active" : ""}`}
                        onClick={() => setBankQuizUsage(bankQuizUsage === "used" ? "all" : "used")}
                      >
                        Used in quiz
                      </button>
                    </div>
                  )}
                </div>

                {/* Sort & More Filters Buttons */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={bankSort}
                    onChange={e => setBankSort(e.target.value as any)}
                    style={{ height: "42px", padding: "0 12px", borderRadius: "9px", minWidth: "140px" }}
                    aria-label="Sort questions"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="topic">Topic (A–Z)</option>
                    <option value="uploader">Uploader (A–Z)</option>
                    <option value="status">Status</option>
                  </select>

                  <button
                    className={bankFilterPanelOpen || activeFilterCount > 0 ? "primary" : "outline"}
                    style={{ height: "42px", padding: "0 14px", borderRadius: "9px" }}
                    onClick={() => setBankFilterPanelOpen(!bankFilterPanelOpen)}
                  >
                    <Filter size={15} /> More filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
                  </button>
                </div>
              </div>

              {/* Active Filter Chips & Counter */}
              <div className="qb-active-bar">
                <span className="qb-count-text">
                  Showing <b>{bankQuestions.length}</b> of <b>{bankTotal}</b> questions
                </span>

                <div className="qb-chip-list">
                  {bankDebouncedSearch && (
                    <span className="qb-chip">
                      Search: &quot;{bankDebouncedSearch}&quot;
                      <button onClick={() => { setBankSearchInput(""); setBankDebouncedSearch(""); }}>×</button>
                    </span>
                  )}
                  {bankQuick !== "all" && (
                    <span className="qb-chip">
                      {bankQuick === "mine" ? "Mine only" : `Status: ${bankQuick.replace("_", " ")}`}
                      <button onClick={() => setBankQuick("all")}>×</button>
                    </span>
                  )}
                  {bankTopic !== "all" && (
                    <span className="qb-chip">
                      Topic: {bankTopic}
                      <button onClick={() => setBankTopic("all")}>×</button>
                    </span>
                  )}
                  {bankAuthorId !== "all" && (
                    <span className="qb-chip">
                      Uploader: {bankUploaders.find(u => u.id === bankAuthorId)?.full_name || "Author"}
                      <button onClick={() => setBankAuthorId("all")}>×</button>
                    </span>
                  )}
                  {bankDateFrom && (
                    <span className="qb-chip">
                      From: {bankDateFrom}
                      <button onClick={() => setBankDateFrom("")}>×</button>
                    </span>
                  )}
                  {bankDateTo && (
                    <span className="qb-chip">
                      To: {bankDateTo}
                      <button onClick={() => setBankDateTo("")}>×</button>
                    </span>
                  )}
                  {bankHasSource !== "all" && (
                    <span className="qb-chip">
                      Source: {bankHasSource === "yes" ? "With citation" : "No citation"}
                      <button onClick={() => setBankHasSource("all")}>×</button>
                    </span>
                  )}
                  {review && bankSpecial !== "all" && (
                    <span className="qb-chip">
                      Type: {bankSpecial}
                      <button onClick={() => setBankSpecial("all")}>×</button>
                    </span>
                  )}
                  {review && bankQuizUsage !== "all" && (
                    <span className="qb-chip">
                      Quiz: {bankQuizUsage === "used" ? "In quiz" : "Never used"}
                      <button onClick={() => setBankQuizUsage("all")}>×</button>
                    </span>
                  )}

                  {(activeFilterCount > 0 || bankDebouncedSearch || bankQuick !== "all") && (
                    <button className="plain qb-clear-all" onClick={resetBankFilters}>
                      Clear all
                    </button>
                  )}
                </div>
              </div>

              {/* More Filters Bottom Sheet / Panel */}
              {bankFilterPanelOpen && (
                <div className="qb-sheet-backdrop" onClick={e => { if (e.target === e.currentTarget) setBankFilterPanelOpen(false); }}>
                  <div className="qb-sheet-panel">
                    <div className="qb-sheet-head">
                      <h3>More filters</h3>
                      <button className="icon-button" aria-label="Close filters" onClick={() => setBankFilterPanelOpen(false)}>
                        <X size={18} />
                      </button>
                    </div>

                    <div className="qb-filter-grid">
                      <label>
                        Topic
                        <select value={bankTopic} onChange={e => setBankTopic(e.target.value)}>
                          <option value="all">All topics</option>
                          {topics.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>

                      <label>
                        Uploader
                        <select value={bankAuthorId} onChange={e => setBankAuthorId(e.target.value)}>
                          <option value="all">All uploaders</option>
                          {bankUploaders.map(u => (
                            <option key={u.id} value={u.id}>
                              {u.full_name}{u.enrollment_number ? ` (${u.enrollment_number})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Upload date from
                        <input
                          type="date"
                          value={bankDateFrom}
                          onChange={e => {
                            const val = e.target.value;
                            if (bankDateTo && val > bankDateTo) {
                              flash("Start date cannot be after end date.");
                              return;
                            }
                            setBankDateFrom(val);
                          }}
                        />
                      </label>

                      <label>
                        Upload date to
                        <input
                          type="date"
                          value={bankDateTo}
                          onChange={e => {
                            const val = e.target.value;
                            if (bankDateFrom && val < bankDateFrom) {
                              flash("End date cannot be before start date.");
                              return;
                            }
                            setBankDateTo(val);
                          }}
                        />
                      </label>

                      <label>
                        Source citation
                        <select value={bankHasSource} onChange={e => setBankHasSource(e.target.value as any)}>
                          <option value="all">Any</option>
                          <option value="yes">With source URL/citation</option>
                          <option value="no">Without source</option>
                        </select>
                      </label>

                      {review && (
                        <label>
                          Question type (Staff)
                          <select value={bankSpecial} onChange={e => setBankSpecial(e.target.value as any)}>
                            <option value="all">All questions</option>
                            <option value="special">Special questions only</option>
                            <option value="standard">Standard only</option>
                          </select>
                        </label>
                      )}

                      {review && (
                        <label>
                          Quiz usage (Staff)
                          <select value={bankQuizUsage} onChange={e => setBankQuizUsage(e.target.value as any)}>
                            <option value="all">All</option>
                            <option value="used">Used in a quiz</option>
                            <option value="unused">Never used in any quiz</option>
                          </select>
                        </label>
                      )}
                    </div>

                    <div className="qb-sheet-foot">
                      <button className="outline" onClick={resetBankFilters}>
                        Reset all
                      </button>
                      <button className="primary" onClick={() => setBankFilterPanelOpen(false)}>
                        Show {bankTotal} results
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Error with Retry State */}
            {bankError && (
              <section className="card qb-error-card">
                <AlertCircle size={20} color="#ef4444" />
                <div>
                  <strong>Failed to load questions</strong>
                  <p>{bankError}</p>
                </div>
                <button className="outline" onClick={() => loadQuestionBank(0, false)}>
                  Retry
                </button>
              </section>
            )}

            {/* Questions Bank List */}
            <section className="card" style={{ padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
                <h3 style={{ margin: 0 }}>
                  Questions · <span style={{ opacity: 0.7 }}>Showing {bankQuestions.length} of {bankTotal}</span>
                </h3>
                {bankLoading && <span className="muted"><RefreshCw size={14} /> Updating list…</span>}
              </div>
{bankQuestions.map(q => {
                const canStudentEdit = !review && q.author_id === profile.id && ["pending", "revision_requested"].includes(q.status);
                const authorDisplay = q.author?.full_name ? memberName(q.author_id, q.author.full_name) : "Contributor";
                const createdDate = new Date(q.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

                return (
                  <details className="question qb-question-item" key={q.id}>
                    <summary className="qb-question-summary">
                      <div className="qb-question-stem">
                        <strong>{q.stem}</strong>
                      </div>
                      <div className="qb-question-footer">
                        <div className="qb-question-meta">
                          <span>{q.topic}</span>
                          {q.is_special && <span className="tag pending" style={{ padding: "2px 6px", fontSize: "11px" }}>Special</span>}
                          {review && (
                            <span className={`tag ${q.is_used_in_quiz ? "approved" : ""}`} style={{ padding: "2px 6px", fontSize: "11px" }}>
                              {q.is_used_in_quiz ? "In quiz" : "Unused"}
                            </span>
                          )}
                          <span>•</span>
                          <span>{authorDisplay}</span>
                          <span>•</span>
                          <span>{createdDate}</span>
                        </div>
                        <div className="qb-question-badge-kebab" onClick={e => e.stopPropagation()}>
                          <span className={`tag ${q.status}`}>{q.status.replace("_", " ")}</span>
                          {/* Kebab menu on summary row for teachers and admins */}
                          {review && (
                            <div
                              className="qz-menu-container"
                              style={{ position: "relative" }}
                              onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <button
                                type="button"
                                className="icon-button"
                                style={{ width: "32px", height: "32px", padding: 0 }}
                                aria-label="Question actions"
                                onClick={e => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setBankMenuQId(bankMenuQId === q.id ? null : q.id);
                                }}
                              >
                                <MoreVertical size={16} />
                              </button>

                              {bankMenuQId === q.id && (
                                <div
                                  className="qz-pop"
                                  style={{
                                    position: "absolute",
                                    right: 0,
                                    top: "calc(100% + 4px)",
                                    background: "var(--surface, #ffffff)",
                                    border: "1px solid var(--border, #e2e8f0)",
                                    borderRadius: "8px",
                                    boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                                    minWidth: "160px",
                                    zIndex: 30,
                                    overflow: "hidden",
                                    display: "flex",
                                    flexDirection: "column"
                                  }}
                                >
                                  <button
                                    type="button"
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
                                      setBankMenuQId(null);
                                      openQuestion(q);
                                    }}
                                  >
                                    <Edit size={14} /> Edit question
                                  </button>
                                  <button
                                    type="button"
                                    className="plain"
                                    style={{
                                      textAlign: "left",
                                      padding: "10px 14px",
                                      fontSize: "13px",
                                      width: "100%",
                                      color: "#ef4444",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px"
                                    }}
                                    onClick={() => {
                                      setBankMenuQId(null);
                                      setDeleteQuestionTarget(q);
                                    }}
                                  >
                                    <X size={14} /> Delete question
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </summary>

                    {/* Answer Options */}
                    <div className="qb-options-list" style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
                      {q.options.map((opt, optIdx) => {
                        const isCorrect = optIdx === q.correct_index;
                        return (
                          <div
                            key={optIdx}
                            style={{
                              padding: "10px 14px",
                              borderRadius: "8px",
                              fontSize: "14px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              border: isCorrect ? "1.5px solid #10b981" : "1px solid var(--border,#e2e8f0)",
                              background: isCorrect ? "#f0fdf4" : "var(--surface,#ffffff)"
                            }}
                          >
                            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <b style={{ color: isCorrect ? "#10b981" : "var(--muted-fg,#64748b)" }}>{"ABCD"[optIdx]}.</b>
                              <span>{opt}</span>
                            </span>
                            {isCorrect && (
                              <span style={{ color: "#10b981", fontWeight: 700, fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <CheckCircle size={15} /> Correct answer
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {q.explanation && (
                      <div style={{ marginTop: "12px", padding: "10px 14px", background: "#f8fafc", borderRadius: "8px", fontSize: "13px", borderLeft: "3px solid #3b82f6" }}>
                        <b>Explanation:</b> {q.explanation}
                      </div>
                    )}

                    <div style={{ marginTop: "8px" }}>
                      <Source value={q.source_url} />
                    </div>

                    {/* Students can edit or delete their pending questions */}
                    {canStudentEdit && (
                      <div className="actions" style={{ marginTop: "12px" }}>
                        <button className="outline" onClick={() => openQuestion(q)}>
                          Edit
                        </button>
                        <button
                          className="danger-outline"
                          onClick={() => setDeleteQuestionTarget(q)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </details>
                );
              })}

              {!bankQuestions.length && !bankLoading && !bankError && (
                <div className="qb-empty-box">
                  <FileQuestion size={36} color="#94a3b8" />
                  <h4>No questions match your current filters</h4>
                  <p>
                    {activeFilterCount > 0 || bankDebouncedSearch || bankQuick !== "all"
                      ? "Some active filters are hiding results. Clear them to restore the question list."
                      : "No questions are currently available in the question bank."}
                  </p>
                  {(activeFilterCount > 0 || bankDebouncedSearch || bankQuick !== "all") && (
                    <button className="primary" onClick={resetBankFilters}>
                      Clear all filters
                    </button>
                  )}
                </div>
              )}

              {bankQuestions.length < bankTotal && (
                <div style={{ marginTop: "20px", textAlign: "center" }}>
                  <button
                    className="outline"
                    disabled={bankLoading}
                    onClick={() => loadQuestionBank(bankQuestions.length, true)}
                    style={{ minWidth: "220px", height: "42px" }}
                  >
                    {bankLoading ? "Loading…" : `Load more questions (${bankTotal - bankQuestions.length} remaining)`}
                  </button>
                </div>
              )}
            </section>

            {/* Self-Run Mock Quiz Setup Dialog */}
            {mockModalOpen && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget && !mockLoading) setMockModalOpen(false);
                }}
              >
                <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "560px", width: "95%" }}>
                  <div className="modal-head">
                    <div>
                      <span className="eyebrow">SELF-STUDY · PRACTICE TEST</span>
                      <h2>Practice mock quiz</h2>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={() => setMockModalOpen(false)} disabled={mockLoading}>
                      <X />
                    </button>
                  </div>
                  <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div className="card" style={{ padding: "12px", background: "#f0f7ff", border: "1px solid #dbeafe", margin: 0 }}>
                      <p style={{ margin: 0, fontSize: "13px", color: "#1e40af" }}>
                        <b>Practice only:</b> Questions are drawn randomly from your approved bank. Shuffled options and questions. Answers are evaluated instantly in your browser and will <b>not</b> record attendance or affect your marks.
                      </p>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>
                        Select topics ({mockTopics.length ? mockTopics.length : "All topics"})
                      </label>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className={mockTopics.length === 0 ? "primary" : "outline"}
                          style={{ padding: "4px 12px", borderRadius: "16px", fontSize: "12px" }}
                          onClick={() => setMockTopics([])}
                        >
                          All topics
                        </button>
                        {topics.map(t => {
                          const active = mockTopics.includes(t);
                          return (
                            <button
                              type="button"
                              key={t}
                              className={active ? "primary" : "outline"}
                              style={{ padding: "4px 12px", borderRadius: "16px", fontSize: "12px" }}
                              onClick={() => {
                                if (active) setMockTopics(mockTopics.filter(x => x !== t));
                                else setMockTopics([...mockTopics, t]);
                              }}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>Number of questions</label>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {[5, 10, 20, 0].map(cnt => (
                          <button
                            type="button"
                            key={cnt}
                            className={mockCount === cnt ? "primary" : "outline"}
                            style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "13px" }}
                            onClick={() => setMockCount(cnt)}
                          >
                            {cnt === 0 ? "All available" : `${cnt} questions`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>Timer</label>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {[
                          { m: 0, label: "Untimed" },
                          { m: 5, label: "5 mins" },
                          { m: 10, label: "10 mins" },
                          { m: 15, label: "15 mins" },
                          { m: 30, label: "30 mins" }
                        ].map(tm => (
                          <button
                            type="button"
                            key={tm.m}
                            className={mockTimerMinutes === tm.m ? "primary" : "outline"}
                            style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "13px" }}
                            onClick={() => setMockTimerMinutes(tm.m)}
                          >
                            {tm.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>Display mode</label>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          className={mockScrollMode === "scroll" ? "primary" : "outline"}
                          style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "13px", flex: 1 }}
                          onClick={() => setMockScrollMode("scroll")}
                        >
                          Single scroll (all questions)
                        </button>
                        <button
                          type="button"
                          className={mockScrollMode === "single" ? "primary" : "outline"}
                          style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "13px", flex: 1 }}
                          onClick={() => setMockScrollMode("single")}
                        >
                          One question at a time
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                      <button className="outline" onClick={() => setMockModalOpen(false)} disabled={mockLoading}>
                        Cancel
                      </button>
                      <button className="primary" onClick={startMockQuiz} disabled={mockLoading}>
                        {mockLoading ? "Generating practice test…" : "Start practice test"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* Active Self-Run Mock Quiz Runner */}
            {mockSessionActive && (
              <div className="quiz-portal" style={{ zIndex: 90 }}>
                <header className="portal-header">
                  <div>
                    <span className="eyebrow" style={{ color: "#2563eb" }}>PRACTICE ONLY · UNGRADED MOCK QUIZ</span>
                    <h1>Self-run practice quiz</h1>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "auto" }}>
                    <div style={{ display: "flex", gap: "4px", background: "#f1f5f9", padding: "4px", borderRadius: "8px" }}>
                      <button
                        className={mockScrollMode === "single" ? "primary" : "plain"}
                        style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "6px" }}
                        onClick={() => setMockScrollMode("single")}
                      >
                        Single
                      </button>
                      <button
                        className={mockScrollMode === "scroll" ? "primary" : "plain"}
                        style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "6px" }}
                        onClick={() => setMockScrollMode("scroll")}
                      >
                        Scroll
                      </button>
                    </div>

                    {mockTimeRemaining !== null && (
                      <div className={`timer ${mockTimeRemaining < 60 ? "timer-low" : ""}`}>
                        <Timer size={18} />
                        <span>
                          {String(Math.floor(mockTimeRemaining / 60)).padStart(2, "0")}:{String(mockTimeRemaining % 60).padStart(2, "0")}
                        </span>
                      </div>
                    )}
                    <button
                      className="outline"
                      onClick={() => {
                        if (confirm("Exit practice quiz? Your answers will not be saved.")) {
                          setMockSessionActive(false);
                        }
                      }}
                    >
                      Exit
                    </button>
                  </div>
                </header>

                <div className="portal-body">
                  <aside className="question-nav">
                    <strong>Questions ({Object.keys(mockAnswers).length}/{mockQuestionsList.length})</strong>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", margin: "12px 0" }}>
                      {mockQuestionsList.map((q, i) => (
                        <button
                          key={q.id}
                          className={mockAnswers[q.id] !== undefined ? "answered" : ""}
                          onClick={() => {
                            if (mockScrollMode === "single") setMockCurrentIndex(i);
                            else document.getElementById(`mock-q-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }}
                          style={{
                            border: mockScrollMode === "single" && mockCurrentIndex === i ? "2px solid #2563eb" : undefined
                          }}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                    <small>Self-paced UPSC preparation</small>
                    <button className="primary" style={{ width: "100%", marginTop: "14px" }} onClick={finishMockQuiz}>
                      Submit practice quiz
                    </button>
                  </aside>

                  <section className="portal-questions">
                    {mockScrollMode === "single" ? (
                      (() => {
                        const q = mockQuestionsList[mockCurrentIndex];
                        if (!q) return null;
                        return (
                          <article className="portal-question" key={q.id}>
                            <span className="eyebrow">
                              QUESTION {mockCurrentIndex + 1} OF {mockQuestionsList.length} · {q.topic}
                            </span>
                            <h2>{q.stem}</h2>
                            <div className="portal-options">
                              {q.options.map((opt: string, j: number) => (
                                <label key={j} className={mockAnswers[q.id] === j ? "chosen" : ""}>
                                  <input
                                    type="radio"
                                    name={q.id}
                                    checked={mockAnswers[q.id] === j}
                                    onChange={() => setMockAnswers({ ...mockAnswers, [q.id]: j })}
                                  />
                                  <span className="option-letter">{"ABCD"[j]}</span>
                                  <span>{opt}</span>
                                </label>
                              ))}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "24px" }}>
                              <button
                                className="outline"
                                disabled={mockCurrentIndex === 0}
                                onClick={() => setMockCurrentIndex(mockCurrentIndex - 1)}
                              >
                                Previous
                              </button>
                              {mockCurrentIndex < mockQuestionsList.length - 1 ? (
                                <button className="primary" onClick={() => setMockCurrentIndex(mockCurrentIndex + 1)}>
                                  Next question
                                </button>
                              ) : (
                                <button className="primary" onClick={finishMockQuiz}>
                                  Submit answers
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })()
                    ) : (
                      <>
                        {mockQuestionsList.map((q, i) => (
                          <article className="portal-question" id={`mock-q-${i}`} key={q.id}>
                            <span className="eyebrow">
                              QUESTION {i + 1} OF {mockQuestionsList.length} · {q.topic}
                            </span>
                            <h2>{q.stem}</h2>
                            <div className="portal-options">
                              {q.options.map((opt: string, j: number) => (
                                <label key={j} className={mockAnswers[q.id] === j ? "chosen" : ""}>
                                  <input
                                    type="radio"
                                    name={q.id}
                                    checked={mockAnswers[q.id] === j}
                                    onChange={() => setMockAnswers({ ...mockAnswers, [q.id]: j })}
                                  />
                                  <span className="option-letter">{"ABCD"[j]}</span>
                                  <span>{opt}</span>
                                </label>
                              ))}
                            </div>
                          </article>
                        ))}
                        <button className="primary portal-submit" onClick={finishMockQuiz}>
                          Submit practice quiz
                        </button>
                      </>
                    )}
                  </section>
                </div>
              </div>
            )}

            {/* Mock Quiz Result & Review Screen */}
            {mockResult && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget) setMockResult(null);
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
                      <span className="eyebrow">PRACTICE EVALUATION · UNGRADED</span>
                      <h2>Practice test scorecard</h2>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={() => setMockResult(null)}>
                      <X />
                    </button>
                  </div>

                  <div className="modal-scroll" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center", background: "#f8fafc" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Final Score</span>
                        <strong style={{ fontSize: "22px", display: "block" }}>
                          {mockResult.score} / {mockResult.total}
                        </strong>
                        <small style={{ color: "#10b981", fontWeight: 600 }}>{mockResult.pct}% Accuracy</small>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Correct</span>
                        <strong style={{ fontSize: "22px", display: "block", color: "#10b981" }}>{mockResult.score}</strong>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Wrong</span>
                        <strong style={{ fontSize: "22px", display: "block", color: "#ef4444" }}>{mockResult.wrong}</strong>
                      </article>
                      <article className="card" style={{ padding: "12px", margin: 0, textAlign: "center" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted-fg,#64748b)" }}>Skipped</span>
                        <strong style={{ fontSize: "22px", display: "block", color: "#64748b" }}>{mockResult.skipped}</strong>
                      </article>
                    </div>

                    {/* Topic-Wise Breakdown */}
                    {mockResult.topicStats && mockResult.topicStats.length > 0 && (
                      <div className="card" style={{ padding: "14px", margin: 0, background: "var(--surface,#fff)" }}>
                        <strong style={{ fontSize: "13px", display: "block", marginBottom: "8px" }}>Topic-Wise Accuracy (UPSC Practice)</strong>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                          {mockResult.topicStats.map((stat: any) => (
                            <div key={stat.topic} style={{ fontSize: "12px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                                <span>{stat.topic}</span>
                                <b>{stat.correct}/{stat.total} ({stat.pct}%)</b>
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

                    {/* Review Every Question */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {mockResult.questions.map((q: any, i: number) => {
                        const isCorrect = q.user_pick === q.correct_index;
                        const isSkipped = q.user_pick === undefined;

                        return (
                          <article
                            key={q.id}
                            className="card"
                            style={{
                              padding: "16px",
                              margin: 0,
                              borderLeft: isCorrect ? "4px solid #10b981" : isSkipped ? "4px solid #64748b" : "4px solid #ef4444"
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                              <strong>{i + 1}. {q.stem}</strong>
                              <span className={`tag ${isCorrect ? "approved" : isSkipped ? "pending" : "revision_requested"}`}>
                                {isCorrect ? "Correct" : isSkipped ? "Skipped" : "Wrong"}
                              </span>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "10px 0" }}>
                              {q.options.map((opt: string, optIdx: number) => {
                                const isCorrectOpt = optIdx === q.correct_index;
                                const isUserPick = optIdx === q.user_pick;
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
                                      border: isCorrectOpt
                                        ? "1px solid #10b981"
                                        : isUserPick && !isCorrect
                                        ? "1px solid #ef4444"
                                        : "1px solid var(--border,#e2e8f0)",
                                      background: isCorrectOpt
                                        ? "#f0fdf4"
                                        : isUserPick && !isCorrect
                                        ? "#fef2f2"
                                        : "transparent"
                                    }}
                                  >
                                    <span><b>{"ABCD"[optIdx]}.</b> {opt}</span>
                                    {isCorrectOpt && (
                                      <span style={{ color: "#10b981", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}>
                                        <CheckCircle size={14} /> Correct Answer
                                      </span>
                                    )}
                                    {isUserPick && !isCorrectOpt && (
                                      <span style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}>
                                        <XCircle size={14} /> Your Choice
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
                            <Source value={q.source_url} />
                          </article>
                        );
                      })}
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                      <button className="primary" onClick={() => { setMockResult(null); setMockModalOpen(true); }}>
                        Start another practice quiz
                      </button>
                      <button className="outline" onClick={() => setMockResult(null)}>
                        Back to Question Bank
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </>
        )}

       {view === "Review queue" && canManageAcademics && (
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
            {canManageAcademics && (
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
            {builderOpen && canManageAcademics && (
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
                  const isSubmitted = attempt?.status === "submitted";
                  const isInProgress = attempt?.status === "in_progress";
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

                  const isLeader = profile.role === "student_leader";
                  const hasDraft = isInProgress || (typeof window !== "undefined" && Boolean(localStorage.getItem(`civicprep_answers_${z.id}`)));
                  const hoursUntil = Math.max(1, Math.ceil((o - clock) / 36e5));

                  // Academic controller privileges (Teacher only)
                  const canPublish = canManageAcademics && z.result_visibility === "after_release" && !z.results_published;
                  const canViewAttendees = canManageAcademics || isLeader;
                  const canViewQuestions = canManageAcademics;
                  const canReviewAnswers =
                    canTakeQuizzes &&
                    isClosed &&
                    isSubmitted &&
                    (z.result_visibility === "immediate" || z.results_published);
                  const canStartNow = canManageAcademics && isUpcoming;
                  const canEditQuiz = canManageAcademics && isUpcoming;
                  const canEndEarly = canManageAcademics && isLive;
                  const canRecalculate = canManageAcademics;
                  const canToggleHide = canManageAcademics;
                  const canDelete = canManageAcademics;

                  // Kebab menu visibility rules
                  const hasDropdownActions = !canManageAcademics && !isLeader
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
                          {isHidden && <span className="tag pending">Teacher only</span>}
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
                        {attempt && isSubmitted ? (
                          <small className="attended" style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px" }}>
                            <CheckCircle2 size={14} /> Attended • Submitted{" "}
                            {new Date(attempt.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </small>
                        ) : isInProgress && isLive ? (
                          <small style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px", color: "#d97706", fontWeight: 600 }}>
                            <Timer size={14} /> In progress • Answers autosaved
                          </small>
                        ) : null}
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
                       {/* Test Taker Primary Card Button */}
                        {canTakeQuizzes &&
                          (isSubmitted ? (
                            z.result_visibility === "after_release" && !z.results_published ? (
                              <span className="tag pending">Results pending</span>
                            ) : isLive ? (
                              <button className="outline" onClick={() => showResult(z)}>
                                Review answers
                              </button>
                            ) : null
                          ) : isInProgress ? (
                            <button className="outline" disabled>
                              Finalizing submission…
                            </button>
                          ) : isLive ? (
                            <button className="primary" onClick={() => openQuiz(z)}>
                              Start quiz
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

  {/* Attendees Modal */}
            {attendeesData && attendanceQuiz && (canManageAcademics || profile.role === "student_leader") && (
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
{view === "Marks summary" && canManageAcademics && (
          <>
            <div className="section-title qb-section-title">
              <div>
                <p style={{ margin: 0 }}>Class-wide student marks scorecard across all conducted quizzes.</p>
              </div>
              <div className="qb-header-actions">
                <button
                  className="outline"
                  onClick={loadGradebook}
                  disabled={gradebookLoading}
                  title="Refresh marks data"
                >
                  <RefreshCw size={15} /> Refresh
                </button>
                <button
                  className="primary"
                  onClick={downloadGradebookCSV}
                  disabled={!gradebookData.matrix.length}
                >
                  <Download size={15} /> Export CSV
                </button>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <section className="card" style={{ padding: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ position: "relative", flex: "1 1 240px", minWidth: "220px" }}>
                  <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
                  <input
                    type="search"
                    placeholder="Search by student name or roll number..."
                    value={gradebookSearch}
                    onChange={e => setGradebookSearch(e.target.value)}
                    style={{ paddingLeft: "36px", width: "100%", height: "42px" }}
                  />
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <label style={{ fontSize: "13px", fontWeight: 700, color: "#64748b" }}>Sort by:</label>
                  <select
                    value={gradebookSort}
                    onChange={e => setGradebookSort(e.target.value as any)}
                    style={{ height: "42px", padding: "0 12px", borderRadius: "9px" }}
                  >
                    <option value="total_desc">Total Marks (Highest first)</option>
                    <option value="attended_desc">Most Quizzes Attended</option>
                    <option value="name_asc">Student Name (A–Z)</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Matrix Table */}
            <section className="card" style={{ padding: 0, overflow: "hidden" }}>
              {gradebookLoading ? (
                <div className="empty">Loading marks matrix…</div>
              ) : !gradebookData.matrix.length ? (
                <div className="empty">No student records match the search filter.</div>
              ) : (
                <div className="gb-table-wrap">
                  <table className="gb-table">
                    <thead>
                      <tr>
                        <th className="gb-sticky-col">Student</th>
                        {gradebookData.quizzesList.map(qz => (
                          <th key={qz.id} title={qz.title}>
                            <span className="gb-quiz-title">{qz.title}</span>
                            <small className="gb-quiz-date">
                              {new Date(qz.opens_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                            </small>
                          </th>
                        ))}
                        <th style={{ textAlign: "center" }}>Attended</th>
                        <th style={{ textAlign: "right", paddingRight: "20px" }}>Total Marks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gradebookData.matrix.map(row => (
                        <tr key={row.student.id}>
                          <td className="gb-sticky-col">
                            <strong>{row.student.full_name}</strong>
                            {row.student.enrollment_number && (
                              <small>Roll: {row.student.enrollment_number}</small>
                            )}
                          </td>
                          {gradebookData.quizzesList.map(qz => {
                            const item = row.scores[qz.id];
                            return (
                              <td key={qz.id} style={{ textAlign: "center" }}>
                                {item?.status === "attended" ? (
                                  <span className="gb-score-pill">{item.score} pts</span>
                                ) : item?.status === "absent" ? (
                                  <span className="gb-absent-pill" title="Not attended">
                                    —
                                  </span>
                                ) : (
                                  <span className="gb-open-pill">Open</span>
                                )}
                              </td>
                            );
                          })}
                          <td style={{ textAlign: "center" }}>
                            <span className="gb-attended-badge">
                              {row.attendedCount} / {row.eligibleCount}
                            </span>
                          </td>
                          <td style={{ textAlign: "right", paddingRight: "20px" }}>
                            <strong className="gb-total-score">{row.totalMarks} pts</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
        
{view === "People" && canManagePeople && (
          <>
            {isTeacher && (
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

            {/* Teacher: Add Member Modal */}
            {profile.role === "supervisor" && memberModal && (
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

            {/* People List */}
            <section className="card">
              <h3>Members ({people.length})</h3>
              <p>Approve student and teacher sign-ups, change member roles, and manage workspace access.</p>

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
                .map(p => {
                  const isPending = !p.active && Boolean(p.requested_role);
                  const isInactive = !p.active && !p.requested_role;
                  const isSelf = p.id === profile.id;

                  return (
                 <div className="row member ppl-row" key={p.id}>
                      <div className="ppl-info">
                        <strong>
                          {p.full_name}
                          {p.enrollment_number ? ` · ${p.enrollment_number}` : ""}
                        </strong>

                        {/* Role and Status Chips */}
                        <div className="ppl-chips">
                          {isPending ? (
                            <>
                              <span className="role-chip role-requested">
                                Requested: {labels[p.requested_role!] || p.requested_role}
                              </span>
                              <span className="role-chip role-pending">Waiting for approval</span>
                            </>
                          ) : isInactive ? (
                            <>
                              <span className={`role-chip role-${p.role}`}>{labels[p.role] || p.role}</span>
                              <span className="role-chip role-inactive">Inactive</span>
                            </>
                          ) : (
                            <span className={`role-chip role-${p.role}`}>{labels[p.role] || p.role}</span>
                          )}
                        </div>
                      </div>

                      {/* Super Admin Row Actions (Anchored to Far Right) */}
                      {isTeacher && (
                        <div className="ppl-actions" style={{ marginLeft: "auto", flex: "0 0 auto" }}>
                          {isPending ? (
                            <button
                              className="primary"
                              onClick={() => {
                                setApproveModalRole(p.requested_role || "student");
                                setApproveModalEnrollment(p.enrollment_number || "");
                                setApproveModalTarget(p);
                              }}
                            >
                              Approve
                            </button>
                          ) : !isSelf ? (
                            <div className="ppl-kebab-anchor" onClick={e => e.stopPropagation()}>
                              <button
                                className="icon-button"
                                aria-label="Member options"
                                onClick={() => setMemberKebabId(memberKebabId === p.id ? null : p.id)}
                              >
                                <MoreVertical size={16} />
                              </button>

                              {memberKebabId === p.id && (
                                <div className="qz-pop ppl-pop">
                                  <button
                                    className="plain"
                                    onClick={() => {
                                      setMemberKebabId(null);
                                      setRoleModalRole(p.role);
                                      setRoleModalEnrollment(p.enrollment_number || "");
                                      setRoleModalTarget(p);
                                    }}
                                  >
                                    Change role
                                  </button>
                                  <button
                                    className="plain"
                                    onClick={() => {
                                      setMemberKebabId(null);
                                      setDeactivateModalTarget(p);
                                    }}
                                  >
                                    {p.active ? "Deactivate" : "Activate"}
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
            </section>

            {/* Change Role Modal (Admin Only) */}
            {roleModalTarget && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget && !memberBusy) setRoleModalTarget(null);
                }}
              >
                <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "460px" }}>
                  <div className="modal-head">
                    <div>
                      <span className="eyebrow">MEMBER MANAGEMENT</span>
                      <h2>Change role</h2>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={() => setRoleModalTarget(null)} disabled={memberBusy}>
                      <X />
                    </button>
                  </div>
                  <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <p style={{ margin: 0, fontSize: "14px" }}>
                      Update role for <b>{roleModalTarget.full_name}</b>.
                    </p>

                    <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 700 }}>
                      Role
                      <select value={roleModalRole} onChange={e => setRoleModalRole(e.target.value)}>
                        <option value="student">Student</option>
                        <option value="student_leader">Student leader</option>
                        <option value="supervisor">Teacher</option>
                      </select>
                    </label>

                    {["student", "student_leader"].includes(roleModalRole) && (
                      <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 700 }}>
                        Enrollment number (required)
                        <input
                          required
                          type="text"
                          maxLength={40}
                          value={roleModalEnrollment}
                          onChange={e => setRoleModalEnrollment(e.target.value)}
                          placeholder="College enrollment / roll number"
                        />
                      </label>
                    )}

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                      <button className="outline" onClick={() => setRoleModalTarget(null)} disabled={memberBusy}>
                        Cancel
                      </button>
                      <button
                        className="primary"
                        disabled={memberBusy || (["student", "student_leader"].includes(roleModalRole) && !roleModalEnrollment.trim())}
                        onClick={async () => {
                          setMemberBusy(true);
                          setError("");
                          try {
                            await request("/rest/v1/rpc/admin_manage_profile", token, "POST", {
                              p_profile_id: roleModalTarget.id,
                              p_role: roleModalRole,
                              p_enrollment_number: ["student", "student_leader"].includes(roleModalRole) ? roleModalEnrollment.trim() : null,
                              p_active: roleModalTarget.active
                            });
                            flash(`Updated role for ${roleModalTarget.full_name}.`);
                            setRoleModalTarget(null);
                            if (session) await load(session);
                          } catch (err: any) {
                            setError(err.message || "Failed to update member role");
                          } finally {
                            setMemberBusy(false);
                          }
                        }}
                      >
                        {memberBusy ? "Saving…" : "Save role"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* Deactivate / Activate Confirmation Modal */}
            {deactivateModalTarget && (() => {
              const upcomingDutiesCount = duties.filter(
                d => d.student_id === deactivateModalTarget.id && d.duty_date >= today
              ).length;
              const willDeactivate = deactivateModalTarget.active;

              return (
                <div
                  className="modal-backdrop"
                  onMouseDown={e => {
                    if (e.target === e.currentTarget && !memberBusy) setDeactivateModalTarget(null);
                  }}
                >
                  <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "480px" }}>
                    <div className="modal-head">
                      <div>
                        <span className="eyebrow" style={{ color: willDeactivate ? "#ef4444" : "#10b981" }}>
                          CONFIRM {willDeactivate ? "DEACTIVATION" : "ACTIVATION"}
                        </span>
                        <h2>{willDeactivate ? "Deactivate member?" : "Activate member?"}</h2>
                      </div>
                      <button className="icon-button" aria-label="Close" onClick={() => setDeactivateModalTarget(null)} disabled={memberBusy}>
                        <X />
                      </button>
                    </div>
                    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                      <p style={{ margin: 0, fontSize: "14px" }}>
                        {willDeactivate ? (
                          <>
                            Deactivate <b>{deactivateModalTarget.full_name}</b>?
                          </>
                        ) : (
                          <>
                            Reactivate <b>{deactivateModalTarget.full_name}</b> and restore workspace access?
                          </>
                        )}
                      </p>

                      {willDeactivate && (
                        <div className="card" style={{ padding: "12px", background: "#fef2f2", border: "1px solid #fee2e2", margin: 0 }}>
                          <p style={{ margin: 0, fontSize: "13px", color: "#991b1b" }}>
                            This member currently has <b>{upcomingDutiesCount}</b> upcoming {upcomingDutiesCount === 1 ? "duty" : "duties"}.
                            They will lose access immediately and will be skipped in future rotation cycles.
                          </p>
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                        <button className="outline" onClick={() => setDeactivateModalTarget(null)} disabled={memberBusy}>
                          Cancel
                        </button>
                        <button
                          className={willDeactivate ? "danger-outline" : "primary"}
                          style={willDeactivate ? { background: "#ef4444", color: "#fff", borderColor: "#ef4444" } : {}}
                          disabled={memberBusy}
                          onClick={async () => {
                            setMemberBusy(true);
                            setError("");
                            try {
                              await request("/rest/v1/rpc/admin_manage_profile", token, "POST", {
                                p_profile_id: deactivateModalTarget.id,
                                p_role: deactivateModalTarget.role,
                                p_enrollment_number: deactivateModalTarget.enrollment_number || null,
                                p_active: !willDeactivate
                              });
                              flash(willDeactivate ? `Deactivated ${deactivateModalTarget.full_name}.` : `Activated ${deactivateModalTarget.full_name}.`);
                              setDeactivateModalTarget(null);
                              if (session) await load(session);
                            } catch (err: any) {
                              setError(err.message || "Failed to change member status");
                            } finally {
                              setMemberBusy(false);
                            }
                          }}
                        >
                          {memberBusy ? "Updating…" : willDeactivate ? "Yes, deactivate" : "Yes, activate"}
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              );
            })()}

            {/* Approve Member Modal */}
            {approveModalTarget && (
              <div
                className="modal-backdrop"
                onMouseDown={e => {
                  if (e.target === e.currentTarget && !memberBusy) setApproveModalTarget(null);
                }}
              >
                <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "460px" }}>
                  <div className="modal-head">
                    <div>
                      <span className="eyebrow" style={{ color: "#10b981" }}>APPROVE SIGNUP</span>
                      <h2>Approve member</h2>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={() => setApproveModalTarget(null)} disabled={memberBusy}>
                      <X />
                    </button>
                  </div>
                  <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <p style={{ margin: 0, fontSize: "14px" }}>
                      Approve and activate account for <b>{approveModalTarget.full_name}</b>.
                    </p>

                    <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 700 }}>
                      Role
                      <select value={approveModalRole} onChange={e => setApproveModalRole(e.target.value)}>
                        <option value="student">Student</option>
                        <option value="student_leader">Student leader</option>
                        <option value="supervisor">Teacher</option>
                      </select>
                    </label>

                    {["student", "student_leader"].includes(approveModalRole) && (
                      <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 700 }}>
                        Enrollment number (required)
                        <input
                          required
                          type="text"
                          maxLength={40}
                          value={approveModalEnrollment}
                          onChange={e => setApproveModalEnrollment(e.target.value)}
                          placeholder="College enrollment / roll number"
                        />
                      </label>
                    )}

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                      <button className="outline" onClick={() => setApproveModalTarget(null)} disabled={memberBusy}>
                        Cancel
                      </button>
                      <button
                        className="primary"
                        disabled={memberBusy || (["student", "student_leader"].includes(approveModalRole) && !approveModalEnrollment.trim())}
                        onClick={async () => {
                          setMemberBusy(true);
                          setError("");
                          try {
                            await request("/rest/v1/rpc/admin_manage_profile", token, "POST", {
                              p_profile_id: approveModalTarget.id,
                              p_role: approveModalRole,
                              p_enrollment_number: ["student", "student_leader"].includes(approveModalRole) ? approveModalEnrollment.trim() : null,
                              p_active: true
                            });
                            flash(`Approved and activated ${approveModalTarget.full_name}.`);
                            setApproveModalTarget(null);
                            if (session) await load(session);
                          } catch (err: any) {
                            setError(err.message || "Failed to approve member");
                          } finally {
                            setMemberBusy(false);
                          }
                        }}
                      >
                        {memberBusy ? "Approving…" : "Approve & activate"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}
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
                <h2 id="question-modal-title">{editQuestion ? "Edit question" : modalTab === "import" ? "Import questions" : "Add question"}</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setModalOpen(false)}>
                <X />
              </button>
            </div>

            {!editQuestion && (
              <div className="dc-subtabs" style={{ padding: "0 24px", margin: 0, background: "#fff" }}>
                <button
                  type="button"
                  className={modalTab === "single" ? "on" : ""}
                  onClick={() => setModalTab("single")}
                >
                  Single question
                </button>
                <button
                  type="button"
                  className={modalTab === "import" ? "on" : ""}
                  onClick={() => setModalTab("import")}
                >
                  Bulk import
                </button>
              </div>
            )}

            <div className="modal-scroll">
              {(editQuestion || modalTab === "single") && (
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
              )}

              {!editQuestion && modalTab === "import" && (
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
            )}
          </div>
        </section>
      </div>
    )}

    {/* Delete Question Confirmation Modal (Admin & Teacher) */}
    {deleteQuestionTarget && (
      <div
        className="modal-backdrop"
        onMouseDown={e => {
          if (e.target === e.currentTarget && !deleteBusy) setDeleteQuestionTarget(null);
        }}
      >
        <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "480px" }}>
          <div className="modal-head">
            <div>
              <span className="eyebrow" style={{ color: "#ef4444" }}>CONFIRM DELETION</span>
              <h2>Delete Question?</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Close"
              disabled={deleteBusy}
              onClick={() => setDeleteQuestionTarget(null)}
            >
              <X />
            </button>
          </div>
          <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "#334155" }}>
              Are you sure you want to permanently delete this question?
            </p>
            <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <strong style={{ fontSize: "13px", display: "block", color: "#0f172a", marginBottom: "4px" }}>
                {deleteQuestionTarget.stem}
              </strong>
              <small style={{ color: "#64748b" }}>{deleteQuestionTarget.topic}</small>
            </div>
           <div className="card" style={{ padding: "12px", background: "#fef2f2", border: "1px solid #fee2e2", margin: 0 }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#991b1b" }}>
                {deleteQuestionTarget.status === "approved"
                  ? "This question will also be removed from any quiz that uses it."
                  : "This will permanently remove this question from your duty count."}
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
              <button
                className="outline"
                disabled={deleteBusy}
                onClick={() => setDeleteQuestionTarget(null)}
              >
                Cancel
              </button>
              <button
                className="danger-outline"
                style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
                disabled={deleteBusy}
                onClick={async () => {
                  setDeleteBusy(true);
                  try {
                    if (await change(route("questions", `id=eq.${deleteQuestionTarget.id}`), null, "DELETE")) {
                      flash("Question deleted.");
                      setDeleteQuestionTarget(null);
                      await loadQuestionBank(bankOffset, false);
                    }
                  } catch (e: any) {
                    setError(e.message || "Failed to delete question.");
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? "Deleting…" : "Yes, delete question"}
              </button>
            </div>
          </div>
        </section>
      </div>
    )}
{/* Active Quiz Screen with One Question at a Time */}
    {activeQuiz && (
        <div className="quiz-portal">
          <header className="portal-header">
            <div className="portal-header-info">
              <span className="eyebrow">CIVICPREP · QUIZ IN PROGRESS</span>
              <h1>{activeQuiz.title}</h1>
            </div>
            <div className="portal-header-tools">
              <div className={`timer ${remaining < 60 ? "timer-low" : ""}`}>
                <Timer size={18} />
                <span>
                  {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                </span>
              </div>
              <button
                className="primary portal-header-submit-btn"
                onClick={() => {
                  const left = quizQuestions.length - Object.keys(answers).length;
                  if (left > 0 && !confirm(`${left} question${left === 1 ? "" : "s"} unanswered. Submit anyway?`)) return;
                  submitQuiz(false);
                }}
                disabled={quizBusy}
              >
                {quizBusy ? "Submitting…" : "Submit"}
              </button>
            </div>
          </header>

          <div className="portal-body">
            <aside className="question-nav">
              <div className="question-nav-header">
                <strong>Questions</strong>
                <span className="pill" style={{ fontSize: "11px", padding: "2px 8px" }}>
                  {Object.keys(answers).length}/{quizQuestions.length} answered
                </span>
              </div>
              <div className="question-nav-grid">
                {quizQuestions.map((q, i) => {
                  const isAnswered = answers[q.id] !== undefined;
                  const isCurrent = i === currentQuizIndex;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`nav-btn ${isAnswered ? "answered" : ""} ${isCurrent ? "current" : ""}`}
                      onClick={() => setCurrentQuizIndex(i)}
                      aria-label={`Go to question ${i + 1}`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <small>Click any number to jump directly to that question.</small>
            </aside>

            <section className="portal-questions">
              {(() => {
                const q = quizQuestions[currentQuizIndex];
                if (!q) return null;
                const isAnswered = answers[q.id] !== undefined;
                return (
                  <article className="portal-question" key={q.id}>
                    <div className="portal-question-top">
                      <span className="eyebrow">
                        QUESTION {currentQuizIndex + 1} OF {quizQuestions.length} · {q.topic}
                      </span>
                      <span className={`tag ${isAnswered ? "approved" : "pending"}`} style={{ fontSize: "11px", padding: "2px 8px" }}>
                        {isAnswered ? "Answered" : "Unanswered"}
                      </span>
                    </div>

                    <h2>{q.stem}</h2>

                    <div className="portal-options">
                      {q.options.map((option: string, j: number) => {
                        const isChosen = answers[q.id] === j;
                        return (
                          <label key={j} className={isChosen ? "chosen" : ""}>
                            <input
                              type="radio"
                              name={q.id}
                              checked={isChosen}
                              onChange={() => {
                                setAnswers(old => ({ ...old, [q.id]: j }));
                              }}
                            />
                            <span className="option-letter">{"ABCD"[j]}</span>
                            <span className="option-text">{option}</span>
                          </label>
                        );
                      })}
                    </div>

                    <footer className="portal-step-actions">
                      <button
                        type="button"
                        className="outline"
                        disabled={currentQuizIndex === 0}
                        onClick={() => setCurrentQuizIndex(c => Math.max(0, c - 1))}
                      >
                        Previous
                      </button>

                      {currentQuizIndex < quizQuestions.length - 1 ? (
                        <button
                          type="button"
                          className="primary"
                          onClick={() => setCurrentQuizIndex(c => Math.min(quizQuestions.length - 1, c + 1))}
                        >
                          Next question
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="primary"
                          onClick={() => {
                            const left = quizQuestions.length - Object.keys(answers).length;
                            if (left > 0 && !confirm(`${left} question${left === 1 ? "" : "s"} unanswered. Submit anyway?`)) return;
                            submitQuiz(false);
                          }}
                          disabled={quizBusy}
                        >
                          {quizBusy ? "Submitting…" : "Review & Submit"}
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })()}
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
