import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export interface MenuItem {
  id?: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  items: MenuItem[];
}

export default function KebabMenu({ items }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="More actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item, idx) => (
          <DropdownMenuItem
            key={item.id ?? idx}
            variant={item.danger ? "destructive" : "default"}
            disabled={item.disabled}
            onClick={(e) => { e.stopPropagation(); item.onClick(); }}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
