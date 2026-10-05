"use client";

import { useEffect, useState } from "react";
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

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const isTeacher = profile?.role === "supervisor";

  // Close profile dropdown when clicking outside
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleOutsideClick = () => setProfileMenuOpen(false);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, [profileMenuOpen]);

  // Reactive badge count for supervisor
  const { data: overviewStats } = useQuery({
    queryKey: ["overview_stats", profile?.id],
    queryFn: () => request("/rest/v1/rpc/get_overview_stats", token, "POST", {}),
    enabled: Boolean(token && isTeacher)
  });
// Pre-warm the class directory across all tabs to prevent "Student" name flashes
useQuery({
  queryKey: ["people_directory"],
  queryFn: () =>
    request(
      "/rest/v1/profiles?select=id,full_name,role,active,enrollment_number&order=full_name.asc",
      token
    ).catch(() => []),
  enabled: Boolean(token && profile?.active),
  staleTime: 1000 * 60 * 30, // 30 minutes cache
  gcTime: 1000 * 60 * 60 // 1 hour memory persistence
});
  const pendingReviewCount = overviewStats?.stats?.pending_total ?? 0;

  if (!profile) return null;

  const userInitials = profile.full_name
    .split(" ")
    .map(n => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const userRoleDisplay =
    profile.role === "supervisor"
      ? "Teacher"
      : profile.role === "student_leader"
      ? "Student Leader"
      : "Student";

  const visibleNavItems = navItems.filter(item => item.roles.includes(profile.role));

  return (
    <div className="layout">
      {/* =========================================================
          1. MOBILE TOP HEADER (Sticky at very top)
          ========================================================= */}
      <header className="mobile-top-bar">
        <div className="brand-mobile">
          <span className="logo-badge">CP</span>
          <div className="brand-text">
            <h1>CivicPrep</h1>
            <span className="version">UPSC Daily Engine</span>
          </div>
        </div>

        {/* Clickable Profile Avatar Button */}
        <div className="profile-anchor" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className="avatar-btn"
            aria-label="Account menu"
            onClick={() => setProfileMenuOpen(prev => !prev)}
          >
            {userInitials}
          </button>

          {/* Profile Dropdown Popover */}
          {profileMenuOpen && (
            <div className="profile-popover">
              <div className="popover-user-info">
                <div className="avatar avatar-md">{userInitials}</div>
                <div className="popover-text">
                  <strong className="popover-name">{profile.full_name}</strong>
                  <span className="popover-role">{userRoleDisplay}</span>
                  {profile.enrollment_number && (
                    <small className="popover-roll">Roll: {profile.enrollment_number}</small>
                  )}
                </div>
              </div>

              <div className="popover-divider" />

              <button
                type="button"
                className="popover-logout-btn"
                onClick={() => {
                  setProfileMenuOpen(false);
                  logout();
                }}
              >
                <LogOut size={16} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* =========================================================
          2. MOBILE TOP NAVBAR (Horizontal pill tabs below header)
          ========================================================= */}
      <nav className="mobile-nav-bar" aria-label="Mobile Navigation">
        <div className="mobile-nav-scroll">
          {visibleNavItems.map(item => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            const isReview = item.href === "/review";

            return (
              <button
                key={item.href}
                type="button"
                onClick={() => router.push(item.href)}
                className={`mobile-tab-btn ${isActive ? "active" : ""}`}
              >
                <Icon size={15} />
                <span>{item.label}</span>
                {isReview && pendingReviewCount > 0 && (
                  <span className="mobile-tab-badge">{pendingReviewCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* =========================================================
          3. DESKTOP SIDEBAR (Visible only on desktop screens)
          ========================================================= */}
      <aside className="sidebar desktop-sidebar">
        <div className="brand">
          <span className="logo-badge">CP</span>
          <div className="brand-text">
            <h1>CivicPrep</h1>
            <span className="version">UPSC Daily Engine</span>
          </div>
        </div>

        <nav className="nav-links">
          {visibleNavItems.map(item => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            const isReview = item.href === "/review";

            return (
              <a
            key={item.href}
            href={item.href}
            onMouseEnter={() => router.prefetch(item.href)}
            onClick={e => {
              e.preventDefault();
              router.push(item.href);
            }}
            className={`nav-link ${isActive ? "active" : ""}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {isReview && pendingReviewCount > 0 && (
                  <span className="nav-badge">{pendingReviewCount}</span>
                )}
              </a>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="user-profile">
            <div className="avatar">{userInitials}</div>
            <div className="user-details">
              <span className="user-name">{profile.full_name}</span>
              <span className="user-role">{userRoleDisplay}</span>
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

      {/* =========================================================
          4. MAIN VIEW CONTENT
          ========================================================= */}
      <main className="content">
        <div className="main-content">{children}</div>
      </main>
    </div>
  );
}
