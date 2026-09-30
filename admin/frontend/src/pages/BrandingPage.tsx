import { useState, useEffect, useCallback, useRef } from "react";
import { Palette, Upload, X, Eye, EyeOff, RefreshCw, RotateCcw, Sun, Moon, ZoomIn, ZoomOut, Sliders } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AdvancedColorsModal } from "@/components/AdvancedColorsModal";
import type { Branding, BrandingUpdate, BrandingStatus } from "@/types";
import { useToast } from "@/App";

type Tab = "logos" | "colors";
type ThemeMode = "light" | "dark";

// Color field groups organized by theme
const COLOR_GROUPS = [
  {
    title: "Brand Colors",
    description: "Core brand colors used throughout the platform",
    themeSpecific: true,
    fields: [
      { key: "primary_color", keyDark: "primary_color_dark", label: "Primary", description: "Main brand color for links and primary actions" },
      { key: "secondary_color", keyDark: "secondary_color_dark", label: "Secondary", description: "Supporting color for secondary elements" },
      { key: "accent_color", keyDark: "accent_color_dark", label: "Accent", description: "Highlight color for success states" },
      { key: "warning_color", keyDark: "warning_color_dark", label: "Warning", description: "Color for alerts and warnings" },
    ],
  },
  {
    title: "Shell Colors",
    description: "Navigation and header appearance",
    themeSpecific: true,
    fields: [
      { key: "sidebar_bg", keyDark: "sidebar_bg_dark", label: "Sidebar Background", description: "Background color of the navigation sidebar" },
      { key: "sidebar_text", keyDark: "sidebar_text_dark", label: "Sidebar Text", description: "Text color of sidebar navigation items" },
      { key: "header_bg", keyDark: "header_bg_dark", label: "Header Background", description: "Background color of the top header bar" },
      { key: "header_text", keyDark: "header_text_dark", label: "Header Text", description: "Text color in the header bar" },
    ],
  },
  {
    title: "UI Element Colors",
    description: "Buttons, tables, and other components",
    themeSpecific: true,
    fields: [
      { key: "mfe_bg", keyDark: "mfe_bg_dark", label: "Content Background", description: "Background color for main content area (MFE views)" },
      { key: "button_bg", keyDark: "button_bg_dark", label: "Button Background", description: "Background color for primary buttons" },
      { key: "button_text", keyDark: "button_text_dark", label: "Button Text", description: "Text color for primary buttons" },
      { key: "table_header_bg", keyDark: "table_header_bg_dark", label: "Table Header", description: "Background color for table headers" },
      { key: "table_border", keyDark: "table_border_dark", label: "Table Border", description: "Border color for tables" },
    ],
  },
] as const;

const LOGO_FIELDS = [
  { key: "logo_horizontal_light", label: "Logo (Light Mode)", description: "Full logo for light backgrounds (SVG/PNG, max 2MB)" },
  { key: "logo_horizontal_dark", label: "Logo (Dark Mode)", description: "Full logo for dark backgrounds (SVG/PNG, max 2MB)" },
  { key: "logo_icon", label: "Icon", description: "Square icon for collapsed sidebar (SVG/PNG, max 2MB)" },
  { key: "favicon", label: "Favicon", description: "Browser tab icon (ICO/PNG, max 2MB)" },
] as const;

// All color keys flattened for form state (including dark variants)
const ALL_COLOR_KEYS = COLOR_GROUPS.flatMap(g =>
  g.fields.flatMap(f => g.themeSpecific && 'keyDark' in f ? [f.key, f.keyDark] : [f.key])
);

// Virtual viewport dimensions for the preview
const PREVIEW_WIDTH = 1920;
const PREVIEW_HEIGHT = 1080;
const ZOOM_STEPS = [0.25, 0.35, 0.5, 0.65, 0.8, 1.0];

