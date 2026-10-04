"use client";

import React, { createContext, useContext, useCallback, useEffect, useState } from "react";
import { useAuth, request } from "./AuthContext";

export type Question = {
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

export type Duty = {
  id: string;
  duty_date: string;
  student_id: string;
  target_count: number;
  rotation_cycle?: number | null;
  duty_status: string;
  status_note?: string | null;
  student?: { full_name: string; enrollment_number?: string | null };
};

export type Quiz = {
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

export type Attempt = {
  quiz_id: string;
  score: number | null;
  total?: number;
  submitted_at: string;
  status: "submitted" | "in_progress" | "abandoned";
  autosaved_answers?: any;
};

export type QuizSummary = {
  attended: number;
  eligible: number;
  marks_got: number;
  marks_total: number;
  percent: number;
  pending_results: number;
};

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

type DataContextType = {
  questions: Question[];
  duties: Duty[];
  myDuties: Duty[];
  quizzes: Quiz[];
  people: any[];
  attempts: Attempt[];
  quizSummary: QuizSummary | null;
  refreshing: boolean;
  reload: () => Promise<void>;
  change: (path: string, body: any, method?: string, prefer?: string) => Promise<boolean>;
};

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { session, profile, setError, flash } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [myDuties, setMyDuties] = useState<Duty[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [quizSummary, setQuizSummary] = useState<QuizSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    if (!session || !profile?.active) {
      setQuestions([]);
      setDuties([]);
      setMyDuties([]);
      setQuizzes([]);
      setPeople([]);
      setAttempts([]);
      setQuizSummary(null);
      return;
    }

    setRefreshing(true);
    try {
      const isTeacherRole = profile.role === "supervisor";
      const showDirectory = isTeacherRole || profile.role === "student_leader";
      const canTakeQuizzesRole = ["student", "student_leader"].includes(profile.role);

      const [q, d, z, m, a, myDutyRows, summaryRes, usedQRows] = await Promise.all([
        isTeacherRole
          ? Promise.all([
              request("/rest/v1/rpc/get_review_questions", session.access_token, "POST", {}).then((rows: any[]) =>
                (rows || []).map(x => ({ ...x, author: { full_name: x.author_full_name, enrollment_number: x.author_enrollment } }))
              ),
              request(
                route(
                  "questions",
                  "select=id,stem,topic,options,source_url,status,author_id,created_at,is_special,author:profiles!questions_author_id_fkey(full_name,enrollment_number)&status=eq.approved&order=created_at.desc&limit=500"
                ),
                session.access_token
              )
            ]).then(([rev, app]) => [...rev, ...(app || [])])
          : request(
              route(
                "questions",
                "select=id,stem,topic,options,source_url,status,author_id,created_at,is_special,author:profiles!questions_author_id_fkey(full_name,enrollment_number)&order=created_at.desc&limit=400"
              ),
              session.access_token
            ),
        loadDutyRows(session.access_token),
        request(
          route(
            "quizzes",
            "select=id,title,kind,opens_at,closes_at,duration_minutes,published,result_visibility,results_published,ended_early_at,is_hidden&order=opens_at.desc&limit=120"
          ),
          session.access_token
        ),
        showDirectory
          ? request(
              route("profiles", "select=id,full_name,role,active,requested_role,enrollment_number&order=full_name.asc"),
              session.access_token
            )
          : Promise.resolve([]),
        request(route("quiz_attempts", `select=quiz_id,submitted_at,score,status,autosaved_answers&student_id=eq.${profile.id}`), session.access_token),
        canTakeQuizzesRole
          ? request(
              route(
                "duties",
                `select=id,duty_date,student_id,target_count,rotation_cycle,duty_status,status_note&student_id=eq.${profile.id}&order=duty_date.desc&limit=200`
              ),
              session.access_token
            ).catch(() => [])
          : Promise.resolve([]),
        canTakeQuizzesRole
          ? request("/rest/v1/rpc/get_my_quiz_summary", session.access_token, "POST", {}).catch(() => null)
          : Promise.resolve(null),
        request(route("quiz_questions", "select=question_id"), session.access_token).catch(() => [])
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
    } catch (e: any) {
      setError(e.message || "Failed to load workspace data");
    } finally {
      setRefreshing(false);
    }
  }, [session, profile, setError]);

  useEffect(() => {
    reload();
  }, [reload]);

  const change = useCallback(
    async (path: string, body: any, method = "POST", prefer = "return=minimal") => {
      if (!session?.access_token) return false;
      setError("");
      try {
        await request(path, session.access_token, method, body, prefer);
        await reload();
        flash("Saved successfully.");
        return true;
      } catch (e: any) {
        setError(e.message || "Save failed");
        return false;
      }
    },
    [session, reload, setError, flash]
  );

  return (
    <DataContext.Provider
      value={{
        questions,
        duties,
        myDuties,
        quizzes,
        people,
        attempts,
        quizSummary,
        refreshing,
        reload,
        change
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useAppData must be used within a DataProvider");
  return ctx;
}
