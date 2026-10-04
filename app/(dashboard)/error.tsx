"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route error:", error);
  }, [error]);

  return (
    <div className="card" style={{ padding: "28px" }}>
      <div
        className="toast-error"
        style={{
          padding: "14px",
          borderRadius: "10px",
          marginBottom: "16px",
          border: "1px solid #f0c4c0",
        }}
      >
        <strong style={{ display: "block", marginBottom: "4px" }}>
          Something went wrong loading this screen
        </strong>
        <p style={{ margin: 0, fontSize: "14px" }}>
          {error.message || "An unexpected error occurred."}
        </p>
      </div>
      <button type="button" className="primary" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
