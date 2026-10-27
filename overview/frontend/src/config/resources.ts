import type { LucideIcon } from "lucide-react";
import { FileText } from "lucide-react";

/**
 * EU AI Act resource links shown in the right sidebar of the Landing Zone.
 * Opens in a new browser tab.
 */
export interface ResourceLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const EU_AI_ACT_RESOURCES: ResourceLink[] = [
  {
    label: "EU AI Act — full regulation text",
    href: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
    icon: FileText,
  },
  {
    label: "Prohibited practices (Article 5)",
    href: "https://artificialintelligenceact.eu/article/5/",
    icon: FileText,
  },
  {
    label: "High-risk requirements (Annex III)",
    href: "https://artificialintelligenceact.eu/annex/3/",
    icon: FileText,
  },
  {
    label: "Transparency obligations (Article 50)",
    href: "https://artificialintelligenceact.eu/article/50/",
    icon: FileText,
  },
];
