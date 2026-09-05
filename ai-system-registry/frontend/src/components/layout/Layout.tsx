import { useState } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandMenu } from "@/components/CommandMenu";

export function Layout() {
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar onOpenCommand={() => setCommandOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
