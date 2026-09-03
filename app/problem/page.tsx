import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/PageShell";

import People from "@/components/People";

export const metadata: Metadata = {
  title: "The problem — Slate",
  description: "Why lending money to someone you like goes wrong, and what would have to be true for it not to.",
};

export default function ProblemPage() {
  return (
    <PageShell current="/problem">
      <article className="prose">
        <p className="prose__kicker">The problem</p>
        <h1 className="prose__display">Lending money to someone you like.</h1>
        <p className="prose__lede">
          It goes wrong the same way every time, and the money is rarely the part that hurts.
        </p>

        <People scene="asking" className="people people--page" />

        <h2>What actually happens</h2>
        <p>
          Nobody writes anything down, because writing it down feels like distrust. A date drifts. The lender
          doesn&rsquo;t want to become the person who chases, so they say nothing, and the nothing gets louder. The
          borrower can tell, and asking for more time now feels like begging, so they go quiet instead. Neither of
          them knows what &ldquo;late&rdquo; means, because it was never said. The friendship is worth more than the
          money, so everyone avoids the conversation until it is the only conversation left.
        </p>

        <h2>What people use now</h2>
        <p>
          A text thread. A spreadsheet. A payment-app request that sits there, unanswered, as a small daily insult. A
          &ldquo;contract&rdquo; one of them found online that neither reads again. All of these are <em>records</em>.
          A record can be ignored. A record does not stop you from sending the sixth reminder, and it does not make
          the other person answer when you ask for two more weeks.
        </p>

        <h2>What would have to be true</h2>
        <ul>
          <li>
            <strong>Chasing costs something.</strong> A lender who can nudge twice a month, and then physically
            cannot, is protected from their own worst evening. So is the friendship.
          </li>
          <li>
            <strong>Asking cannot be ignored.</strong> A request for time should put a decision in front of the other
            person and leave it there until they answer.
          </li>
          <li>
            <strong>Some things belong to one side outright.</strong> One pause a year that the borrower takes
            without asking. Forgiveness that only the lender can give, and that ends the matter for good.
          </li>
          <li>
            <strong>Default has to be earned.</strong> Not a mood — a cure period that has run, a warning that was
            actually sent, and no open request waiting for an answer.
          </li>
          <li>
            <strong>It has to bind the assistants too.</strong> Increasingly the person doing the chasing, or the
            paying, is an agent acting for someone. Rules that only exist as text are rules the agent can talk its
            way around. The terms have to be enforced at the level where the agent acts.
          </li>
        </ul>

        <h2>What Slate is</h2>
        <p>
          A slate is opened between two named people. The terms are not text they promise to honour; they are
          capabilities. What each side can do is exactly what the agreement grants them right now, and when a clause
          closes, the tool that performs it is rubbed off the page — for the person and for any agent acting for
          them. The <Link href="/why-webmcp" className="link">why WebMCP</Link> page explains how that is enforced,
          and the <Link href="/walkthrough" className="link">walkthrough</Link> shows a whole loan, start to finish.
        </p>
      </article>
    </PageShell>
  );
}
