"use client";

import { useState } from "react";

type Health = { app: string; status: string; llmMode: string; time: string };

const AGENTS = [
  { name: "Reader", desc: "Extracts details from the receipt" },
  { name: "Auditor", desc: "Checks month, caps and duplicates" },
  { name: "Form Filler", desc: "Completes the reimbursement form" },
  { name: "Dispatcher", desc: "Drafts the email to Accounts" },
];

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkBackend() {
    setError(null);
    try {
      const res = await fetch("/api/health");
      setHealth(await res.json());
    } catch {
      setError("Backend not reachable");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">ClaimCrew</h1>
        <p className="mt-2 text-lg opacity-75">
          Four agents. One receipt. Zero paperwork.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {AGENTS.map((a, i) => (
          <div
            key={a.name}
            className="rounded-lg border border-zinc-300 bg-white p-4 text-zinc-900"
          >
            <div className="text-sm text-zinc-500">Agent {i + 1}</div>
            <div className="font-semibold">{a.name}</div>
            <div className="text-sm text-zinc-700">{a.desc}</div>
          </div>
        ))}
      </section>

      <section className="flex flex-col items-start gap-3">
        <button
          onClick={checkBackend}
          className="rounded-md border border-zinc-400 bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Check backend
        </button>
        {health && (
          <pre className="rounded border border-zinc-600 bg-zinc-900 p-3 text-sm text-zinc-100">
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
        {error && <p className="font-medium text-red-500">{error}</p>}
      </section>
    </main>
  );
}
