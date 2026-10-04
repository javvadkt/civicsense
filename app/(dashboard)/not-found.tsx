import Link from "next/link";
import { BookOpen } from "lucide-react";

export default function NotFound() {
  return (
    <main className="center">
      <div className="auth" style={{ textAlign: "center" }}>
        <span className="logo" style={{ margin: "0 auto 16px" }}>
          <BookOpen />
        </span>
        <h1 style={{ margin: "0 0 8px" }}>Page Not Found</h1>
        <p style={{ margin: "0 0 24px" }}>
          The page you requested does not exist or has moved.
        </p>
        <Link
          href="/"
          className="primary"
          style={{ width: "100%", textDecoration: "none" }}
        >
          Return to workspace
        </Link>
      </div>
    </main>
  );
}
