"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, request } from "../../../context/AuthContext";
import { useAppData } from "../../../context/DataProvider";
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
  const { duties, people, questions, reload } = useAppData();
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = session?.access_token || "";
  const today = getTodayIST();
  const dateParam = searchParams.get("date");
  const dutyDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const [dutyProgress, setDutyProgress] = useState<any[]>([]);
  const [dutyAvailability, setDutyAvailability] = useState<any[]>([]);
  const [dutyBusy, setDutyBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const isTeacher = profile?.role === "supervisor";
  const canManageDuties = isTeacher || profile?.role === "student_leader";
  const review = isTeacher;
  const manage = canManageDuties;

  const enrollmentFor = useCallback(
    (id: string) => people.find(p => p.id === id)?.enrollment_number,
    [people]
  );

  const memberName = useCallback(
    (id: string, name: string) => {
      const enrollment = enrollmentFor(id) || questions.find(q => q.author_id === id)?.author?.enrollment_number;
      return enrollment ? `${name} · ${enrollment}` : name;
    },
    [enrollmentFor, questions]
  );

  const selectedDuty = useMemo(() => duties.find(d => d.duty_date === dutyDate), [duties, dutyDate]);

  const onSelectDate = useCallback(
    (nextDate: string) => {
      router.push(`/duties?date=${nextDate}`);
    },
    [router]
  );

  useEffect(() => {
    if (!token || !profile?.active || !dutyDate) return;
    Promise.all([
      request("/rest/v1/rpc/get_duty_progress", token, "POST", { p_duty_date: dutyDate }),
      manage ? request("/rest/v1/rpc/get_duty_availability", token, "POST", { p_duty_date: dutyDate }) : Promise.resolve([])
    ])
      .then(([progress, avail]) => {
        setDutyProgress(progress || []);
        setDutyAvailability(avail || []);
      })
      .catch((e: any) => setError(e.message || "Failed to load duty data"));
  }, [token, profile?.active, manage, dutyDate, setError]);

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
      await reload();
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
      await reload();
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
      await reload();
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
        refresh={reload}
      />

      <QuestionEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        questionToEdit={null}
        onSaved={reload}
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
