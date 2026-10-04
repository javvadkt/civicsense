"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";

export default function PendingPage() {
  const { session, profile, loading, error, logout, refreshProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
    } else if (profile?.active) {
      router.replace("/overview");
    }
  }, [session, profile, loading, router]);

  if (loading) return <main className="center">Loading workspace…</main>;
  if (!session || !profile) return null;

  const recognizedRoles = ["supervisor", "student_leader", "student"];
  const isLegacyRole = !recognizedRoles.includes(profile.role);

  if (isLegacyRole) {
    return (
      <main className="center">
        <div className="auth">
          <h1>Invalid Account Role</h1>
          <p>
            Your account is assigned a legacy or unrecognized role (<code>{String(profile.role)}</code>).
            The &quot;super admin&quot; role has been decommissioned. Please contact your teacher to update your role.
          </p>
          {error && <p className="error">{error}</p>}
          <button type="button" className="primary" onClick={logout}>
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="center">
      <div className="auth">
        <h1>Approval pending</h1>
        <p>
          Your account was created and is waiting for teacher approval
          {profile.requested_role
            ? ` as ${profile.requested_role === "supervisor" ? "teacher" : "student"}`
            : ""}. Once approved, check approval below to open the workspace.
        </p>
        {error && <p className="error">{error}</p>}
        <button
          type="button"
          className="primary"
          onClick={() => refreshProfile()}
        >
          Check approval
        </button>
        <button type="button" className="plain" onClick={logout}>
          Sign out
        </button>
      </div>
    </main>
  );
}
