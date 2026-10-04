"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";

const legacyHashToRoute: Record<string, string> = {
  overview: "/overview",
  "question-bank": "/questions",
  quizzes: "/quizzes",
  "duty-calendar": "/duties",
  "marks-summary": "/marks",
  "review-queue": "/review",
  people: "/people"
};

export default function RootPage() {
  const { session, profile, loading, passwordSetup } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    // Check if the URL hash contains invite/recovery tokens or errors
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const isAuthHash =
      hash.includes("access_token") ||
      hash.includes("error_code") ||
      hash.includes("type=recovery") ||
      hash.includes("type=invite");

    if (passwordSetup || isAuthHash || !session) {
      router.replace("/login");
      return;
    }

    if (!profile || !profile.active) {
      router.replace("/pending");
      return;
    }

    // Role check for legacy or decommissioned roles
    const recognizedRoles = ["supervisor", "student_leader", "student"];
    if (!recognizedRoles.includes(profile.role)) {
      router.replace("/pending");
      return;
    }

    // Preserve bookmark compatibility: map legacy hash tabs to real routes
    const targetRoute = legacyHashToRoute[hash];
    if (targetRoute) {
      const teacherOnly = ["/marks", "/review", "/people"];
      if (!teacherOnly.includes(targetRoute) || profile.role === "supervisor") {
        router.replace(targetRoute);
        return;
      }
    }

    router.replace("/overview");
  }, [session, profile, loading, passwordSetup, router]);

  return <main className="center">Loading workspace…</main>;
}
