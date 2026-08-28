import { useState, useEffect } from "react";
import {
  Settings,
  Save,
  Loader2,
} from "lucide-react";
import { api, SettingResponse } from "../api/client";
import { useToast } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

// Map setting key to short name
function getShortKey(key: string): string {
  return key.split(".").pop() || key;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, SettingResponse>>({});
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const groups = await api.settings.list();
        const generalGroup = groups.find((g) => g.category === "general");
        if (generalGroup) {
          const settingsMap: Record<string, SettingResponse> = {};
          const values: Record<string, unknown> = {};
          generalGroup.settings.forEach((s) => {
            const shortKey = getShortKey(s.key);
            settingsMap[shortKey] = s;
            values[shortKey] = s.value;
          });
          setSettings(settingsMap);
          setFormValues(values);
        }
      } catch (err) {
        showToast("Failed to load settings", true);
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
  };

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      for (const [shortKey, value] of Object.entries(formValues)) {
        const setting = settings[shortKey];
        if (setting && value !== setting.value) {
          updates[setting.key] = value;
        }
      }

      if (Object.keys(updates).length > 0) {
        await api.settings.bulkUpdate(updates);
        showToast("Settings saved successfully");
        // Reload to get updated timestamps
        const groups = await api.settings.list();
        const generalGroup = groups.find((g) => g.category === "general");
        if (generalGroup) {
          const settingsMap: Record<string, SettingResponse> = {};
          generalGroup.settings.forEach((s) => {
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

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex size-12 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
          <Settings className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            General platform configuration and preferences.
          </p>
        </div>
      </div>

      {/* Main settings card */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Settings</CardTitle>
          <CardDescription>
            Configure general platform settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Platform name */}
          <div className="space-y-2">
            <Label htmlFor="name">Platform Name</Label>
            <Input
              id="name"
              value={(formValues.name as string) || ""}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="AI Trust Platform"
            />
            <p className="text-xs text-muted-foreground">
              Displayed in the platform header and emails.
            </p>
          </div>

          {/* Support email */}
          <div className="space-y-2">
            <Label htmlFor="support_email">Support Email</Label>
            <Input
              id="support_email"
              type="email"
              value={(formValues.support_email as string) || ""}
              onChange={(e) => handleChange("support_email", e.target.value)}
              placeholder="support@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Contact email for platform support inquiries.
            </p>
          </div>

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

      {/* Additional info card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>System Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-sm text-muted-foreground">Version</div>
              <div className="font-medium">1.0.0</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Environment</div>
              <div className="font-medium">Production</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
