"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RECEIPT_FIELDS,
  type AgentName,
  type AuditResult,
  type ClaimResponse,
  type FilledForm,
  type PipelineEvent,
  type ReaderResult,
  type ReceiptFieldName,
} from "@/lib/claim-types";

const FIELD_LABELS: Record<ReceiptFieldName, string> = {
  beneficiary: "Beneficiary",
  serviceProvider: "Service Provider",
  date: "Date",
  month: "Month",
  natureOfExpense: "Nature of Expense",
  amount: "Amount",
};

type AgentItem = {
  kind: "agent";
  id: string;
  agent: AgentName;
  attempt: number;
  status: "working" | "done" | "failed";
  note: string;
  summary?: string;
  fields?: ReaderResult;
  audit?: AuditResult;
  form?: FilledForm;
};
type LoopItem = {
  kind: "loop";
  id: string;
  attempt: number;
  fields: ReceiptFieldName[];
};
type Item = AgentItem | LoopItem;

const AGENT_META = {
  reader: { name: "Reader", icon: "R", role: "Vision · extracts the receipt" },
  auditor: { name: "Auditor", icon: "A", role: "Policy · verifies the claim" },
  formFiller: { name: "Form Filler", icon: "F", role: "Document · fills the expense sheet" },
} as const;

const STANDBY = [
  { name: "Dispatcher", icon: "D", role: "Drafts the email to Accounts" },
];

