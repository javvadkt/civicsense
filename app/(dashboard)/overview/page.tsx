"use client";

import { useAuth } from "../../../context/AuthContext";

export default function OverviewPage() {
  const { profile } = useAuth();

  return (
    <section className="card" style={{ padding: "24px" }}>
      <h2>Overview</h2>
      <p className="muted-desc">
        Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}. The full overview dashboard will migrate here in Step 2.1.
      </p>
    </section>
  );
}
