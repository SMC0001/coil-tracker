// src/auth/LoginForm.jsx
import React, { useState } from "react";
import { useAuth } from "./AuthContext";

export default function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await login(username, password);
    } catch (e) {
      setErr(e.response?.data?.error || "Login failed");
    }
  };

  return (
    <form onSubmit={onSubmit} className="max-w-sm mx-auto p-4 border rounded space-y-3">
      <h2 className="text-lg font-bold">Sign in</h2>
      {err && <div className="text-red-600 text-sm">{err}</div>}
      <input
        className="border rounded px-3 py-2 w-full"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="border rounded px-3 py-2 w-full"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button className="w-full bg-sky-600 text-white rounded px-3 py-2">Login</button>
    </form>
  );
}
