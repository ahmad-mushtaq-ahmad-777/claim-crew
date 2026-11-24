import ClaimFlow from "@/components/ClaimFlow";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 px-6 py-14">
      <header className="flex flex-col gap-3">
        <div className="font-mono text-xs tracking-[0.3em] text-cyan-300">
          MULTI-AGENT EXPENSE CLAIMS
        </div>
        <h1 className="neon-text text-5xl font-bold tracking-tight sm:text-6xl">
          ClaimCrew
        </h1>
        <p className="text-lg text-slate-300">
          Five agents. One receipt. Zero paperwork.
        </p>
      </header>

      <ClaimFlow />

      <footer className="pb-6 pt-4 font-mono text-xs text-slate-500">
        Demo uses made-up data only. Emails go only to a demo mailbox, and only after you approve.
      </footer>
    </main>
  );
}
