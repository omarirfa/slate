import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slate — a loan between friends, held by both halves",
  description:
    "A two-party loan agreement whose clauses are enforced as WebMCP capabilities: what each side's agent can do changes as the agreement changes.",
};

/* Light is the default. The stored preference is applied before first paint so
   the page never flashes the wrong surface. */
const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem("slate-theme");
    if (stored === "dark" || stored === "light") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;

/* Chrome's WebMCP origin trial: register the deployed origin, put the token in
   NEXT_PUBLIC_ORIGIN_TRIAL_TOKEN at build time, and the native chip lights up. */
const ORIGIN_TRIAL = process.env.NEXT_PUBLIC_ORIGIN_TRIAL_TOKEN?.trim() || null;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        {ORIGIN_TRIAL && <meta httpEquiv="origin-trial" content={ORIGIN_TRIAL} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Geist:wght@350;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
