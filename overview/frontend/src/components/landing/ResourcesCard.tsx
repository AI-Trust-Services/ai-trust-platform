import { ExternalLink } from "lucide-react";
import { EU_AI_ACT_RESOURCES } from "../../config/resources";

export function ResourcesCard() {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">EU AI Act resources</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Key articles and official guidance for compliance.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {EU_AI_ACT_RESOURCES.map((resource) => {
          const Icon = resource.icon;
          return (
            <li key={resource.href}>
              <a
                href={resource.href}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                <span className="flex items-center gap-2 truncate">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{resource.label}</span>
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
