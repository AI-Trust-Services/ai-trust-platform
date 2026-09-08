/**
 * UsersPage - Redirects to the Users MFE via Luigi navigation.
 * The users MFE is a separate micro-frontend that handles user management.
 */

import { useEffect } from "react";
import LuigiClient from "@luigi-project/client";
import { Loader2 } from "lucide-react";

export default function UsersPage() {
  useEffect(() => {
    // Navigate to users MFE via Luigi Client API
    LuigiClient.linkManager().navigate("/home/users");
  }, []);

  return (
    <div className="flex h-96 items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary" />
      <span className="ml-3 text-muted-foreground">Redirecting to Users & Roles...</span>
    </div>
  );
}
