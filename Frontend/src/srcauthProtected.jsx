// src/auth/Protected.jsx
import React from "react";
import { useAuth } from "./AuthContext";

export default function Protected({ children, requireAdmin = false }) {
  const { isAuthed, role } = useAuth();
  if (!isAuthed) return null;
  if (requireAdmin && role !== "admin") return null;
  return <>{children}</>;
}
