/** Client-side shape of a brought key. Kept in memory unless the person asks otherwise. */
export type Provider = "anthropic" | "openai" | "gemini";

export interface OwnKey {
  key: string;
  provider: Provider;
  /** Optional model override; blank means the server default for that provider. */
  model?: string;
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
};

export function detectProvider(key: string): Provider | null {
  const k = key.trim();
  if (/^sk-ant-/.test(k)) return "anthropic";
  if (/^AIza/.test(k)) return "gemini";
  if (/^sk-/.test(k)) return "openai";
  return null;
}

const STORAGE = "slate-model-key";

export function loadOwnKey(): OwnKey | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as OwnKey) : null;
  } catch {
    return null;
  }
}

export function saveOwnKey(k: OwnKey | null): void {
  if (k) localStorage.setItem(STORAGE, JSON.stringify(k));
  else localStorage.removeItem(STORAGE);
}
