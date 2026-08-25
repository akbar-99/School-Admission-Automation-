import Link from "next/link";
import { ClipboardList, CreditCard, UserCheck, GraduationCap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo, LogoFull } from "@/components/logo";

const STEPS = [
  { icon: ClipboardList, title: "Lead & Application", desc: "Marketing enters a lead; parents complete the secure admission form." },
  { icon: UserCheck, title: "Assessment", desc: "Grade applicants book a slot; teachers record the result." },
  { icon: CreditCard, title: "Agreement & Payment", desc: "Auto-generated agreement and a Razorpay payment link." },
  { icon: GraduationCap, title: "Enrollment", desc: "Automatic admission number, section allocation and onboarding." },
];

export default function Home() {
  return (
    <main className="flex-1">
      <header className="glass sticky top-0 z-20 border-b border-border/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Logo size="sm" />
          <Link href="/login">
            <Button variant="outline" size="sm">
              Staff sign in
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-secondary/70 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-secondary-foreground">
              Broadway · Home Schooling
            </p>
            <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
              Admissions, refined from{" "}
              <span className="brand-gradient-text italic">lead to enrollment.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              A seamless, end-to-end admission experience — application forms,
              assessment scheduling, secure payments, and automatic
              enrollment, in one elegant flow.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/login">
                <Button size="lg">
                  Staff sign in <ArrowRight className="size-4" />
                </Button>
              </Link>
              <a href="#how">
                <Button size="lg" variant="outline">
                  How it works
                </Button>
              </a>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Parents don&apos;t need an account — they receive a secure
              admission link via WhatsApp, SMS and email.
            </p>
          </div>

          {/* Brand showcase card */}
          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] brand-gradient opacity-10 blur-2xl" />
            <div className="relative flex flex-col items-center gap-7 rounded-[1.75rem] border border-border/70 bg-card/80 p-12 shadow-luxe">
              <LogoFull height={172} priority />
              <div className="h-px w-24 bg-border" />
              <p className="text-center text-sm text-muted-foreground">
                Nurturing learners at home, with the structure of a school.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section id="how" className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          The journey
        </h2>
        <p className="mt-1 text-muted-foreground">Four refined steps, fully automated.</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="group rounded-lg border border-border/70 bg-card p-6 shadow-soft transition-all hover:-translate-y-1 hover:shadow-luxe"
            >
              <div className="mb-4 flex size-11 items-center justify-center rounded-xl brand-gradient text-primary-foreground shadow-soft">
                <s.icon className="size-5" />
              </div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Step {i + 1}
              </div>
              <h3 className="mt-1 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/60 py-7 text-center text-sm text-muted-foreground">
        <span className="font-logo font-semibold text-primary">Broadway</span> Home Schooling · Admissions
      </footer>
    </main>
  );
}
