import { Search, Bell, Sparkles, Command, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/hooks/usePermissions";

interface TopBarProps {
  onOpenCommand?: () => void;
}

export function TopBar({ onOpenCommand }: TopBarProps) {
  const { username } = usePermissions();

  // Generate initials from username
  const initials = username
    ? username
        .split(/[@.]/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() || "")
        .join("")
    : "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Database className="size-5" />
        </span>
        <span className="text-lg font-semibold">AI Trust Platform</span>
      </div>

      {/* Search / Command */}
      <button
        onClick={onOpenCommand}
        className="flex h-9 w-80 items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search systems, tasks...</span>
        <kbd className="flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-xs">
          <Command className="size-3" />K
        </kbd>
      </button>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2">
          <Sparkles className="size-4" />
          AI Assistant
        </Button>

        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-5" />
          {/* Notification indicator */}
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 pl-2 pr-3">
              <Avatar className="size-8">
                <AvatarImage src="" />
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start text-xs">
                <span className="font-medium">{username || "User"}</span>
                <span className="text-muted-foreground">AI Engineer</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Preferences</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
