/**
 * CommandMenu — Local command palette for the registry frontend.
 *
 * NOTE: The main Ctrl+K command palette is handled by the Luigi shell
 * (shell/public/luigi-config.js). This component is kept for cases where
 * the frontend needs to open a command menu programmatically, but the
 * keyboard shortcut is handled by the shell.
 *
 * DEV ONLY: Review Mode feature for POC feedback collection.
 * - Enable/Disable Review Mode is in the shell's command palette
 * - See ReviewPanel.tsx and useReviewMode.tsx for implementation
 * - Database table: review_notes (migration 0013_review_notes.py)
 * - Backend router: routers/review_notes.py
 */

import { useEffect } from "react";
import { useNavigate } from "react-router";
import {
  LayoutDashboard,
  ClipboardList,
  Box,
  CreditCard,
  MessageSquarePlus,
  MessageSquareOff,
  Plus,
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

  // NOTE: Keyboard shortcut (Ctrl+K) is handled by the Luigi shell.
  // This component only responds to programmatic open/close.

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
          <CommandItem onSelect={() => runCommand(() => navigate("/today"))}>
            <LayoutDashboard className="mr-2" />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/work"))}>
            <ClipboardList className="mr-2" />
            My Work
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/systems"))}>
            <Box className="mr-2" />
            Systems
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/models"))}>
            <CreditCard className="mr-2" />
            Model Cards
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => {
            navigate("/systems");
            // Trigger registration wizard via URL param
            window.location.hash = "#/systems?register=true";
          })}>
            <Plus className="mr-2" />
            Register new AI System
          </CommandItem>

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
