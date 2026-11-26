"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { draftToHtml } from "@/lib/email-html";
import { FIELD_LABELS } from "@/lib/claim-configs";
import { POLICY } from "@/lib/policy";
import {
  type AgentName,
  type AuditResult,
  type Classification,
  type ClaimResponse,
  type EmailDraft,
  type FilledForm,
  type PipelineEvent,
  type ReaderResult,
  type ReceiptFieldName,
} from "@/lib/claim-types";

const labelOf = (key: string) => FIELD_LABELS[key] ?? key;

// Made-up receipts in public/samples: a happy path, retry loops, and a direct reject.
type Sample = {
  file: string;
  kind: string;
  title: string;
  tag: string;
  tone: "happy" | "loop" | "reject";
};
const SAMPLES: Sample[] = [
  {
    file: "stormfiber-payment-receipt.pdf",
    kind: "Internet bill",
    title: "StormFiber payment receipt",
    tag: "Clean claim",
    tone: "happy",
  },
  {
    file: "stormfiber-missing-holder.pdf",
    kind: "Internet bill",
    title: "Account holder missing",
    tag: "Retries, then rejected",
    tone: "loop",
  },
  {
    file: "iron-peak-gym-receipt.pdf",
    kind: "Health club",
    title: "Iron Peak Fitness Club",
    tag: "Clean claim",
    tone: "happy",
  },
  {
    file: "iron-peak-gym-faded-name.jpg",
    kind: "Health club",
    title: "Faded member name",
    tag: "Retries, then recovers",
    tone: "loop",
  },
  {
    file: "iron-peak-gym-last-year.pdf",
    kind: "Health club",
    title: "Last year's receipt",
    tag: "Rejected immediately",
    tone: "reject",
  },
];

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

// The user's designation is remembered in the browser so it is typed only once.
const DESIGNATION_KEY = "claimcrew-designation";
const DESIGNATION_EVENT = "claimcrew-designation-change";
const subscribeDesignation = (cb: () => void) => {
  window.addEventListener(DESIGNATION_EVENT, cb);
  return () => window.removeEventListener(DESIGNATION_EVENT, cb);
};
const readDesignation = () => localStorage.getItem(DESIGNATION_KEY) ?? "";
function saveDesignation(value: string) {
  localStorage.setItem(DESIGNATION_KEY, value);
  window.dispatchEvent(new Event(DESIGNATION_EVENT));
}

type AgentItem = {
  kind: "agent";
  id: string;
  agent: AgentName;
  attempt: number;
  status: "working" | "done" | "failed";
  note: string;
  summary?: string;
  classification?: Classification;
  fields?: ReaderResult;
  audit?: AuditResult;
  form?: FilledForm;
  draft?: EmailDraft;
};
type LoopItem = {
  kind: "loop";
  id: string;
  attempt: number;
  fields: ReceiptFieldName[];
};
type Item = AgentItem | LoopItem;

const AGENT_META = {
  classifier: {
    name: "Classifier",
    icon: "C",
    role: "Intent · identifies the claim type",
    blurb: "Looks at the receipt and decides whether it is an internet bill or a health club claim.",
  },
  reader: {
    name: "Reader",
    icon: "R",
    role: "Vision · extracts the receipt",
    blurb: "Reads the receipt and pulls out only the fields the company form needs.",
  },
  auditor: {
    name: "Auditor",
    icon: "A",
    role: "Policy · verifies the claim",
    blurb: "Checks the claim against policy and sends unclear reads back to the Reader.",
  },
  formFiller: {
    name: "Form Filler",
    icon: "F",
    role: "Tools · fills the expense sheet",
    blurb: "Chooses the right document tool and fills in the company expense sheet. The tool works out the reimbursable amount.",
  },
  dispatcher: {
    name: "Dispatcher",
    icon: "D",
    role: "Comms · drafts the email to Accounts",
    blurb: "Drafts the email to Accounts with the receipt and the filled form attached.",
  },
} as const;

