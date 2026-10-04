"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export const SUPABASE_BASE = "https://dclxjishlusibfiedroo.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_TdCaDw8CU8M0H1dvBHL-MQ_S3sc_PfE";

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string };
};

export type Profile = {
  id: string;
  full_name: string;
  role: "supervisor" | "student_leader" | "student";
  active: boolean;
  requested_role?: ("supervisor" | "student") | null;
  enrollment_number?: string | null;
};

export async function request(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
  prefer?: string
) {
  const res = await fetch(SUPABASE_BASE + path, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body === undefined || method === "DELETE" ? undefined : JSON.stringify(body)
  });
  const raw = await res.text();
  let data: any;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!res.ok) {
    throw new Error(data?.message || data?.error_description || data?.error || `Request failed (${res.status})`);
  }
  return data;
}

type AuthContextType = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string;
  notice: string;
  passwordSetup: boolean;
  setError: (msg: string) => void;
  setNotice: (msg: string) => void;
  setPasswordSetup: (val: boolean) => void;
  flash: (msg: string) => void;
  login: (email: string, pass: string) => Promise<void>;
  signup: (params: { email: string; pass: string; name: string; role: string; enrollment?: string }) => Promise<void>;
  recover: (email: string) => Promise<void>;
  updatePassword: (pass: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [passwordSetup, setPasswordSetup] = useState(false);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 4500);
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(""), 8000);
    return () => window.clearTimeout(t);
  }, [error]);

  const loadProfile = useCallback(async (s: Session) => {
    const rows = await request(
      `/rest/v1/profiles?id=eq.${s.user.id}&select=id,full_name,role,active,requested_role,enrollment_number`,
      s.access_token
    );
    setProfile((rows?.[0] as Profile) || null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session);
  }, [session, loadProfile]);

  useEffect(() => {
    (async () => {
      try {
        let s: Session | null = null;
        const params = new URLSearchParams(window.location.hash.slice(1));
        const inviteToken = params.get("access_token");
        const inviteRefresh = params.get("refresh_token");
        const inviteType = params.get("type");

        if (params.get("error_code")) {
          setError("That email link has expired or was already used. Request a fresh password link.");
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }

        if (inviteToken && inviteRefresh) {
          const user = await request("/auth/v1/user", inviteToken);
          s = {
            access_token: inviteToken,
            refresh_token: inviteRefresh,
            expires_at: Math.floor(Date.now() / 1000) + Number(params.get("expires_in") || 3600),
            user
          };
          localStorage.setItem("civicprep_session", JSON.stringify(s));
          if (inviteType === "invite" || inviteType === "recovery") setPasswordSetup(true);
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        } else {
          s = JSON.parse(localStorage.getItem("civicprep_session") || "null");
        }

        if (s?.refresh_token && (s.expires_at || 0) < Date.now() / 1000 + 60) {
          try {
            const n = await request("/auth/v1/token?grant_type=refresh_token", SUPABASE_ANON_KEY, "POST", {
              refresh_token: s.refresh_token
            });
            s = { ...n, expires_at: Math.floor(Date.now() / 1000) + n.expires_in };
            localStorage.setItem("civicprep_session", JSON.stringify(s));
          } catch {
            s = null;
            localStorage.removeItem("civicprep_session");
          }
        }

        setSession(s);
        if (s) await loadProfile(s);
      } catch (e: any) {
        setError(e?.message || "Session initialization failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadProfile]);

  const login = async (email: string, pass: string) => {
    setLoading(true);
    setError("");
    try {
      const n = await request("/auth/v1/token?grant_type=password", SUPABASE_ANON_KEY, "POST", { email, password: pass });
      const s = { ...n, expires_at: Math.floor(Date.now() / 1000) + n.expires_in };
      localStorage.setItem("civicprep_session", JSON.stringify(s));
      setSession(s);
      await loadProfile(s);
    } finally {
      setLoading(false);
    }
  };

  const signup = async ({ email, pass, name, role, enrollment }: { email: string; pass: string; name: string; role: string; enrollment?: string }) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${SUPABASE_BASE}/functions/v1/public-signup`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass, full_name: name, requested_role: role, enrollment_number: role === "student" ? enrollment : null })
      });
      const data: any = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create your account.");
      setNotice("Account created. Wait for a teacher to activate your account.");
    } finally {
      setLoading(false);
    }
  };

  const recover = async (email: string) => {
    const destination = "https://upsc-current-affairs-hub.mohammedjavvadkt.chatgpt.site";
    await request(`/auth/v1/recover?redirect_to=${encodeURIComponent(destination)}`, SUPABASE_ANON_KEY, "POST", { email });
    flash("If this address has an account, a fresh password link is on its way.");
  };

  const updatePassword = async (pass: string) => {
    if (!session?.access_token) throw new Error("No active session");
    await request("/auth/v1/user", session.access_token, "PUT", { password: pass });
    setPasswordSetup(false);
    flash("Password set. Welcome to CivicPrep.");
  };

  const logout = () => {
    if (session?.access_token) {
      request("/auth/v1/logout", session.access_token, "POST").catch(() => {});
    }
    localStorage.removeItem("civicprep_session");
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        error,
        notice,
        passwordSetup,
        setError,
        setNotice,
        setPasswordSetup,
        flash,
        login,
        signup,
        recover,
        updatePassword,
        logout,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
