import { useEffect, useState } from "react";
import {
  api,
  type AssessmentSummary,
  type MySystemRow,
  type OpenTaskRow,
  type OrganizationContact,
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
    ])
      .then(([tasks, systems, allAssessments]) => {
        setOpenTasks(tasks);
        setMySystems(systems);
        setAssessments(allAssessments);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  const showHeroCurtain =
    state === "ready" && openTasks.length === 0 && mySystems.length === 0;

  // While the curtain is up, show preview-quality mock rows so the user sees
  // what the tables will look like once populated — the curtain itself is the
  // call-to-action.
  const displayOpenTasks = showHeroCurtain ? MOCK_OPEN_TASKS : openTasks;
  const displayMySystems = showHeroCurtain ? MOCK_MY_SYSTEMS : mySystems;
  const displayAssessments = showHeroCurtain ? MOCK_ASSESSMENTS : assessments;

  return (
    <main className="min-h-screen bg-[#f6f7fb]">
      <div className="flex w-full max-w-[1600px] gap-6 px-4 py-8">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <LandingHeader firstName={firstName} />
          <div className="relative">
            <div
              aria-hidden={showHeroCurtain || undefined}
              className={
                showHeroCurtain
                  ? "pointer-events-none select-none flex flex-col gap-8 blur-[2px]"
                  : "flex flex-col gap-8"
              }
            >
              <GetStartedCard canRegister={canRegister} />
              <OpenTasksSection
                state="ready"
                rows={displayOpenTasks}
                assessments={displayAssessments}
              />
              <MySystemsSection
                canRegister={canRegister}
                state="ready"
                systems={displayMySystems}
                assessments={displayAssessments}
              />
            </div>
            {showHeroCurtain && <HeroEmptyState canRegister={canRegister} />}
          </div>
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
