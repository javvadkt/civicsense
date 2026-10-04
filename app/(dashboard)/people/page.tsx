"use client";

import { useCallback, useEffect, useState } from "react";
import { MoreVertical, Plus, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, request } from "../../../context/AuthContext";
import type { Duty } from "../../../context/DataProvider";
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
  const queryClient = useQueryClient();
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

  // 1. Full people directory
  const {
    data: people = [],
    isLoading: peopleLoading,
    isFetching: peopleFetching
  } = useQuery<any[]>({
    queryKey: ["people_directory"],
    queryFn: () =>
      request(
        "/rest/v1/profiles?select=id,full_name,role,active,requested_role,enrollment_number&order=full_name.asc",
        token
      ).catch(() => []),
    enabled: Boolean(token && isTeacher)
  });

  // 2. Scheduled duties for deactivation impact checks
  const { data: upcomingDuties = [] } = useQuery<Duty[]>({
    queryKey: ["upcoming_duties_summary", today],
    queryFn: () =>
      request(
        `/rest/v1/duties?duty_date=gte.${today}&select=id,student_id,duty_date`,
        token
      ).catch(() => []),
    enabled: Boolean(token && isTeacher)
  });

  const invalidatePeople = useCallback(async () => {
    queryClient.invalidateQueries({ queryKey: ["people_directory"] });
    queryClient.invalidateQueries({ queryKey: ["overview_stats"] });
    queryClient.invalidateQueries({ queryKey: ["duty_availability"] });
    queryClient.invalidateQueries({ queryKey: ["gradebook_matrix"] });
  }, [queryClient]);

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <div>
            <h3 style={{ margin: 0 }}>Members ({people.length})</h3>
            <p style={{ margin: "4px 0 0 0" }}>
              Approve student and teacher sign-ups, change member roles, and manage workspace access.
            </p>
          </div>
          {peopleFetching && !peopleLoading && (
            <span className="muted" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <RefreshCw size={13} /> Updating directory…
            </span>
          )}
        </div>

        <label className="member-search" style={{ marginTop: "16px" }}>
          Find a member
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or enrollment number"
          />
        </label>

        {peopleLoading ? (
          <div className="empty">Loading member directory…</div>
        ) : (
          filteredPeople.map(p => {
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
          })
        )}

        {!filteredPeople.length && !peopleLoading && <div className="empty">No members found.</div>}
      </section>

      <AddMemberModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        token={token}
        flash={flash}
        setError={setError}
        onCreated={invalidatePeople}
      />

      <ChangeRoleModal
        target={roleModalTarget}
        onClose={() => setRoleModalTarget(null)}
        token={token}
        flash={flash}
        setError={setError}
        onUpdated={invalidatePeople}
      />

      <DeactivateModal
        target={deactivateModalTarget}
        onClose={() => setDeactivateModalTarget(null)}
        token={token}
        duties={upcomingDuties}
        today={today}
        flash={flash}
        setError={setError}
        onUpdated={invalidatePeople}
      />

      <ApproveModal
        target={approveModalTarget}
        onClose={() => setApproveModalTarget(null)}
        token={token}
        flash={flash}
        setError={setError}
        onUpdated={invalidatePeople}
      />
    </>
  );
}
