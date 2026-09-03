/**
 * WebMCP integration.
 *
 * The spec is a moving target: `provideContext()` was removed in March 2026 and
 * the surface moved from `navigator.modelContext` to `document.modelContext`
 * (Chrome deprecated the navigator alias in 150 but still ships it during the
 * origin trial). So: detect in priority order, and fall back to a shim that
 * implements the same shape, so in-page agents work in every browser.
 */

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ModelContextTool {
  name: string;
  description: string;
  title?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute: (args: any, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  origin?: string;
}

export interface RegisterOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

export interface ModelContextLike extends EventTarget {
  registerTool(tool: ModelContextTool, options?: RegisterOptions): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool,
    args: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
}

export type Provider = "document" | "navigator" | "shim";

/* ------------------------------------------------------------------- shim */

const BRIDGE = "webmcp-bridge";
const BRIDGE_TIMEOUT_MS = 6000;

/**
 * Spec-shaped in-page model context. Beyond the page's own tools it can be
 * attached to embedded frames on other origins that run the matching shim
 * (see bank/webmcp-shim.js): `getTools({ fromOrigins })` asks each named
 * frame for the tools it exposes to this origin, and `executeTool` on one of
 * those runs it inside that frame. That mirrors what the browser does
 * natively with `exposedTo` / `fromOrigins`, so the same page code works
 * either way.
 */
class ModelContextShim extends EventTarget implements ModelContextLike {
  private tools = new Map<string, ModelContextTool & { origin: string }>();
  private frames = new Map<string, Window>();
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; origin: string }>();
  private seq = 0;

  constructor() {
    super();
    if (typeof window !== "undefined") {
      window.addEventListener("message", (event) => this.onMessage(event));
    }
  }

  attachFrame(win: Window, origin: string): void {
    this.frames.set(origin, win);
    this.dispatchEvent(new Event("toolchange"));
  }

  detachFrame(origin: string): void {
    if (this.frames.delete(origin)) this.dispatchEvent(new Event("toolchange"));
  }

  private onMessage(event: MessageEvent): void {
    const msg = event.data;
    if (!msg || typeof msg !== "object" || !msg[BRIDGE]) return;
    if (!this.frames.has(event.origin)) return;
    if (msg[BRIDGE] === "toolchange") {
      this.dispatchEvent(new Event("toolchange"));
      return;
    }
    if (msg[BRIDGE] === "reply" && typeof msg.id === "string") {
      const p = this.pending.get(msg.id);
      if (!p || p.origin !== event.origin) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg);
      else p.reject(new DOMException(String(msg.error ?? "Bridged call failed."), "InvalidStateError"));
    }
  }

  private request(origin: string, body: Record<string, unknown>): Promise<any> {
    const win = this.frames.get(origin);
    if (!win) return Promise.reject(new DOMException(`No frame attached for ${origin}.`, "InvalidStateError"));
    const id = `b${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DOMException(`${origin} did not answer.`, "TimeoutError"));
      }, BRIDGE_TIMEOUT_MS);
      this.pending.set(id, {
        origin,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      win.postMessage({ [BRIDGE]: body.kind, id, ...body }, origin);
    });
  }

  async registerTool(tool: ModelContextTool, options: RegisterOptions = {}): Promise<void> {
    if (!tool?.name) {
      throw new DOMException("Tool needs a name.", "InvalidStateError");
    }
    if (this.tools.has(tool.name)) {
      // Matches the spec: duplicate names are an InvalidStateError.
      throw new DOMException(`Tool "${tool.name}" is already registered.`, "InvalidStateError");
    }
    const origin = typeof location !== "undefined" ? location.origin : "null";
    this.tools.set(tool.name, { ...tool, origin });

    if (options.signal) {
      if (options.signal.aborted) {
        this.tools.delete(tool.name);
      } else {
        options.signal.addEventListener(
          "abort",
          () => {
            this.tools.delete(tool.name);
            this.dispatchEvent(new Event("toolchange"));
          },
          { once: true }
        );
      }
    }
    this.dispatchEvent(new Event("toolchange"));
  }

  async getTools(options: { fromOrigins?: string[] } = {}): Promise<RegisteredTool[]> {
    const local: RegisteredTool[] = [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      origin: t.origin,
    }));
    const remote: RegisteredTool[] = [];
    for (const origin of options.fromOrigins ?? []) {
      if (!this.frames.has(origin)) continue;
      try {
        const reply = await this.request(origin, { kind: "getTools" });
        for (const t of (reply.tools ?? []) as RegisteredTool[]) {
          remote.push({ ...t, origin });
        }
      } catch {
        /* a frame that is not answering simply has no tools to show */
      }
    }
    return [...local, ...remote];
  }

  async executeTool(
    tool: RegisteredTool,
    args: unknown,
    options: { signal?: AbortSignal } = {}
  ): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted before execution.", "AbortError");
    }
    const here = typeof location !== "undefined" ? location.origin : "null";
    if (tool.origin && tool.origin !== here && this.frames.has(tool.origin)) {
      const reply = await this.request(tool.origin, { kind: "execute", name: tool.name, args });
      return reply.result;
    }
    const found = this.tools.get(tool.name);
    if (!found) {
      throw new DOMException(`No tool named "${tool.name}" is registered.`, "InvalidStateError");
    }
    return await found.execute(args, { signal: options.signal });
  }
}

let shimSingleton: ModelContextShim | null = null;

export function resolveModelContext(): { mc: ModelContextLike; provider: Provider } {
  if (typeof window === "undefined") {
    if (!shimSingleton) shimSingleton = new ModelContextShim();
    return { mc: shimSingleton, provider: "shim" };
  }
  const doc = (document as any).modelContext;
  if (doc && typeof doc.registerTool === "function") {
    return { mc: doc as ModelContextLike, provider: "document" };
  }
  const nav = (navigator as any).modelContext;
  if (nav && typeof nav.registerTool === "function") {
    return { mc: nav as ModelContextLike, provider: "navigator" };
  }
  if (!shimSingleton) shimSingleton = new ModelContextShim();
  return { mc: shimSingleton, provider: "shim" };
}

/* --------------------------------------------------- registration manager */

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute: (args: any, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
}

/**
 * Keeps the set of registered tools in sync with a desired set, registering
 * what appeared and aborting what should no longer exist. Tearing a tool down
 * through its AbortController is what makes a locked clause genuinely absent
 * from the agent's view rather than merely guarded behind a runtime check.
 */
export class ToolRegistry {
  private mc: ModelContextLike;
  readonly provider: Provider;
  private controllers = new Map<string, AbortController>();
  private specs = new Map<string, ToolSpec>();
  private lastChange: { added: string[]; removed: string[] } = { added: [], removed: [] };

  /**
   * `isolated` gives this registry its own model context rather than the
   * page's. The stand-in party uses that: their tools are genuinely not on the
   * surface your agent can see, the same way a second person's browser would
   * hold its own `document.modelContext`.
   */
  constructor(options: { isolated?: boolean } = {}) {
    if (options.isolated) {
      this.mc = new ModelContextShim();
      this.provider = "shim";
    } else {
      const { mc, provider } = resolveModelContext();
      this.mc = mc;
      this.provider = provider;
    }
  }

  get context(): ModelContextLike {
    return this.mc;
  }

  /**
   * Attach an embedded frame on another origin. With native WebMCP the
   * browser already mediates cross-origin discovery, so this is a no-op; with
   * the shim it wires up the postMessage bridge that stands in for it.
   */
  attachFrame(win: Window, origin: string): void {
    if (this.mc instanceof ModelContextShim) this.mc.attachFrame(win, origin);
  }

  detachFrame(origin: string): void {
    if (this.mc instanceof ModelContextShim) this.mc.detachFrame(origin);
  }

  get registered(): string[] {
    return [...this.controllers.keys()];
  }

  get delta() {
    return this.lastChange;
  }

  async sync(
    desired: ToolSpec[],
    options: { exposedTo?: string[] } = {}
  ): Promise<{ added: string[]; removed: string[] }> {
    const wanted = new Map(desired.map((d) => [d.name, d]));
    const added: string[] = [];
    const removed: string[] = [];

    // Tear down anything that no longer belongs on this party's surface.
    for (const name of [...this.controllers.keys()]) {
      if (!wanted.has(name)) {
        this.controllers.get(name)!.abort();
        this.controllers.delete(name);
        this.specs.delete(name);
        removed.push(name);
      }
    }

    // Refresh implementations in place (closures capture state).
    for (const [name, spec] of wanted) {
      if (this.controllers.has(name)) {
        this.specs.set(name, spec);
        continue;
      }
      const controller = new AbortController();
      try {
        await this.mc.registerTool(
          {
            name: spec.name,
            description: spec.description,
            inputSchema: spec.inputSchema,
            annotations: spec.annotations,
            // Route through the live spec so the handler never goes stale.
            execute: async (args: any, options?: { signal?: AbortSignal }) => {
              const current = this.specs.get(name);
              if (!current) {
                throw new Error(`Tool "${name}" is no longer available.`);
              }
              return await current.execute(args, options);
            },
          },
          { signal: controller.signal, ...(options.exposedTo ? { exposedTo: options.exposedTo } : {}) }
        );
        this.controllers.set(name, controller);
        this.specs.set(name, spec);
        added.push(name);
      } catch (err) {
        controller.abort();
        // A duplicate-name InvalidStateError means someone else owns the name;
        // surface it rather than silently swallowing.
        console.warn(`[slate] could not register "${name}":`, err);
      }
    }

    if (added.length || removed.length) this.lastChange = { added, removed };
    return { added, removed };
  }

  async teardown(): Promise<void> {
    for (const c of this.controllers.values()) c.abort();
    this.controllers.clear();
    this.specs.clear();
  }
}

export function providerLabel(p: Provider): string {
  switch (p) {
    case "document":
      return "document.modelContext — native";
    case "navigator":
      return "navigator.modelContext — native, deprecated alias";
    default:
      return "in-page shim — this browser exposes no native WebMCP";
  }
}

/**
 * What the status chip says. The shim is a designed fallback, not a fault: the
 * page behaves identically either way. So the chip is amber, never red, and the
 * detail line says what is missing and how to get the native path — a person on
 * a browser without WebMCP should not be left guessing at a four-letter word.
 */
export type ProviderStatus = {
  /** Chip text. */
  label: string;
  /** Drives the chip's colour. */
  tone: "native" | "fallback";
  /** Tooltip, and the sentence shown beside the chip when running on the shim. */
  detail: string;
};

export function providerStatus(p: Provider): ProviderStatus {
  switch (p) {
    case "document":
      return {
        label: "native",
        tone: "native",
        detail:
          "This browser implements WebMCP itself, so tools register on document.modelContext and its own agent can discover them.",
      };
    case "navigator":
      return {
        label: "native (alias)",
        tone: "native",
        detail:
          "This browser exposes WebMCP on navigator.modelContext, the older alias. It works, but the spec has moved to document.modelContext.",
      };
    default:
      return {
        label: "shim — no browser WebMCP",
        tone: "fallback",
        detail:
          "This browser exposes neither document.modelContext nor navigator.modelContext, so Slate is running its own implementation of the same spec. Everything on this page works exactly the same; what is missing is the browser's built-in agent being able to see the tools. For that, use Chrome with the WebMCP origin trial enabled.",
      };
  }
}
