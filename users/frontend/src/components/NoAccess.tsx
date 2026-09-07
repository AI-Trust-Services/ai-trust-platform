import { Lock } from "lucide-react";

export function NoAccess() {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-6" />
      </span>
      <h3 className="mb-2 text-lg font-semibold text-foreground">No Access</h3>
      <p className="text-sm text-muted-foreground">
        You don't have permission to view this page.
      </p>
    </div>
  );
}
