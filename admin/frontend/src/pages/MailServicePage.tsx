import { useState, useEffect } from "react";
import {
  Mail,
  Save,
  Send,
  Loader2,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { api, SettingResponse, TestResponse } from "../api/client";
import { useToast } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// Map setting key to short name
function getShortKey(key: string): string {
  return key.split(".").pop() || key;
}

export default function MailServicePage() {
  const [settings, setSettings] = useState<Record<string, SettingResponse>>({});
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const showToast = useToast();

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const groups = await api.settings.list();
        const mailGroup = groups.find((g) => g.category === "mail");
        if (mailGroup) {
          const settingsMap: Record<string, SettingResponse> = {};
          const values: Record<string, unknown> = {};
          mailGroup.settings.forEach((s) => {
            const shortKey = getShortKey(s.key);
            settingsMap[shortKey] = s;
            values[shortKey] = s.value;
          });
          setSettings(settingsMap);
          setFormValues(values);
        }

        // Get current user email for test
        try {
          const me = await api.me.get();
          if (me.email) {
            setTestEmail(me.email);
          }
        } catch {
          // Ignore - user might not have email
        }
      } catch (err) {
        showToast("Failed to load mail settings", true);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  // Handle form change
  const handleChange = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      for (const [shortKey, value] of Object.entries(formValues)) {
        const setting = settings[shortKey];
        if (setting) {
          // Only update if value changed and is not the secret mask
          if (value !== "••••••••" && value !== setting.value) {
            updates[setting.key] = value;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await api.settings.bulkUpdate(updates);
        showToast("Mail service settings saved successfully");
        // Reload to get updated timestamps
        const groups = await api.settings.list();
        const mailGroup = groups.find((g) => g.category === "mail");
        if (mailGroup) {
          const settingsMap: Record<string, SettingResponse> = {};
          mailGroup.settings.forEach((s) => {
            settingsMap[getShortKey(s.key)] = s;
          });
          setSettings(settingsMap);
        }
      } else {
        showToast("No changes to save");
      }
    } catch (err) {
      showToast("Failed to save settings", true);
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Test SMTP connection
  const handleTest = async () => {
    if (!testEmail) {
      showToast("Please enter an email address to send test to", true);
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.settings.testSmtp(testEmail);
      setTestResult(result);
      if (result.success) {
        showToast("Test email sent successfully");
      } else {
        showToast(result.message, true);
      }
    } catch (err) {
      showToast("SMTP test failed", true);
      console.error(err);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const isConfigured = formValues.host && formValues.from;

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex size-12 items-center justify-center rounded-xl bg-green-100 text-green-600">
          <Mail className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Mail Service (SMTP)</h1>
          <p className="text-muted-foreground">
            Configure SMTP settings for system notifications and emails.
          </p>
        </div>
      </div>

      {/* Main settings card */}
      <Card>
        <CardHeader>
          <CardTitle>SMTP Configuration</CardTitle>
          <CardDescription>
            Configure your SMTP server to enable email notifications from the platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Server settings */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="host">SMTP Host</Label>
              <Input
                id="host"
                value={(formValues.host as string) || ""}
                onChange={(e) => handleChange("host", e.target.value)}
                placeholder="smtp.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">SMTP Port</Label>
              <Input
                id="port"
                type="number"
                value={formValues.port ?? ""}
                onChange={(e) => handleChange("port", parseInt(e.target.value) || "")}
                placeholder="587"
              />
              <p className="text-xs text-muted-foreground">
                Typically 587 for TLS, 465 for SSL
              </p>
            </div>
          </div>

          {/* Security settings */}
          <div className="flex gap-6">
            <div className="flex items-center space-x-2">
              <Switch
                id="ssl"
                checked={formValues.ssl as boolean || false}
                onCheckedChange={(checked) => handleChange("ssl", checked)}
              />
              <Label htmlFor="ssl">Use SSL</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="starttls"
                checked={formValues.starttls as boolean ?? true}
                onCheckedChange={(checked) => handleChange("starttls", checked)}
              />
              <Label htmlFor="starttls">Use STARTTLS</Label>
            </div>
          </div>

          <Separator />

          {/* Authentication */}
          <div className="space-y-4">
            <h4 className="font-medium">Authentication</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="user">Username</Label>
                <Input
                  id="user"
                  value={(formValues.user as string) || ""}
                  onChange={(e) => handleChange("user", e.target.value)}
                  placeholder="your-email@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={(formValues.password as string) || ""}
                    onChange={(e) => handleChange("password", e.target.value)}
                    placeholder="••••••••"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Sender settings */}
          <div className="space-y-4">
            <h4 className="font-medium">Sender Information</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="from">From Address</Label>
                <Input
                  id="from"
                  type="email"
                  value={(formValues.from as string) || ""}
                  onChange={(e) => handleChange("from", e.target.value)}
                  placeholder="noreply@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="from_name">From Name</Label>
                <Input
                  id="from_name"
                  value={(formValues.from_name as string) || ""}
                  onChange={(e) => handleChange("from_name", e.target.value)}
                  placeholder="AI Trust Platform"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Test section */}
          <div className="space-y-4">
            <h4 className="font-medium">Test Connection</h4>
            <div className="flex gap-3">
              <Input
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="recipient@example.com"
                className="max-w-xs"
              />
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing || !isConfigured}
              >
                {testing ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Send className="size-4 mr-2" />
                )}
                Send Test Email
              </Button>
            </div>
            {!isConfigured && (
              <p className="text-sm text-muted-foreground">
                Configure SMTP host and from address to enable testing.
              </p>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg p-4",
                testResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              )}
            >
              {testResult.success ? (
                <CheckCircle className="size-5" />
              ) : (
                <AlertCircle className="size-5" />
              )}
              <div className="flex-1">
                <div className="font-medium">{testResult.success ? "Success" : "Failed"}</div>
                <div className="text-sm">{testResult.message}</div>
              </div>
            </div>
          )}

          <Separator />

          {/* Save button */}
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
