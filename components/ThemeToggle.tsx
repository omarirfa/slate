"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The light/dark control, shared by every banner.
 *
 * Self-contained on purpose: it reads and writes `slate-theme` and sets
 * `data-theme` on the document itself, so any page can drop it in without
 * threading state down. The stored value is applied before first paint by the
 * bootstrap script in the root layout; this only has to agree with it.
 *
 * It was previously only on the app's own banner, so a reader on /problem
 * inherited whatever the app had been set to and had no way to change it.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  const flip = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("slate-theme", next);
      } catch {
        /* private mode: the choice just does not persist */
      }
      return next;
    });
  }, []);

  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={className ?? "btn btn--sm btn--ghost theme-toggle"}
      onClick={flip}
      aria-pressed={dark}
      aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      title={dark ? "Light" : "Dark"}
    >
      {/* Both glyphs are always present and crossfade, so the button never
          changes width as the label swaps. */}
      <span className="theme-toggle__glyphs" aria-hidden="true">
        <svg className="theme-toggle__sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
        </svg>
        <svg className="theme-toggle__moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
        </svg>
      </span>
      <span className="theme-toggle__label">{dark ? "Light" : "Dark"}</span>
    </button>
  );
}
