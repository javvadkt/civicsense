"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, request } from "../../../context/AuthContext";
import { useAppData, Duty } from "../../../context/DataProvider";
import DutyCalendar from "../../DutyCalendar";
import QuestionEditorModal from "../../../components/QuestionEditorModal";

const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const dutyStatuses: Record<string, string> = {
  assigned: "Assigned",
  confirmed: "Confirmed",
  in_progress: "In progress",
  submitted: "Questions submitted",
  reviewed: "Reviewed",
  change_requested: "Change requested",
  excused: "Excused",
  missed: "Missed"
};

function DutiesContent() {
  const { session, profile, flash, setError } = useAuth();
  const { reload } = useAppData();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const token = session?.access_token || "";
  const today = getTodayIST();
  const dateParam = searchParams.get("date");
  const dutyDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const [dutyBusy, setDutyBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const isTeacher = profile?.role === "supervisor";
  const canManageDuties = isTeacher || profile?.role === "student_leader";
  const review = isTeacher;
  const manage = canManageDuties;

  // Compute 3-month window bounds around active duty date [month - 1, month + 1]
  const { startDate, endDate } = useMemo(() => {
    const parts = dutyDate.split("-").map(Number);
    const y = parts[0] || new Date().getFullYear();
    const m = parts[1] || new Date().getMonth() + 1;
    const start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    return { startDate: start, endDate: end };
  }, [dutyDate]);

  // 1. Windowed duties query
  const { data: duties = [] } = useQuery<Duty[]>({
    queryKey: ["duties_window", startDate, endDate],
    queryFn: () =>
      request(
        `/rest/v1/duties?select=id,duty_date,student_id,target_count,rotation_cycle,duty_status,status_note&duty_date=gte.${startDate}&duty_date=lte.${endDate}&order=duty_date.asc`,
        token
      ).catch(() => []),
    enabled: Boolean(token && profile?.active)
  });

 // 2. People directory query (reads directly from the warm AppShell cache)
  const { data: people = [], isLoading: peopleLoading } = useQuery<any[]>({
    queryKey: ["people_directory"],
    queryFn: () =>
      request("/rest/v1/profiles?select=id,full_name,role,active,enrollment_number&order=full_name.asc", token).catch(() => []),
    enabled: Boolean(token && profile?.active),
    staleTime: 1000 * 60 * 30
  });

  // 3. Duty progress query for selected date
  const { data: dutyProgress = [] } = useQuery<any[]>({
    queryKey: ["duty_progress", dutyDate],
    queryFn: () =>
      request("/rest/v1/rpc/get_duty_progress", token, "POST", { p_duty_date: dutyDate }).catch(() => []),
    enabled: Boolean(token && profile?.active && dutyDate)
  });

  // 4. Duty availability query for managers
  const { data: dutyAvailability = [] } = useQuery<any[]>({
    queryKey: ["duty_availability", dutyDate],
    queryFn: () =>
      request("/rest/v1/rpc/get_duty_availability", token, "POST", { p_duty_date: dutyDate }).catch(() => []),
    enabled: Boolean(token && profile?.active && dutyDate && manage)
  });

  const memberName = useCallback(
    (id: string, fallbackName?: string) => {
      const person = people.find((p: any) => p.id === id);
      const fullName = person?.full_name || fallbackName || (peopleLoading ? "…" : "Student");
      const enroll = person?.enrollment_number;
      return enroll ? `${fullName} · ${enroll}` : fullName;
    },
    [people, peopleLoading]
  );

  const selectedDuty = useMemo(() => duties.find(d => d.duty_date === dutyDate), [duties, dutyDate]);

  const onSelectDate = useCallback(
    (nextDate: string) => {
      router.push(`/duties?date=${nextDate}`);
    },
    [router]
  );

const invalidateDuties = useCallback(async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["duties_window"] }),
    queryClient.invalidateQueries({ queryKey: ["duty_progress"] }),
    queryClient.invalidateQueries({ queryKey: ["duty_availability"] }),
    queryClient.invalidateQueries({ queryKey: ["overview_stats"] }),
    queryClient.invalidateQueries({ queryKey: ["my_duties_overview"] })
  ]);
  reload();
}, [queryClient, reload]);

  async function handleDutySave(p: { date: string; studentId: string; target: number; reason: string }) {
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
        if (p.date !== dutyDate) onSelectDate(p.date);
      } else if (p.studentId === "auto") {
        r = await request("/rest/v1/rpc/assign_next_duty", token, "POST", {
          p_duty_date: dutyDate,
          p_target_count: p.target
        });
      } else {
        r = await request("/rest/v1/rpc/assign_duty_manually", token, "POST", {
          p_duty_date: dutyDate,
          p_student_id: p.studentId,
          p_target_count: p.target
        });
      }
      invalidateDuties();
      flash(`${r?.[0]?.full_name || "Duty"} saved for ${selectedDuty ? p.date : dutyDate}.`);
      return true;
    } catch (e: any) {
      setError(e.message || "Failed to save duty");
      return false;
    } finally {
      setDutyBusy(false);
    }
  }

  async function handleDutyDelete(reason: string) {
    if (!selectedDuty) return false;
    setError("");
    setDutyBusy(true);
    try {
      await request("/rest/v1/rpc/delete_duty", token, "POST", {
        p_duty_id: selectedDuty.id,
        p_reason: reason || null
      });
      invalidateDuties();
      flash(`Duty for ${dutyDate} deleted.`);
      return true;
    } catch (e: any) {
      setError(e.message || "Failed to delete duty");
      return false;
    } finally {
      setDutyBusy(false);
    }
  }

  async function handleSetDutyStatus(duty: any, status: string, reason = "") {
    setError("");
    setDutyBusy(true);
    try {
      await request("/rest/v1/rpc/update_duty_status", token, "POST", {
        p_duty_id: duty.id,
        p_status: status,
        p_reason: reason || null
      });
      invalidateDuties();
      flash(`Duty status updated: ${dutyStatuses[status] || status}.`);
    } catch (e: any) {
      setError(e.message || "Failed to update status");
    } finally {
      setDutyBusy(false);
    }
  }

  if (!profile) return null;

  return (
    <>
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
        onSelectDate={onSelectDate}
        onSave={handleDutySave}
        onDelete={handleDutyDelete}
        onStatus={handleSetDutyStatus}
        onAddQuestions={() => setEditorOpen(true)}
        goReview={() => router.push("/review")}
        api={(path, method, body, prefer) => request(path, token, method, body, prefer)}
        flash={flash}
        fail={setError}
        refresh={invalidateDuties}
      />

      <QuestionEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        questionToEdit={null}
        onSaved={() => {
          invalidateDuties();
          queryClient.invalidateQueries({ queryKey: ["question_bank"] });
        }}
        isTeacher={isTeacher}
        token={token}
        flash={flash}
        setError={setError}
      />
    </>
  );
}

export default function DutiesPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "32px", textAlign: "center" }}>Loading duty calendar…</div>}>
      <DutiesContent />
    </Suspense>
  );
}
