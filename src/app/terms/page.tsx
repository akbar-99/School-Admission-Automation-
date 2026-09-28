import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { Logo } from "@/components/logo";

export const metadata = { title: "Terms of Service — Broadway Home Schooling Admissions" };
// Reads admin-editable settings (school contact info) — must not be frozen
// at build time, or an admin's later change here would never show.
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const settings = await getSettings();
  const updated = "27 September 2026";

  return (
    <main className="flex-1">
      <header className="glass sticky top-0 z-20 border-b border-border/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3.5">
          <Link href="/">
            <Logo size="sm" />
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-foreground/90">
          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Acceptance</h2>
            <p className="mt-2">
              By using this admissions portal — the online application form, assessment scheduling,
              payments, and related communications — you agree to these terms on behalf of yourself
              and, where applicable, your child.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">What this service does</h2>
            <p className="mt-2">
              {settings.schoolName} uses this portal to process admissions: collecting an
              application, scheduling and recording an assessment, generating an admission
              agreement, collecting the admission fee, and confirming enrollment. Submitting an
              application does not guarantee admission — offers are subject to assessment results
              and seat availability.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Payments</h2>
            <p className="mt-2">
              Fees are processed through Razorpay. Refund and cancellation requests are handled
              case-by-case under the school&apos;s admission policy — contact us using the details
              below.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Communications</h2>
            <p className="mt-2">
              By providing your phone number, email, or messaging us on WhatsApp, Instagram, or
              Facebook Messenger, you consent to receiving admission-related updates through those
              channels.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Your responsibilities</h2>
            <p className="mt-2">
              You agree to provide accurate information about the applicant and to keep your access
              link and account credentials confidential. Providing false information may result in
              an offer being withdrawn.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Changes</h2>
            <p className="mt-2">
              We may update these terms from time to time; the &quot;Last updated&quot; date above
              reflects the most recent change.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Contact</h2>
            <p className="mt-2">
              Questions about these terms:{" "}
              <a className="text-primary underline underline-offset-2" href={`mailto:${settings.schoolEmail}`}>
                {settings.schoolEmail}
              </a>{" "}
              or {settings.schoolPhone}.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
