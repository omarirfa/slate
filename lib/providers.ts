/**
 * One tool-calling format, three providers.
 *
 * The agents speak the shape used by lib/agent.ts: a system string, a list of
 * messages whose content is text / tool_use / tool_result blocks, and a list
 * of tools with JSON-schema input. This module turns that into a request for
 * Anthropic, OpenAI or Gemini and turns each reply back into the same blocks,
 * so the client never has to know which brain it got.
 */

export type Provider = "anthropic" | "openai" | "gemini";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}

export interface Reply {
  content: Block[];
  stop_reason: string;
  model: string;
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  openai: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  gemini: process.env.GEMINI_MODEL || "gemini-2.5-flash",
};

/** Guess the provider from the key's shape. */
export function detectProvider(key: string): Provider | null {
  const k = key.trim();
  if (/^sk-ant-/.test(k)) return "anthropic";
  if (/^AIza/.test(k)) return "gemini";
  if (/^sk-/.test(k)) return "openai";
  return null;
}

function blocks(m: Message): Block[] {
  return typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
}

function schemaOf(t: ToolDef): Record<string, unknown> {
  return t.inputSchema ?? { type: "object", properties: {} };
}

/* ------------------------------------------------------------ anthropic */

async function callAnthropic(key: string, model: string, system: string, messages: Message[], tools: ToolDef[]): Promise<Reply> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system,
      messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t) })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Anthropic call failed (${res.status}).`);
  return { content: data.content ?? [], stop_reason: data.stop_reason ?? "end_turn", model: data.model ?? model };
}

/* --------------------------------------------------------------- openai */

async function callOpenAI(key: string, model: string, system: string, messages: Message[], tools: ToolDef[]): Promise<Reply> {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    const bs = blocks(m);
    if (m.role === "assistant") {
      const text = bs.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      const calls = bs.filter((b) => b.type === "tool_use") as Array<{ id: string; name: string; input: unknown }>;
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }
          : {}),
      });
    } else {
      const results = bs.filter((b) => b.type === "tool_result") as Array<{ tool_use_id: string; content: string }>;
      for (const r of results) out.push({ role: "tool", tool_call_id: r.tool_use_id, content: r.content });
      const text = bs.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      if (text) out.push({ role: "user", content: text });
    }
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      messages: out,
      ...(tools.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: schemaOf(t) } })) }
        : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI call failed (${res.status}).`);
  const msg = data.choices?.[0]?.message ?? {};
  const content: Block[] = [];
  if (msg.content) content.push({ type: "text", text: String(msg.content) });
  for (const c of msg.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = JSON.parse(c.function?.arguments || "{}");
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: c.id, name: c.function?.name, input });
  }
  const finish = data.choices?.[0]?.finish_reason;
  return { content, stop_reason: finish === "tool_calls" ? "tool_use" : "end_turn", model: data.model ?? model };
}

/* --------------------------------------------------------------- gemini */

async function callGemini(key: string, model: string, system: string, messages: Message[], tools: ToolDef[]): Promise<Reply> {
  // Gemini matches function responses to calls by name, so remember names by id.
  const nameById = new Map<string, string>();
  const contents: unknown[] = [];
  for (const m of messages) {
    const parts: unknown[] = [];
    for (const b of blocks(m)) {
      if (b.type === "text" && b.text) parts.push({ text: b.text });
      else if (b.type === "tool_use") {
        nameById.set(b.id, b.name);
        parts.push({ functionCall: { name: b.name, args: (b.input as Record<string, unknown>) ?? {} } });
      } else if (b.type === "tool_result") {
        parts.push({
          functionResponse: {
            name: nameById.get(b.tool_use_id) ?? "tool",
            response: b.is_error ? { error: b.content } : { result: b.content },
          },
        });
      }
    }
    if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      ...(tools.length
        ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: stripSchema(schemaOf(t)) })) }] }
        : {}),
      generationConfig: { maxOutputTokens: 600 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Gemini call failed (${res.status}).`);
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const content: Block[] = [];
  let n = 0;
  for (const p of parts) {
    if (p.text) content.push({ type: "text", text: String(p.text) });
    if (p.functionCall) content.push({ type: "tool_use", id: `g${Date.now().toString(36)}_${n++}`, name: p.functionCall.name, input: p.functionCall.args ?? {} });
  }
  return { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", model };
}

/** Gemini rejects a few JSON-schema keywords; drop the ones our tools use. */
function stripSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    delete o.additionalProperties;
    delete o.$schema;
    for (const v of Object.values(o)) walk(v);
  };
  walk(clone);
  return clone;
}

/* ---------------------------------------------------------------- entry */

export async function complete(
  provider: Provider,
  key: string,
  model: string | undefined,
  system: string,
  messages: Message[],
  tools: ToolDef[]
): Promise<Reply> {
  const m = model?.trim() || DEFAULT_MODELS[provider];
  switch (provider) {
    case "anthropic":
      return callAnthropic(key, m, system, messages, tools);
    case "openai":
      return callOpenAI(key, m, system, messages, tools);
    case "gemini":
      return callGemini(key, m, system, messages, tools);
  }
}
