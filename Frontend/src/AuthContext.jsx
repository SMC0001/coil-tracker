// src/auth/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "./srcapi.js";

const AuthContext = createContext(null);

function decodeRoleFromJWT(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload?.role || "user";
  } catch {
    return "user";
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [role, setRole] = useState(() => (token ? decodeRoleFromJWT(token) : "user"));

  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
      setRole(decodeRoleFromJWT(token));
    } else {
      localStorage.removeItem("token");
      setRole("user");
    }
  }, [token]);

  const login = async (username, password) => {
    const res = await api.post("/login", { username, password });
    setToken(res.data.token);
  };

  const logout = () => setToken("");

  const value = useMemo(() => ({ token, role, isAuthed: !!token, login, logout }), [token, role]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