export default function ClaimFlow() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const designation = useSyncExternalStore(
    subscribeDesignation,
    readDesignation,
    () => "",
  );
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
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

  // Auto-scroll: follow the newest agent card, unless the user scrolls away.
  const timelineRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const pause = () => {
      if (pausedRef.current) return;
      pausedRef.current = true;
      setPaused(true);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) pause();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", pause, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", pause);
    };
  }, []);

  // The newest thing the user should see: error box, send panel, rejection box, or last card.
  function liveTarget(): Element | null | undefined {
    return (
      document.getElementById("claim-error") ??
      document.getElementById("send-panel") ??
      document.getElementById("verdict") ??
      timelineRef.current?.lastElementChild
    );
  }

  function scrollToLive() {
    liveTarget()?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const itemCount = items.length;
  const hasDraft = !!result?.draft;
  const hasResult = !!result;
  const hasError = !!error;
  useEffect(() => {
    if (pausedRef.current || itemCount === 0) return;
    liveTarget()?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [itemCount, hasDraft, hasResult, hasError]);

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
                classification: ev.agent === "classifier" ? ev.classification : undefined,
                fields: ev.agent === "reader" ? ev.fields : undefined,
                audit: ev.agent === "auditor" ? ev.audit : undefined,
                form: ev.agent === "formFiller" ? ev.form : undefined,
                draft: ev.agent === "dispatcher" ? ev.draft : undefined,
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
    if (!file || running || !designation.trim()) return;
    setRunning(true);
    setItems([]);
    setResult(null);
    setError(null);
    setStopped(false);
    stoppedRef.current = false;
    pausedRef.current = false;
    setPaused(false);

    // Watchdog: if nothing arrives for 90s, stop waiting and tell the user.
    const controller = new AbortController();
    abortRef.current = controller;
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
      body.append("designation", designation.trim());
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
          hint: "Check that your file is a JPG, PNG, WebP, HEIC or PDF under 4 MB, then try again.",
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
      if (stoppedRef.current) {
        setStopped(true);
        return;
      }
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

  // Cancels the running claim. The server stops at its next step and nothing is sent.
  function stopClaim() {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }

  // Goes back to the sample list.
  function clearFile() {
    setFile(null);
    setItems([]);
    setResult(null);
    setError(null);
    setStopped(false);
    setFileError(null);
  }

  // Loads a bundled sample receipt exactly as if the user had chosen it.
  async function loadSample(s: Sample) {
    if (running) return;
    try {
      const res = await fetch(`/samples/${s.file}`);
      if (!res.ok) throw new Error("missing");
      const blob = await res.blob();
      // A judge can go straight from a sample to Start Claim. Never overwrites a typed value.
      if (!designation.trim()) saveDesignation("Software Engineer");
      pickFile(
        new File([blob], s.file, {
          type: s.file.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
        }),
      );
    } catch {
      setFileError("Could not load that sample. Please try again.");
    }
  }

  // Used by both the file picker and drag and drop: same checks as the server.
  function pickFile(picked: File | null) {
    if (!picked) return;
    let f = picked;
    // Some browsers give dropped HEIC photos an empty type.
    if (!f.type && /\.(heic|heif)$/i.test(f.name)) {
      f = new File([f], f.name, { type: "image/heic" });
    }
    if (!ALLOWED_TYPES.includes(f.type)) {
      setFileError("That file type isn't supported. Use a JPG, PNG, WebP, HEIC or PDF.");
      return;
    }
    if (f.size > MAX_RECEIPT_BYTES) {
      setFileError("That file is over 4 MB. Please use a smaller one.");
      return;
    }
    setFileError(null);
    setFile(f);
    setItems([]);
    setResult(null);
    setError(null);
    setStopped(false);
  }

  const started = items.length > 0 || running;
  const has = (agent: AgentName) =>
    items.some((x) => x.kind === "agent" && x.agent === agent);

  return (
    <div className="flex flex-col gap-10">
      {/* ---- The crew: dim before a claim starts, live and sticky once it does ---- */}
      <Tracker items={items} />

      {/* ---- Upload ---- */}
      <section className="agent-card p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="font-mono text-sm tracking-widest text-cyan-300">
            STEP 01
          </span>
          <h2 className="text-xl font-semibold">Drop in your receipt</h2>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex flex-col gap-4 sm:w-80 sm:shrink-0">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                if (!running) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!running) pickFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`flex h-28 cursor-pointer items-center justify-center rounded-lg border border-dashed px-5 text-center text-base transition ${
                dragging
                  ? "border-cyan-300 bg-cyan-400/20 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.35)]"
                  : "border-cyan-400/50 bg-cyan-400/5 text-cyan-100 hover:bg-cyan-400/10"
              }`}
            >
              {dragging
                ? "Drop it here"
                : file
                  ? "Drop a new receipt or click to change"
                  : "Drag a receipt here or click to choose (JPG, PNG, WebP, HEIC or PDF, up to 4 MB)"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                className="hidden"
                disabled={running}
                onChange={(e) => {
                  pickFile(e.target.files?.[0] ?? null);
                  e.target.value = ""; // lets the same file be chosen again
                }}
              />
            </label>
            {fileError && <div className="text-base text-red-300">{fileError}</div>}
            <div>
              <label className="block text-base text-slate-300" htmlFor="designation">
                Your designation <span className="text-red-300">*</span>
              </label>
              <input
                id="designation"
                type="text"
                maxLength={60}
                value={designation}
                onChange={(e) => saveDesignation(e.target.value)}
                placeholder="e.g. Software Engineer"
                disabled={running}
                className="mt-2 w-full rounded-lg border border-slate-600 bg-black/40 px-4 py-2 text-slate-100 outline-none focus:border-cyan-400"
              />
            </div>
            <button
              onClick={startClaim}
              disabled={!file || running || !designation.trim()}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 px-6 py-3 font-semibold text-black shadow-[0_0_24px_rgba(34,211,238,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {running ? "Agents at work…" : "▶ Start Claim"}
            </button>
            {!running && (!file || !designation.trim()) && (
              <div className="-mt-2 text-base text-slate-400">
                {!file
                  ? "Choose a receipt or sample first."
                  : "Enter your designation to continue."}
              </div>
            )}
            {running && (
              <button
                onClick={stopClaim}
                className="rounded-lg border border-red-400/60 bg-red-400/10 px-6 py-2 text-base font-semibold text-red-200 transition hover:bg-red-400/20"
              >
                ■ Stop
              </button>
            )}
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
                <div className="flex h-40 items-center justify-center rounded-lg border border-slate-600 px-4 text-center text-base text-slate-300">
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
              <span className="font-mono text-sm text-slate-400">{file.name}</span>
              {!running && (
                <button
                  onClick={clearFile}
                  className="self-start text-base text-cyan-300 underline-offset-4 hover:underline"
                >
                  ← Choose a different receipt
                </button>
              )}
            </div>
          )}

          {!file && (
            <div className="flex-1">
              <div className="mb-3 text-base text-slate-300">
                No receipt handy? Try a sample:
              </div>
              {/* Made-up files so the whole flow can be tried in one click */}
              <div className="flex flex-col divide-y divide-slate-700/60 overflow-hidden rounded-lg border border-slate-700/70">
                {SAMPLES.map((s) => (
                  <button
                    key={s.file}
                    onClick={() => loadSample(s)}
                    disabled={running}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="text-base">
                      <span className="font-semibold text-slate-100">{s.title}</span>
                      <span className="block text-sm text-slate-400">{s.kind}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-sm ${
                        s.tone === "loop"
                          ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                          : s.tone === "reject"
                            ? "border-red-400/50 bg-red-400/10 text-red-200"
                            : "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                      }`}
                    >
                      {s.tag}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---- Agent timeline ---- */}
      {started && (
        <section>
          <div className="mb-5 flex items-center gap-3">
            <span className="font-mono text-sm tracking-widest text-cyan-300">
              STEP 02
            </span>
            <h2 className="text-xl font-semibold">Agents at work</h2>
            {running && (
              <span className="font-mono text-sm text-cyan-300">
                LIVE<span className="blink">_</span>
              </span>
            )}
          </div>

          <div className="flex flex-col" ref={timelineRef}>
            {items.map((it, i) => (
              <div
                key={it.id}
                data-agent={it.kind === "agent" ? it.agent : undefined}
                className="step-in scroll-mt-28"
              >
                {i > 0 && (
                  <div
                    className={`connector ${it.kind === "agent" && it.status === "working" ? "flow" : ""}`}
                  />
                )}
                {it.kind === "loop" ? (
                  <LoopBanner item={it} />
                ) : (
                  <AgentCard
                    item={it}
                    startOpen={it.agent === "dispatcher"}
                    collapsible={
                      it.agent === "dispatcher" ||
                      (it.agent === "formFiller" && has("dispatcher")) ||
                      ((it.agent === "classifier" ||
                        it.agent === "reader" ||
                        it.agent === "auditor") &&
                        it.audit?.verdict !== "needs_reread" &&
                        has("formFiller"))
                    }
                  />
                )}
              </div>
            ))}

          </div>
        </section>
      )}

      {stopped && (
        <section id="claim-error" className="agent-card step-in scroll-mt-28 p-6">
          <div className="font-mono text-sm tracking-widest text-slate-400">
            STOPPED BY YOU
          </div>
          <div className="mt-1 text-lg font-semibold">The claim was cancelled.</div>
          <div className="mt-1 text-base text-slate-300">
            Nothing was sent. You can start again whenever you are ready.
          </div>
          <button
            onClick={startClaim}
            disabled={running || !file || !designation.trim()}
            className="mt-4 rounded-lg border border-cyan-400/60 bg-cyan-400/10 px-5 py-2 text-base font-semibold text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-40"
          >
            ↻ Start again
          </button>
        </section>
      )}

      {error && (
        <section id="claim-error" className="agent-card is-bad step-in scroll-mt-28 p-6">
          <div className="flex items-start gap-4">
            <span className="text-3xl text-red-300">⚠</span>
            <div className="flex-1">
              <div className="font-mono text-sm tracking-widest text-red-300">
                CLAIM STOPPED
              </div>
              <div className="mt-1 text-lg font-semibold">{error.message}</div>
              <div className="mt-1 text-base text-slate-300">{error.hint}</div>
              <button
                onClick={startClaim}
                disabled={running || !file || !designation.trim()}
                className="mt-4 rounded-lg border border-red-400/60 bg-red-400/10 px-5 py-2 text-base font-semibold text-red-200 transition hover:bg-red-400/20 disabled:opacity-40"
              >
                ↻ Try again
              </button>
            </div>
          </div>
        </section>
      )}

      {result?.draft && result.form && file && (
        <div id="send-panel" className="scroll-mt-28">
          <SendPanel
            key={result.draft.signature}
            draft={result.draft}
            form={result.form}
            file={file}
          />
        </div>
      )}

      {result && (
        <div id="verdict" className="scroll-mt-28">
          <Verdict result={result} />
        </div>
      )}

      {paused && running && (
        <button
          onClick={() => {
            pausedRef.current = false;
            setPaused(false);
            scrollToLive();
          }}
          className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full border border-cyan-400/60 bg-[#080c16]/95 px-5 py-2 font-mono text-sm text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.3)] transition hover:bg-cyan-400/10"
        >
          ↓ Jump to live
        </button>
      )}
    </div>
  );
}

