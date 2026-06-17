export function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export const TIER_META = {
  "prohibited":    { label: "Prohibited",    cls: "badge-prohibited" },
  "high":          { label: "High-Risk",     cls: "badge-high" },
  "gpai-systemic": { label: "GPAI Systemic", cls: "badge-gpai-systemic" },
  "gpai-standard": { label: "GPAI Standard", cls: "badge-gpai-standard" },
  "limited":       { label: "Limited",       cls: "badge-limited" },
  "minimal":       { label: "Minimal",       cls: "badge-minimal" },
};

export const LIFECYCLE_LABELS = {
  "development":    "Development",
  "testing":        "Testing",
  "conformity":     "Conformity",
  "market":         "On Market",
  "post-market":    "Post-Market",
  "decommissioned": "Decommissioned",
};

export const FLOPS_THRESHOLD = 1e25;

export function previewClassify(flags, flops) {
  const g = (k) => !!flags[k];
  if (g("subliminal_manipulation") || g("exploits_vulnerability") || g("social_scoring_public") ||
      g("real_time_biometric_public") || g("emotion_recognition_workplace") ||
      g("untargeted_facial_scraping") || g("predictive_policing") ||
      g("biometric_categorisation_sensitive")) {
    return { tier: "prohibited", basis: "Prohibited under EU AI Act Art. 5",
      obligations: ["Art. 5 — Must not be placed on market"] };
  }
  if (g("is_gpai")) {
    const systemic = (parseFloat(flops) || 0) >= FLOPS_THRESHOLD;
    return {
      tier: systemic ? "gpai-systemic" : "gpai-standard",
      basis: systemic ? "GPAI — systemic risk (≥10²⁵ FLOPs)" : "GPAI — standard",
      obligations: systemic
        ? ["Art. 53 — Technical docs", "Art. 55 — Adversarial testing", "Art. 55 — Incident reporting"]
        : ["Art. 53 — Technical docs", "Art. 53 — Copyright summary"],
    };
  }
  if (g("is_biometric_identification") || g("is_critical_infrastructure") || g("is_education_related") ||
      g("is_employment_related") || g("is_credit_scoring") || g("is_public_service") ||
      g("is_law_enforcement") || g("is_migration") || g("is_judicial_admin")) {
    return { tier: "high", basis: "High-risk under EU AI Act Annex III",
      obligations: ["Art. 9 — Risk management", "Art. 10 — Data governance",
        "Art. 11 — Technical documentation", "Art. 13 — Transparency", "Art. 49 — Registration"] };
  }
  if (g("is_chatbot") || g("generates_synthetic_content")) {
    return { tier: "limited", basis: "Limited-risk under EU AI Act Art. 50",
      obligations: ["Art. 50 — Transparency obligation"] };
  }
  return { tier: "minimal", basis: "Minimal risk — no mandatory obligations", obligations: [] };
}
