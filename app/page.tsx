"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./workbench.css";

import Actions from "@/components/Actions";
import SlateBoard from "@/components/SlateBoard";
import HeroLoop from "@/components/HeroLoop";
import Opener from "@/components/Opener";
import KeyBox from "@/components/KeyBox";
import { loadOwnKey, saveOwnKey, type OwnKey } from "@/lib/keys";
import { NAV } from "@/components/PageShell";
import Link from "next/link";
import ToolConsole from "@/components/ToolConsole";
import Simulate from "@/components/Simulate";
import OtherHalf from "@/components/OtherHalf";
import BankPanel from "@/components/BankPanel";
import Negotiate from "@/components/Negotiate";

import { capabilities, formatDay, nameFor, newLoan, other, phase } from "@/lib/engine";
import { buildTools } from "@/lib/tools";
import { StandInAgent, type AgentMode, type TraceEntry } from "@/lib/agent";
import type { StandInMood } from "@/lib/standin";
import { DEFAULT_TERMS, type LoanState, type Role } from "@/lib/types";
import { ToolRegistry, providerLabel, type Provider, type RegisteredTool } from "@/lib/webmcp";
import type { HalfPresence, Presence } from "@/lib/store";

/** Polling is the fallback when the event stream drops. */
const POLL_FALLBACK_MS = 6000;
const TICK_RULES_MS = 2600;
const TICK_MODEL_MS = 7000;

/**
 * Optional. Set NEXT_PUBLIC_PARTNER_ORIGIN to the origin serving the other
 * half and tool discovery becomes browser-enforced across origins via
 * `exposedTo` / `fromOrigins`. Unset, the two halves share one origin and the
 * server re-checks every call instead.
 */
const PARTNER_ORIGIN = process.env.NEXT_PUBLIC_PARTNER_ORIGIN?.trim() || null;

/**
 * The bank lives on its own origin (see bank/). Set NEXT_PUBLIC_BANK_ORIGIN to
 * where it runs; in development it defaults to the port `npm run bank` uses.
 */
const BANK_ORIGIN =
  process.env.NEXT_PUBLIC_BANK_ORIGIN?.trim().replace(/\/$/, "") ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : null);

const FROM_ORIGINS = [PARTNER_ORIGIN, BANK_ORIGIN].filter((o): o is string => Boolean(o));

type HalfKeys = Partial<Record<Role, string>>;

function keysStorageKey(room: string): string {
  return `slate-keys:${room}`;
}

function loadKeys(room: string): HalfKeys {
  try {
    const raw = localStorage.getItem(keysStorageKey(room));
    return raw ? (JSON.parse(raw) as HalfKeys) : {};
  } catch {
    return {};
  }
}

function saveKeys(room: string, keys: HalfKeys): void {
  localStorage.setItem(keysStorageKey(room), JSON.stringify(keys));
}

