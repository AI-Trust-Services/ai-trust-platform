import { useState } from "react";
import { X, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Default colors for each category - these become CSS variables
export const ADVANCED_COLOR_DEFAULTS: Record<string, string> = {
  // Risk Tier Badges (aligned with EU AI Act terminology from product-terminology-2026-08-28.md)
  tier_prohibited_bg: "#fef2f2",
  tier_prohibited_text: "#b91c1c",
  tier_high_bg: "#fff7ed",
  tier_high_text: "#c2410c",
  tier_high_transparency_bg: "#fef3f2",
  tier_high_transparency_text: "#c2410c",
  tier_transparency_bg: "#fffbeb",
  tier_transparency_text: "#b45309",
  tier_limited_no_bg: "#f0fdf4",
  tier_limited_no_text: "#15803d",
  tier_pending_bg: "#f4f4f5",
  tier_pending_text: "#71717a",
  // Lifecycle Badges (aligned with terminology)
  lifecycle_development_bg: "#eff6ff",
  lifecycle_development_text: "#1147E9",
  lifecycle_testing_bg: "#fffbeb",
  lifecycle_testing_text: "#b45309",
  lifecycle_prod_ready_bg: "#fff7ed",
  lifecycle_prod_ready_text: "#c2410c",
  lifecycle_market_bg: "#f0fdf4",
  lifecycle_market_text: "#15803d",
  lifecycle_service_bg: "#f0fdf4",
  lifecycle_service_text: "#166534",
  lifecycle_updated_bg: "#eff6ff",
  lifecycle_updated_text: "#1e40af",
  lifecycle_decommissioned_bg: "#f4f4f5",
  lifecycle_decommissioned_text: "#71717a",
  // Chart Palette
  chart_1: "#1147E9",
  chart_2: "#1a7a3c",
  chart_3: "#e05c00",
  chart_4: "#5a0080",
  chart_5: "#e9a922",
  chart_6: "#8b0000",
  chart_7: "#00758f",
  chart_8: "#3d6b99",
  // Alert Severity
  alert_error_bg: "#fef2f2",
  alert_error_text: "#b91c1c",
  alert_warning_bg: "#fffbeb",
  alert_warning_text: "#b45309",
  alert_info_bg: "#f0f4f8",
  alert_info_text: "#1e40af",
  // Progress/Score
  progress_success: "#16a34a",
  progress_warning: "#e9a922",
  progress_danger: "#dc2626",
};

// Color categories for the modal tabs
const CATEGORIES = [
  {
    id: "tiers",
    label: "Risk Tiers",
    description: "EU AI Act risk classification badges",
    fields: [
      { key: "tier_prohibited_bg", label: "Prohibited Practice Bg" },
      { key: "tier_prohibited_text", label: "Prohibited Practice Text" },
      { key: "tier_high_bg", label: "High Risk Bg" },
      { key: "tier_high_text", label: "High Risk Text" },
      { key: "tier_high_transparency_bg", label: "High Risk + Transparency Bg" },
      { key: "tier_high_transparency_text", label: "High Risk + Transparency Text" },
      { key: "tier_transparency_bg", label: "Transparency Obligations Bg" },
      { key: "tier_transparency_text", label: "Transparency Obligations Text" },
      { key: "tier_limited_no_bg", label: "Limited/No Risk Bg" },
      { key: "tier_limited_no_text", label: "Limited/No Risk Text" },
      { key: "tier_pending_bg", label: "Pending Bg" },
      { key: "tier_pending_text", label: "Pending Text" },
    ],
  },
  {
    id: "lifecycle",
    label: "Lifecycle",
    description: "AI system lifecycle status badges",
    fields: [
      { key: "lifecycle_development_bg", label: "Development Bg" },
      { key: "lifecycle_development_text", label: "Development Text" },
      { key: "lifecycle_testing_bg", label: "Testing Bg" },
      { key: "lifecycle_testing_text", label: "Testing Text" },
      { key: "lifecycle_prod_ready_bg", label: "Production Ready Bg" },
      { key: "lifecycle_prod_ready_text", label: "Production Ready Text" },
      { key: "lifecycle_market_bg", label: "On Market Bg" },
      { key: "lifecycle_market_text", label: "On Market Text" },
      { key: "lifecycle_service_bg", label: "In Service Bg" },
      { key: "lifecycle_service_text", label: "In Service Text" },
      { key: "lifecycle_updated_bg", label: "Updated Bg" },
      { key: "lifecycle_updated_text", label: "Updated Text" },
      { key: "lifecycle_decommissioned_bg", label: "Decommissioned Bg" },
      { key: "lifecycle_decommissioned_text", label: "Decommissioned Text" },
    ],
  },
  {
    id: "charts",
    label: "Charts",
    description: "Chart and visualization colors",
    fields: [
      { key: "chart_1", label: "Color 1 (Primary)" },
      { key: "chart_2", label: "Color 2 (Success)" },
      { key: "chart_3", label: "Color 3 (Warning)" },
      { key: "chart_4", label: "Color 4 (Purple)" },
      { key: "chart_5", label: "Color 5 (Amber)" },
      { key: "chart_6", label: "Color 6 (Danger)" },
      { key: "chart_7", label: "Color 7 (Teal)" },
      { key: "chart_8", label: "Color 8 (Blue)" },
    ],
  },
  {
    id: "alerts",
    label: "Alerts",
    description: "Alert severity indicators",
    fields: [
      { key: "alert_error_bg", label: "Error Bg" },
      { key: "alert_error_text", label: "Error Text" },
      { key: "alert_warning_bg", label: "Warning Bg" },
      { key: "alert_warning_text", label: "Warning Text" },
      { key: "alert_info_bg", label: "Info Bg" },
      { key: "alert_info_text", label: "Info Text" },
    ],
  },
  {
    id: "progress",
    label: "Progress",
    description: "Progress bars and score indicators",
    fields: [
      { key: "progress_success", label: "Success (≥100%)" },
      { key: "progress_warning", label: "Warning (60-99%)" },
      { key: "progress_danger", label: "Danger (<60%)" },
    ],
  },
];

interface AdvancedColorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

export function AdvancedColorsModal({
  isOpen,
  onClose,
  values,
  onChange,
}: AdvancedColorsModalProps) {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].id);
  const [localValues, setLocalValues] = useState<Record<string, string>>(values);

  if (!isOpen) return null;

  const category = CATEGORIES.find((c) => c.id === activeCategory)!;

  function handleColorChange(key: string, value: string) {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    // Only include values that differ from defaults
    const changedValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(localValues)) {
      if (value && value !== ADVANCED_COLOR_DEFAULTS[key]) {
        changedValues[key] = value;
      }
    }
    onChange(changedValues);
    onClose();
  }

  function handleResetCategory() {
    const resetValues = { ...localValues };
    for (const field of category.fields) {
      delete resetValues[field.key];
    }
    setLocalValues(resetValues);
  }

  function getColorValue(key: string): string {
    return localValues[key] || ADVANCED_COLOR_DEFAULTS[key] || "#000000";
  }

  function isCustomized(key: string): boolean {
    return !!localValues[key] && localValues[key] !== ADVANCED_COLOR_DEFAULTS[key];
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background rounded-xl shadow-2xl w-[800px] max-h-[85vh] flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
              <Palette className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Advanced Color Customization</h2>
              <p className="text-sm text-muted-foreground">Customize badges, charts, and status indicators</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-6 pt-4 border-b border-border shrink-0">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeCategory === cat.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{category.description}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetCategory}
              className="text-xs"
            >
              Reset to defaults
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {category.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-xs flex items-center gap-2">
                  {field.label}
                  {isCustomized(field.key) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      Custom
                    </span>
                  )}
                </Label>
                <div className="flex gap-2">
                  <div
                    className="w-9 h-9 rounded-md border border-border shrink-0 cursor-pointer"
                    style={{ backgroundColor: getColorValue(field.key) }}
                    onClick={() => {
                      const input = document.getElementById(`adv-${field.key}`) as HTMLInputElement;
                      input?.click();
                    }}
                  />
                  <input
                    id={`adv-${field.key}`}
                    type="color"
                    className="sr-only"
                    value={getColorValue(field.key)}
                    onChange={(e) => handleColorChange(field.key, e.target.value)}
                  />
                  <Input
                    placeholder={ADVANCED_COLOR_DEFAULTS[field.key]}
                    value={localValues[field.key] || ""}
                    onChange={(e) => handleColorChange(field.key, e.target.value)}
                    className="font-mono text-xs h-9"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Preview */}
          {activeCategory === "tiers" && (
            <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30">
              <p className="text-xs font-medium mb-3">Preview</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "prohibited", label: "Prohibited Practice" },
                  { key: "high", label: "High Risk" },
                  { key: "high_transparency", label: "High Risk + Transparency" },
                  { key: "transparency", label: "Transparency" },
                  { key: "limited_no", label: "Limited/No Risk" },
                  { key: "pending", label: "Pending" },
                ].map((tier) => (
                  <span
                    key={tier.key}
                    className="px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: getColorValue(`tier_${tier.key}_bg`),
                      color: getColorValue(`tier_${tier.key}_text`),
                    }}
                  >
                    {tier.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {activeCategory === "lifecycle" && (
            <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30">
              <p className="text-xs font-medium mb-3">Preview</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "development", label: "Development" },
                  { key: "testing", label: "Testing" },
                  { key: "prod_ready", label: "Production Ready" },
                  { key: "market", label: "On Market" },
                  { key: "service", label: "In Service" },
                  { key: "updated", label: "Updated" },
                  { key: "decommissioned", label: "Decommissioned" },
                ].map((lc) => (
                  <span
                    key={lc.key}
                    className="px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: getColorValue(`lifecycle_${lc.key}_bg`),
                      color: getColorValue(`lifecycle_${lc.key}_text`),
                    }}
                  >
                    {lc.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {activeCategory === "charts" && (
            <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30">
              <p className="text-xs font-medium mb-3">Preview</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <div
                    key={n}
                    className="flex-1 h-8 rounded"
                    style={{ backgroundColor: getColorValue(`chart_${n}`) }}
                  />
                ))}
              </div>
            </div>
          )}

          {activeCategory === "progress" && (
            <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30">
              <p className="text-xs font-medium mb-3">Preview</p>
              <div className="space-y-2">
                {[
                  { label: "100%", key: "progress_success", width: "100%" },
                  { label: "75%", key: "progress_warning", width: "75%" },
                  { label: "40%", key: "progress_danger", width: "40%" },
                ].map((item) => (
                  <div key={item.key} className="flex items-center gap-3">
                    <span className="text-xs w-10">{item.label}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: item.width,
                          backgroundColor: getColorValue(item.key),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
