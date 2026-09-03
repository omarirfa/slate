/**
 * WebMCP for the bank page.
 *
 * Prefers the browser's own `document.modelContext` (or the deprecated
 * `navigator.modelContext` alias). When neither exists, this shim implements
 * the same shape and additionally answers the embedding page over postMessage,
 * so `getTools({ fromOrigins })` / `executeTool()` in the parent behave the way
 * the browser would make them behave across origins: a tool is discoverable
 * only by an origin named in its `exposedTo`, and it runs here, in the bank's
 * own execution context.
 */
(function () {
  const BRIDGE = "webmcp-bridge";
  const win = window;
  const ORIGIN = location.origin;

  class ModelContextShim extends EventTarget {
    constructor() {
      super();
      this.tools = new Map(); // name -> { tool, exposedTo:Set }
      win.addEventListener("message", (event) => this.onMessage(event));
    }

    async registerTool(tool, options = {}) {
      if (!tool || !tool.name) throw new DOMException("Tool needs a name.", "InvalidStateError");
      if (this.tools.has(tool.name)) {
        throw new DOMException(`Tool "${tool.name}" is already registered.`, "InvalidStateError");
      }
      const exposedTo = new Set(options.exposedTo || []);
      for (const o of exposedTo) {
        if (!/^https:\/\//.test(o) && !/^http:\/\/localhost(:\d+)?$/.test(o) && !/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(o)) {
          throw new DOMException(`exposedTo origin "${o}" is not trustworthy.`, "SecurityError");
        }
      }
      this.tools.set(tool.name, { tool, exposedTo });
      if (options.signal) {
        const remove = () => {
          this.tools.delete(tool.name);
          this.changed();
        };
        if (options.signal.aborted) remove();
        else options.signal.addEventListener("abort", remove, { once: true });
      }
      this.changed();
    }

    async getTools() {
      return [...this.tools.values()].map(({ tool }) => this.describe(tool));
    }

    async executeTool(tool, args, options = {}) {
      const found = this.tools.get(tool && tool.name);
      if (!found) throw new DOMException(`No tool named "${tool && tool.name}" is registered.`, "InvalidStateError");
      if (options.signal && options.signal.aborted) throw new DOMException("Aborted.", "AbortError");
      return await found.tool.execute(args, { signal: options.signal });
    }

    describe(tool) {
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        origin: ORIGIN,
      };
    }

    changed() {
      this.dispatchEvent(new Event("toolchange"));
      // Tell every origin that may see any of our tools that the surface moved.
      if (!win.parent || win.parent === win) return;
      const origins = new Set();
      for (const { exposedTo } of this.tools.values()) for (const o of exposedTo) origins.add(o);
      for (const o of origins) win.parent.postMessage({ [BRIDGE]: "toolchange" }, o);
    }

    /* ------------------------------------------- answering the embedder */

    async onMessage(event) {
      const msg = event.data;
      if (!msg || typeof msg !== "object" || !msg[BRIDGE]) return;
      const reply = (body) => event.source && event.source.postMessage({ [BRIDGE]: "reply", id: msg.id, ...body }, event.origin);

      if (msg[BRIDGE] === "getTools") {
        // Only tools that name the caller's origin in exposedTo are visible to it.
        const visible = [...this.tools.values()]
          .filter(({ exposedTo }) => exposedTo.has(event.origin))
          .map(({ tool }) => this.describe(tool));
        return reply({ ok: true, tools: visible });
      }

      if (msg[BRIDGE] === "execute") {
        const found = this.tools.get(msg.name);
        if (!found || !found.exposedTo.has(event.origin)) {
          return reply({ ok: false, error: `No tool named "${msg.name}" is exposed to ${event.origin}.` });
        }
        try {
          const result = await found.tool.execute(msg.args || {}, {});
          return reply({ ok: true, result });
        } catch (err) {
          return reply({ ok: false, error: err && err.message ? err.message : String(err) });
        }
      }
    }
  }

  function resolve() {
    const doc = document.modelContext;
    if (doc && typeof doc.registerTool === "function") return { mc: doc, provider: "document" };
    const nav = navigator.modelContext;
    if (nav && typeof nav.registerTool === "function") return { mc: nav, provider: "navigator" };
    return { mc: new ModelContextShim(), provider: "shim" };
  }

  win.BankWebMCP = { resolve };
})();
