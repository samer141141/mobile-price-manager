"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
export default function LoginPage() {
  const router = useRouter(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState("");
  async function login(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      if (!supabase)
        throw new Error(
          "Configure the Supabase URL and publishable key in .env.local, then restart.",
        );
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login">
      <section className="login-card">
        <span className="brand-icon">Li</span>
        <p className="eyebrow">INVENTORY & INSIGHTS</p>
        <h1>Lager iPhone</h1>
        <p>Sign in to manage your phones and sales.</p>
        <form onSubmit={login}>
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {message && (
            <p role="alert" className="alert">
              {message}
            </p>
          )}
          <button className="primary" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <p className="login-footer">
          A simpler way to keep your inventory in order.
        </p>
      </section>
    </main>
  );
}
