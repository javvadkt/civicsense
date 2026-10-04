"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  X
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

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isTeacher = profile?.role === "supervisor";

  // Close mobile drawer whenever the user navigates
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const { data: overviewStats } = useQuery({
    queryKey: ["overview_stats", profile?.id],
    queryFn: () => request("/rest/v1/rpc/get_overview_stats", token, "POST", {}),
    enabled: Boolean(token && isTeacher)
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

  return (
    <div className="layout">
      {/* Mobile Top Header (Visible only on mobile) */}
      <header className="mobile-header">
        <div className="brand-mobile">
          <span className="logo-badge">CP</span>
          <div className="brand-text">
            <h1>CivicPrep</h1>
            <span className="version">UPSC Daily Engine</span>
          </div>
        </div>

        <div className="mobile-header-right">
          <div className="avatar avatar-sm" title={profile.full_name}>
            {userInitials}
          </div>
          <button
            type="button"
            className="mobile-menu-btn"
            aria-label="Toggle navigation"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      {/* Main Navigation (Sidebar on Desktop / Slide Drawer on Mobile) */}
      <aside className={`sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}>
        {/* Desktop Brand */}
        <div className="brand desktop-only">
          <span className="logo-badge">CP</span>
          <div className="brand-text">
            <h1>CivicPrep</h1>
            <span className="version">UPSC Daily Engine</span>
          </div>
        </div>

        {/* Navigation Links */}
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
                    setMobileMenuOpen(false);
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

        {/* Profile Card & Logout */}
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
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Backdrop overlay when mobile menu is open */}
      {mobileMenuOpen && (
        <div className="mobile-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Main View Area */}
      <main className="content">
        <div className="main-content">{children}</div>
      </main>
    </div>
  );
}
