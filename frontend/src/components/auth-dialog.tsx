"use client";

import React, { useState } from "react";
import { Lock, LogIn, UserPlus } from "lucide-react";
import { API_BASE } from "@/lib/api";

interface AuthDialogProps {
  open: boolean;
}

export default function AuthDialog({ open }: AuthDialogProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        throw new Error(mode === "login" ? "Invalid email or password." : "Registration failed.");
      }
      const payload = await response.json();
      window.localStorage.setItem("access_token", payload.access_token);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              minLength={8}
              required
            />
          </label>
        </div>

        {error ? <p className="mt-3 text-xs font-medium text-danger">{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {isSubmitting ? "Please wait..." : mode === "login" ? "Sign in" : "Register"}
        </button>

        <button
          type="button"
          onClick={() => {
            setError("");
            setMode(mode === "login" ? "register" : "login");
          }}
          className="mt-3 w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
