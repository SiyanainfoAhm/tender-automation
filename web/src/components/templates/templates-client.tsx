"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { BidPreparation } from "@/components/templates/bid-preparation";
import { ManageTemplates } from "@/components/templates/manage-templates";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BidProfileTemplate } from "@/lib/templates/types";

type TemplatesClientProps = {
  templates: BidProfileTemplate[];
  canManage: boolean;
  companyName: string;
  companyAddress: string;
};

export function TemplatesClient({
  templates,
  canManage,
  companyName,
  companyAddress,
}: TemplatesClientProps) {
  const [resetNonce, setResetNonce] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bid Profile Templates"
        subtitle="Search tender and prepare bid using saved profile templates"
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setResetNonce((n) => n + 1)}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        }
      />

      <Tabs defaultValue="preparation">
        <TabsList>
          <TabsTrigger value="preparation">Bid Preparation</TabsTrigger>
          <TabsTrigger value="templates">Manage Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="preparation">
          <BidPreparation templates={templates} resetNonce={resetNonce} />
        </TabsContent>
        <TabsContent value="templates">
          <ManageTemplates
            templates={templates}
            canManage={canManage}
            companyName={companyName}
            companyAddress={companyAddress}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
