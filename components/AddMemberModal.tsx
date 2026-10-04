"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { SUPABASE_BASE, SUPABASE_ANON_KEY } from "../context/AuthContext";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  flash: (msg: string) => void;
  setError: (msg: string) => void;
  onCreated: () => Promise<void>;
};

export default function AddMemberModal({
  isOpen,
  onClose,
  token,
  flash,
  setError,
  onCreated
}: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");
  const [enrollment, setEnrollment] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${SUPABASE_BASE}/functions/v1/admin-create-member`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          full_name: name.trim(),
          email: email.trim(),
          password,
          role,
          enrollment_number: role === "supervisor" ? null : enrollment.trim()
        })
      });
      const data: any = await res.json();
      if (!res.ok) throw new Error(data.error || "Account creation failed.");

      setName("");
      setEmail("");
      setPassword("");
      setEnrollment("");
      flash(data.message || "Account created.");
      onClose();
      await onCreated();
    } catch (err: any) {
      setError(err?.message || "Failed to create account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal member-modal form-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-modal-title"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">NEW ACCOUNT</span>
            <h2 id="member-modal-title">Add member</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-scroll">
          <p>Set their sign-in email and initial password.</p>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <label>
                Full name
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </label>
              <label>
                Email address
                <input
                  required
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </label>
              <label>
                Initial password
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </label>
              <label>
                Role
                <select value={role} onChange={e => setRole(e.target.value)}>
                  <option value="student">Student</option>
                  <option value="student_leader">Student leader</option>
                  <option value="supervisor">Teacher</option>
                </select>
              </label>
              {role !== "supervisor" && (
                <label>
                  Enrollment number
                  <input
                    required
                    maxLength={40}
                    value={enrollment}
                    onChange={e => setEnrollment(e.target.value)}
                    placeholder="College enrollment / roll number"
                  />
                </label>
              )}
            </div>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
