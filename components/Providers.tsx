"use client";

import React from "react";
import { AuthProvider } from "../context/AuthContext";
import QueryProvider from "./QueryProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>{children}</AuthProvider>
    </QueryProvider>
  );
}
