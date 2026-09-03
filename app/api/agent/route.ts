import { NextRequest, NextResponse } from "next/server";
import { complete, DEFAULT_MODELS, detectProvider, type Message, type Provider, type ToolDef } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * The stand-in's brain, when one is available.
 *
 * The page discovers its tools through `getTools()` on the stand-in's own
 * model context and sends that list here verbatim. This route adds nothing to
 * it: the model sees exactly the capabilities the agreement grants that party
 * right now, and nothing else.
 *
 * Keys. The deployment may carry ANTHROPIC_API_KEY, OPENAI_API_KEY or
 * GEMINI_API_KEY; the first one present is the default brain. Otherwise a
 * person brings their own in the x-model-key header (with x-model-provider
 * and, optionally, x-model-name). A brought key is used for this one call and
 * passed straight to its provider; it is never stored, logged, or echoed.
 * Without any key the page uses the rules brain, which needs none.
 */

const SERVER: Array<{ provider: Provider; key: string | undefined }> = [
  { provider: "anthropic", key: process.env.ANTHROPIC_API_KEY },
  { provider: "openai", key: process.env.OPENAI_API_KEY },
  { provider: "gemini", key: process.env.GEMINI_API_KEY },
];
const serverDefault = SERVER.find((s) => s.key);

export async function GET() {
  return NextResponse.json({
    serverKey: Boolean(serverDefault),
    provider: serverDefault?.provider ?? null,
    model: serverDefault ? DEFAULT_MODELS[serverDefault.provider] : null,
    models: DEFAULT_MODELS,
  });
}

interface Body {
  system: string;
  messages: Message[];
  tools: ToolDef[];
}

export async function POST(req: NextRequest) {
  const ownKey = req.headers.get("x-model-key")?.trim() || "";
  const ownProvider = (req.headers.get("x-model-provider")?.trim() || (ownKey ? detectProvider(ownKey) : null)) as Provider | null;
  const ownModel = req.headers.get("x-model-name")?.trim() || undefined;

  let provider: Provider;
  let key: string;
  let model: string | undefined;
  if (ownKey && ownProvider && ["anthropic", "openai", "gemini"].includes(ownProvider)) {
    provider = ownProvider;
    key = ownKey;
    model = ownModel;
  } else if (serverDefault?.key) {
    provider = serverDefault.provider;
    key = serverDefault.key;
  } else {
    return NextResponse.json(
      { ok: false, message: "No API key: add yours in the demo panel, or keep the rules brain." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request body." }, { status: 400 });
  }

  try {
    const reply = await complete(provider, key, model, body.system, body.messages ?? [], body.tools ?? []);
    return NextResponse.json({ ok: true, provider, ...reply });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "Model call failed." }, { status: 502 });
  }
}
