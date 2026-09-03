import { desires, MOOD_LABEL, type StandInMood, type StandInMove } from "./standin";
import type { LoanState, Role } from "./types";
import type { ModelContextLike, RegisteredTool } from "./webmcp";

/**
 * The stand-in as an agent.
 *
 * It is handed a model context that belongs to the other party — its own
 * `ToolRegistry({ isolated: true })`, kept in sync with that party's capability
 * surface by the page. Everything it knows about what it can do comes from
 * `getTools()` on that context, and everything it does goes through
 * `executeTool()`. It has no back door to the server.
 *
 * Two brains, one path:
 *  - "rules": the deterministic mover in lib/standin.ts lists what it would
 *    like to do; the first wish that is on the surface is executed, and each
 *    wish that is not is recorded as a refusal.
 *  - "model": a Claude model is given the discovered tool list verbatim and
 *    asked to act in character. When it wants something the list lacks, it
 *    has to say so.
 */

export type AgentMode = "rules" | "model";

export type TraceKind = "discover" | "thought" | "call" | "result" | "refused" | "error" | "idle";

export interface TraceEntry {
  id: number;
  at: number;
  kind: TraceKind;
  text: string;
}

export interface AgentOptions {
  mc: ModelContextLike;
  role: Role;
  mood: StandInMood;
  mode: AgentMode;
  getState: () => LoanState;
  onTrace: (entry: TraceEntry) => void;
  /** Rules brain: what to want, instead of the disposition-driven default. */
  wants?: (s: LoanState, role: Role) => StandInMove[];
  /** Model brain: the system prompt, instead of the disposition-driven default. */
  brief?: (s: LoanState, role: Role) => string;
  /**
   * Tools the agent must behave as if it cannot see, even if they are on
   * its context. The negotiators use this for sign-agreement: signing is the
   * people's step, so the agents are never offered it.
   */
  exclude?: string[];
  /** A person's own key (Anthropic, OpenAI or Gemini), sent per call and never stored server-side. */
  apiKey?: string | null;
  provider?: string | null;
  modelName?: string | null;
}

const MOOD_BRIEF: Record<StandInMood, string> = {
  reliable:
    "You pay in full when a payment is due, confirm payments the moment they land, and grant more time when asked.",
  stretched:
    "Money is tight. As borrower you pay part of what is due and ask for more time rather than going quiet. As lender you send a reminder once something is overdue and grant more time when asked.",
  avoidant:
    "As borrower you go quiet, then take the hardship pause once you are far behind. As lender you decline requests for time, send sharp reminders, and reach for default the moment the cure period is up.",
};

let traceSeq = 0;

export class StandInAgent {
  private opts: AgentOptions;
  private busy = false;
  private stopped = false;

  constructor(opts: AgentOptions) {
    this.opts = opts;
  }

  update(patch: Partial<Pick<AgentOptions, "mood" | "mode" | "apiKey" | "provider" | "modelName">>): void {
    this.opts = { ...this.opts, ...patch };
  }

  stop(): void {
    this.stopped = true;
  }

  private trace(kind: TraceKind, text: string): void {
    this.opts.onTrace({ id: ++traceSeq, at: Date.now(), kind, text });
  }

  /** The tools this agent may see: its context, minus anything excluded. */
  private async visible(): Promise<RegisteredTool[]> {
    const all = await this.opts.mc.getTools();
    const hidden = new Set(this.opts.exclude ?? []);
    return all.filter((t) => !hidden.has(t.name));
  }

  private async discover(): Promise<RegisteredTool[]> {
    const tools = await this.visible();
    this.trace(
      "discover",
      tools.length
        ? `getTools() → ${tools.map((t) => t.name).join(", ")}`
        : "getTools() → nothing registered on my surface"
    );
    return tools;
  }

  private async execute(tool: RegisteredTool, args: unknown): Promise<string> {
    this.trace("call", `executeTool(${tool.name}) ${JSON.stringify(args ?? {})}`);
    try {
      const result = await this.opts.mc.executeTool(tool, args);
      const text = resultText(result);
      this.trace("result", text);
      return text;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      this.trace("error", text);
      return `Error: ${text}`;
    }
  }

  /** One turn. Returns true if an action was taken. */
  async tick(): Promise<boolean> {
    if (this.busy || this.stopped) return false;
    this.busy = true;
    try {
      const tools = await this.discover();
      return this.opts.mode === "model" ? await this.tickModel(tools) : await this.tickRules(tools);
    } finally {
      this.busy = false;
    }
  }

