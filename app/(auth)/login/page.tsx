"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";

export default function LoginPage() {
  const {
    session,
    profile,
    loading,
    error,
    notice,
    passwordSetup,
    login,
    signup,
    recover,
    updatePassword,
    setError,
    setNotice
  } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [signupRole, setSignupRole] = useState("student");
  const [signupEnrollment, setSignupEnrollment] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [signupMode, setSignupMode] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (session && profile?.active) {
      router.replace("/overview");
    } else if (session && profile && !profile.active) {
      router.replace("/pending");
    }
  }, [session, profile, loading, router]);

  if (loading) return <main className="center">Loading workspace…</main>;

  if (passwordSetup) {
    return (
      <main className="center">
        <div className="auth">
          <span className="logo"><BookOpen /></span>
          <h1>Set your password</h1>
          <p>Your email link is verified. Choose a password to finish joining.</p>
          <form onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            try {
              await updatePassword(newPassword);
              router.replace("/overview");
            } catch (err: any) {
              setError(err?.message || "Failed to save password");
            } finally {
              setBusy(false);
            }
          }}>
            <label>
              New password
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </main>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (recoveryMode) {
        await recover(email);
      } else if (signupMode) {
        await signup({
          email,
          pass: password,
          name: newName,
          role: signupRole,
          enrollment: signupEnrollment
        });
        setSignupMode(false);
        setPassword("");
        setNewName("");
        setSignupEnrollment("");
      } else {
        await login(email, password);
        setPassword("");
      }
    } catch (err: any) {
      setError(err?.message || "Authentication request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center">
      <div className="auth">
        <span className="logo"><BookOpen /></span>
        <h1>{recoveryMode ? "Set or reset password" : signupMode ? "Create your account" : "CivicPrep"}</h1>
        <p>
          {recoveryMode
            ? "We will email you a fresh link to choose a password."
            : signupMode
            ? "Student and teacher accounts need teacher approval before they can enter."
            : "UPSC current affairs workspace"}
        </p>
        <form onSubmit={handleSubmit}>
          {signupMode && (
            <>
              <label>
                Full name
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </label>
              <label>
                I am a
                <select value={signupRole} onChange={e => setSignupRole(e.target.value)}>
                  <option value="student">Student</option>
                  <option value="supervisor">Teacher</option>
                </select>
              </label>
              {signupRole === "student" && (
                <label>
                  Enrollment number
                  <input
                    required
                    maxLength={40}
                    value={signupEnrollment}
                    onChange={e => setSignupEnrollment(e.target.value)}
                    placeholder="Your college enrollment number"
                  />
                </label>
              )}
            </>
          )}
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </label>
          {!recoveryMode && (
            <label>
              Password
              <input
                required
                minLength={8}
                type="password"
                autoComplete={signupMode ? "new-password" : "current-password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </label>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Processing…" : recoveryMode ? "Send password link" : signupMode ? "Sign up" : "Sign in"}
          </button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="success" role="status">{notice}</p>}
        <button
          type="button"
          className="plain"
          onClick={() => {
            setRecoveryMode(!recoveryMode);
            setSignupMode(false);
            setError("");
            setNotice("");
          }}
        >
          {recoveryMode ? "Back to sign in" : "Forgot password?"}
        </button>
        {!recoveryMode && (
          <button
            type="button"
            className="plain"
            onClick={() => {
              setSignupMode(!signupMode);
              setError("");
              setNotice("");
            }}
          >
            {signupMode ? "Already have an account? Sign in" : "New student or teacher? Sign up"}
          </button>
        )}
      </div>
    </main>
  );
}
