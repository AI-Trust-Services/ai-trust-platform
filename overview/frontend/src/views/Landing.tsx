import { useEffect, useState } from "react";
import { api, type OrganizationContact } from "../api/client";
import { usePermissions } from "../hooks/usePermissions";
import { LandingHeader } from "../components/landing/Header";
import { GetStartedCard } from "../components/landing/GetStartedCard";
import { OpenTasksSection } from "../components/landing/OpenTasksSection";
import { MySystemsSection } from "../components/landing/MySystemsSection";
import { ResourcesCard } from "../components/landing/ResourcesCard";
import { OrgContactsCard } from "../components/landing/OrgContactsCard";

export default function Landing() {
  const { can } = usePermissions();
  const canRegister = can("systems:write");
  const [firstName, setFirstName] = useState<string | null>(null);
  const [complianceOfficer, setComplianceOfficer] =
    useState<OrganizationContact | null>(null);
  const [organizationAdmin, setOrganizationAdmin] =
    useState<OrganizationContact | null>(null);

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

  return (
    <main className="mx-auto flex w-full max-w-[1280px] gap-6 px-6 py-8">
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <LandingHeader firstName={firstName} />
        <GetStartedCard canRegister={canRegister} />
        <OpenTasksSection />
        <MySystemsSection canRegister={canRegister} />
      </div>
      <aside className="hidden w-[320px] shrink-0 flex-col gap-4 lg:flex">
        <ResourcesCard />
        <OrgContactsCard
          complianceOfficer={complianceOfficer}
          organizationAdmin={organizationAdmin}
        />
      </aside>
    </main>
  );
}
