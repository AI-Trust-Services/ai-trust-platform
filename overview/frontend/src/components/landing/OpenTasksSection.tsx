import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL } from "../../api/client";

export function OpenTasksSection() {
  function handleViewSystems() {
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">Open Tasks</h2>
        <span className="text-xs text-muted-foreground">
          No questions assigned to you
        </span>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">
            No tasks assigned to you
          </h3>
          <p className="max-w-md text-xs text-muted-foreground">
            You haven&apos;t been assigned any questions in an AI System assessment yet.
            When a colleague assigns you a question, it&apos;ll appear here.
          </p>
        </div>
        <Button variant="outline" onClick={handleViewSystems}>
          View all AI Systems
        </Button>
      </div>
    </section>
  );
}
