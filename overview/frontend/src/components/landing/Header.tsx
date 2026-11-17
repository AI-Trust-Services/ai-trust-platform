interface HeaderProps {
  firstName: string | null;
}

export function LandingHeader({ firstName }: HeaderProps) {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-3xl font-semibold tracking-[-0.02em]">{greeting}</h1>
      <p className="text-sm text-muted-foreground">
        Welcome to the AI Trust Platform.
      </p>
    </div>
  );
}
