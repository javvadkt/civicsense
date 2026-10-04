"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { DataProvider, useAppData } from "../../context/DataProvider";
import AppShell from "../../components/AppShell";

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { session, profile, loading: authLoading, setError } = useAuth();
  const { questions, quizzes, attempts, refreshing } = useAppData();
  const router = useRouter();
  const pathname = usePathname();
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Client-side authentication and role guard
  useEffect(() => {
    if (authLoading) return;

    if (!session) {
      router.replace("/login");
      return;
    }

    if (!profile || !profile.active) {
      router.replace("/pending");
      return;
    }

    const recognizedRoles = ["supervisor", "student_leader", "student"];
    if (!recognizedRoles.includes(profile.role)) {
      router.replace("/pending");
      return;
    }

    const teacherOnlyRoutes = ["/review", "/people", "/marks"];
    if (teacherOnlyRoutes.some(r => pathname.startsWith(r)) && profile.role !== "supervisor") {
      setError("That section is restricted to teachers.");
      router.replace("/overview");
    }
  }, [session, profile, authLoading, pathname, router, setError]);

  const pendingCount = useMemo(() => {
    return questions.filter(q => ["pending", "revision_requested"].includes(q.status)).length;
  }, [questions]);

  const liveQuizCount = useMemo(() => {
    const myAttempts = new Set(attempts.map(a => a.quiz_id));
    return quizzes.filter(
      q =>
        q.published &&
        new Date(q.opens_at).getTime() <= clock &&
        new Date(q.closes_at).getTime() >= clock &&
        !(q as any).ended_early_at &&
        !myAttempts.has(q.id)
    ).length;
  }, [quizzes, attempts, clock]);

  if (authLoading) {
    return <main className="center">Loading workspace…</main>;
  }

  if (!session || !profile || !profile.active) {
    return null;
  }

  return (
    <AppShell
      pendingCount={profile.role === "supervisor" ? pendingCount : 0}
      liveQuizCount={liveQuizCount}
      refreshing={refreshing}
    >
      {children}
    </AppShell>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <DashboardContent>{children}</DashboardContent>
    </DataProvider>
  );
}
