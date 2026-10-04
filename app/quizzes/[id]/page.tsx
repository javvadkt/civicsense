"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";

export default function QuizPortalPage() {
  const params = useParams();
  const quizId = params?.id as string;
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <main className="center">Loading quiz portal…</main>;
  }

  if (!session || !profile || !profile.active) {
    return (
      <main className="center">
        <div className="auth" style={{ textAlign: "center" }}>
          <h2>Sign in required</h2>
          <p>You must be signed in to take a quiz.</p>
          <Link href="/login" className="primary" style={{ textDecoration: "none" }}>
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="quiz-portal" style={{ minHeight: "100vh" }}>
      <header className="portal-header">
        <div>
          <span className="eyebrow">CIVICPREP · QUIZ IN PROGRESS</span>
          <h1>Live Quiz ({quizId})</h1>
        </div>
        <Link href="/quizzes" className="outline" style={{ textDecoration: "none" }}>
          Exit to Quizzes
        </Link>
      </header>
      <div style={{ maxWidth: "800px", margin: "40px auto", padding: "0 20px" }}>
        <section className="card" style={{ padding: "28px" }}>
          <h2>Active Quiz Session</h2>
          <p className="muted-desc">
            The full-screen quiz runner, synchronized timer, and question navigator will migrate here in Step 2.5.
          </p>
        </section>
      </div>
    </div>
  );
}