const TRACK = ["classifier", "reader", "auditor", "formFiller", "dispatcher"] as const;
type TrackState = "standby" | "working" | "done" | "warn" | "bad";

function trackState(items: Item[], agent: AgentName): TrackState {
  const mine = items.filter(
    (x): x is AgentItem => x.kind === "agent" && x.agent === agent,
  );
  const last = mine[mine.length - 1];
  if (!last) return "standby";
  if (last.status === "failed") return "bad";
  if (last.status === "working") return "working";
  if (last.audit?.verdict === "needs_reread") return "warn";
  if (last.audit?.verdict === "rejected" || notRecognised(last.classification)) return "bad";
  return "done";
}

function notRecognised(c?: Classification): boolean {
  return !!c && (c.type === "unknown" || c.confidence < POLICY.minClassifyConfidence);
}

function ClassificationView({ c }: { c: Classification }) {
  const pct = Math.round(c.confidence * 100);
  const lv = level(pct);
  const bad = notRecognised(c);
  return (
    <div className="mt-4 rounded-xl border border-slate-700/70 bg-black/30 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-md border px-3 py-1 font-mono text-base font-semibold ${
            bad
              ? "border-red-400/60 bg-red-400/10 text-red-200"
              : "border-cyan-400/60 bg-cyan-400/10 text-cyan-100"
          }`}
        >
          {bad
            ? "UNRECOGNISED"
            : c.type === "gym"
              ? "HEALTH CLUB RECEIPT"
              : "INTERNET BILL"}
        </span>
        <span className="flex items-center gap-1.5 text-sm text-slate-400">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: lv.hex, boxShadow: `0 0 6px ${lv.hex}` }}
          />
          {pct}% sure
        </span>
      </div>
      {c.reason && <p className="mt-3 text-base text-slate-300">{c.reason}</p>}
    </div>
  );
}

function Tracker({ items }: { items: Item[] }) {
  const colors: Record<TrackState, string> = {
    standby: "border-slate-600 text-slate-500",
    working: "border-cyan-400 text-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.6)]",
    done: "border-emerald-400 bg-emerald-400/10 text-emerald-300",
    warn: "border-amber-400 text-amber-300",
    bad: "border-red-400 text-red-300",
  };
  return (
    <div className="sticky top-2 z-20 rounded-2xl border border-slate-700/70 bg-[#080c16] px-4 py-3">
      <div className="flex items-center">
        {TRACK.map((agent, i) => {
          const st = trackState(items, agent);
          const next = i < TRACK.length - 1;
          return (
            <div key={agent} className={`flex items-center ${next ? "flex-1" : ""}`}>
              <div className="group relative">
              {/* Hover card: what this agent does */}
              <span
                className={`pointer-events-none absolute top-full z-30 mt-3 w-72 rounded-lg border border-slate-600 bg-[#0b1020] px-4 py-3 text-left text-base leading-relaxed text-slate-200 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 ${i === TRACK.length - 1 ? "right-0" : "left-0"}`}
              >
                <span className="mb-0.5 block font-semibold text-cyan-200">
                  {AGENT_META[agent].name}
                </span>
                {AGENT_META[agent].blurb}
              </span>
              <button
                onClick={() => {
                  const els = document.querySelectorAll(`[data-agent="${agent}"]`);
                  els[els.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                disabled={st === "standby"}
                className="flex items-center gap-2 disabled:cursor-default"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 font-mono text-sm font-bold transition-all ${colors[st]} ${st === "working" ? "animate-pulse" : ""}`}
                >
                  {st === "done" ? "✓" : st === "bad" ? "✕" : AGENT_META[agent].icon}
                </span>
                <span
                  className={`hidden text-base sm:inline ${st === "standby" ? "text-slate-400" : "text-slate-200"}`}
                >
                  {AGENT_META[agent].name}
                </span>
              </button>
              </div>
              {next && (
                <div className="mx-3 h-0.5 flex-1 overflow-hidden rounded bg-slate-700">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-700"
                    style={{ width: st === "done" ? "100%" : "0%" }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CC_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

function SendPanel({
  draft,
  form,
  file,
}: {
  draft: EmailDraft;
  form: FilledForm;
  file: File;
}) {
  const [cc, setCc] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = CC_RE.test(cc.trim());

  async function send() {
    if (!valid || sending) return;
    setSending(true);
    setErr(null);
    try {
      const body = new FormData();
      body.append("receipt", file);
      body.append("cc", cc.trim());
      body.append("subject", draft.subject);
      body.append("body", draft.body);
      body.append("pdfBase64", form.pdfBase64);
      body.append("pdfFilename", form.filename);
      body.append("signature", draft.signature);
      const res = await fetch("/api/send", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(data?.error ?? "The email could not be sent.");
      } else {
        setSent(cc.trim());
      }
    } catch {
      setErr("Lost the connection. Check your internet and try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <section className="agent-card is-done step-in p-6">
        <div className="font-mono text-sm tracking-widest text-emerald-300">EMAIL SENT</div>
        <div className="mt-1 text-lg font-semibold">
          Sent to Accounts, with {sent} in CC.
        </div>
        <div className="mt-1 text-base text-slate-300">
          Both attachments (original receipt and filled expense sheet) were included.
        </div>
      </section>
    );
  }

  return (
    <section className="agent-card step-in p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="font-mono text-sm tracking-widest text-cyan-300">STEP 03</span>
        <h2 className="text-xl font-semibold">Approve &amp; send</h2>
      </div>
      <label className="block text-base text-slate-300" htmlFor="cc">
        CC email <span className="text-red-300">*</span>
      </label>
      <input
        id="cc"
        type="email"
        value={cc}
        onChange={(e) => setCc(e.target.value)}
        placeholder="manager@example.com"
        disabled={sending}
        className="mt-2 w-full rounded-lg border border-slate-600 bg-black/40 px-4 py-2 text-slate-100 outline-none focus:border-cyan-400"
      />
      {cc && !valid && (
        <div className="mt-1 text-base text-red-300">Enter one valid email address.</div>
      )}
      {err && <div className="mt-3 text-base text-red-300">{err}</div>}
      <button
        onClick={send}
        disabled={!valid || sending}
        className="mt-4 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 px-6 py-3 font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? "Sending…" : "✉ Approve & Send"}
      </button>
      <div className="mt-2 text-base text-slate-400">
        Enter your own email so you get a copy of exactly what ClaimCrew sends to Accounts on your behalf. Nothing is sent until you approve.
      </div>
    </section>
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

// Friendly names for the tools the Form Filler can choose.
const TOOL_LABELS: Record<string, string> = {
  generate_form_pdf: "PDF form generator",
};

function AgentCard({
  item,
  collapsible,
  startOpen = false,
}: {
  item: AgentItem;
  collapsible: boolean;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const collapsed = collapsible && item.status === "done" && !open;
  const meta = AGENT_META[item.agent];
  const verdict = item.audit?.verdict;
  const state =
    item.status === "failed"
      ? "bad"
      : item.status === "working"
      ? "working"
      : verdict === "needs_reread"
        ? "warn"
        : verdict === "rejected" || notRecognised(item.classification)
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
              <span className="rounded bg-amber-400/15 px-2 py-0.5 font-mono text-sm text-amber-300">
                PASS {item.attempt}
              </span>
            )}
          </div>
          <div className="text-base text-slate-400">{meta.role}</div>
        </div>
        <span
          className={`ml-auto shrink-0 font-mono text-sm tracking-wider ${
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
        {collapsible && item.status === "done" && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 rounded-md border border-slate-600 px-2 py-1 font-mono text-sm text-slate-300 transition hover:border-cyan-400 hover:text-cyan-200"
          >
            {open ? "Hide details" : "Show details"}
          </button>
        )}
      </div>

      {/* Shown whether the card is open or collapsed */}
      {item.status === "done" && item.form?.toolCall && (
        <div className="mt-3 flex items-center gap-2 text-base text-slate-300">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]" />
          <span>
            Chose tool:{" "}
            <span className="font-semibold text-cyan-200">
              {TOOL_LABELS[item.form.toolCall.name] ?? item.form.toolCall.name}
            </span>
          </span>
        </div>
      )}

      {collapsed && item.summary && (
        <div className="mt-3 text-base text-slate-400">{item.summary}</div>
      )}

      {item.status === "working" && (
        <div className="mt-4">
          <div className="mb-2 font-mono text-base text-cyan-200">
            {item.note}
            <span className="blink">…</span>
          </div>
          <div className="scan-bar" />
        </div>
      )}

      {item.status === "failed" && (
        <div className="mt-4 font-mono text-base text-red-300">
          Stopped before finishing: {item.note}
        </div>
      )}

      {item.status === "done" && !collapsed && item.classification && (
        <ClassificationView c={item.classification} />
      )}
      {item.status === "done" && !collapsed && item.fields && (
        <FieldsTable fields={item.fields} />
      )}
      {item.status === "done" && !collapsed && item.audit && (
        <AuditChecks audit={item.audit} />
      )}
      {item.status === "done" && !collapsed && item.form && (
        <FormPreview form={item.form} />
      )}
      {item.status === "done" && !collapsed && item.draft && (
        <DraftPreview draft={item.draft} />
      )}
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
  const keys = Object.keys(fields);
  const scores = keys.map((k) => fields[k].confidence);
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
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#080c16] font-mono text-base font-bold">
            {overall}%
          </div>
        </div>
        <div>
          <div className="font-mono text-sm tracking-widest text-slate-400">
            OVERALL READ QUALITY
          </div>
          <div className={`text-lg font-semibold ${overallLevel.text}`}>
            {overallLevel.label} confidence
          </div>
          <div className="text-base text-slate-400">
            Average across all {keys.length} extracted fields
          </div>
        </div>
      </div>

      {/* Per-field results */}
      <div className="grid gap-3 sm:grid-cols-2">
        {keys.map((key) => {
          const f = fields[key];
          const pct = Math.round(f.confidence * 100);
          const lv = level(pct);
          return (
            <div
              key={key}
              className="rounded-xl border border-slate-700/70 bg-black/30 p-3"
            >
              <div className="text-sm uppercase tracking-wider text-slate-400">
                {labelOf(key)}
              </div>
              <div className="mt-0.5 truncate text-base font-semibold">
                {f.value === null || f.value === undefined
                  ? "Not found"
                  : key === "amount" && typeof f.value === "number"
                    ? `Rs. ${f.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                    : f.value}
              </div>

              <div className="mt-3 flex items-center justify-between text-sm">
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
      <div className="mt-3 text-base text-slate-400">
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
              className={`mt-0.5 font-mono font-bold ${c.note ? "text-amber-400" : c.passed ? "text-emerald-400" : "text-red-400"}`}
            >
              {c.note ? "!" : c.passed ? "✓" : "✕"}
            </span>
            <div>
              <div className="text-base font-medium">{c.label}</div>
              <div className="text-base text-slate-400">{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-base text-slate-300">{audit.reason}</p>
    </div>
  );
}

function FormPreview({ form }: { form: FilledForm }) {
  const href = `data:application/pdf;base64,${form.pdfBase64}`;
  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-sm text-slate-400">{form.filename}</div>
        <a
          href={href}
          download={form.filename}
          className="rounded-lg border border-emerald-400/60 bg-emerald-400/10 px-4 py-2 text-base font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
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

function DraftPreview({ draft }: { draft: EmailDraft }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-700/70 bg-black/30">
      <div className="grid gap-1 border-b border-slate-700/70 px-4 py-3 text-base">
        <div className="flex gap-3">
          <span className="w-16 shrink-0 text-slate-500">To</span>
          <span>{draft.toLabel}</span>
        </div>
        <div className="flex gap-3">
          <span className="w-16 shrink-0 text-slate-500">Subject</span>
          <span className="font-medium">{draft.subject}</span>
        </div>
        <div className="flex gap-3">
          <span className="w-16 shrink-0 text-slate-500">Attached</span>
          <span className="flex flex-wrap gap-2">
            {draft.attachments.map((a) => (
              <span
                key={a.filename}
                className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-sm text-cyan-100"
                title={a.label}
              >
                📎 {a.label}: {a.filename}
              </span>
            ))}
          </span>
        </div>
      </div>
      <div
        className="px-4 py-4 text-base leading-relaxed text-slate-200"
        // Built from escaped text by draftToHtml, same layout as the sent email.
        dangerouslySetInnerHTML={{ __html: draftToHtml(draft.body, { inherit: true }) }}
      />
      <div className="border-t border-slate-700/70 px-4 py-2 font-mono text-sm text-slate-500">
        DRAFT · nothing has been sent
      </div>
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
        <div className="text-base text-amber-100/80">
          Re-reading: {item.fields.map(labelOf).join(", ")} (retry{" "}
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
          <div className="text-base text-slate-300">{result.audit.reason}</div>
        </div>
        <span className="ml-auto font-mono text-sm text-slate-500">
          {result.mode.toUpperCase()} MODE
        </span>
      </div>
    </section>
  );
}
