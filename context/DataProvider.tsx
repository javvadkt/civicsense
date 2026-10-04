export type Question = {
  id: string;
  stem: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  source_url: string | null;
  topic: string;
  status: "pending" | "approved" | "revision_requested";
  is_special: boolean;
  is_used_in_quiz?: boolean;
  author_id: string;
  created_at: string;
  author?: {
    id: string;
    full_name: string;
    enrollment_number?: string | null;
  };
};

export type Duty = {
  id: string;
  duty_date: string;
  student_id: string;
  target_count: number;
  rotation_cycle: number;
  duty_status: string;
  status_note?: string | null;
  student?: {
    id: string;
    full_name: string;
    enrollment_number?: string | null;
  };
};

export type Quiz = {
  id: string;
  title: string;
  kind: string;
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  result_visibility: "immediate" | "after_release";
  results_published: boolean;
  published: boolean;
  ended_early_at?: string | null;
  is_hidden?: boolean;
};

export type QuizSummary = {
  eligible: number;
  attended: number;
  marks_got: number;
  marks_total: number;
  percent: number;
  pending_results: number;
};

export type Person = {
  id: string;
  full_name: string;
  role: "supervisor" | "student_leader" | "student";
  active: boolean;
  requested_role?: ("supervisor" | "student") | null;
  enrollment_number?: string | null;
};

/**
 * @deprecated DataProvider has been retired in favor of server RPCs and TanStack Query.
 */
export function useAppData(): any {
  return {};
}