export default function BrandingPage() {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("colors");
  const [colorThemeMode, setColorThemeMode] = useState<ThemeMode>("light");
  const [showPreview, setShowPreview] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewScale, setPreviewScale] = useState(0.65);

  const [draft, setDraft] = useState<Branding | null>(null);
  const [status, setStatus] = useState<BrandingStatus | null>(null);
  const [form, setForm] = useState<BrandingUpdate>({});
  const [advancedColors, setAdvancedColors] = useState<Record<string, string>>({});
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Zoom controls
  function zoomIn() {
    const currentIndex = ZOOM_STEPS.findIndex(s => s >= previewScale);
    if (currentIndex < ZOOM_STEPS.length - 1) {
      setPreviewScale(ZOOM_STEPS[currentIndex + 1]);
    }
  }

  function zoomOut() {
    const currentIndex = ZOOM_STEPS.findIndex(s => s >= previewScale);
    if (currentIndex > 0) {
      setPreviewScale(ZOOM_STEPS[currentIndex - 1]);
    } else if (currentIndex === -1) {
      setPreviewScale(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    }
  }

  const load = useCallback(async () => {
    try {
      const [draftData, statusData] = await Promise.all([
        api.getBranding("draft"),
        api.getBrandingStatus(),
      ]);
      setDraft(draftData);
      setStatus(statusData);
      // Initialize form with all color fields
      const formData: BrandingUpdate = {};
      for (const key of ALL_COLOR_KEYS) {
        formData[key as keyof BrandingUpdate] = draftData[key as keyof Branding] as string ?? "";
      }
      setForm(formData);
      // Initialize advanced colors
      setAdvancedColors(draftData.advanced_colors || {});
    } catch {
      showToast("Failed to load branding settings", true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      // Include advanced colors in the update
      const updatePayload: BrandingUpdate = {
        ...form,
        advanced_colors: Object.keys(advancedColors).length > 0 ? advancedColors : null,
      };
      const updated = await api.updateBranding(updatePayload);
      setDraft(updated);
      const newStatus = await api.getBrandingStatus();
      setStatus(newStatus);
      showToast("Draft saved");
      // Refresh preview
      setPreviewKey(k => k + 1);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", true);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      await api.publishBranding();
      await load();
      showToast("Branding published successfully");
      // Notify shell to reload branding
      localStorage.setItem("trust-platform-branding-update", Date.now().toString());
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Publish failed", true);
    } finally {
      setPublishing(false);
    }
  }

  async function handleDiscard() {
    setDiscarding(true);
    try {
      await api.discardBranding();
      await load();
      showToast("Draft changes discarded");
      setPreviewKey(k => k + 1);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Discard failed", true);
    } finally {
      setDiscarding(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset all branding to platform defaults? This will remove all custom logos, colors, and settings.")) {
      return;
    }
    setResetting(true);
    try {
      await api.resetBranding();
      await load();
      showToast("Branding reset to defaults");
      // Notify shell to reload branding
      localStorage.setItem("trust-platform-branding-update", Date.now().toString());
      setPreviewKey(k => k + 1);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Reset failed", true);
    } finally {
      setResetting(false);
    }
  }

  async function handleFileUpload(assetType: string, file: File) {
    try {
      const updated = await api.uploadBrandingAsset(assetType, file);
      setDraft(updated);
      const newStatus = await api.getBrandingStatus();
      setStatus(newStatus);
      showToast(`${assetType.replace(/_/g, " ")} uploaded`);
      setPreviewKey(k => k + 1);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload failed", true);
    }
  }

  // Get the correct color key based on theme mode
  function getColorKey(field: { key: string; keyDark?: string }, themeSpecific: boolean): string {
    if (!themeSpecific || colorThemeMode === "light") {
      return field.key;
    }
    return field.keyDark || field.key;
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border shrink-0">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 text-white">
            <Palette className="size-7" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Branding & Appearance</h1>
            <p className="text-sm text-muted-foreground">Customize the platform's look and feel.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? <EyeOff className="size-4 mr-1.5" /> : <Eye className="size-4 mr-1.5" />}
            {showPreview ? "Hide Preview" : "Show Preview"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={resetting}
            title="Reset to platform defaults"
          >
            <RotateCcw className="size-4 mr-1.5" />
            {resetting ? "Resetting…" : "Reset to Defaults"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDiscard}
            disabled={discarding || !status?.has_unpublished_changes}
          >
            {discarding ? "Discarding…" : "Discard Draft"}
          </Button>
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={publishing || !status?.has_unpublished_changes}
          >
            {publishing ? "Publishing…" : "Publish Changes"}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className={`flex-1 min-h-0 grid ${showPreview ? "grid-cols-[400px_1fr]" : "grid-cols-1"}`}>
        {/* Settings Panel */}
        <div className="border-r border-border overflow-y-auto p-6">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-border mb-6">
            {(["logos", "colors"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Logos Tab */}
          {activeTab === "logos" && (
            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="text-base font-semibold mb-1">Logo Assets</h2>
                <p className="text-sm text-muted-foreground mb-4">Upload your organization's logo variants.</p>
                <div className="grid grid-cols-2 gap-4">
                  {LOGO_FIELDS.map(({ key, label, description }) => (
                    <div key={key} className="space-y-2">
                      <Label className="text-xs">{label}</Label>
                      <div
                        className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => fileInputRefs.current[key]?.click()}
                      >
                        {draft?.[key as keyof Branding] ? (
                          <>
                            <img
                              src={api.getBrandingAssetUrl(draft[key as keyof Branding] as string)}
                              alt={label}
                              className="max-h-12 max-w-full object-contain"
                            />
                            <button
                              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Clear the logo (would need a delete endpoint)
                              }}
                            >
                              <X className="size-3" />
                            </button>
                          </>
                        ) : (
                          <>
                            <Upload className="size-6 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Upload</span>
                          </>
                        )}
                        <input
                          ref={(el) => { fileInputRefs.current[key] = el; }}
                          type="file"
                          accept={key === "favicon" ? ".ico,.png" : ".svg,.png,.jpg,.jpeg"}
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(key, file);
                            e.target.value = "";
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Colors Tab */}
          {activeTab === "colors" && (
            <div className="space-y-5">
              {COLOR_GROUPS.map((group) => (
                <div key={group.title} className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-center justify-between mb-0.5">
                    <h2 className="text-base font-semibold">{group.title}</h2>
                    {group.themeSpecific && (
                      <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                        <button
                          onClick={() => setColorThemeMode("light")}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            colorThemeMode === "light"
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Sun className="size-3.5" />
                          Light
                        </button>
                        <button
                          onClick={() => setColorThemeMode("dark")}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            colorThemeMode === "dark"
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Moon className="size-3.5" />
                          Dark
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">{group.description}</p>
                  <div className="grid grid-cols-2 gap-3">
                    {group.fields.map((field) => {
                      const colorKey = getColorKey(field, group.themeSpecific);
                      return (
                        <div key={colorKey} className="space-y-1">
                          <Label className="text-xs">{field.label}</Label>
                          <div className="flex gap-2">
                            <div
                              className="w-9 h-9 rounded-md border border-border shrink-0 cursor-pointer"
                              style={{ backgroundColor: form[colorKey as keyof BrandingUpdate] as string || "#e5e5e5" }}
                              onClick={() => {
                                const input = document.getElementById(`${colorKey}-picker`) as HTMLInputElement;
                                input?.click();
                              }}
                            />
                            <input
                              id={`${colorKey}-picker`}
                              type="color"
                              className="sr-only"
                              value={form[colorKey as keyof BrandingUpdate] as string || "#000000"}
                              onChange={(e) => setForm({ ...form, [colorKey]: e.target.value })}
                            />
                            <Input
                              id={colorKey}
                              placeholder="#000000"
                              value={form[colorKey as keyof BrandingUpdate] as string || ""}
                              onChange={(e) => setForm({ ...form, [colorKey]: e.target.value })}
                              className="font-mono text-xs h-9"
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-tight">{field.description}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Advanced Colors Button */}
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Advanced Customization</h2>
                    <p className="text-sm text-muted-foreground">
                      Customize tier badges, lifecycle badges, charts, alerts, and progress indicators.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setShowAdvancedModal(true)}
                  >
                    <Sliders className="size-4 mr-1.5" />
                    Customize More
                  </Button>
                </div>
                {Object.keys(advancedColors).length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {Object.keys(advancedColors).length} custom color{Object.keys(advancedColors).length !== 1 ? "s" : ""} configured
                  </p>
                )}
              </div>

              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Draft"}
              </Button>
            </div>
          )}
        </div>

        {/* Preview Panel */}
        {showPreview && (
          <div className="flex flex-col bg-muted/30 p-4 overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-medium">Live Preview</h3>
                {status?.has_unpublished_changes && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Draft
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Zoom controls */}
                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  <button
                    onClick={zoomOut}
                    disabled={previewScale <= ZOOM_STEPS[0]}
                    className="p-1.5 rounded-md hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Zoom out"
                  >
                    <ZoomOut className="size-4" />
                  </button>
                  <span className="text-xs font-medium w-12 text-center">
                    {Math.round(previewScale * 100)}%
                  </span>
                  <button
                    onClick={zoomIn}
                    disabled={previewScale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                    className="p-1.5 rounded-md hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Zoom in"
                  >
                    <ZoomIn className="size-4" />
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewKey(k => k + 1)}
                >
                  <RefreshCw className="size-4 mr-1.5" />
                  Refresh
                </Button>
              </div>
            </div>
            {/* Scaled preview container */}
            <div className="flex-1 min-h-0 flex items-start justify-center overflow-auto rounded-lg border border-border bg-background shadow-lg p-4">
              <div
                className="origin-top"
                style={{
                  width: `${PREVIEW_WIDTH}px`,
                  height: `${PREVIEW_HEIGHT}px`,
                  transform: `scale(${previewScale})`,
                  flexShrink: 0,
                }}
              >
                <iframe
                  key={previewKey}
                  src="/?preview=true"
                  className="border-0"
                  title="Branding Preview"
                  style={{ width: `${PREVIEW_WIDTH}px`, height: `${PREVIEW_HEIGHT}px` }}
                />
              </div>
            </div>
            <Alert className="mt-3 shrink-0">
              <AlertDescription className="text-xs">
                Preview shows draft branding. Publish to make changes live for all users.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      {/* Footer with publish metadata */}
      {status?.published_at && (
        <div className="px-8 py-3 border-t border-border text-sm text-muted-foreground shrink-0">
          Last published: {new Date(status.published_at).toLocaleString()}
          {status.published_by && ` by ${status.published_by}`}
        </div>
      )}

      {/* Advanced Colors Modal */}
      <AdvancedColorsModal
        isOpen={showAdvancedModal}
        onClose={() => setShowAdvancedModal(false)}
        values={advancedColors}
        onChange={setAdvancedColors}
      />
    </div>
  );
}
