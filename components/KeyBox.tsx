"use client";

import { useState } from "react";
import { detectProvider, PROVIDER_LABEL, type OwnKey, type Provider } from "@/lib/keys";

interface Props {
  serverKey: boolean;
  serverProvider: string | null;
  serverModel: string | null;
  defaults: Record<string, string> | null;
  own: OwnKey | null;
  remembered: boolean;
  onChange: (key: OwnKey | null, remember: boolean) => void;
}

/**
 * Bring your own key — Anthropic, OpenAI or Gemini. It lives in this tab's
 * memory and is sent with each model call to this app's server, which hands
 * it to the provider and keeps nothing. Ticking "remember" keeps it in this
 * browser's storage, and only then; the default is to forget it with the tab.
 */
export default function KeyBox({ serverKey, serverProvider, serverModel, defaults, own, remembered, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState<Provider | "">("");
  const [model, setModel] = useState("");
  const [remember, setRemember] = useState(remembered);

  const detected = detectProvider(draft);
  const chosen: Provider | null = (provider || detected) as Provider | null;
  const canUse = draft.trim().length > 12 && Boolean(chosen);

  return (
    <section className="panel" aria-labelledby="key-title">
      <div className="panel__head">
        <h2 className="panel__title" id="key-title">
          {own ? "Your key" : serverKey ? "Model" : "Bring a key"}
        </h2>
      </div>

      {own ? (
        <div className="standin">
          <p className="standin__note">
            Using your {PROVIDER_LABEL[own.provider]} key
            {own.model ? (
              <>
                {" "}
                for <span className="mono">{own.model}</span>
              </>
            ) : defaults?.[own.provider] ? (
              <>
                {" "}
                for <span className="mono">{defaults[own.provider]}</span>
              </>
            ) : null}
            . {remembered ? "Remembered on this device." : "Kept in memory for this tab only."}
          </p>
          <div className="standin__row">
            <button type="button" className="btn btn--sm" onClick={() => onChange(null, false)}>
              Forget it
            </button>
          </div>
        </div>
      ) : (
        <div className="standin">
          <p className="standin__note">
            {serverKey ? (
              <>
                This deployment has its own {serverProvider ? PROVIDER_LABEL[serverProvider as Provider] : ""} key
                {serverModel ? (
                  <>
                    {" "}
                    (<span className="mono">{serverModel}</span>)
                  </>
                ) : null}
                , so nobody needs one. You can still use yours instead.
              </>
            ) : (
              <>Optional. Rules drive the stand-in and the negotiators without one. Add an Anthropic, OpenAI or Gemini key and a model can drive them instead.</>
            )}
          </p>
          <div className="standin__row">
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…  sk-…  AIza…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="API key"
              style={{ maxWidth: "20rem" }}
            />
            <select
              className="select"
              style={{ width: "auto", minHeight: 34, fontSize: "var(--text-xs)" }}
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider | "")}
              aria-label="Provider"
            >
              <option value="">{detected ? `${PROVIDER_LABEL[detected]} (detected)` : "Provider…"}</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </div>
          <div className="standin__row">
            <input
              className="input"
              placeholder={chosen && defaults?.[chosen] ? `Model (default ${defaults[chosen]})` : "Model (optional)"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model name, optional"
              style={{ maxWidth: "20rem" }}
            />
            <button
              type="button"
              className="btn btn--sm btn--primary"
              disabled={!canUse}
              onClick={() => {
                if (!chosen) return;
                onChange({ key: draft.trim(), provider: chosen, model: model.trim() || undefined }, remember);
                setDraft("");
                setModel("");
                setProvider("");
              }}
            >
              Use it
            </button>
          </div>
          <label className="switch" style={{ fontSize: "var(--text-xs)" }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span className="switch__track" aria-hidden="true" />
            <span>Remember on this device</span>
          </label>
          <p className="standin__note">
            Sent with each model call to this app&rsquo;s server, which passes it straight to the provider and does
            not store or log it. Unless you tick remember, it is gone when this tab closes.
          </p>
        </div>
      )}
    </section>
  );
}
