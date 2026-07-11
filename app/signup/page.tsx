"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/dashboard`
            : undefined,
      },
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen bg-background font-sans antialiased text-foreground [--accent-hover:#0d5d3d] [--accent-muted-bg:#e6f3eb] [--accent-muted-border:#c9e2d3] [--accent-primary:#126b46] [--background:#f5f8f6] [--card-bg:#ffffff] [--card-border:#d9e2dd] [--card-border-hover:#aebdb5] [--critical-bg:#fff0ed] [--critical-border:#efc6be] [--critical-text:#bd3b2c] [--foreground:#10261c] [--text-ghost:#71877c] [--text-muted:#4f665b]">
      
      {/* HEADER - MATCHES LOGIN VIEW */}
      <header className="border-b border-border-system/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-accent/15 bg-white shadow-sm">
              <Image
                src="/ProfitPlate logo.png.png"
                alt="ProfitPlate Logo"
                width={72}
                height={72}
                priority
                className="h-8 w-8 object-contain"
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-extrabold leading-none tracking-tight text-foreground">
                ProfitPlate
              </span>
              <span className="mt-1 hidden font-mono text-[9px] uppercase tracking-widest text-text-ghost sm:block">
                Daily margin control for restaurants
              </span>
            </span>
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-border-system bg-white px-4 py-2.5 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover"
          >
            Log in
          </Link>
        </div>
      </header>

      {/* CORE PAGE STRUCTURE - MATCHES LOGIN GRID */}
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl gap-10 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[1fr_0.82fr] lg:items-center lg:gap-20">
        
        {/* LEFT TEXT PANEL */}
        <section className="max-w-2xl">
          <span className="inline-flex rounded-full border border-accent-muted-border bg-white px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-accent shadow-sm">
            Create workspace
          </span>
          <h1 className="mt-6 max-w-[15ch] font-sans font-extrabold tracking-tight text-4xl leading-[1.08] text-foreground sm:text-5xl lg:text-[3.6rem]">
            Start controlling restaurant margin with connected data.
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-text-muted sm:text-base">
            Track supplier cost changes, inventory movement, recipe yield, and active dish margin from one operating graph. Get clean data, then run the day with unyielding controls.
          </p>

          <div className="mt-8 grid border-y border-border-system bg-white sm:grid-cols-3">
            {[
              ["Margin visibility", "Revenue, cost, and yield"],
              ["Daily control", "Registers and exceptions"],
              ["Role access", "The right work for each team"],
            ].map(([title, detail]) => (
              <div
                key={title}
                className="border-b border-border-system px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
              >
                <p className="text-xs font-bold text-foreground">{title}</p>
                <p className="mt-1 text-[11px] leading-4 text-text-muted">
                  {detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* RIGHT CONTROL PANEL - MATCHES SIGNUP FORM ELEVATION */}
        <section className="w-full rounded-lg border border-border-system bg-white p-5 shadow-[0_24px_70px_rgba(25,65,45,0.12)] sm:p-8">
          <div className="border-b border-border-system pb-5">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
              ProfitPlate workspace
            </span>
            <h2 className="mt-1 font-sans font-extrabold tracking-tight text-3xl text-foreground">Sign up</h2>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              Use your work email and a secure password to create your account.
            </p>
          </div>

          <form onSubmit={handleSignup} className="mt-6 grid gap-5">
            <label className="grid gap-2 text-xs font-bold text-foreground">
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@restaurant.com"
                autoComplete="email"
                required
                className="h-12 rounded-md border border-border-system bg-background px-4 text-sm font-normal text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>
            <label className="grid gap-2 text-xs font-bold text-foreground">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 6 characters"
                autoComplete="new-password"
                required
                minLength={6}
                className="h-12 rounded-md border border-border-system bg-background px-4 text-sm font-normal text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>

            {message ? (
              <p
                className="rounded-md border border-status-critical-border bg-status-critical-bg px-4 py-3 text-sm text-status-critical-text"
                role="alert"
              >
                {message}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 min-h-12 rounded-md bg-accent px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border-system pt-5 text-xs">
            <Link
              href="/"
              className="font-semibold text-text-muted transition hover:text-foreground"
            >
              Back to homepage
            </Link>
            <p className="text-text-muted">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-bold text-accent hover:text-accent-hover"
              >
                Log in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
