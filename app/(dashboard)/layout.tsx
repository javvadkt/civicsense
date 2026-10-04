"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import AppShell from "../../components/AppShell";

const teacherOnlyRoutes = ["/review", "/people", "/marks"];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, flash } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;

    if (!session || !profile) {
      router.replace("/login");
      return;
    }

    if (!profile.active) {
      router.replace("/pending");
      return;
    }

    if (teacherOnlyRoutes.includes(pathname) && profile.role !== "supervisor") {
      flash("Access denied: Teacher permissions required.");
      router.replace("/overview");
    }
  }, [session, profile, loading, pathname, router, flash]);

  if (loading || !profile || !profile.active) {
    return <main className="center">Loading workspace…</main>;
  }

  return <AppShell>{children}</AppShell>;
}
