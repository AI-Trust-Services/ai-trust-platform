import { useState, useEffect, useCallback } from "react";
import { Bot, Eye, EyeOff } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AiProviderSettings, AiProviderUpdate } from "@/types";
import { useToast } from "@/App";

type Provider = "ollama" | "external";

const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Ollama (Local)",
  external: "External (Production)",
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  ollama: "Connect to a local Ollama instance with OpenAI-compatible API.",
  external: "OAuth2 client credentials authentication with Anthropic-format API.",
};

function SecretInput({
  id,
  label,
  value,
  hasExisting,
  changed,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  hasExisting: boolean;
  changed: boolean;
  onChange: (v: string, changed: boolean) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          placeholder={hasExisting && !changed ? "••••••••" : (placeholder ?? "")}
          value={value}
          onChange={(e) => onChange(e.target.value, true)}
          className="pr-10"
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShow((s) => !s)}
          tabIndex={-1}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

export default function AiProvidersPage() {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [settings, setSettings] = useState<AiProviderSettings | null>(null);
  const [activeProvider, setActiveProvider] = useState<Provider>("ollama");

  // Per-provider form state
  const [ollamaForm, setOllamaForm] = useState({
    llm_base_url: "",
    llm_model: "",
    llm_vision_model: "",
    llm_api_key: "",
    apiKeyChanged: false,
  });
  const [externalForm, setExternalForm] = useState({
    ai_client_id: "",
    ai_client_secret: "",
    ai_auth_url: "",
    ai_api_url: "",
    ai_deployment_id: "",
    ai_resource_group: "",
    secretChanged: false,
  });

  const load = useCallback(async () => {
    try {
      const data = await api.getAiProvider();
      setSettings(data);
      const active = (data.active_provider === "ollama" || data.active_provider === "external")
        ? data.active_provider
        : "ollama";
      setActiveProvider(active);
      setOllamaForm({
        llm_base_url: data.ollama.llm_base_url ?? "",
        llm_model: data.ollama.llm_model ?? "",
        llm_vision_model: data.ollama.llm_vision_model ?? "",
        llm_api_key: "",
        apiKeyChanged: false,
      });
      setExternalForm({
        ai_client_id: data.external.ai_client_id ?? "",
        ai_client_secret: "",
        ai_auth_url: data.external.ai_auth_url ?? "",
        ai_api_url: data.external.ai_api_url ?? "",
        ai_deployment_id: data.external.ai_deployment_id ?? "",
        ai_resource_group: data.external.ai_resource_group ?? "",
        secretChanged: false,
      });
    } catch {
      showToast("Failed to load AI provider settings", true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    setTestResult(null);
    try {
      const payload: AiProviderUpdate = { active_provider: activeProvider };
      if (activeProvider === "ollama") {
        const ollama: Record<string, string | null> = {
          llm_base_url: ollamaForm.llm_base_url || null,
          llm_model: ollamaForm.llm_model || null,
          llm_vision_model: ollamaForm.llm_vision_model || null,
        };
        if (ollamaForm.apiKeyChanged) ollama.llm_api_key = ollamaForm.llm_api_key || null;
        payload.ollama = ollama;
      } else {
        const external: Record<string, string | null> = {
          ai_client_id: externalForm.ai_client_id || null,
          ai_auth_url: externalForm.ai_auth_url || null,
          ai_api_url: externalForm.ai_api_url || null,
          ai_deployment_id: externalForm.ai_deployment_id || null,
          ai_resource_group: externalForm.ai_resource_group || null,
        };
        if (externalForm.secretChanged) external.ai_client_secret = externalForm.ai_client_secret || null;
        payload.external = external;
      }
      const updated = await api.updateAiProvider(payload);
      setSettings(updated);
      setOllamaForm((f) => ({ ...f, apiKeyChanged: false }));
      setExternalForm((f) => ({ ...f, secretChanged: false }));
      showToast("AI provider settings saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", true);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testAiProvider();
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-8">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 text-white">
          <Bot className="size-7" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">AI Providers</h1>
          <p className="text-sm text-muted-foreground">Configure and manage connections to AI providers used across the platform.</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold mb-1">Provider Configuration</h2>
          <p className="text-sm text-muted-foreground mb-4">Select your AI provider and configure the connection settings.</p>

          <div className="space-y-1.5 mb-2">
            <Label htmlFor="ai_provider">AI Provider</Label>
            <select
              id="ai_provider"
              value={activeProvider}
              onChange={(e) => {
                setActiveProvider(e.target.value as Provider);
                setTestResult(null);
              }}
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="ollama">{PROVIDER_LABELS.ollama}</option>
              <option value="external">{PROVIDER_LABELS.external}</option>
            </select>
          </div>
          <p className="text-sm text-muted-foreground mb-6">{PROVIDER_DESCRIPTIONS[activeProvider]}</p>

          <div className="border-t border-border pt-6">
            {activeProvider === "ollama" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="llm_base_url">Base URL</Label>
                  <Input
                    id="llm_base_url"
                    placeholder="http://ollama:11434/v1"
                    value={ollamaForm.llm_base_url}
                    onChange={(e) => setOllamaForm({ ...ollamaForm, llm_base_url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">OpenAI-compatible endpoint URL for Ollama</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="llm_model">Model</Label>
                    <Input
                      id="llm_model"
                      placeholder="llama3.2"
                      value={ollamaForm.llm_model}
                      onChange={(e) => setOllamaForm({ ...ollamaForm, llm_model: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="llm_vision_model">Vision Model</Label>
                    <Input
                      id="llm_vision_model"
                      placeholder="llama3.2-vision"
                      value={ollamaForm.llm_vision_model}
                      onChange={(e) => setOllamaForm({ ...ollamaForm, llm_vision_model: e.target.value })}
                    />
                  </div>
                </div>
                <SecretInput
                  id="llm_api_key"
                  label="API Key (optional)"
                  value={ollamaForm.llm_api_key}
                  hasExisting={settings?.has_ollama_api_key ?? false}
                  changed={ollamaForm.apiKeyChanged}
                  onChange={(v, changed) => setOllamaForm({ ...ollamaForm, llm_api_key: v, apiKeyChanged: changed })}
                  placeholder="ollama"
                />
              </div>
            )}

            {activeProvider === "external" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ai_client_id">OAuth Client ID</Label>
                    <Input
                      id="ai_client_id"
                      placeholder="sb-xxxxxxxx-..."
                      value={externalForm.ai_client_id}
                      onChange={(e) => setExternalForm({ ...externalForm, ai_client_id: e.target.value })}
                    />
                  </div>
                  <SecretInput
                    id="ai_client_secret"
                    label="OAuth Client Secret"
                    value={externalForm.ai_client_secret}
                    hasExisting={settings?.has_external_client_secret ?? false}
                    changed={externalForm.secretChanged}
                    onChange={(v, changed) => setExternalForm({ ...externalForm, ai_client_secret: v, secretChanged: changed })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai_auth_url">OAuth Auth URL</Label>
                  <Input
                    id="ai_auth_url"
                    placeholder="https://...authentication.sap.hana.ondemand.com/oauth/token"
                    value={externalForm.ai_auth_url}
                    onChange={(e) => setExternalForm({ ...externalForm, ai_auth_url: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai_api_url">API URL</Label>
                  <Input
                    id="ai_api_url"
                    placeholder="https://api.ai.internalprod.eu-central-1.aws.ml.hana.ondemand.com"
                    value={externalForm.ai_api_url}
                    onChange={(e) => setExternalForm({ ...externalForm, ai_api_url: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ai_deployment_id">Deployment ID</Label>
                    <Input
                      id="ai_deployment_id"
                      placeholder="dce520df6e9d17dd"
                      value={externalForm.ai_deployment_id}
                      onChange={(e) => setExternalForm({ ...externalForm, ai_deployment_id: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai_resource_group">Resource Group</Label>
                    <Input
                      id="ai_resource_group"
                      placeholder="default"
                      value={externalForm.ai_resource_group}
                      onChange={(e) => setExternalForm({ ...externalForm, ai_resource_group: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testing} className="gap-2">
          {testing ? "Testing…" : "Test Connection"}
        </Button>
      </div>
      {testResult && (
        <p className={cn("mt-3 text-sm", testResult.success ? "text-[var(--success-fg)]" : "text-destructive")}>
          {testResult.message}
        </p>
      )}
    </div>
  );
}