  /* ------------------------------------------------------------------ rules */

  private async tickRules(tools: RegisteredTool[]): Promise<boolean> {
    const state = this.opts.getState();
    const wants = this.opts.wants
      ? this.opts.wants(state, this.opts.role)
      : desires(state, this.opts.role, this.opts.mood);
    if (!wants.length) {
      this.trace("idle", "Nothing I want to do right now.");
      return false;
    }
    for (const want of wants) {
      const tool = tools.find((t) => t.name === want.tool);
      if (!tool) {
        this.trace("refused", `Wanted ${want.tool} (${want.rationale}) — not on my surface.`);
        continue;
      }
      this.trace("thought", want.rationale);
      await this.execute(tool, want.args);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ model */

  private async tickModel(initialTools: RegisteredTool[]): Promise<boolean> {
    const state = this.opts.getState();
    const role = this.opts.role;
    const name = role === "lender" ? state.terms.lenderName : state.terms.borrowerName;
    const system = this.opts.brief
      ? this.opts.brief(state, role)
      : [
      `You are ${name}, the ${role} on a small loan between friends, played by a stand-in agent.`,
      `Disposition: ${MOOD_LABEL[this.opts.mood]}. ${MOOD_BRIEF[this.opts.mood]}`,
      `You can act only through the tools you are given. They are the capabilities the agreement grants you at this moment; anything not listed is closed to you by a clause.`,
      `Each turn: call get-loan-summary first. Then take at most one action that fits your disposition, or none if nothing is due. Do not repeat an action the summary shows you already took today.`,
      `If you want to do something and there is no tool for it, do not improvise or ask. Write exactly one line beginning "WANTED: <action> — <why>" and stop. You may call explain-locked-capability first to learn which clause is in the way.`,
      `Keep any other text to one short sentence.`,
    ].join("\n");

    let tools = initialTools;
    const messages: unknown[] = [
      { role: "user", content: `It is ${dayLabel(state)}. Decide your next move.` },
    ];
    let acted = false;

    for (let round = 0; round < 4 && !this.stopped; round++) {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.opts.apiKey ? { "x-model-key": this.opts.apiKey } : {}),
          ...(this.opts.apiKey && this.opts.provider ? { "x-model-provider": this.opts.provider } : {}),
          ...(this.opts.apiKey && this.opts.modelName ? { "x-model-name": this.opts.modelName } : {}),
        },
        body: JSON.stringify({
          system,
          messages,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        this.trace("error", data?.message ?? `Model call failed (${res.status}).`);
        return acted;
      }

      const content = (data.content ?? []) as Array<
        { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }
      >;

      for (const block of content) {
        if (block.type !== "text" || !block.text.trim()) continue;
        for (const line of block.text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (/^WANTED:/i.test(trimmed)) {
            this.trace("refused", `${trimmed.replace(/^WANTED:\s*/i, "Wanted ")} — not on my surface.`);
          } else {
            this.trace("thought", trimmed);
          }
        }
      }

      const calls = content.filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use");
      if (!calls.length) break;

      messages.push({ role: "assistant", content });
      const results: unknown[] = [];
      for (const call of calls) {
        const tool = tools.find((t) => t.name === call.name);
        if (!tool) {
          // The model only ever saw the discovered list, so this is rare, but a
          // fabricated name must fail the same way a closed clause does.
          this.trace("refused", `Tried ${call.name} — no such tool is registered on my context.`);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: `No tool named "${call.name}" is registered on your model context.`,
          });
          continue;
        }
        const text = await this.execute(tool, call.input);
        if (!tool.annotations?.readOnlyHint) acted = true;
        results.push({ type: "tool_result", tool_use_id: call.id, content: text });
      }
      messages.push({ role: "user", content: results });

      // The surface may have changed under us; read it again before the
      // next round so the model is never offered a tool that just closed.
      await new Promise((r) => setTimeout(r, 250));
      tools = await this.visible();
      if (acted) break;
    }
    return acted;
  }
}

/* ---------------------------------------------------------------- helpers */

function resultText(result: unknown): string {
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    if (Array.isArray(content)) {
      return content
        .map((c) => (c && c.type === "text" ? c.text ?? "" : JSON.stringify(c)))
        .join("\n");
    }
  }
  return typeof result === "string" ? result : JSON.stringify(result ?? null);
}

function dayLabel(s: LoanState): string {
  return `day ${s.day} of the slate`;
}
