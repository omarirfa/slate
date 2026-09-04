import type { Metadata } from "next";
import PageShell from "@/components/PageShell";
import Playground from "@/components/Playground";

export const metadata: Metadata = {
  title: "Playground — Slate",
  description:
    "Drive this page's WebMCP tools by hand or with your own model. The slate is local to the page and resets on reload.",
};

export default function PlaygroundPage() {
  return (
    <PageShell current="/playground">
      <article className="prose prose--wide">
        <p className="prose__kicker">Playground</p>
        <h1 className="prose__display">Drive the surface yourself.</h1>
        <p className="prose__lede">
          A throwaway slate with its tools registered on this page&rsquo;s model context. Call them by hand, or bring a
          key and let a model choose. Either way a clause that has closed a tool closes it here too — there is nothing
          registered to call.
        </p>
        <p className="prose__note">
          This page also puts the tools on <span className="mono">document.modelContext</span>, so a browser extension
          or a devtools snippet can discover and call them from outside. Elsewhere on the site that is opt-in with{" "}
          <span className="mono">?inspect=1</span>.
        </p>
      </article>
      <Playground />
    </PageShell>
  );
}
