/**
 * CommandMenu — Command palette for admin frontend.
 *
 * DEV ONLY: Review Mode feature for POC feedback collection.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router";
import {
  LayoutDashboard,
  Users,
  Bot,
  Mail,
  Settings,
  MessageSquarePlus,
  MessageSquareOff,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useReviewMode } from "@/hooks/useReviewMode";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const navigate = useNavigate();
  const { enabled: reviewEnabled, setEnabled: setReviewEnabled } = useReviewMode();

  // Keyboard shortcut (Ctrl+K / Cmd+K)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => navigate("/"))}>
            <LayoutDashboard className="mr-2" />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/users"))}>
            <Users className="mr-2" />
            Users & Roles
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/ai-providers"))}>
            <Bot className="mr-2" />
            AI Providers
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/mail-service"))}>
            <Mail className="mr-2" />
            Mail Service
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/settings"))}>
            <Settings className="mr-2" />
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          {/* DEV ONLY: Review Mode for POC feedback collection */}
          {reviewEnabled ? (
            <CommandItem onSelect={() => runCommand(() => setReviewEnabled(false))}>
              <MessageSquareOff className="mr-2" />
              Disable Review Mode (DEV ONLY)
            </CommandItem>
          ) : (
            <CommandItem onSelect={() => runCommand(() => setReviewEnabled(true))}>
              <MessageSquarePlus className="mr-2" />
              Enable Review Mode (DEV ONLY)
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
