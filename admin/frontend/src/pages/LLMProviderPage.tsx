import { useState, useEffect, useCallback } from "react";
import { Cpu, Plug, Power, AlertTriangle } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { LLMProvider, LLMProviderHealth, LLMProviderUpdate } from "@/types";
import { useToast } from "@/App";

export default function LLMProviderPage() {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [status, setStatus] = useState<LLMProvider | null>(null);
  const [health, setHealth] = useState<LLMProviderHealth | null>(null);
  const [form, setForm] = useState<LLMProviderUpdate>({ base_url: "", model: "", api_token: null });
  const [hasToken, setHasToken] = useState(false);
  const [tokenChanged, setTokenChanged] = useState(false);

  const apply = useCallback((data: LLMProvider) => {
    setStatus(data);
    setForm({ base_url: data.base_url ?? "", model: data.model ?? "", api_token: null });
    setHasToken(data.has_token);
    setTokenChanged(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.getLLMProvider();
      apply(data);
      // If a provider is active, probe it live (read-only, no audit) so an
      // active-but-broken provider (bad model / unreachable) surfaces on load.
      if (data.is_active) {
        try {
          setHealth(await api.getLLMProviderHealth());
        } catch {
          setHealth(null);
        }
      } else {
        setHealth(null);
      }
    } catch {
      showToast("Failed to load LLM provider config", true);
    } finally {
      setLoading(false);
    }
  }, [apply, showToast]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    setTestResult(null);
    try {
      const payload: LLMProviderUpdate = {
        base_url: form.base_url || null,
        model: form.model || null,
      };
      if (tokenChanged) payload.api_token = form.api_token || null;
      apply(await api.updateLLMProvider(payload));
      showToast("Saved. Run Test Connection, then activate.");
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
      // Test the current form values (no save required). base_url/model are sent
      // as-is; the token is sent only if the user typed a new one — otherwise the
      // backend falls back to the stored token (shown masked). An empty form field
      // falls back to the stored row too.
      const result = await api.testLLMProvider({
        base_url: form.base_url || null,
        model: form.model || null,
        ...(tokenChanged ? { api_token: form.api_token || null } : {}),
      });
      setTestResult(result);
      // Only refresh from the server when the form matches the SAVED config —
      // that's the only case where the backend recorded last_test_status (and
      // the form already equals the row, so nothing is lost). For a scratch test
      // of UNSAVED edits, refreshing would overwrite the typed-in values with the
      // (empty/old) saved row and the user would lose their input — so skip it.
      const isDirty =
        (form.base_url ?? "") !== (status?.base_url ?? "") ||
        (form.model ?? "") !== (status?.model ?? "") ||
        tokenChanged;
      if (!isDirty) {
        apply(await api.getLLMProvider());
      }
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    try {
      apply(await api.activateLLMProvider());
      showToast("Custom LLM provider activated.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Activation failed", true);
    } finally {
      setActivating(false);
    }
  }

  async function handleDeactivate() {
    setActivating(true);
    try {
      apply(await api.deactivateLLMProvider());
      showToast("Restored the platform default LLM.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to restore default", true);
    } finally {
      setActivating(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  const isActive = status?.is_active ?? false;
  const testPassed = status?.last_test_status === "ok";
  // Silent-stub state: no custom provider active AND the platform default isn't
  // a live gateway → AI workflows return placeholder output. Shown until a
  // provider is activated (a passing test alone is not enough — the config must
  // be activated to take effect).
  const stubWarning =
    !isActive && status?.platform_default_live === false;
  // Active-but-broken: a provider is active but the live health probe failed
  // (bad model / unreachable / revoked token since activation).
  const activeBroken = isActive && health?.active === true && health.ok === false;
  const hasConfig = Boolean((form.base_url || status?.base_url) && (form.model || status?.model) && (hasToken || tokenChanged));
  // The form has edits not yet saved — Activate acts on the SAVED config, so
  // activating while dirty would silently ignore these edits. Block it.
  const dirty =
    (form.base_url ?? "") !== (status?.base_url ?? "") ||
    (form.model ?? "") !== (status?.model ?? "") ||
    tokenChanged;

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-8">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-white">
          <Cpu className="size-7" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">LLM Provider</h1>
          <p className="text-sm text-muted-foreground">
            Use your own OpenAI-compatible LLM endpoint for AI-assisted workflows, or keep the platform default.
          </p>
        </div>
      </div>

      {/* Current status banner */}
      {activeBroken ? (
        <div className="rounded-lg border border-[#fca5a5]/60 bg-[#fef2f2] p-4 mb-4 text-sm flex items-start gap-3 text-[#991b1b]">
          <AlertTriangle className="size-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Active provider is not reachable</p>
            <p>
              {health?.message
                ? `The active provider failed a connection check: ${health.message}`
                : "The active provider failed a connection check."}{" "}
              AI workflows will error until this is fixed — update the configuration and
              re-run Test Connection, or restore the platform default.
            </p>
          </div>
        </div>
      ) : stubWarning ? (
        <div className="rounded-lg border border-[#fcd34d]/60 bg-[#fffbeb] p-4 mb-4 text-sm flex items-start gap-3 text-[#92400e]">
          <AlertTriangle className="size-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">No live LLM is configured</p>
            <p>
              No custom provider is active and the platform default is not set up.
              Configure and activate a provider below to enable AI features.
            </p>
          </div>
        </div>
      ) : (
        <div className={cn(
          "rounded-lg border p-4 mb-4 text-sm flex items-center gap-3",
          isActive
            ? "border-[var(--success-fg)]/30 bg-[var(--success-fg)]/5"
            : "border-border bg-muted/40",
        )}>
          <Power className={cn("size-5 shrink-0", isActive ? "text-[var(--success-fg)]" : "text-muted-foreground")} />
          <div>
            <p className="font-medium">
              {isActive ? "Custom provider active" : "Platform default (Thalamus) in use"}
            </p>
            <p className="text-muted-foreground">
              {isActive
                ? `AI workflows use ${status?.base_url} (${status?.model}).`
                : "Configure and activate a custom endpoint below to override the default."}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold mb-1">Endpoint Configuration</h2>
          <p className="text-sm text-muted-foreground mb-4">
            The endpoint must implement the OpenAI <code>/v1/chat/completions</code> API over HTTPS.
          </p>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="base_url">Endpoint URL</Label>
              <Input
                id="base_url"
                placeholder="https://api.your-provider.com/v1"
                value={form.base_url ?? ""}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Model Identifier</Label>
              <Input
                id="model"
                placeholder="your-model-name"
                value={form.model ?? ""}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api_token">API Token</Label>
              <Input
                id="api_token"
                type="password"
                placeholder={hasToken && !tokenChanged ? "••••••••" : ""}
                value={form.api_token ?? ""}
                onChange={(e) => {
                  setForm({ ...form, api_token: e.target.value });
                  setTokenChanged(true);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Sent as <code>Authorization: Bearer</code>. Stored securely and never shown again.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold mb-1">Test Connection</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Verify the endpoint authenticates and serves the model. Activation requires a successful test of the <strong>saved</strong> configuration.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" disabled={testing || !hasConfig} onClick={handleTest} className="gap-2">
              <Plug className="size-3.5" />
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            {status?.last_tested_at && !testResult && (
              <span className={cn("text-xs", testPassed ? "text-[var(--success-fg)]" : "text-destructive")}>
                Last test: {testPassed ? "passed" : "failed"}
                {status.last_test_message ? ` — ${status.last_test_message}` : ""}
              </span>
            )}
          </div>
          {testResult && (
            <p className={cn("mt-2 text-sm", testResult.success ? "text-[var(--success-fg)]" : "text-destructive")}>
              {testResult.message}
              {testResult.success && !isActive && (
                <span className="font-medium">
                  {" "}
                  {dirty
                    ? "Save your changes, then Test the saved configuration to activate."
                    : "Click Activate to start using this provider."}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        {!isActive ? (
          <Button
            variant="default"
            disabled={activating || !testPassed || dirty}
            onClick={handleActivate}
            title={
              dirty
                ? "Save your changes first"
                : !testPassed
                  ? "Run a successful Test Connection first"
                  : undefined
            }
            className="gap-2"
          >
            <Power className="size-4" />
            {activating ? "Activating…" : "Activate"}
          </Button>
        ) : (
          <Button variant="outline" disabled={activating} onClick={handleDeactivate} className="gap-2">
            <Power className="size-4" />
            {activating ? "Restoring…" : "Restore Platform Default"}
          </Button>
        )}
      </div>
    </div>
  );
}
