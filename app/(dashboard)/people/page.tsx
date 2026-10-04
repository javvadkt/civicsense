"use client";

import { useEffect, useState } from "react";
import { MoreVertical, Plus } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useAppData } from "../../../context/DataProvider";
import AddMemberModal from "../../../components/AddMemberModal";
import {
  ChangeRoleModal,
  DeactivateModal,
  ApproveModal
} from "../../../components/MemberActionModals";

const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const roleLabels: Record<string, string> = {
  supervisor: "Teacher",
  student_leader: "Student leader",
  student: "Student"
};

export default function PeoplePage() {
  const { session, profile, flash, setError } = useAuth();
  const { people, duties, reload } = useAppData();
  const token = session?.access_token || "";
  const isTeacher = profile?.role === "supervisor";
  const today = getTodayIST();

  const [search, setSearch] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [memberKebabId, setMemberKebabId] = useState<string | null>(null);

  const [roleModalTarget, setRoleModalTarget] = useState<any | null>(null);
  const [deactivateModalTarget, setDeactivateModalTarget] = useState<any | null>(null);
  const [approveModalTarget, setApproveModalTarget] = useState<any | null>(null);

  useEffect(() => {
    if (!memberKebabId) return;
    const close = () => setMemberKebabId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [memberKebabId]);

  if (!isTeacher) return null;

  const filteredPeople = people.filter(p =>
    `${p.full_name} ${p.enrollment_number || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="section-title">
        <p>Add accounts directly, or approve sign-ups below.</p>
        <button
          type="button"
          className="primary"
          onClick={() => setAddModalOpen(true)}
        >
          <Plus size={16} /> Add member
        </button>
      </div>

      <section className="card">
        <h3>Members ({people.length})</h3>
        <p>Approve student and teacher sign-ups, change member roles, and manage workspace access.</p>

        <label className="member-search">
          Find a member
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or enrollment number"
          />
        </label>

        {filteredPeople.map(p => {
          const isPending = !p.active && Boolean(p.requested_role);
          const isInactive = !p.active && !p.requested_role;
          const isSelf = p.id === profile?.id;

          return (
            <div className="row member ppl-row" key={p.id}>
              <div className="ppl-info">
                <strong>
                  {p.full_name}
                  {p.enrollment_number ? ` · ${p.enrollment_number}` : ""}
                </strong>
                <div className="ppl-chips">
                  {isPending ? (
                    <>
                      <span className="role-chip role-requested">
                        Requested: {roleLabels[p.requested_role!] || p.requested_role}
                      </span>
                      <span className="role-chip role-pending">Waiting for approval</span>
                    </>
                  ) : isInactive ? (
                    <>
                      <span className={`role-chip role-${p.role}`}>{roleLabels[p.role] || p.role}</span>
                      <span className="role-chip role-inactive">Inactive</span>
                    </>
                  ) : (
                    <span className={`role-chip role-${p.role}`}>{roleLabels[p.role] || p.role}</span>
                  )}
                </div>
              </div>

              <div className="ppl-actions" style={{ marginLeft: "auto", flex: "0 0 auto" }}>
                {isPending ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setApproveModalTarget(p)}
                  >
                    Approve
                  </button>
                ) : !isSelf ? (
                  <div className="ppl-kebab-anchor" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Member options"
                      onClick={() => setMemberKebabId(memberKebabId === p.id ? null : p.id)}
                    >
                      <MoreVertical size={16} />
                    </button>

                    {memberKebabId === p.id && (
                      <div className="qz-pop ppl-pop">
                        <button
                          type="button"
                          className="plain"
                          onClick={() => {
                            setMemberKebabId(null);
                            setRoleModalTarget(p);
                          }}
                        >
                          Change role
                        </button>
                        <button
                          type="button"
                          className="plain"
                          onClick={() => {
                            setMemberKebabId(null);
                            setDeactivateModalTarget(p);
                          }}
                        >
                          {p.active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {!filteredPeople.length && <div className="empty">No members found.</div>}
      </section>

      <AddMemberModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        token={token}
        flash={flash}
        setError={setError}
        onCreated={reload}
      />

      <ChangeRoleModal
        target={roleModalTarget}
        onClose={() => setRoleModalTarget(null)}
        token={token}
        flash={flash}
        setError={setError}
        onUpdated={reload}
      />

      <DeactivateModal
        target={deactivateModalTarget}
        onClose={() => setDeactivateModalTarget(null)}
        token={token}
        duties={duties}
        today={today}
        flash={flash}
        setError={setError}
        onUpdated={reload}
      />

      <ApproveModal
        target={approveModalTarget}
        onClose={() => setApproveModalTarget(null)}
        token={token}
        flash={flash}
        setError={setError}
        onUpdated={reload}
      />
    </>
  );
}
