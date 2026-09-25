import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { Logo } from "@/components/logo";

export const metadata = { title: "Privacy Policy — Broadway Home Schooling Admissions" };
// Reads admin-editable settings (school contact info) — must not be frozen
// at build time, or an admin's later change here would never show.
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const settings = await getSettings();
  const updated = "25 September 2026";

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
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-foreground/90">
          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">What this covers</h2>
            <p className="mt-2">
              This policy describes how {settings.schoolName} collects, uses and protects
              information submitted through this admissions portal — the online application form,
              assessment scheduling, payments, and related communications with parents, students
              and staff.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Information we collect</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Parent/guardian name, email, phone number and address</li>
              <li>Student name, date of birth, gender, grade applying for, and academic documents you upload</li>
              <li>Assessment scheduling details and results</li>
              <li>Payment records (processed by Razorpay; we do not store card or bank details)</li>
              <li>Communications sent to you by email, SMS and WhatsApp, and their delivery status</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">How we use it</h2>
            <p className="mt-2">
              Solely to process the admission — scheduling assessments, sharing results, generating
              the admission agreement, collecting fees, confirming enrollment, and keeping you and
              our staff informed at each step by email, SMS and WhatsApp. We do not sell or share
              this information with third parties for marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Third-party services</h2>
            <p className="mt-2">
              We use Razorpay for payment processing, and WhatsApp Business Platform (Meta), our
              email provider and SMS provider to deliver admission updates. Each handles data under
              its own privacy terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Data retention</h2>
            <p className="mt-2">
              Application and enrollment records are retained for as long as required for academic,
              administrative and regulatory purposes. You may request access to or deletion of your
              data by contacting us below, subject to records we are legally required to keep.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground">Contact</h2>
            <p className="mt-2">
              Questions about this policy or your data:{" "}
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
