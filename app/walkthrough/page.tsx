import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/PageShell";

import { SCENARIO } from "@/lib/scenario";

export const metadata: Metadata = {
  title: "Walkthrough — Slate",
  description: "A whole loan between friends, start to finish, in seventeen steps — simulated for you, or played by hand.",
};

const WHO: Record<string, string> = { lender: "Priya", borrower: "Marcus" };

/**
 * Generated voxel art (see art/). Width and height are the assets' real pixel
 * dimensions: given both, the browser reserves the right box before the image
 * loads, so nothing on the page jumps. `height: auto` in CSS keeps the ratio
 * while the width scales down to the column.
 */
const AVATAR: Record<string, { src: string; w: number; h: number }> = {
  lender: { src: "/art/avatar-priya.png", w: 73, h: 79 },
  borrower: { src: "/art/avatar-marcus.png", w: 61, h: 76 },
};

function what(action: string, payload?: Record<string, unknown>): string {
  switch (action) {
    case "reset":
      return "reset";
    case "advance-clock":
      return `clock +${payload?.days ?? "?"} days`;
    default:
      return action;
  }
}

export default function WalkthroughPage() {
  const steps = SCENARIO;
  const refusals = steps.filter((s) => s.expectRefusal).length;

  return (
    <PageShell current="/walkthrough">
      <article className="prose">
        <p className="prose__kicker">Walkthrough</p>
        <h1 className="prose__display">A whole loan, start to finish.</h1>
        <p className="prose__lede">
          Priya lends Marcus $2,400. Over {steps.length} steps it is agreed, paid, missed, chased, stretched and paused.
          Two of the steps are refused on purpose — those are the ones to watch.
        </p>

        <img
          className="art art--hero"
          src="/art/hero-pair.png"
          width={741}
          height={525}
          alt="Priya and Marcus either side of a notched stick, a hand each on their own end."
        />

        <div className="choice">
          <div className="choice__card">
            <h2 className="choice__title">Simulate it for me</h2>
            <p>
              Opens a fresh slate with the demo layer on and plays every step below, both halves, with a caption for
              each. About a minute. You can pause, step, or stop at any point.
            </p>
            <Link href="/?demo=1&autoplay=1" className="btn btn--primary">
              Play the whole slate
            </Link>
          </div>
          <div className="choice__card">
            <h2 className="choice__title">I&rsquo;ll do it myself</h2>
            <p>
              Open a slate in your own name, take a half, and either send the invite to a friend or let a stand-in
              play the other side. Use this list as the script, or ignore it.
            </p>
            <Link href="/" className="btn">
              Open a slate
            </Link>
          </div>
        </div>

        <img
          className="art art--desk"
          src="/art/desk.png"
          width={669}
          height={408}
          alt="A person at a desk with an open ledger."
        />

        <p className="prose__note">
          Neither option needs an API key. With one, the stand-in and the negotiators can be driven by a model instead
          of rules; your key is used for the call and not stored anywhere.
        </p>

        <h2>The steps</h2>
        <p>
          Every step is a real WebMCP call: <code>executeTool()</code> on the acting party&rsquo;s model context. The{" "}
          {refusals} marked steps are refused because the tool is not registered at that moment — not by a check that
          says no, but by there being nothing to call.
        </p>

        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i} className="step" data-refused={s.expectRefusal || undefined}>
              <span className="step__n mono">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className="step__caption">{s.caption}</p>
                <p className="step__meta mono">
                  {/* Decorative: the name it belongs to is the next thing read. */}
                  <img
                    className="art-avatar"
                    src={AVATAR[s.role].src}
                    width={AVATAR[s.role].w}
                    height={AVATAR[s.role].h}
                    alt=""
                    aria-hidden="true"
                  />
                  <span>
                    {WHO[s.role]} · {what(s.action, s.payload)}
                    {s.expectRefusal ? " · refused, on purpose" : ""}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ol>

        <h2>What it shows</h2>
        <ul>
          <li>Proposing terms registers an answer on the other side; a request cannot be ignored into silence.</li>
          <li>Logging a payment registers a confirmation duty; nothing touches the balance until it is met.</li>
          <li>A reminder budget that, once spent, takes the tool off the page — not disables it, removes it.</li>
          <li>Default that cannot be declared while a request is unanswered or the cure period has not run.</li>
          <li>A pause that belongs to the borrower, taken without asking, that removes the lender&rsquo;s tools while it runs.</li>
        </ul>

        <p>
          Then read <Link href="/why-webmcp" className="link">why WebMCP</Link> is the thing that makes this
          enforceable rather than promised.
        </p>
      </article>
    </PageShell>
  );
}
