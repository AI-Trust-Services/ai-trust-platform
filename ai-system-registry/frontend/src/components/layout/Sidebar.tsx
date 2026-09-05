import { useState } from "react";
import { NavLink } from "react-router";
import {
  Home,
  CheckSquare,
  Bot,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
}

function NavItem({ to, icon, label, collapsed }: NavItemProps) {
  const content = (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )
      }
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

interface RecentSystemProps {
  name: string;
  collapsed: boolean;
}

function RecentSystem({ name, collapsed }: RecentSystemProps) {
  if (collapsed) return null;

  return (
    <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
      <span className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="truncate">{name}</span>
    </button>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  // Mock recent systems - will be replaced with real data
  const recentSystems = [
    { name: "TalentMatch AI" },
    { name: "SmartScheduler AI" },
    { name: "SafetyWatch AI" },
    { name: "Document Intelligence" },
  ];

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "flex h-full flex-col border-r border-border bg-card transition-all duration-200",
          collapsed ? "w-16" : "w-56"
        )}
      >
        {/* Main Navigation */}
        <nav className="flex flex-col gap-1 p-3">
          <NavItem
            to="/today"
            icon={<Home className="size-5" />}
            label="Today"
            collapsed={collapsed}
          />
          <NavItem
            to="/work"
            icon={<CheckSquare className="size-5" />}
            label="My Work"
            collapsed={collapsed}
          />
          <NavItem
            to="/systems"
            icon={<Bot className="size-5" />}
            label="AI Systems"
            collapsed={collapsed}
          />
        </nav>

        {/* Recent Systems */}
        {!collapsed && (
          <>
            <Separator className="mx-3" />
            <div className="flex flex-col gap-1 p-3">
              <span className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recent Systems
              </span>
              {recentSystems.map((sys) => (
                <RecentSystem
                  key={sys.name}
                  name={sys.name}
                  collapsed={collapsed}
                />
              ))}
              <button className="px-3 py-1.5 text-left text-xs font-medium text-primary hover:underline">
                View all systems
              </button>
            </div>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom Navigation */}
        <div className="flex flex-col gap-1 p-3">
          <NavItem
            to="/settings"
            icon={<Settings className="size-5" />}
            label="Settings"
            collapsed={collapsed}
          />
          <NavItem
            to="/help"
            icon={<HelpCircle className="size-5" />}
            label="Help"
            collapsed={collapsed}
          />
        </div>

        {/* Collapse Toggle */}
        <div className="border-t border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn("w-full", collapsed ? "justify-center px-2" : "justify-start")}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <>
                <ChevronLeft className="size-4" />
                <span className="ml-2">Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
