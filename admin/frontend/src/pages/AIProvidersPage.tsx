import { useState, useEffect } from "react";
import {
  Bot,
  Save,
  TestTube2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { api, SettingsGroup, SettingResponse, TestResponse } from "../api/client";
import { useToast } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// Map setting key to short name
function getShortKey(key: string): string {
  return key.split(".").pop() || key;
}

// Provider descriptions
const PROVIDER_INFO: Record<string, { label: string; description: string }> = {
  stub: {
    label: "Test Mode (Stub)",
    description: "Returns deterministic canned responses. Use for development and testing.",
  },
  ollama: {
    label: "Ollama (Local)",
    description: "Connect to a local Ollama instance with OpenAI-compatible API.",
  },
  external: {
    label: "External (Production)",
    description: "OAuth2 client credentials authentication with Anthropic-format API.",
  },
};

export default function AIProvidersPage() {
  const [settings, setSettings] = useState<Record<string, SettingResponse>>({});
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const showToast = useToast();

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const groups = await api.settings.list();
        const aiGroup = groups.find((g) => g.category === "ai");
        if (aiGroup) {
          const settingsMap: Record<string, SettingResponse> = {};
          const values: Record<string, unknown> = {};
          aiGroup.settings.forEach((s) => {
            const shortKey = getShortKey(s.key);
            settingsMap[shortKey] = s;
            values[shortKey] = s.value;
          });
          setSettings(settingsMap);
          setFormValues(values);
        }
      } catch (err) {
        showToast("Failed to load AI settings", true);
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
      // Build settings object with full keys
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
        showToast("AI provider settings saved successfully");
        // Reload to get updated timestamps
        const groups = await api.settings.list();
        const aiGroup = groups.find((g) => g.category === "ai");
        if (aiGroup) {
          const settingsMap: Record<string, SettingResponse> = {};
          aiGroup.settings.forEach((s) => {
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

  // Test connection
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.settings.testLlm();
      setTestResult(result);
      if (result.success) {
        showToast("Connection test successful");
      } else {
        showToast(result.message, true);
      }
    } catch (err) {
      showToast("Connection test failed", true);
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

  const provider = (formValues.provider as string) || "stub";
  const providerInfo = PROVIDER_INFO[provider] || PROVIDER_INFO.stub;

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex size-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
          <Bot className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Providers</h1>
          <p className="text-muted-foreground">
            Configure and manage connections to AI providers used across the platform.
          </p>
        </div>
      </div>

      {/* Main settings card */}
      <Card>
        <CardHeader>
          <CardTitle>Provider Configuration</CardTitle>
          <CardDescription>
            Select your AI provider and configure the connection settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Provider selector */}
          <div className="space-y-2">
            <Label htmlFor="provider">AI Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => handleChange("provider", value)}
            >
              <SelectTrigger id="provider" className="w-full max-w-xs">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stub">Test Mode (Stub)</SelectItem>
                <SelectItem value="ollama">Ollama (Local)</SelectItem>
                <SelectItem value="external">External (Production)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{providerInfo.description}</p>
          </div>

          <Separator />

          {/* Provider-specific settings */}
          {provider === "stub" && (
            <div className="rounded-lg bg-muted p-4">
              <p className="text-sm text-muted-foreground">
                <strong>Test Mode</strong> returns deterministic responses without calling any
                external AI service. No additional configuration required.
              </p>
            </div>
          )}

          {provider === "ollama" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="base_url">Base URL</Label>
                <Input
                  id="base_url"
                  value={(formValues.base_url as string) || ""}
                  onChange={(e) => handleChange("base_url", e.target.value)}
                  placeholder="http://ollama:11434/v1"
                />
                <p className="text-xs text-muted-foreground">
                  OpenAI-compatible endpoint URL for Ollama
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    value={(formValues.model as string) || ""}
                    onChange={(e) => handleChange("model", e.target.value)}
                    placeholder="llama3.2"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vision_model">Vision Model</Label>
                  <Input
                    id="vision_model"
                    value={(formValues.vision_model as string) || ""}
                    onChange={(e) => handleChange("vision_model", e.target.value)}
                    placeholder="llama3.2-vision"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="api_key">API Key (optional)</Label>
                <div className="relative">
                  <Input
                    id="api_key"
                    type={showSecrets.api_key ? "text" : "password"}
                    value={(formValues.api_key as string) || ""}
                    onChange={(e) => handleChange("api_key", e.target.value)}
                    placeholder="ollama"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowSecrets((s) => ({ ...s, api_key: !s.api_key }))}
                  >
                    {showSecrets.api_key ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {provider === "external" && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="client_id">OAuth Client ID</Label>
                  <Input
                    id="client_id"
                    value={(formValues.client_id as string) || ""}
                    onChange={(e) => handleChange("client_id", e.target.value)}
                    placeholder="Enter client ID"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client_secret">OAuth Client Secret</Label>
                  <div className="relative">
                    <Input
                      id="client_secret"
                      type={showSecrets.client_secret ? "text" : "password"}
                      value={(formValues.client_secret as string) || ""}
                      onChange={(e) => handleChange("client_secret", e.target.value)}
                      placeholder="Enter client secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowSecrets((s) => ({ ...s, client_secret: !s.client_secret }))}
                    >
                      {showSecrets.client_secret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="auth_url">OAuth Auth URL</Label>
                <Input
                  id="auth_url"
                  value={(formValues.auth_url as string) || ""}
                  onChange={(e) => handleChange("auth_url", e.target.value)}
                  placeholder="https://auth.example.com/oauth/token"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="api_url">API URL</Label>
                <Input
                  id="api_url"
                  value={(formValues.api_url as string) || ""}
                  onChange={(e) => handleChange("api_url", e.target.value)}
                  placeholder="https://api.example.com"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="deployment_id">Deployment ID</Label>
                  <Input
                    id="deployment_id"
                    value={(formValues.deployment_id as string) || ""}
                    onChange={(e) => handleChange("deployment_id", e.target.value)}
                    placeholder="Enter deployment ID"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resource_group">Resource Group</Label>
                  <Input
                    id="resource_group"
                    value={(formValues.resource_group as string) || ""}
                    onChange={(e) => handleChange("resource_group", e.target.value)}
                    placeholder="Enter resource group"
                  />
                </div>
              </div>
            </div>
          )}

          <Separator />

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

          {/* Actions */}
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
              Save Changes
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <TestTube2 className="size-4 mr-2" />}
              Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
