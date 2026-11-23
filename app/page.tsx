"use client";

import { useEffect, useMemo, useState } from "react";
import { RECEIPT_FIELDS, type ReaderResponse } from "@/lib/claim-types";

const FIELD_LABELS: Record<(typeof RECEIPT_FIELDS)[number], string> = {
  beneficiary: "Beneficiary",
  serviceProvider: "Service Provider",
  date: "Date",
  month: "Month",
  natureOfExpense: "Nature of Expense",
  amount: "Amount",
};

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
  const [file, setFile] = useState<File | null>(null);
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const [reading, setReading] = useState(false);
  const [readerResult, setReaderResult] = useState<ReaderResponse | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);

  async function startClaim() {
    if (!file) return;
    setReading(true);
    setReaderError(null);
    setReaderResult(null);
    try {
      const body = new FormData();
      body.append("receipt", file);
      const res = await fetch("/api/reader", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reader failed");
      setReaderResult(data as ReaderResponse);
    } catch (e) {
      setReaderError(e instanceof Error ? e.message : "Reader failed");
    } finally {
      setReading(false);
    }
  }

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

      <section className="flex flex-col items-start gap-4">
        <h2 className="text-2xl font-semibold">Upload your receipt</h2>
        <label className="cursor-pointer rounded-md border border-dashed border-zinc-400 px-4 py-3">
          <span>{file ? "Change receipt" : "Choose receipt image"}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {file && previewUrl && (
          <div className="flex flex-col gap-2">
            {file.type === "application/pdf" ? (
              <iframe
                src={previewUrl}
                title="Receipt preview"
                className="h-[28rem] w-full max-w-xl rounded border border-zinc-400 bg-white"
              />
            ) : file.type === "image/heic" || file.type === "image/heif" ? (
              <div className="flex h-40 w-full max-w-xl items-center justify-center rounded border border-zinc-400 px-4 text-center text-sm opacity-75">
                HEIC photos can&apos;t be previewed in the browser, but the
                Reader can still process this file.
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Receipt preview"
                className="max-h-80 rounded border border-zinc-400"
              />
            )}
            <span className="text-sm opacity-75">{file.name}</span>
          </div>
        )}
        <button
          onClick={startClaim}
          disabled={!file || reading}
          className="rounded-md bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {reading ? "Reader is reading..." : "Start Claim"}
        </button>
        {readerError && (
          <p className="font-medium text-red-500">{readerError}</p>
        )}
      </section>

      {readerResult && (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold">
            Reader agent result{" "}
            <span className="text-sm font-normal opacity-75">
              ({readerResult.mode})
            </span>
          </h2>
          <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white text-zinc-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-100 text-zinc-700">
                <tr>
                  <th className="px-4 py-2">Field</th>
                  <th className="px-4 py-2">Value</th>
                  <th className="px-4 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {RECEIPT_FIELDS.map((key) => {
                  const f = readerResult.fields[key];
                  return (
                    <tr key={key} className="border-t border-zinc-200">
                      <td className="px-4 py-2 font-medium">
                        {FIELD_LABELS[key]}
                      </td>
                      <td className="px-4 py-2">{f.value ?? "Not found"}</td>
                      <td className="px-4 py-2">
                        {Math.round(f.confidence * 100)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
