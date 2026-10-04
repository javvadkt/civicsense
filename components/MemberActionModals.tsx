"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { request } from "../context/AuthContext";
import type { Duty } from "../context/DataProvider";

type Profile = {
  id: string;
  full_name: string;
  role: string;
  active: boolean;
  requested_role?: ("supervisor" | "student") | null;
  enrollment_number?: string | null;
};

type CommonProps = {
  target: Profile | null;
  onClose: () => void;
  token: string;
  flash: (msg: string) => void;
  setError: (msg: string) => void;
  onUpdated: () => Promise<void>;
};

export function ChangeRoleModal({
  target,
  onClose,
  token,
  flash,
  setError,
  onUpdated
}: CommonProps) {
  const [role, setRole] = useState("student");
  const [enrollment, setEnrollment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setRole(target.role);
      setEnrollment(target.enrollment_number || "");
    }
  }, [target]);

  if (!target) return null;

  const handleSave = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/rest/v1/rpc/admin_manage_profile", token, "POST", {
        p_profile_id: target.id,
        p_role: role,
        p_enrollment_number: ["student", "student_leader"].includes(role) ? enrollment.trim() : null,
        p_active: target.active
      });
      flash(`Updated role for ${target.full_name}.`);
      onClose();
      await onUpdated();
    } catch (err: any) {
      setError(err?.message || "Failed to update member role");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "460px" }}>
        <div className="modal-head">
          <div><span className="eyebrow">MEMBER MANAGEMENT</span><h2>Change role</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <p style={{ margin: 0, fontSize: "14px" }}>Update role for <b>{target.full_name}</b>.</p>
          <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 700 }}>
            Role
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="student">Student</option>
              <option value="student_leader">Student leader</option>
              <option value="supervisor">Teacher</option>
            </select>
          </label>
          {["student", "student_leader"].includes(role) && (
            <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 700 }}>
              Enrollment number (required)
              <input required type="text" maxLength={40} value={enrollment} onChange={e => setEnrollment(e.target.value)} placeholder="College enrollment / roll number" />
            </label>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
            <button type="button" className="outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="primary" disabled={busy || (["student", "student_leader"].includes(role) && !enrollment.trim())} onClick={handleSave}>
              {busy ? "Saving…" : "Save role"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function DeactivateModal({
  target,
  onClose,
  token,
  duties,
  today,
  flash,
  setError,
  onUpdated
}: CommonProps & { duties: Duty[]; today: string }) {
  const [busy, setBusy] = useState(false);
  if (!target) return null;

  const willDeactivate = target.active;
  const upcomingDutiesCount = duties.filter(d => d.student_id === target.id && d.duty_date >= today).length;

  const handleToggle = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/rest/v1/rpc/admin_manage_profile", token, "POST", {
        p_profile_id: target.id,
        p_role: target.role,
        p_enrollment_number: target.enrollment_number || null,
        p_active: !willDeactivate
      });
      flash(willDeactivate ? `Deactivated ${target.full_name}.` : `Activated ${target.full_name}.`);
      onClose();
      await onUpdated();
    } catch (err: any) {
      setError(err?.message || "Failed to update member status");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "480px" }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow" style={{ color: willDeactivate ? "#ef4444" : "#10b981" }}>
              CONFIRM {willDeactivate ? "DEACTIVATION" : "ACTIVATION"}
            </span>
            <h2>{willDeactivate ? "Deactivate member?" : "Activate member?"}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <p style={{ margin: 0, fontSize: "14px" }}>
            {willDeactivate ? <>Deactivate <b>{target.full_name}</b>?</> : <>Reactivate <b>{target.full_name}</b> and restore workspace access?</>}
          </p>
          {willDeactivate && upcomingDutiesCount > 0 && (
            <div className="card" style={{ padding: "12px", background: "#fef2f2", border: "1px solid #fee2e2", margin: 0 }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#991b1b" }}>
                This member currently has <b>{upcomingDutiesCount}</b> upcoming {upcomingDutiesCount === 1 ? "duty" : "duties"}. They will lose access immediately and will be skipped in future rotation cycles.
              </p>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
            <button type="button" className="outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              type="button"
              className={willDeactivate ? "danger-outline" : "primary"}
              style={willDeactivate ? { background: "#ef4444", color: "#fff", borderColor: "#ef4444" } : {}}
              disabled={busy}
              onClick={handleToggle}
            >
              {busy ? "Updating…" : willDeactivate ? "Yes, deactivate" : "Yes, activate"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ApproveModal({
  target,
  onClose,
  token,
  flash,
  setError,
  onUpdated
}: CommonProps) {
  const [role, setRole] = useState("student");
  const [enrollment, setEnrollment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setRole(target.requested_role || "student");
      setEnrollment(target.enrollment_number || "");
    }
  }, [target]);

  if (!target) return null;

  const handleApprove = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/rest/v1/rpc/admin_manage_profile", token, "POST", {
        p_profile_id: target.id,
        p_role: role,
        p_enrollment_number: ["student", "student_leader"].includes(role) ? enrollment.trim() : null,
        p_active: true
      });
      flash(`Approved and activated ${target.full_name}.`);
      onClose();
      await onUpdated();
    } catch (err: any) {
      setError(err?.message || "Failed to approve member");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="modal form-card" role="dialog" aria-modal="true" style={{ maxWidth: "460px" }}>
        <div className="modal-head">
          <div><span className="eyebrow" style={{ color: "#10b981" }}>APPROVE SIGNUP</span><h2>Approve member</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <p style={{ margin: 0, fontSize: "14px" }}>Approve and activate account for <b>{target.full_name}</b>.</p>
          <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 700 }}>
            Role
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="student">Student</option>
              <option value="student_leader">Student leader</option>
              <option value="supervisor">Teacher</option>
            </select>
          </label>
          {["student", "student_leader"].includes(role) && (
            <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 700 }}>
              Enrollment number (required)
              <input required type="text" maxLength={40} value={enrollment} onChange={e => setEnrollment(e.target.value)} placeholder="College enrollment / roll number" />
            </label>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
            <button type="button" className="outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="primary" disabled={busy || (["student", "student_leader"].includes(role) && !enrollment.trim())} onClick={handleApprove}>
              {busy ? "Approving…" : "Approve & activate"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
