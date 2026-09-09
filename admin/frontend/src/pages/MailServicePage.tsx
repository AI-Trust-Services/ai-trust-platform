import { useState, useEffect, useCallback } from "react";
import { Mail, Send } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SmtpSettings, SmtpSettingsUpdate } from "@/types";
import { useToast } from "@/App";

export default function MailServicePage() {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [form, setForm] = useState<SmtpSettingsUpdate>({
    smtp_host: "",
    smtp_port: 587,
    smtp_user: "",
    smtp_password: null,
    smtp_from: "",
    smtp_from_name: "",
    smtp_ssl: false,
    smtp_starttls: true,
  });
  const [hasPassword, setHasPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const load = useCallback(async () => {
    try {
      const data: SmtpSettings = await api.getSmtp();
      setForm({
        smtp_host: data.smtp_host ?? "",
        smtp_port: data.smtp_port ?? 587,
        smtp_user: data.smtp_user ?? "",
        smtp_password: null,
        smtp_from: data.smtp_from ?? "",
        smtp_from_name: data.smtp_from_name ?? "",
        smtp_ssl: data.smtp_ssl,
        smtp_starttls: data.smtp_starttls,
      });
      setHasPassword(data.has_password);
    } catch {
      showToast("Failed to load SMTP settings", true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: SmtpSettingsUpdate = {
        ...form,
        smtp_host: form.smtp_host || null,
        smtp_user: form.smtp_user || null,
        smtp_from: form.smtp_from || null,
        smtp_from_name: form.smtp_from_name || null,
      };
      if (!passwordChanged) {
        delete payload.smtp_password;
      }
      await api.updateSmtp(payload);
      setPasswordChanged(false);
      showToast("SMTP settings saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", true);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!testEmail) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testSmtp({ to: testEmail });
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  const canTest = Boolean(form.smtp_host && form.smtp_from && testEmail);

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-8">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white">
          <Mail className="size-7" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">Mail Service (SMTP)</h1>
          <p className="text-sm text-muted-foreground">Configure SMTP settings for system notifications and emails.</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold mb-1">SMTP Configuration</h2>
          <p className="text-sm text-muted-foreground mb-4">Configure your SMTP server to enable email notifications from the platform.</p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="smtp_host">SMTP Host</Label>
              <Input
                id="smtp_host"
                placeholder="smtp.example.com"
                value={form.smtp_host ?? ""}
                onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp_port">SMTP Port</Label>
              <Input
                id="smtp_port"
                type="number"
                placeholder="587"
                value={form.smtp_port ?? ""}
                onChange={(e) => setForm({ ...form, smtp_port: e.target.value ? parseInt(e.target.value) : null })}
              />
              <p className="text-xs text-muted-foreground">Typically 587 for TLS, 465 for SSL</p>
            </div>
          </div>

          <div className="flex items-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <Switch
                id="smtp_ssl"
                checked={form.smtp_ssl}
                onCheckedChange={(v) => setForm({ ...form, smtp_ssl: v })}
              />
              <Label htmlFor="smtp_ssl">Use SSL</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="smtp_starttls"
                checked={form.smtp_starttls}
                onCheckedChange={(v) => setForm({ ...form, smtp_starttls: v })}
              />
              <Label htmlFor="smtp_starttls">Use STARTTLS</Label>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold mb-4">Authentication</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="smtp_user">Username</Label>
              <Input
                id="smtp_user"
                placeholder="your-email@example.com"
                value={form.smtp_user ?? ""}
                onChange={(e) => setForm({ ...form, smtp_user: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp_password">Password</Label>
              <Input
                id="smtp_password"
                type="password"
                placeholder={hasPassword && !passwordChanged ? "••••••••" : ""}
                value={form.smtp_password ?? ""}
                onChange={(e) => {
                  setForm({ ...form, smtp_password: e.target.value });
                  setPasswordChanged(true);
                }}
              />
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold mb-4">Sender Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="smtp_from">From Address</Label>
              <Input
                id="smtp_from"
                type="email"
                placeholder="noreply@example.com"
                value={form.smtp_from ?? ""}
                onChange={(e) => setForm({ ...form, smtp_from: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp_from_name">From Name</Label>
              <Input
                id="smtp_from_name"
                placeholder="AI Trust Platform"
                value={form.smtp_from_name ?? ""}
                onChange={(e) => setForm({ ...form, smtp_from_name: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold mb-4">Test Connection</h3>
          <div className="flex items-center gap-3">
            <Input
              placeholder="admin@local.dev"
              type="email"
              value={testEmail}
              onChange={(e) => { setTestEmail(e.target.value); setTestResult(null); }}
              className="max-w-xs"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!canTest || testing}
              onClick={handleTest}
              className="gap-2"
            >
              <Send className="size-3.5" />
              {testing ? "Sending…" : "Send Test Email"}
            </Button>
          </div>
          {testResult && (
            <p className={cn("mt-2 text-sm", testResult.success ? "text-[var(--success-fg)]" : "text-destructive")}>
              {testResult.message}
            </p>
          )}
          {!canTest && !testResult && (
            <p className="mt-2 text-xs text-muted-foreground">Configure SMTP host and from address to enable testing.</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
