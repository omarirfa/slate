import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import type { ReactNode } from "react";
import "@/app/workbench.css";

export const NAV = [
  { href: "/problem", label: "The problem" },
  { href: "/walkthrough", label: "Walkthrough" },
  { href: "/why-webmcp", label: "Why WebMCP" },
  { href: "/playground", label: "Playground" },
] as const;

/** Banner and column for the reading pages. The app itself has its own banner. */
export default function PageShell({ current, children }: { current: string; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="banner">
        <div className="banner__mark">
          <Link href="/" className="wordmark wordmark--link">
            Slate
          </Link>
        </div>
        <nav className="nav" aria-label="Pages">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="nav__link" aria-current={n.href === current ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="banner__spacer" />
        <div className="banner__side">
          <Link href="/" className="btn btn--sm btn--primary">
            Open a slate
          </Link>
          {/* Last in the row on every page, so it lands in the same place
              whether or not the banner also carries a primary action. */}
          <ThemeToggle />
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
