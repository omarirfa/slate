import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/PageShell";

import People from "@/components/People";

export const metadata: Metadata = {
  title: "Why WebMCP — Slate",
  description: "How a browser API for page-level tools turns the terms of a loan into things that are enforced rather than promised.",
};

export default function WhyPage() {
  return (
    <PageShell current="/why-webmcp">
      <article className="prose">
        <p className="prose__kicker">Why WebMCP</p>
        <h1 className="prose__display">The terms aren&rsquo;t text. They&rsquo;re tools.</h1>
        <p className="prose__lede">
          WebMCP lets a web page register tools that an agent can discover and call, on that page, inside the
          person&rsquo;s own session. Slate uses that one mechanism to make an agreement enforce itself.
        </p>

        <People scene="apart" className="people people--page" />

        <h2>What WebMCP is, in a sentence</h2>
        <p>
          A page calls <code>document.modelContext.registerTool(&hellip;)</code> to say &ldquo;here is something an
          agent may do here.&rdquo; An agent — the browser&rsquo;s own, an extension, or a script on the page — calls{" "}
          <code>getTools()</code> to see what is on offer and <code>executeTool()</code> to do it. A tool can be
          withdrawn at any moment with an <code>AbortController</code>. Forms can declare themselves as tools with a{" "}
          <code>toolname</code> attribute, and a page can expose tools to one other origin and no other.
        </p>

        <h2>Why that fits this problem</h2>

        <h3>1. A clause is a tool that is registered, or isn&rsquo;t</h3>
        <p>
          &ldquo;Two nudges a month&rdquo; is not a sentence in Slate. It is the <code>send-reminder</code> tool being
          registered while the budget has room and aborted the moment it runs out. An agent that wants to nudge a third
          time does not hit a permission check and get told no. It never finds the door. The stand-in&rsquo;s trace
          shows this happening: <em>wanted send-reminder — not on my surface</em>.
        </p>

        <h3>2. People and their agents live by the same rules</h3>
        <p>
          The list of actions a person sees on the page and the list an agent gets from <code>getTools()</code> are
          the same list, built from the same state by the same code. There is no second, softer path for the human
          and no harder path for the agent. When a clause closes for one, it closes for both.
        </p>

        <h3>3. Two parties, two surfaces</h3>
        <p>
          The lender and the borrower each get their own model context. Every state change re-derives each
          side&rsquo;s capabilities and syncs its registry: new clauses register, closed ones abort, and a{" "}
          <code>toolchange</code> event tells any listening agent that the ground moved. Deployed on separate
          origins, <code>exposedTo</code> and <code>fromOrigins</code> make the browser itself enforce that
          the borrower&rsquo;s agent cannot even discover the lender&rsquo;s tools.
        </p>

        <h3>4. Obligations can be discharged by another origin</h3>
        <p>
          The bank is a separate site, embedded with <code>allow=&quot;tools&quot;</code>. It exposes{" "}
          <code>get-balance</code>, <code>list-transactions</code> and <code>prepare-transfer</code> to Slate&rsquo;s
          origin and nobody else. When the borrower pays, Slate reads the bank&rsquo;s record through a cross-origin
          tool and logs it; the lender&rsquo;s duty to confirm is met by <code>list-transactions</code> showing the
          money landed — a read tool on a third origin, not a person clicking yes. The ledger records what was checked.
        </p>

        <h3>5. The consequential step stays with a person</h3>
        <p>
          The bank&rsquo;s <code>send-transfer</code> is a declarative form with no <code>toolautosubmit</code>. An
          agent can fill it — <code>prepare-transfer</code> does exactly that — but only the account holder presses
          Pay. Signing the agreement works the same way: two agents can negotiate the terms, but{" "}
          <code>sign-agreement</code> is excluded from what they may see. The spec&rsquo;s own model for money and
          signatures is the one Slate uses.
        </p>

        <h3>6. Why not just a backend API</h3>
        <p>
          A server-side integration holds a long-lived token and acts somewhere the person cannot see. WebMCP tools
          run in the person&rsquo;s own logged-in page: the agent never holds a credential, the site decides who may
          discover its tools, and the person is looking at the same state the agent is acting on. For a moment that
          is supposed to be theirs — pressing Pay, signing — that is the right layer.
        </p>

        <h2>The pieces, by name</h2>
        <ul className="prose__list--mono">
          <li>
            <code>registerTool</code> with <code>AbortController</code> — dynamic surface, diffed on every change
          </li>
          <li>
            <code>toolchange</code> — agents learn the ground moved without polling
          </li>
          <li>
            <code>getTools()</code> / <code>executeTool()</code> — every in-page agent acts only through these
          </li>
          <li>
            <code>toolname</code> forms, no <code>toolautosubmit</code> — terms and transfers
          </li>
          <li>
            <code>exposedTo</code> / <code>fromOrigins</code> — the bank, and per-party isolation across origins
          </li>
          <li>
            <code>annotations</code> — <code>readOnlyHint</code> on reads, <code>destructiveHint</code> on default
            and forgiveness
          </li>
          <li>
            isolated contexts — the stand-in and the negotiators hold the other party&rsquo;s tools and nothing else
          </li>
        </ul>

        <p>
          See it happen in the <Link href="/walkthrough" className="link">walkthrough</Link>, or{" "}
          <Link href="/?demo=1" className="link">open a slate with the demo layer on</Link> and read the tool console
          yourself.
        </p>
      </article>
    </PageShell>
  );
}
