import { Box, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL } from "../../api/client";

interface MySystemsSectionProps {
  canRegister: boolean;
}

export function MySystemsSection({ canRegister }: MySystemsSectionProps) {
  function handleRegister() {
    navigateTo("/home/ai-system-registry/systems/new", `${REGISTRY_URL}#/systems/new`);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">My AI Systems</h2>
        <span className="text-xs text-muted-foreground">No systems yet</span>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Box className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">No AI systems yet</h3>
          <p className="max-w-md text-xs text-muted-foreground">
            You haven&apos;t added any AI systems to the platform. Register your first AI
            system to start assessing it for EU AI Act compliance.
          </p>
        </div>
        {canRegister && (
          <Button onClick={handleRegister}>
            <Plus />
            Register new AI System
          </Button>
        )}
      </div>
    </section>
  );
}
