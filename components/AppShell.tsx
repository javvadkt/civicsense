"use client";

import Link from "next/navigation";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Users
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, request } from "../context/AuthContext";

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, roles: ["supervisor", "student_leader", "student"] },
  { href: "/questions", label: "Question Bank", icon: BookOpen, roles: ["supervisor", "student_leader", "student"] },
  { href: "/duties", label: "Duty Calendar", icon: CalendarDays, roles: ["supervisor", "student_leader", "student"] },
  { href: "/quizzes", label: "Quizzes", icon: ClipboardList, roles: ["supervisor", "student_leader", "student"] },
  { href: "/marks", label: "Marks Summary", icon: GraduationCap, roles: ["supervisor"] },
  { href: "/review", label: "Review Queue", icon: CheckSquare, roles: ["supervisor"] },
  { href: "/people", label: "People", icon: Users, roles: ["supervisor"] }
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { session, profile, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const token = session?.access_token || "";

  const isTeacher = profile?.role === "supervisor";

  // Reactive badge count using the shared overview_stats query
  const { data: overviewStats } = useQuery({
    queryKey: ["overview_stats", profile?.id],
    queryFn: () => request("/rest/v1/rpc/get_overview_stats", token, "POST", {}),
    enabled: Boolean(token && isTeacher)
  });

  const pendingReviewCount = overviewStats?.stats?.pending_total ?? 0;

  if (!profile) return null;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo-badge">CP</span>
          <div className="brand-text">
            <h1>CivicPrep</h1>
            <span className="version">UPSC Daily Engine</span>
          </div>
        </div>

        <nav className="nav-links">
          {navItems
            .filter(item => item.roles.includes(profile.role))
            .map(item => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              const isReviewLink = item.href === "/review";

              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={e => {
                    e.preventDefault();
                    router.push(item.href);
                  }}
                  className={`nav-link ${isActive ? "active" : ""}`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {isReviewLink && pendingReviewCount > 0 && (
                    <span className="nav-badge">{pendingReviewCount}</span>
                  )}
                </a>
              );
            })}
        </nav>

        <div className="sidebar-foot">
          <div className="user-profile">
            <div className="avatar">
              {profile.full_name
                .split(" ")
                .map(n => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <div className="user-details">
              <span className="user-name">{profile.full_name}</span>
              <span className="user-role">
                {profile.role === "supervisor"
                  ? "Teacher"
                  : profile.role === "student_leader"
                  ? "Student Leader"
                  : "Student"}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="logout-button"
            onClick={logout}
            title="Sign out of CivicPrep"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="content">
        <div className="main-content">{children}</div>
      </main>
    </div>
  );
}
