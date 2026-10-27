import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { InitialsAvatar } from "../InitialsAvatar";
import type { OrganizationContact } from "../../api/client";

interface OrgContactsCardProps {
  complianceOfficer: OrganizationContact | null;
  organizationAdmin: OrganizationContact | null;
}

export function OrgContactsCard({
  complianceOfficer,
  organizationAdmin,
}: OrgContactsCardProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">My Organization</h3>
      <div className="mt-4 flex flex-col gap-4">
        <ContactRow
          role="Compliance Officer"
          description="Your compliance officer is responsible for the…"
          contact={complianceOfficer}
          emptyLabel="No compliance officer assigned"
        />
        <div className="border-t border-border pt-4">
          <ContactRow
            role="Organization admin"
            description="For all inquiries regarding user rights and administration."
            contact={organizationAdmin}
            emptyLabel="No organization admin assigned"
          />
        </div>
      </div>
    </section>
  );
}

interface ContactRowProps {
  role: string;
  description: string;
  contact: OrganizationContact | null;
  emptyLabel: string;
}

function ContactRow({ role, description, contact, emptyLabel }: ContactRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-foreground">{role}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {contact ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <InitialsAvatar
              firstName={contact.firstName}
              lastName={contact.lastName}
              username={contact.username}
            />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                {displayName(contact)}
              </span>
              {contact.email && (
                <span className="text-xs text-muted-foreground">{contact.email}</span>
              )}
            </div>
          </div>
          {contact.email && <CopyEmailButton email={contact.email} />}
        </div>
      ) : (
        <span className="text-xs italic text-muted-foreground">{emptyLabel}</span>
      )}
    </div>
  );
}

function displayName(c: OrganizationContact): string {
  const full = `${c.firstName || ""} ${c.lastName || ""}`.trim();
  return full || c.username;
}

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API blocked; silently ignore — the user can select+copy manually */
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={copied ? "Copied" : `Copy ${email}`}
      title={copied ? "Copied!" : "Copy email"}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  );
}
