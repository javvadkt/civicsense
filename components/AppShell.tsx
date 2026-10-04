"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

export type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ size?: number }>;
  teacherOnly?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { name: "Overview", href: "/overview", icon: BookOpen },
  { name: "Question bank", href: "/questions", icon: BookOpen },
  { name: "Quizzes", href: "/quizzes", icon: ClipboardList },
  { name: "Duty calendar", href: "/duties", icon: CalendarDays },
  { name: "Marks summary", href: "/marks", icon: Award, teacherOnly: true },
  { name: "Review queue", href: "/review", icon: ShieldCheck, teacherOnly: true },
  { name: "People", href: "/people", icon: Users, teacherOnly: true }
];

const roleLabels: Record<string, string> = {
  supervisor: "Teacher",
  student_leader: "Student leader",
  student: "Student"
};

type AppShellProps = {
  children: React.ReactNode;
  activeTab?: string;
  onNavigate?: (tabName: string) => void;
  pendingCount?: number;
  liveQuizCount?: number;
  refreshing?: boolean;
  title?: string;
};

export default function AppShell({
  children,
  activeTab,
  onNavigate,
  pendingCount = 0,
  liveQuizCount = 0,
  refreshing = false,
  title
}: AppShellProps) {
  const { profile, logout, error, notice, setError, setNotice } = useAuth();
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!mobileProfileOpen) return;
    const closeMenu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest(".profile-menu")) {
        setMobileProfileOpen(false);
      }
    };
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [mobileProfileOpen]);

  const isTeacher = profile?.role === "supervisor";
  const visibleNav = NAV_ITEMS.filter(item => !item.teacherOnly || isTeacher);

  const initials = (() => {
    if (!profile?.full_name) return "CP";
    const parts = profile.full_name.trim().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : profile.full_name.trim().slice(0, 2)).toUpperCase();
  })();

  const currentTitle =
    title ||
    activeTab ||
    visibleNav.find(item => item.href === pathname)?.name ||
    "Overview";

  const renderMobileProfileMenu = () => {
    if (!profile) return null;
    return (
      <div className="profile-menu profile-menu--side">
        <button
          type="button"
          className="profile-btn"
          aria-haspopup="menu"
          aria-expanded={mobileProfileOpen}
          aria-label="Account profile and options"
          onClick={e => {
            e.stopPropagation();
            setMobileProfileOpen(o => !o);
          }}
        >
          <span className="profile-avatar">{initials}</span>
          <span className="profile-name">{profile.full_name.split(" ")[0]}</span>
          <span className="profile-role">{roleLabels[profile.role] || profile.role}</span>
          <ChevronDown size={14} />
        </button>

        {mobileProfileOpen && (
          <div className="profile-dropdown" role="menu" onClick={e => e.stopPropagation()}>
            <div className="profile-dropdown-head">
              <strong>{profile.full_name}</strong>
              {profile.enrollment_number && <small>Roll: {profile.enrollment_number}</small>}
              <span className="pill profile-pill">{roleLabels[profile.role] || profile.role}</span>
            </div>
            <hr className="profile-divider" />
            <button
              type="button"
              role="menuitem"
              className="profile-signout"
              onClick={() => {
                setMobileProfileOpen(false);
                logout();
              }}
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="shell">
      <aside className="side">
        <div className="side-top-row">
          <div className="brand">
            <span className="logo">
              <BookOpen />
            </span>
            <span>
              <strong>CivicPrep</strong>
              <small>Current affairs hub</small>
            </span>
          </div>
          {renderMobileProfileMenu()}
        </div>

        <div className="side-nav-wrap">
          <nav>
            {visibleNav.map(item => {
              const Icon = item.icon;
              const isActive = activeTab ? activeTab === item.name : pathname === item.href;
              const badge =
                item.name === "Review queue" && pendingCount > 0 ? (
                  <b>{pendingCount}</b>
                ) : item.name === "Quizzes" && liveQuizCount > 0 ? (
                  <b className="live-count">{liveQuizCount}</b>
                ) : null;

              if (onNavigate) {
                return (
                  <button
                    key={item.name}
                    type="button"
                    className={isActive ? "active" : ""}
                    onClick={() => onNavigate(item.name)}
                  >
                    <span className="nav-icon">
                      <Icon size={18} />
                    </span>
                    {item.name}
                    {badge}
                  </button>
                );
              }

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={isActive ? "active" : ""}
                >
                  <span className="nav-icon">
                    <Icon size={18} />
                  </span>
                  {item.name}
                  {badge}
                </Link>
              );
            })}
          </nav>
          <span className="nav-scroll-hint" aria-hidden="true">
            <ChevronRight size={16} />
          </span>
        </div>

        {profile && (
          <div className="desktop-identity identity">
            <div className="identity-user">
              <strong>{profile.full_name}</strong>
              <small>
                {roleLabels[profile.role] || profile.role}
                {profile.enrollment_number ? ` · ${profile.enrollment_number}` : ""}
              </small>
            </div>
            <button type="button" onClick={logout} className="identity-signout">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        )}
      </aside>

      <div className="main">
        <header>
          <div>
            <span className="eyebrow">UPSC FOUNDATION · LIVE WORKSPACE</span>
            <h1>{currentTitle}</h1>
          </div>
          <div className="header-tools">
            {refreshing && (
              <span className="muted">
                <RefreshCw size={14} /> Updating
              </span>
            )}
          </div>
        </header>

        <div className="toasts">
          {error && (
            <div className="toast toast-error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="toast toast-success" role="status">
              <span>{notice}</span>
              <button aria-label="Dismiss" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
        </div>

        {children}
      </div>
    </main>
  );
}