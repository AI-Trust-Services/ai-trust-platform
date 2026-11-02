import { useEffect, useMemo, useState } from "react";
import {
  api,
  type AssessmentSummary,
  type MySystemRow,
  type OpenTaskRow,
  type OrganizationContact,
  type UserSummary,
} from "../api/client";
import { usePermissions } from "../hooks/usePermissions";
import { LandingHeader } from "../components/landing/Header";
import { GetStartedCard } from "../components/landing/GetStartedCard";
import { HeroEmptyState } from "../components/landing/HeroEmptyState";
import { OpenTasksSection } from "../components/landing/OpenTasksSection";
import { MySystemsSection } from "../components/landing/MySystemsSection";
import { ResourcesCard } from "../components/landing/ResourcesCard";
import { OrgContactsCard } from "../components/landing/OrgContactsCard";
import {
  deriveOwnerTasks,
  filterContributorTasksForOwner,
} from "../components/landing/ownerTasks";
import {
  MOCK_ASSESSMENTS,
  MOCK_MY_SYSTEMS,
  MOCK_OPEN_TASKS,
} from "../components/landing/mockLandingData";

type LoadState = "loading" | "ready" | "error";

export default function Landing() {
  const { can } = usePermissions();
  const canRegister = can("systems:write");
  const [firstName, setFirstName] = useState<string | null>(null);
  const [complianceOfficer, setComplianceOfficer] =
    useState<OrganizationContact | null>(null);
  const [organizationAdmin, setOrganizationAdmin] =
    useState<OrganizationContact | null>(null);

  const [state, setState] = useState<LoadState>("loading");
  const [openTasks, setOpenTasks] = useState<OpenTaskRow[]>([]);
  const [mySystems, setMySystems] = useState<MySystemRow[]>([]);
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    api
      .me()
      .then((me) => setFirstName(me.firstName || null))
      .catch(() => setFirstName(null));
  }, []);

  useEffect(() => {
    api
      .organizationContacts()
      .then((r) => {
        setComplianceOfficer(r.compliance_officer);
        setOrganizationAdmin(r.organization_admin);
      })
      .catch(() => {
        setComplianceOfficer(null);
        setOrganizationAdmin(null);
      });
  }, []);

  // Pull the open-tasks + my-systems + assessments data up to Landing so we can
  // decide whether to render the two tables or the Hero curtain over mock data.
  useEffect(() => {
    Promise.all([
      api.myOpenTasks(),
      api.mySystems(),
      api.allAssessments().catch(() => [] as AssessmentSummary[]),
      api.allUsers().catch(() => [] as UserSummary[]),
    ])
      .then(([tasks, systems, allAssessments, allUsers]) => {
        setOpenTasks(tasks);
        setMySystems(systems);
        setAssessments(allAssessments);
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

  const showHeroCurtain =
    state === "ready" && openTasks.length === 0 && mySystems.length === 0;

  // While the curtain is up, show preview-quality mock rows so the user sees
  // what the tables will look like once populated — the curtain itself is the
  // call-to-action.
  const displayOpenTasks = showHeroCurtain ? MOCK_OPEN_TASKS : openTasks;
  const displayMySystems = showHeroCurtain ? MOCK_MY_SYSTEMS : mySystems;
  const displayAssessments = showHeroCurtain ? MOCK_ASSESSMENTS : assessments;

  // Owner-level tasks replace contributor rows for systems the user owns —
  // owners drive the whole process (Start / Continue EU AI Act Assessment)
  // rather than self-assigning individual questions.
  const ownerTasks = useMemo(
    () => deriveOwnerTasks(displayMySystems, displayAssessments),
    [displayMySystems, displayAssessments],
  );
  const contributorTasks = useMemo(() => {
    const ownedIds = new Set(displayMySystems.map((s) => s.id));
    return filterContributorTasksForOwner(displayOpenTasks, ownedIds);
  }, [displayOpenTasks, displayMySystems]);

  if (showHeroCurtain) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[#f6f7fb]">
        <div
          aria-hidden
          className="pointer-events-none select-none flex w-full max-w-[1600px] flex-col gap-8 px-4 pt-[40vh] blur-[2px]"
        >
          <OpenTasksSection
            state="ready"
            rows={contributorTasks}
            ownerTasks={ownerTasks}
            assessments={displayAssessments}
            userMap={userMap}
          />
          <MySystemsSection
            canRegister={canRegister}
            state="ready"
            systems={displayMySystems}
            assessments={displayAssessments}
            userMap={userMap}
          />
        </div>
        <HeroEmptyState canRegister={canRegister} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f7fb]">
      <div className="flex w-full max-w-[1600px] gap-6 px-4 py-8">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <LandingHeader firstName={firstName} />
          <GetStartedCard canRegister={canRegister} />
          <OpenTasksSection
            state="ready"
            rows={contributorTasks}
            ownerTasks={ownerTasks}
            assessments={displayAssessments}
            userMap={userMap}
          />
          <MySystemsSection
            canRegister={canRegister}
            state="ready"
            systems={displayMySystems}
            assessments={displayAssessments}
            userMap={userMap}
          />
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
