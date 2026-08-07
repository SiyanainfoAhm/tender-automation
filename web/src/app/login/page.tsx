import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left panel — desktop only */}
      <div className="relative hidden w-[45%] flex-col justify-between overflow-hidden bg-navy p-10 text-white lg:flex xl:p-14">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_#2563eb33,_transparent_60%)]" />
        <div className="absolute -right-20 -top-20 size-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-blue-500/5 blur-3xl" />

        <div className="relative">
          <div className="mb-2 flex size-12 items-center justify-center rounded-[14px] bg-primary font-heading text-lg font-bold">
            STI
          </div>
          <h1 className="font-heading mt-8 text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">
            Siyana Tender Intelligence
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">
            Tender discovery, qualification and bid intelligence in one
            workspace.
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-4">
          {[
            { label: "Sources", value: "2+" },
            { label: "Qualification", value: "AI" },
            { label: "Pipeline", value: "Daily" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-[14px] border border-white/10 bg-white/5 p-4 backdrop-blur-sm"
            >
              <p className="font-heading text-2xl font-bold">{stat.value}</p>
              <p className="mt-1 text-xs text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col justify-center bg-surface px-6 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 flex size-10 items-center justify-center rounded-[10px] bg-primary font-heading text-sm font-bold text-white">
              STI
            </div>
            <h1 className="font-heading text-2xl font-bold text-text-primary">
              Sign in
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              Tender discovery, qualification and bid intelligence in one
              workspace.
            </p>
          </div>

          <div className="hidden lg:block">
            <h2 className="font-heading text-2xl font-bold text-text-primary">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              Sign in to your Siyana STI workspace.
            </p>
          </div>

          <div className="mt-8">
            <LoginForm />
          </div>

          <p className="mt-8 text-center text-xs text-text-subtle">
            Protected workspace · Authorized users only
          </p>
        </div>
      </div>
    </div>
  );
}
