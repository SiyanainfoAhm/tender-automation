import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canEditBidPreferences, canEditCompanyProfile } from "@/lib/company/types";
import { requireCompanyOrRedirect } from "@/server/auth/company-access";
import {
  getCompanyBidPreferences,
  getCompanyById,
} from "@/server/repositories/companyRepository";
import { CompanyGeneralInfoForm } from "@/components/company/company-general-info-form";
import { BidPreferencesForm } from "@/components/company/bid-preferences-form";

export default async function CompanyProfilePage() {
  const session = await requireCompanyOrRedirect();
  const company = await getCompanyById(session.companyId);
  if (!company) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-text-muted">
        Company record not found.
      </div>
    );
  }

  const prefs = await getCompanyBidPreferences(session.companyId);
  const canEditProfile = canEditCompanyProfile(session.user.role);
  const canEditPrefs = canEditBidPreferences(session.user.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Profile"
        subtitle="Manage your company information and bidding preferences"
      />

      <Card>
        <CardContent className="pt-5">
          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">General Info</TabsTrigger>
              <TabsTrigger value="preferences">Bid Preferences</TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="pt-4">
              <CompanyGeneralInfoForm
                canEdit={canEditProfile}
                initial={{
                  name: company.name,
                  industryType: company.industryType || "",
                  businessLocation: company.businessLocation || "",
                  website: company.website || "",
                  yearEstablished:
                    company.yearEstablished != null
                      ? String(company.yearEstablished)
                      : "",
                  description: company.description || "",
                }}
              />
            </TabsContent>
            <TabsContent value="preferences" className="pt-4">
              <BidPreferencesForm
                canEdit={canEditPrefs}
                initial={{
                  maxEmdInr:
                    prefs?.maxEmdInr != null ? String(prefs.maxEmdInr) : "",
                  minTenderValueInr:
                    prefs?.minTenderValueInr != null
                      ? String(prefs.minTenderValueInr)
                      : "",
                  maxTenderValueInr:
                    prefs?.maxTenderValueInr != null
                      ? String(prefs.maxTenderValueInr)
                      : "",
                  serviceScope: prefs?.serviceScope || [],
                  excludedScope: prefs?.excludedScope || [],
                }}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
