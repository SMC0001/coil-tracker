import { useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "/api";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await axios.post(`${API}/login`, { username, password });
      localStorage.setItem("token", res.data.token); // save token
      onLogin(res.data.token); // ✅ pass token to App.jsx
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-slate-100">
      <form
        onSubmit={handleSubmit}
        className="bg-white shadow rounded-lg p-6 w-80 space-y-4"
      >
        <h2 className="text-xl font-bold">Login</h2>

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <input
          type="text"
          placeholder="Username"
          className="border rounded px-3 py-2 w-full"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <input
          type="password"
          placeholder="Password"
          className="border rounded px-3 py-2 w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-sky-600 text-white rounded px-3 py-2"
        >
          {loading ? "Logging in…" : "Login"}
        </button>
      </form>
    </div>
  );
}
