import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export interface NavItem {
  href: string;
  label: string;
}

export function DashboardShell({
  roleLabel,
  userName,
  nav,
  children,
}: {
  roleLabel: string;
  userName: string;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="glass sticky top-0 z-20 border-b border-border/70 print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-7">
            <Link href="/" aria-label="Broadway Home Schooling">
              <Logo size="sm" />
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold leading-tight">{userName}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {roleLabel}
              </div>
            </div>
            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </form>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-border/60 px-6 py-2 md:hidden">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
      <footer className="border-t border-border/60 py-5 text-center text-xs text-muted-foreground print:hidden">
        Broadway Home Schooling · Admissions
      </footer>
    </div>
  );
}