export default function Page() {
  const [room, setRoom] = useState<string>("");
  const [role, setRole] = useState<Role | null>(null);
  const [keys, setKeys] = useState<HalfKeys>({});
  const [entryNote, setEntryNote] = useState<string | null>(null);
  const [standIn, setStandIn] = useState(false);
  const [mood, setMood] = useState<StandInMood>("stretched");
  const [agentMode, setAgentMode] = useState<AgentMode>("rules");
  const [model, setModel] = useState<{
    serverKey: boolean;
    provider: string | null;
    name: string | null;
    defaults: Record<string, string> | null;
  }>({ serverKey: false, provider: null, name: null, defaults: null });
  // A person's own key: memory by default, this browser only if they ask.
  const [own, setOwn] = useState<OwnKey | null>(null);
  const [keyRemembered, setKeyRemembered] = useState(false);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [state, setState] = useState<LoanState>(() => newLoan("DEMO", DEFAULT_TERMS));
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [myTools, setMyTools] = useState<RegisteredTool[]>([]);
  const [refused, setRefused] = useState<{ name: string; at: number } | null>(null);
  const [provider, setProvider] = useState<Provider>("shim");
  const [revision, setRevision] = useState(0);
  const [preselect, setPreselect] = useState<string | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [live, setLive] = useState(false);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [demo, setDemoState] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const autoplayRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const simRef = useRef(false);
  simRef.current = simRunning;

  // Two registries: this party's, on the page's own model context, and the
  // other party's, on an isolated context that only exists here when this
  // device holds their half-key. The stand-in and the simulator act through
  // the second one; nothing on this page can reach it any other way.
  const [registry, setRegistry] = useState<ToolRegistry | null>(null);
  const [otherRegistry, setOtherRegistry] = useState<ToolRegistry | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const modelAvailableRef = useRef(false);
  modelAvailableRef.current = model.serverKey || Boolean(own);
  const roleRef = useRef<Role | null>(role);
  roleRef.current = role;
  const keysRef = useRef<HalfKeys>(keys);
  keysRef.current = keys;

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = (params.get("room") || randomRoom()).toUpperCase().slice(0, 8);
    setRoom(r);
    const roleParam = params.get("role");
    const keyParam = params.get("key");
    const stored = loadKeys(r);

    // A key in the address is an invite: keep it, then get it out of the bar.
    if ((roleParam === "lender" || roleParam === "borrower") && keyParam) {
      stored[roleParam] = keyParam;
      saveKeys(r, stored);
    }
    setKeys(stored);

    if (roleParam === "lender" || roleParam === "borrower") {
      if (stored[roleParam]) setRole(roleParam);
    }

    const theme = localStorage.getItem("slate-theme");
    if (theme === "dark" || theme === "light") setTheme(theme);

    // The demo layer (clock, simulator, stand-in, console) is off unless asked
    // for. ?demo=1 turns it on; the switch in the banner remembers the choice.
    const demoParam = params.get("demo");
    const storedDemo = localStorage.getItem("slate-demo");
    setDemoState(demoParam === "1" || (demoParam !== "0" && storedDemo === "1"));
    if (params.get("autoplay") === "1") {
      setAutoplay(true);
      autoplayRef.current = true;
      setDemoState(true);
    }

    fetch("/api/agent")
      .then((res) => res.json())
      .then((data) =>
        setModel({
          serverKey: Boolean(data?.serverKey),
          provider: data?.provider ?? null,
          name: data?.model ?? null,
          defaults: data?.models ?? null,
        })
      )
      .catch(() => setModel({ serverKey: false, provider: null, name: null, defaults: null }));

    const rememberedKey = loadOwnKey();
    if (rememberedKey) {
      setOwn(rememberedKey);
      setKeyRemembered(true);
    }
  }, []);

  // Open the room on first visit: the server mints both half-keys exactly
  // once. If someone else already opened it, this device needs an invite.
  useEffect(() => {
    if (!room) return;
    if (keysRef.current.lender || keysRef.current.borrower) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, type: "open-room" }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.ok && data.keys) {
          saveKeys(room, data.keys);
          setKeys(data.keys);
          // The walkthrough's "simulate it for me" skips the opener: take the
          // lender's half in the default names and let the simulator play.
          if (autoplayRef.current) setRole("lender");
        } else {
          setEntryNote(data?.message ?? "This slate has already been opened.");
        }
      } catch {
        if (!cancelled) setEntryNote("Could not reach the slate. Is the server running?");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("slate-theme", theme);
  }, [theme]);

  const changeKey = useCallback((key: OwnKey | null, remember: boolean) => {
    setOwn(key);
    setKeyRemembered(Boolean(key) && remember);
    saveOwnKey(key && remember ? key : null);
  }, []);

  const setDemo = useCallback((v: boolean) => {
    setDemoState(v);
    localStorage.setItem("slate-demo", v ? "1" : "0");
  }, []);

  useEffect(() => {
    if (!modelAvailableRef.current && agentMode === "model") setAgentMode("rules");
  });

  // For "seen 2 min ago" to stay honest.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!room || !role) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", room);
    url.searchParams.set("role", role);
    url.searchParams.delete("key");
    url.searchParams.delete("autoplay");
    window.history.replaceState({}, "", url);
  }, [room, role]);

  /* ------------------------------------------------------------ transport */

  const refresh = useCallback(async () => {
    if (!room) return;
    try {
      const res = await fetch(`/api/state?room=${encodeURIComponent(room)}`, { cache: "no-store" });
      const data = await res.json();
      if (data?.state) setState(data.state);
    } catch {
      /* offline: keep the last good state rather than blanking the slate */
    }
  }, [room]);

  // The entry screen needs the names on the slate before a half is taken.
  useEffect(() => {
    if (room) void refresh();
  }, [room, refresh]);

  // Live feed first; poll only while the stream is down.
  useEffect(() => {
    if (!room || !role) return;
    void refresh();
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const startPoll = () => {
      if (poll) return;
      poll = setInterval(() => void refresh(), POLL_FALLBACK_MS);
    };
    const stopPoll = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };

    if (typeof EventSource !== "undefined") {
      es = new EventSource(`/api/events?room=${encodeURIComponent(room)}&role=${role}`);
      es.addEventListener("presence", (ev) => {
        try {
          setPresence(JSON.parse((ev as MessageEvent).data));
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("state", (ev) => {
        try {
          setState(JSON.parse((ev as MessageEvent).data));
          setLive(true);
          stopPoll();
        } catch {
          /* ignore a bad frame */
        }
      });
      es.onerror = () => {
        setLive(false);
        startPoll();
      };
    } else {
      startPoll();
    }

    return () => {
      es?.close();
      stopPoll();
    };
  }, [room, role, refresh]);

  const dispatch = useCallback(
    async (
      type: string,
      payload: Record<string, unknown> = {},
      opts: { as?: Role; via?: "tool" | "ui" | "clock" } = {}
    ) => {
      const actor = opts.as ?? roleRef.current;
      if (!actor || !room) return { ok: false, message: "No role selected." };
      const key = keysRef.current[actor];
      if (!key) return { ok: false, message: `This device does not hold the ${actor}'s half-key.` };
      try {
        const res = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, type, role: actor, key, via: opts.via ?? "ui", payload }),
        });
        const data = await res.json();
        if (data?.state) setState(data.state);
        // Silent success: the slate and the ledger already show it. Only a
        // refusal speaks, and it speaks for the clause.
        if (!data.ok && !simRef.current && (!opts.as || opts.as === roleRef.current)) {
          setToast({ text: String(data.message ?? "Refused."), tone: "error" });
          setRefused({ name: type, at: Date.now() });
        }
        return { ok: Boolean(data.ok), message: String(data.message ?? "") };
      } catch {
        const message = "Could not reach the slate. Is the server running?";
        setToast({ text: message, tone: "error" });
        return { ok: false, message };
      }
    },
    [room]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  /* -------------------------------------------------- WebMCP registration */

  const otherRole: Role | null = role ? other(role) : null;
  const holdsOtherKey = Boolean(otherRole && keys[otherRole]);

  useEffect(() => {
    if (!role) return;
    const mine = new ToolRegistry();
    setRegistry(mine);
    setProvider(mine.provider);
    const theirs = holdsOtherKey ? new ToolRegistry({ isolated: true }) : null;
    setOtherRegistry(theirs);
    return () => {
      void mine.teardown();
      void theirs?.teardown();
      setRegistry(null);
      setOtherRegistry(null);
    };
  }, [role, holdsOtherKey]);

  // The heart of it: every state change re-derives each party's capability
  // surface and syncs their registry to match. Tools that lost their clause
  // are aborted; tools whose clause just opened are registered.
  useEffect(() => {
    if (!registry || !role) return;
    let cancelled = false;

    (async () => {
      const specs = buildTools(stateRef.current, role, (type, payload) =>
        dispatch(type, payload ?? {}, { via: "tool" })
      );
      const { added, removed } = await registry.sync(specs, {
        // When the two halves are deployed on separate origins, this is what
        // makes the asymmetry browser-enforced rather than server-checked:
        // the counterparty's origin may discover these tools, nobody else may.
        exposedTo: PARTNER_ORIGIN ? [PARTNER_ORIGIN] : undefined,
      });
      if (cancelled) return;
      setMyTools(await registry.context.getTools());
      if (added.length || removed.length) setRevision((r) => r + 1);

      if (otherRegistry && otherRole) {
        const theirSpecs = buildTools(stateRef.current, otherRole, (type, payload) =>
          dispatch(type, payload ?? {}, { as: otherRole, via: "tool" })
        );
        await otherRegistry.sync(theirSpecs);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state, role, otherRole, registry, otherRegistry, dispatch]);

  /**
   * Run one tool as one party, through that party's context. The simulator
   * uses this for both halves; it is the only way it can act.
   */
  const runTool = useCallback(
    async (as: Role, name: string, args: Record<string, unknown> = {}) => {
      const reg = as === roleRef.current ? registry : otherRegistry;
      if (!reg) return { ok: false, message: `No model context for the ${as} on this device.` };
      const tools = await reg.context.getTools();
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return {
          ok: false,
          message: `${name} is not registered on the ${as}'s model context right now.`,
        };
      }
      try {
        const result = (await reg.context.executeTool(tool, args)) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const text = result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
        const refused = /^(Not done|Refused)/.test(text) || /not available/i.test(text);
        return { ok: !refused, message: text };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    [registry, otherRegistry]
  );

  const linkBank = useCallback(
    (accountId: string) => dispatch("link-bank-account", { accountId }, { via: "ui" }),
    [dispatch]
  );

  const roomAction = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => dispatch(type, payload, { via: "clock" }),
    [dispatch]
  );

  /* ------------------------------------------------------------- stand-in */

  const agentRef = useRef<StandInAgent | null>(null);

  useEffect(() => {
    if (!standIn || !otherRole || !otherRegistry || !room) return;
    const agent = new StandInAgent({
      mc: otherRegistry.context,
      role: otherRole,
      mood,
      mode: agentMode,
      apiKey: own?.key ?? null,
      provider: own?.provider ?? null,
      modelName: own?.model ?? null,
      getState: () => stateRef.current,
      onTrace: (entry) => setTrace((t) => [...t.slice(-59), entry]),
    });
    agentRef.current = agent;
    const timer = setInterval(
      () => void agent.tick(),
      agentMode === "model" ? TICK_MODEL_MS : TICK_RULES_MS
    );
    return () => {
      clearInterval(timer);
      agent.stop();
      agentRef.current = null;
    };
    // mood and mode are pushed in below without restarting the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standIn, otherRole, otherRegistry, room, agentMode]);

  useEffect(() => {
    agentRef.current?.update({
      mood,
      mode: agentMode,
      apiKey: own?.key ?? null,
      provider: own?.provider ?? null,
      modelName: own?.model ?? null,
    });
  }, [mood, agentMode, own]);

  /* --------------------------------------------------------------- derived */

  const caps = useMemo(() => (role ? capabilities(state, role) : []), [state, role]);
  const p = phase(state);
  const t = state.terms;

  // Stable identity matters: the negotiation loop restarts if this changes.
  const bothContexts = useMemo(() => {
    if (!role || !otherRole || !registry || !otherRegistry) return null;
    return { [role]: registry.context, [otherRole]: otherRegistry.context } as Record<Role, typeof registry.context>;
  }, [role, otherRole, registry, otherRegistry]);

  const inviteUrl = useMemo(() => {
    if (!role || !otherRole || !keys[otherRole] || typeof window === "undefined") return null;
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("room", room);
    url.searchParams.set("role", otherRole);
    url.searchParams.set("key", keys[otherRole]!);
    return url.toString();
  }, [role, otherRole, keys, room]);

  if (!room) return null;

  /* ----------------------------------------------------------------- entry */

  if (!role) {
    return (
      <div className="shell">
        <Banner room={room} theme={theme} setTheme={setTheme} provider={provider} />
        <main className="entry">
          <div>
            <h1 className="entry__display">You get two nudges a month. Then Slate won&rsquo;t let you.</h1>
            <p className="entry__lede">
              Slate holds a loan between friends in both your hands. The terms aren&rsquo;t promises;
              they&rsquo;re capabilities. When a clause closes, the tool that performs it is rubbed off the
              page, for you and for any agent acting for you.
            </p>
            <HeroLoop />
            <p className="entry__note">
              Asking for time can&rsquo;t be ignored. The borrower gets one pause a year without asking.
              Default waits for the cure period. Wiping the slate takes every collection tool with it. The
              name is old: a tally stick was split lengthways so neither half could be altered alone.
            </p>
          </div>

          <div className="panel entry__form">
            <Opener
              keys={keys}
              state={state}
              note={entryNote}
              onOpen={async (r, names, principal) => {
                setRole(r);
                const res = await dispatch(
                  "propose-terms",
                  { lenderName: names.lender, borrowerName: names.borrower, principal },
                  { as: r, via: "ui" }
                );
                return res;
              }}
              onTake={(r) => setRole(r)}
            />
          </div>
        </main>
        <Footer provider={provider} />
      </div>
    );
  }

  /* ------------------------------------------------------------- workbench */

  const myName = nameFor(state, role);
  const theirName = nameFor(state, other(role));
  const theirs = presence?.[other(role)] ?? null;
  const modelAvailable = model.serverKey || Boolean(own);
  const modelLabel = own ? own.model ?? model.defaults?.[own.provider] ?? own.provider : model.name;

  return (
    <div className="shell">
      <Banner
        room={room}
        theirName={theirName}
        theirs={theirs}
        now={now}
        inviteUrl={inviteUrl}
        demo={demo}
        setDemo={setDemo}
        theme={theme}
        setTheme={setTheme}
        provider={provider}
        live={live}
      />

      <main className={demo ? "work work--demo" : "work work--plain"}>
        <div className="col">
          <section className="sec sec--board" aria-label="The slate">
            <SlateBoard state={state} viewer={role} />
            {demo && (
              <div className="clock">
                <span className="clock__label">Simulated clock</span>
                <span className="clock__date">{formatDay(state.day)}</span>
                <button type="button" className="btn btn--sm" onClick={() => void dispatch("advance-clock", { days: 7 }, { via: "clock" })}>
                  +1 week
                </button>
                <button type="button" className="btn btn--sm" onClick={() => void dispatch("advance-clock", { days: 30 }, { via: "clock" })}>
                  +1 month
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => void dispatch("reset", {}, { via: "ui" })}>
                  Reset
                </button>
              </div>
            )}
          </section>

          {p === "drafting" && <TermsForm state={state} dispatch={dispatch} />}

          {p === "drafting" && demo && registry && otherRole && (
            <Negotiate
              state={state}
              myRole={role}
              contexts={bothContexts}
              modelAvailable={modelAvailable}
              modelName={modelLabel}
              own={own}
              onSign={() => void runTool(role, "sign-agreement")}
            />
          )}

          <Actions
            caps={caps}
            tools={myTools}
            mc={registry?.context ?? null}
            state={state}
            role={role}
            myName={myName}
            theirName={theirName}
            refused={refused}
          />

          {BANK_ORIGIN && registry && (p === "active" || p === "paused") && (
            <BankPanel
              bankOrigin={BANK_ORIGIN}
              registry={registry}
              mc={registry.context}
              room={room}
              role={role}
              myName={myName}
              theirName={theirName}
              state={state}
              revision={revision}
              onLink={linkBank}
            />
          )}

          <section className="sec" aria-labelledby="log-title">
            <h2 className="sec__title" id="log-title">
              Ledger
            </h2>
            <ol className="ledger">
              {[...state.events]
                .slice(-40)
                .reverse()
                .map((e) => (
                  <li key={e.id} className="ledger__item" data-actor={e.actor === role ? "me" : e.actor === "system" ? "clock" : "them"}>
                    <span className="ledger__meta mono">
                      day {e.day}
                      {e.via === "tool" && e.tool ? ` · via ${e.tool}` : ""}
                    </span>
                    <span className="ledger__text">{e.text}</span>
                  </li>
                ))}
            </ol>
          </section>
        </div>

        {demo && (
          <div className="col col--demo">
            <KeyBox
              serverKey={model.serverKey}
              serverProvider={model.provider}
              serverModel={model.name}
              defaults={model.defaults}
              own={own}
              remembered={keyRemembered}
              onChange={changeKey}
            />

            <Simulate
              runTool={runTool}
              roomAction={roomAction}
              onBusyChange={setSimRunning}
              enabled={Boolean(otherRegistry)}
              autoplay={autoplay}
            />

            <OtherHalf
              theirName={theirName}
              theirRole={other(role)}
              inviteUrl={null}
              canStandIn={Boolean(otherRegistry)}
              standIn={standIn}
              setStandIn={(v) => {
                setStandIn(v);
                if (!v) setTrace([]);
              }}
              mood={mood}
              setMood={setMood}
              mode={agentMode}
              setMode={setAgentMode}
              modelAvailable={modelAvailable}
              modelName={modelLabel}
              trace={trace}
              onClearTrace={() => setTrace([])}
            />

            {registry && (
              <ToolConsole
                mc={registry.context}
                revision={revision}
                fromOrigins={FROM_ORIGINS.length ? FROM_ORIGINS : null}
                preselect={preselect}
                onConsumedPreselect={() => setPreselect(null)}
              />
            )}
          </div>
        )}
      </main>

      <Footer provider={provider} />

      {toast && (
        <div className="toast" data-tone={toast.tone === "error" ? "error" : undefined} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

function relative(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function Banner({
  room,
  theirName,
  theirs,
  now,
  inviteUrl,
  demo,
  setDemo,
  theme,
  setTheme,
  provider,
  live,
}: {
  room: string;
  theirName?: string;
  theirs?: HalfPresence | null;
  now?: number;
  inviteUrl?: string | null;
  demo?: boolean;
  setDemo?: (v: boolean) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  provider: Provider;
  live?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const inWork = typeof demo === "boolean";

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this invite link", inviteUrl);
    }
  }

  return (
    <header className="banner">
      <div className="banner__mark">
        <span className="wordmark">Slate</span>
        <span className="banner__room">/ {room}</span>
      </div>

      {!inWork && (
        <nav className="nav" aria-label="Pages">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="nav__link">
              {n.label}
            </Link>
          ))}
        </nav>
      )}

      {inWork && theirName && (
        <div className="presence">
          {theirs && theirs.lastSeen !== null ? (
            <>
              <span className="presence__dot" data-on={theirs.online || undefined} aria-hidden="true" />
              <span>
                {theirs.online ? `${theirName} is here` : `${theirName} · seen ${relative(theirs.lastSeen, now ?? Date.now())}`}
              </span>
            </>
          ) : (
            <>
              <span className="presence__dot" aria-hidden="true" />
              <span>{theirName} hasn&rsquo;t opened their half</span>
              {inviteUrl && (
                <button type="button" className="btn btn--sm" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy invite"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="banner__spacer" />
      <div className="banner__side">
        {inWork && demo && (
          <>
            <span className="provider-chip" data-native={provider !== "shim"}>
              <span className="provider-chip__dot" aria-hidden="true" />
              {provider === "shim" ? "shim" : "native"}
            </span>
            <span className="provider-chip" data-native={live} title={live ? "Live: the other half's moves arrive as they happen" : "Polling: the event stream is down"}>
              <span className="provider-chip__dot" aria-hidden="true" />
              {live ? "live" : "polling"}
            </span>
          </>
        )}
        {inWork && setDemo && (
          <label className="switch">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            <span className="switch__track" aria-hidden="true" />
            <span>Demo</span>
          </label>
        )}
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
        >
          {theme === "light" ? "Dark" : "Light"}
        </button>
      </div>
    </header>
  );
}

function Footer({ provider }: { provider: Provider }) {
  return (
    <footer className="foot">
      <span>Slate — WebMCP capability surface</span>
      <span aria-hidden="true">·</span>
      <span className="mono">{providerLabel(provider)}</span>
    </footer>
  );
}

/**
 * Declarative WebMCP: the browser can synthesise a tool from this form's
 * attributes. Deliberately no `toolautosubmit` — an agent may fill the terms,
 * but a person presses the button.
 */
function TermsForm({
  state,
  dispatch,
}: {
  state: LoanState;
  dispatch: (
    type: string,
    payload?: Record<string, unknown>,
    opts?: { as?: Role; via?: "tool" | "ui" | "clock" }
  ) => Promise<{ ok: boolean; message: string }>;
}) {
  const t = state.terms;
  const [principal, setPrincipal] = useState(String(t.principal / 100));
  const [count, setCount] = useState(String(t.installmentCount));
  const [budget, setBudget] = useState(String(t.reminderBudget));
  const [cure, setCure] = useState(String(t.cureDays));

  return (
    <section className="panel" aria-labelledby="terms-title">
      <div className="panel__head">
        <span className="label">Open until both halves are signed</span>
        <h2 className="panel__title" id="terms-title">
          Terms
        </h2>
      </div>
      <form
        className="console"
        // Declarative WebMCP attributes — synthesised into a tool by browsers
        // that support it, inert everywhere else.
        {...({
          toolname: "propose-terms-form",
          tooldescription:
            "Fill in the proposed terms of the loan. The person must press Propose themselves; this form never submits on its own.",
        } as Record<string, string>)}
        onSubmit={(e) => {
          e.preventDefault();
          void dispatch("propose-terms", {
            principal: Number(principal),
            installmentCount: Number(count),
            reminderBudget: Number(budget),
            cureDays: Number(cure),
          });
        }}
      >
        <div className="console__args">
          <div className="field">
            <label className="field__label" htmlFor="t-principal">
              Amount lent
            </label>
            <input
              id="t-principal"
              name="principal"
              className="input figure"
              inputMode="decimal"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              {...({ toolparamdescription: "Amount lent, in whole units." } as Record<string, string>)}
            />
            <p className="field__help">Currency {t.currency}.</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="t-count">
              Number of payments
            </label>
            <input
              id="t-count"
              name="installmentCount"
              className="input figure"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              {...({ toolparamdescription: "How many repayments, 1 to 36." } as Record<string, string>)}
            />
            <p className="field__help">Every {t.cadenceDays} days.</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="t-budget">
              Reminders per month
            </label>
            <input
              id="t-budget"
              name="reminderBudget"
              className="input figure"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              {...({
                toolparamdescription:
                  "How many reminders the lender may send in any 30-day window.",
              } as Record<string, string>)}
            />
            <p className="field__help">The clause that protects the friendship.</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="t-cure">
              Cure period, days
            </label>
            <input
              id="t-cure"
              name="cureDays"
              className="input figure"
              inputMode="numeric"
              value={cure}
              onChange={(e) => setCure(e.target.value)}
              {...({
                toolparamdescription:
                  "Days an overdue payment must sit before default may be declared.",
              } as Record<string, string>)}
            />
            <p className="field__help">Default is locked shut until it runs.</p>
          </div>
        </div>
        <div className="console__row">
          <button type="submit" className="btn btn--primary">
            Propose these terms
          </button>
        </div>
      </form>
    </section>
  );
}

function randomRoom(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
