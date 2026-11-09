import { useEffect, useMemo, useState } from "react";
import {
  api,
  type OpenTaskRow,
  type OrganizationContact,
  type RecentSystemRow,
  type UserSummary,
} from "../api/client";
import { LandingHeader } from "../components/landing/Header";
import { GetStartedCardsRow } from "../components/landing/GetStartedCardsRow";
import { RecentSystemsPanel } from "../components/landing/RecentSystemsPanel";
import { ReviewQueueTable } from "../components/landing/ReviewQueueTable";
import { ResourcesCard } from "../components/landing/ResourcesCard";
import { OrgContactsCard } from "../components/landing/OrgContactsCard";

type LoadState = "loading" | "ready" | "error";

interface ComplianceLandingProps {
  firstName: string | null;
  canRegister: boolean;
  complianceOfficer: OrganizationContact | null;
  organizationAdmin: OrganizationContact | null;
}

/**
 * Landing variant for the Compliance Officer role.
 *
 * Replaces the owner-focused "Open tasks + My systems" pair with:
 *   - Two-card Get Started hero (Register + View all systems)
 *   - Recent AI Systems row (whole org, 3 most recent)
 *   - Ready for Review table (assessments awaiting *this* CO's review)
 *
 * See issue #345 for the full requirements.
 */
export default function ComplianceLanding({
  firstName,
  canRegister,
  complianceOfficer,
  organizationAdmin,
}: ComplianceLandingProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [reviewRows, setReviewRows] = useState<OpenTaskRow[]>([]);
  const [recentSystems, setRecentSystems] = useState<RecentSystemRow[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    Promise.all([
      api.myOpenTasks(),
      // Fetch 5 but RecentSystemsPanel renders only the first 3 — the small
      // buffer lets the panel drop malformed/odd rows without going short.
      api.recentSystems(5).catch(() => [] as RecentSystemRow[]),
      api.allUsers().catch(() => [] as UserSummary[]),
    ])
      .then(([tasks, recent, allUsers]) => {
        setReviewRows(tasks.filter((t) => t.source === "review"));
        setRecentSystems(recent);
        setUsers(allUsers);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  const userMap = useMemo(() => {
    const m = new Map<string, UserSummary>();
    for (const u of users) m.set(u.username, u);
    return m;
  }, [users]);

  return (
    <main className="min-h-screen bg-[#f6f7fb]">
      <div className="flex w-full max-w-[1600px] gap-6 px-4 py-8">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <LandingHeader firstName={firstName} />
          <GetStartedCardsRow canRegister={canRegister} />
          <RecentSystemsPanel systems={recentSystems} />
          {state === "ready" && (
            <ReviewQueueTable rows={reviewRows} userMap={userMap} />
          )}
        </div>
        <aside className="hidden w-[320px] shrink-0 flex-col gap-4 lg:flex">
          <ResourcesCard />
          <OrgContactsCard
            complianceOfficer={complianceOfficer}
            organizationAdmin={organizationAdmin}
          />
        </aside>
      </div>
    </main>
  );
}

/** Keycloak role name for the Compliance Officer — single source of truth. */
export const COMPLIANCE_OFFICER_ROLE = "ai_compliance_officer";
