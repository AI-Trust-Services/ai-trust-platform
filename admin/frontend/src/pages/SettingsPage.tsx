import { useState, useEffect, useCallback } from "react";
import { Settings, KeyRound, Eye, EyeOff, Copy } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  GeneralSettings,
  GeneralSettingsUpdate,
  ExternalApiToken,
} from "@/types";
import { useToast } from "@/App";

export default function SettingsPage() {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<GeneralSettingsUpdate>({
    platform_name: "",
    support_email: "",
  });
  const [extToken, setExtToken] = useState<ExternalApiToken | null>(null);
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data: GeneralSettings = await api.getSettings();
      setForm({
        platform_name: data.platform_name,
        support_email: data.support_email ?? "",
      });
    } catch {
      showToast("Failed to load settings", true);
    } finally {
      setLoading(false);
    }
    // The external-API token is a separate, non-fatal concern — a failure here
    // must not block the main settings form.
    try {
      setExtToken(await api.getExternalApiToken());
    } catch {
      setExtToken(null);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function copyToken() {
    if (!extToken?.token) return;
    try {
      await navigator.clipboard.writeText(extToken.token);
      showToast("Token copied to clipboard");
    } catch {
      showToast("Copy failed — reveal and copy manually", true);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateSettings({
        platform_name: form.platform_name || undefined,
        support_email: form.support_email || null,
      });
      showToast("Settings saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-8">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-amber-600 text-white">
          <Settings className="size-7" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">General platform configuration and preferences.</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold mb-1">Platform Settings</h2>
          <p className="text-sm text-muted-foreground mb-4">Configure general platform settings.</p>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="platform_name">Platform Name</Label>
              <Input
                id="platform_name"
                placeholder="AI Trust Platform"
                value={form.platform_name ?? ""}
                onChange={(e) => setForm({ ...form, platform_name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Displayed in the platform header and emails.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="support_email">Support Email</Label>
              <Input
                id="support_email"
                type="email"
                placeholder="support@example.com"
                value={form.support_email ?? ""}
                onChange={(e) => setForm({ ...form, support_email: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Contact email for platform support inquiries.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">External API Access</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Read-only bearer token for an off-platform service to call the external
          API (<code>/api/registry/v1/external/*</code>). Share it with the team
          integrating that service; they send it as{" "}
          <code>Authorization: Bearer &lt;token&gt;</code>. Rotate it by changing{" "}
          <code>EXTERNAL_API_TOKEN</code> in the platform secret and redeploying.
        </p>

        {extToken?.configured && extToken.token ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ext_token">Bearer token</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ext_token"
                  readOnly
                  type={revealed ? "text" : "password"}
                  value={extToken.token}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setRevealed((r) => !r)}
                  aria-label={revealed ? "Hide token" : "Reveal token"}
                >
                  {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyToken}
                  aria-label="Copy token"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Service principal</Label>
              <p className="text-sm font-mono text-muted-foreground">
                {extToken.service_principal}
              </p>
              <p className="text-xs text-muted-foreground">
                The identity the platform uses downstream for this consumer (read-only).
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not configured — set <code>EXTERNAL_API_TOKEN</code> in the platform
            secret to enable the external API.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold mb-4">System Information</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Version</p>
            <p className="font-medium">1.0.0</p>
          </div>
          <div>
            <p className="text-muted-foreground">Environment</p>
            <p className="font-medium">{import.meta.env.PROD ? "Production" : "Development"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
