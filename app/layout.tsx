import type { Metadata } from "next";
import Providers from "../components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "CivicPrep — UPSC Current Affairs Hub",
  description: "A shared workspace to contribute, verify, and practise UPSC current affairs.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