export default function ClaimFlow() {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [result, setResult] = useState<ClaimResponse | null>(null);
  const [error, setError] = useState<{ message: string; hint: string } | null>(
    null,
  );

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleEvent(ev: PipelineEvent) {
    if (ev.type === "agent_start") {
      setItems((prev) => [
        ...prev,
        {
          kind: "agent",
          id: `${ev.agent}-${ev.attempt}`,
          agent: ev.agent,
          attempt: ev.attempt,
          status: "working",
          note: ev.note,
        },
      ]);
    } else if (ev.type === "agent_done") {
      setItems((prev) =>
        prev.map((it) =>
          it.kind === "agent" && it.id === `${ev.agent}-${ev.attempt}`
            ? {
                ...it,
                status: "done",
                summary: ev.summary,
                fields: ev.agent === "reader" ? ev.fields : undefined,
                audit: ev.agent === "auditor" ? ev.audit : undefined,
                form: ev.agent === "formFiller" ? ev.form : undefined,
              }
            : it,
        ),
      );
    } else if (ev.type === "loop_back") {
      setItems((prev) => [
        ...prev,
        {
          kind: "loop",
          id: `loop-${ev.attempt}`,
          attempt: ev.attempt,
          fields: ev.fields,
        },
      ]);
    } else if (ev.type === "complete") {
      setResult(ev.result);
    } else if (ev.type === "error") {
      failWorking();
      setError({ message: ev.message, hint: ev.hint });
    }
  }

  // Stop any spinning agent and mark it as failed.
  function failWorking() {
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "agent" && it.status === "working"
          ? { ...it, status: "failed" }
          : it,
      ),
    );
  }

  async function startClaim() {
    if (!file || running) return;
    setRunning(true);
    setItems([]);
    setResult(null);
    setError(null);

    // Watchdog: if nothing arrives for 90s, stop waiting and tell the user.
    const controller = new AbortController();
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, 90_000);
    };

    let finished = false; // got a complete or error event
    try {
      const body = new FormData();
      body.append("receipt", file);
      arm();
      const res = await fetch("/api/claim", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        finished = true;
        setError({
          message: data?.error ?? "The agents could not start.",
          hint: "Check that your file is a JPG, PNG, WebP, HEIC or PDF under 5 MB, then try again.",
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as PipelineEvent;
          if (ev.type === "complete" || ev.type === "error") finished = true;
          handleEvent(ev);
        }
      }
    } catch {
      finished = true;
      failWorking();
      setError(
        stalled
          ? {
              message: "The agents stopped responding.",
              hint: "The AI model may be overloaded. Wait a moment and try again.",
            }
          : {
              message: "Lost the connection to the agents.",
              hint: "Check your internet connection and try again.",
            },
      );
    } finally {
      clearTimeout(timer);
      // The stream ended without a result or an error (e.g. server cut off).
      if (!finished) {
        failWorking();
        setError({
          message: "The agents stopped before finishing.",
          hint: "This can happen if the server timed out. Please try again.",
        });
      }
      setRunning(false);
    }
  }

  const started = items.length > 0 || running;

  return (
    <div className="flex flex-col gap-10">
      {/* ---- Upload ---- */}
      <section className="agent-card p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-xs tracking-widest text-cyan-300">
            STEP 01
          </span>
          <h2 className="text-xl font-semibold">Drop in your receipt</h2>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex flex-col gap-4">
            <label className="cursor-pointer rounded-lg border border-dashed border-cyan-400/50 bg-cyan-400/5 px-5 py-4 text-sm text-cyan-100 transition hover:bg-cyan-400/10">
              {file ? "Change receipt" : "Choose receipt (JPG, PNG, WebP, HEIC or PDF)"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                className="hidden"
                disabled={running}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setItems([]);
                  setResult(null);
                  setError(null);
                }}
              />
            </label>
            <button
              onClick={startClaim}
              disabled={!file || running}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 px-6 py-3 font-semibold text-black shadow-[0_0_24px_rgba(34,211,238,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {running ? "Agents at work…" : "▶ Start Claim"}
            </button>
          </div>

          {file && previewUrl && (
            <div className="flex flex-1 flex-col gap-2">
              {file.type === "application/pdf" ? (
                <iframe
                  src={previewUrl}
                  title="Receipt preview"
                  className="h-96 w-full rounded-lg border border-slate-600 bg-white"
                />
              ) : file.type === "image/heic" || file.type === "image/heif" ? (
                <div className="flex h-40 items-center justify-center rounded-lg border border-slate-600 px-4 text-center text-sm text-slate-300">
                  HEIC photos can&apos;t be previewed in the browser, but the
                  Reader can still process this file.
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Receipt preview"
                  className="max-h-96 w-auto self-start rounded-lg border border-slate-600"
                />
              )}
              <span className="font-mono text-xs text-slate-400">{file.name}</span>
            </div>
          )}
        </div>
      </section>

      {/* ---- Agent timeline ---- */}
      {started && (
        <section>
          <div className="mb-5 flex items-center gap-3">
            <span className="font-mono text-xs tracking-widest text-cyan-300">
              STEP 02
            </span>
            <h2 className="text-xl font-semibold">Agents at work</h2>
            {running && (
              <span className="font-mono text-xs text-cyan-300">
                LIVE<span className="blink">_</span>
              </span>
            )}
          </div>

          <div className="flex flex-col">
            {items.map((it, i) => (
              <div key={it.id} className="step-in">
                {i > 0 && (
                  <div
                    className={`connector ${it.kind === "agent" && it.status === "working" ? "flow" : ""}`}
                  />
                )}
                {it.kind === "loop" ? (
                  <LoopBanner item={it} />
                ) : (
                  <AgentCard item={it} />
                )}
              </div>
            ))}

            {/* Agents that come after approval */}
            {result?.audit.verdict === "approved" && (
              <>
                {STANDBY.map((s) => (
                  <div key={s.name} className="step-in">
                    <div className="connector" />
                    <div className="agent-card is-standby flex items-center gap-4 p-4">
                      <Badge icon={s.icon} state="standby" />
                      <div>
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-sm text-slate-400">{s.role}</div>
                      </div>
                      <span className="ml-auto font-mono text-xs text-slate-400">
                        NEXT UP
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      )}

      {error && (
        <section className="agent-card is-bad step-in p-6">
          <div className="flex items-start gap-4">
            <span className="text-3xl text-red-300">⚠</span>
            <div className="flex-1">
              <div className="font-mono text-xs tracking-widest text-red-300">
                CLAIM STOPPED
              </div>
              <div className="mt-1 text-lg font-semibold">{error.message}</div>
              <div className="mt-1 text-sm text-slate-300">{error.hint}</div>
              <button
                onClick={startClaim}
                disabled={running || !file}
                className="mt-4 rounded-lg border border-red-400/60 bg-red-400/10 px-5 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-400/20 disabled:opacity-40"
              >
                ↻ Try again
              </button>
            </div>
          </div>
        </section>
      )}

      {result && <Verdict result={result} />}
    </div>
  );
}

function Badge({
  icon,
  state,
}: {
  icon: string;
  state: "working" | "done" | "warn" | "bad" | "standby";
}) {
  const colors = {
    working: "border-cyan-400 text-cyan-300",
    done: "border-emerald-400 text-emerald-300",
    warn: "border-amber-400 text-amber-300",
    bad: "border-red-400 text-red-300",
    standby: "border-slate-600 text-slate-400",
  };
  return (
    <div
      className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 bg-black/40 font-mono text-xl font-bold ${colors[state]}`}
    >
      {state === "working" && (
        <>
          <span className="orbit-glow" />
          <span className="orbit" />
        </>
      )}
      <span className="relative">
        {state === "done" ? "✓" : state === "bad" ? "✕" : icon}
      </span>
    </div>
  );
}

function AgentCard({ item }: { item: AgentItem }) {
  const meta = AGENT_META[item.agent];
  const verdict = item.audit?.verdict;
  const state =
    item.status === "failed"
      ? "bad"
      : item.status === "working"
      ? "working"
      : verdict === "needs_reread"
        ? "warn"
        : verdict === "rejected"
          ? "bad"
          : "done";
  const cardClass =
    state === "working"
      ? "is-working"
      : state === "warn"
        ? "is-warn"
        : state === "bad"
          ? "is-bad"
          : "is-done";

  return (
    <div className={`agent-card ${cardClass} p-5`}>
      <div className="flex items-center gap-4">
        <Badge icon={meta.icon} state={state} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{meta.name} Agent</span>
            {item.attempt > 1 && (
              <span className="rounded bg-amber-400/15 px-2 py-0.5 font-mono text-xs text-amber-300">
                PASS {item.attempt}
              </span>
            )}
          </div>
          <div className="text-sm text-slate-400">{meta.role}</div>
        </div>
        <span
          className={`ml-auto shrink-0 font-mono text-xs tracking-wider ${
            state === "working"
              ? "text-cyan-300"
              : state === "warn"
                ? "text-amber-300"
                : state === "bad"
                  ? "text-red-300"
                  : "text-emerald-300"
          }`}
        >
          {state === "working"
            ? "WORKING"
            : state === "warn"
              ? "LOOP BACK"
              : state === "bad"
                ? item.status === "failed"
                  ? "FAILED"
                  : "REJECTED"
                : "DONE"}
        </span>
      </div>

      {item.status === "working" && (
        <div className="mt-4">
          <div className="mb-2 font-mono text-sm text-cyan-200">
            {item.note}
            <span className="blink">…</span>
          </div>
          <div className="scan-bar" />
        </div>
      )}

      {item.status === "failed" && (
        <div className="mt-4 font-mono text-sm text-red-300">
          Stopped before finishing: {item.note}
        </div>
      )}

      {item.status === "done" && item.fields && <FieldsTable fields={item.fields} />}
      {item.status === "done" && item.audit && <AuditChecks audit={item.audit} />}
      {item.status === "done" && item.form && <FormPreview form={item.form} />}
    </div>
  );
}

// Confidence levels: High 90%+, Medium 70-89% (meets policy), Low under 70%.
function level(pct: number) {
  if (pct >= 90)
    return { label: "HIGH", text: "text-emerald-300", bar: "bg-emerald-400", hex: "#34d399" };
  if (pct >= 70)
    return { label: "MEDIUM", text: "text-amber-300", bar: "bg-amber-400", hex: "#fbbf24" };
  return { label: "LOW", text: "text-red-300", bar: "bg-red-400", hex: "#f87171" };
}

function FieldsTable({ fields }: { fields: ReaderResult }) {
  const scores = RECEIPT_FIELDS.map((k) => fields[k].confidence);
  const overall = Math.round(
    (scores.reduce((a, b) => a + b, 0) / scores.length) * 100,
  );
  const overallLevel = level(overall);

  return (
    <div className="mt-5">
      {/* Overall read quality */}
      <div className="mb-4 flex items-center gap-4 rounded-xl border border-slate-700/70 bg-black/30 p-4">
        <div
          className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(${overallLevel.hex} ${overall * 3.6}deg, rgba(100,116,139,0.3) 0deg)`,
          }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#080c16] font-mono text-sm font-bold">
            {overall}%
          </div>
        </div>
        <div>
          <div className="font-mono text-xs tracking-widest text-slate-400">
            OVERALL READ QUALITY
          </div>
          <div className={`text-lg font-semibold ${overallLevel.text}`}>
            {overallLevel.label} confidence
          </div>
          <div className="text-xs text-slate-400">
            Average across all {RECEIPT_FIELDS.length} extracted fields
          </div>
        </div>
      </div>

      {/* Per-field results */}
      <div className="grid gap-3 sm:grid-cols-2">
        {RECEIPT_FIELDS.map((key) => {
          const f = fields[key];
          const pct = Math.round(f.confidence * 100);
          const lv = level(pct);
          return (
            <div
              key={key}
              className="rounded-xl border border-slate-700/70 bg-black/30 p-3"
            >
              <div className="text-xs uppercase tracking-wider text-slate-400">
                {FIELD_LABELS[key]}
              </div>
              <div className="mt-0.5 truncate text-base font-semibold">
                {f.value ?? "Not found"}
              </div>

              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: lv.hex, boxShadow: `0 0 6px ${lv.hex}` }}
                  />
                  {lv.label.charAt(0) + lv.label.slice(1).toLowerCase()} confidence
                </span>
                <span className="tabular-nums text-slate-200">{pct}%</span>
              </div>

              <div
                className="mt-2 h-1 overflow-hidden rounded bg-slate-700"
                title={`${pct}% confident (policy minimum 70%)`}
              >
                <div
                  className={`h-full ${lv.bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-xs text-slate-500">
        Fields below 70% confidence are sent back to the Reader by the Auditor.
      </div>
    </div>
  );
}

function AuditChecks({ audit }: { audit: AuditResult }) {
  return (
    <div className="mt-4">
      <ul className="grid gap-2">
        {audit.checks.map((c) => (
          <li
            key={c.id}
            className="flex items-start gap-3 rounded-lg border border-slate-700/70 bg-black/30 px-3 py-2"
          >
            <span
              className={`mt-0.5 font-mono font-bold ${c.passed ? "text-emerald-400" : "text-red-400"}`}
            >
              {c.passed ? "✓" : "✕"}
            </span>
            <div>
              <div className="text-sm font-medium">{c.label}</div>
              <div className="text-xs text-slate-400">{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-slate-300">{audit.reason}</p>
    </div>
  );
}

function FormPreview({ form }: { form: FilledForm }) {
  const href = `data:application/pdf;base64,${form.pdfBase64}`;
  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-xs text-slate-400">{form.filename}</div>
        <a
          href={href}
          download={form.filename}
          className="rounded-lg border border-emerald-400/60 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
        >
          ⬇ Download PDF
        </a>
      </div>
      <iframe
        src={`${href}#toolbar=0&navpanes=0`}
        title="Filled expense sheet"
        className="h-[34rem] w-full rounded-lg border border-slate-600 bg-white"
      />
    </div>
  );
}

function LoopBanner({ item }: { item: LoopItem }) {
  return (
    <div className="loop-banner flex items-center gap-4 px-5 py-4">
      <span className="loop-arrow text-2xl text-amber-300">↻</span>
      <div>
        <div className="font-semibold text-amber-200">
          Auditor sent the receipt back to the Reader
        </div>
        <div className="text-sm text-amber-100/80">
          Re-reading: {item.fields.map((f) => FIELD_LABELS[f]).join(", ")} (retry{" "}
          {item.attempt})
        </div>
      </div>
    </div>
  );
}

function Verdict({ result }: { result: ClaimResponse }) {
  const approved = result.audit.verdict === "approved";
  return (
    <section
      className={`agent-card step-in p-6 ${approved ? "is-done" : "is-bad"}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`text-3xl ${approved ? "text-emerald-300" : "text-red-300"}`}
        >
          {approved ? "✓" : "✕"}
        </span>
        <div>
          <div className="text-xl font-semibold">
            {approved ? "Claim approved by the Auditor" : "Claim rejected"}
          </div>
          <div className="text-sm text-slate-300">{result.audit.reason}</div>
        </div>
        <span className="ml-auto font-mono text-xs text-slate-500">
          {result.mode.toUpperCase()} MODE
        </span>
      </div>
    </section>
  );
}
