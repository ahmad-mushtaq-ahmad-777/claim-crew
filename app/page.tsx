import ClaimFlow from "@/components/ClaimFlow";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <div className="font-mono text-sm tracking-[0.3em] text-cyan-300">
          MULTI-AGENT EXPENSE CLAIMS
        </div>
        <h1 className="neon-text text-5xl font-bold tracking-tight sm:text-6xl">
          ClaimCrew
        </h1>
        <p className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          Five agents. One receipt.{" "}
          <span className="bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-transparent">
            Zero paperwork.
          </span>
        </p>
        <p className="max-w-3xl text-lg leading-relaxed text-slate-300">
          ClaimCrew turns a receipt into a ready-to-send reimbursement claim. A
          team of AI agents reads it, checks it against policy, fills in the
          company form and drafts the email to Accounts.
        </p>
        <div className="flex flex-wrap items-center gap-2.5 pt-2 text-base">
          <span className="font-mono text-sm tracking-widest text-slate-400">HANDLES</span>
          <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3.5 py-1 text-cyan-100">
            Internet bills
          </span>
          <span className="rounded-full border border-violet-400/40 bg-violet-400/10 px-3.5 py-1 text-violet-100">
            Health club memberships
          </span>
          <span className="text-slate-400">New claim types are config-driven</span>
        </div>
      </header>

      <ClaimFlow />

      <footer className="pb-6 pt-4 font-mono text-base text-slate-400">
        Demo uses made-up data only. Emails go only to a demo mailbox, and only after you approve.
      </footer>
    </main>
  );
}
