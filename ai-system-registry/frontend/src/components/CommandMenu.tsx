/**
 * CommandMenu — Local command palette for the registry frontend.
 *
 * NOTE: The main Ctrl+K command palette is handled by the Luigi shell
 * (shell/public/luigi-config.js). This component is kept for cases where
 * the frontend needs to open a command menu programmatically, but the
 * keyboard shortcut is handled by the shell.
 */

import { useNavigate } from "react-router";
import {
  LayoutDashboard,
  ClipboardList,
  Box,
  CreditCard,
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

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const navigate = useNavigate();

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
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
