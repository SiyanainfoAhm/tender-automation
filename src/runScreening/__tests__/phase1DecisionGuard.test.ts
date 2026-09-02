import assert from "node:assert/strict";
import test from "node:test";
import { SIYANA_COMPANY_ID } from "../../company/siyanaCompany.js";
import {
  decidePhase1Row,
  enforcePhase1ScreeningDecisions,
} from "../phase1DecisionGuard.js";
import { toTenderScreeningPreferenceSnapshot } from "../companyPreferences.js";
import type { CompanyPreferenceSnapshot } from "../companyPreferences.js";
import type { RunWorkbookRow } from "../runWorkbook.js";

function companySnapshot(): CompanyPreferenceSnapshot {
  return {
    company: {
      id: SIYANA_COMPANY_ID,
      name: "Siyana Info Solutions Pvt. Ltd.",
      industryType: "IT / Software",
      businessLocation: "Chennai",
      website: null,
      yearEstablished: 2014,
      description: "Software services",
      slug: "siyana",
    },
    preferences: {
      companyId: SIYANA_COMPANY_ID,
      maxEmdInr: 1_500_000,
      minTenderValueInr: 0,
      maxTenderValueInr: 50_000_000,
      serviceScope: [
        "Information Technology",
        "Software Development",
        "System Integration",
        "Mobile",
      ],
      excludedScope: [
        "NON-IT",
        "Scanning / Digitization",
        "Hardware Only",
        "Internet / Connectivity Service",
      ],
      extras: {},
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
    loadedAt: "2026-08-19T00:00:00.000Z",
  };
}

function screening() {
  return toTenderScreeningPreferenceSnapshot(companySnapshot());
}

function decide(partial: {
  tenderId: string;
  title: string;
  emdAmount?: string;
  estimatedCost?: string;
  deadline?: string;
  llmStatus?: string;
}) {
  return decidePhase1Row({
    tenderId: partial.tenderId,
    title: partial.title,
    deadline: partial.deadline ?? "",
    emdAmount: partial.emdAmount ?? "0",
    estimatedCost: partial.estimatedCost ?? "0",
    runDate: "2026-08-17",
    snapshot: screening(),
    llmStatus: partial.llmStatus,
  });
}

const REGRESSION: Array<{
  id: string;
  title: string;
  emdAmount?: string;
  expected: "NO_BID" | "VERIFY";
}> = [
  {
    id: "93674650",
    title: "corrigendum : hiring of agency for it projects- milestone basis",
    emdAmount: "12500000",
    expected: "NO_BID",
  },
  {
    id: "103403905",
    title:
      "implementation of smart city solutions, ict infrastructure, upgradation of the existing iccc & erp systems, and operation & maintenance of the integrated command and control centre (iccc) for a period of five years",
    expected: "NO_BID",
  },
  {
    id: "103393651",
    title: "Cyber security audit of IT systems",
    expected: "NO_BID",
  },
  {
    id: "103389190",
    title: "ETABS software academic bundle",
    expected: "NO_BID",
  },
  {
    id: "103410269",
    title: "Smart classroom establishment and commissioning with interactive panels and AV equipment",
    expected: "NO_BID",
  },
  {
    id: "103392928",
    title: "Internet leased line and MPLS bandwidth connectivity",
    expected: "NO_BID",
  },
  {
    id: "103388896",
    title: "Document scanning and record digitization of archival files",
    expected: "NO_BID",
  },
  {
    id: "103408025",
    title:
      "procurement of one-year OEM-backed comprehensive AMC for ERP DR server infrastructure",
    expected: "NO_BID",
  },
  {
    id: "100053264",
    title: "Hiring of agency for IT projects - Milestone Basis",
    emdAmount: "50000",
    expected: "VERIFY",
  },
  {
    id: "103219603",
    title: "Selection of MSP",
    emdAmount: "100000",
    expected: "VERIFY",
  },
  {
    id: "103549141",
    title:
      "supply and installation of smart-class rooms with LED interactive panels and classroom hardware",
    expected: "NO_BID",
  },
  {
    id: "103548560",
    title: "comprehensive AMC for hardware, software and LAN networking equipment",
    expected: "NO_BID",
  },
  {
    id: "102890647",
    title: "CORS network infrastructure AMC and maintenance of reference stations",
    expected: "NO_BID",
  },
  {
    id: "102890648",
    title: "AMC of CORS network infrastructure",
    expected: "NO_BID",
  },
  {
    id: "103484951",
    title:
      "VR/AI based fighter-aircraft training system and simulator procurement",
    expected: "NO_BID",
  },
  {
    id: "103507004",
    title: "SMS gateway operation and messaging service",
    expected: "NO_BID",
  },
  {
    id: "103523481",
    title: "turnkey AI coding labs setup with workstations and lab infrastructure",
    expected: "NO_BID",
  },
];

test("93674650 is NO_BID because EMD exceeds the company maximum", () => {
  const decision = decide({
    tenderId: "93674650",
    title: "corrigendum : hiring of agency for it projects- milestone basis",
    emdAmount: "12500000",
    llmStatus: "VERIFY",
  });
  assert.equal(decision.status, "NO_BID");
  assert.equal(decision.hardGateFailed, true);
  assert.equal(decision.hardGateReason, "EMD_LIMIT_EXCEEDED");
  assert.equal(decision.emdAmount, 12_500_000);
  assert.equal(decision.maxEmd, 1_500_000);
  assert.match(decision.reason, /EMD/i);
});

test("103403905 is NO_BID because ICT/ICCC infrastructure dominates ERP keywords", () => {
  const decision = decide({
    tenderId: "103403905",
    title:
      "implementation of smart city solutions, ict infrastructure, upgradation of the existing iccc & erp systems, and operation & maintenance of the integrated command and control centre (iccc) for a period of five years",
    llmStatus: "VERIFY",
  });
  assert.equal(decision.status, "NO_BID");
  assert.equal(decision.hardGateFailed, false);
  assert.equal(decision.dominantScope, "EXCLUDED_INFRASTRUCTURE");
  assert.ok(decision.excludedScopeHits.includes("ICT Infrastructure"));
  assert.ok(decision.preferredScopeHits.includes("ERP"));
  assert.match(decision.reason, /ICCC infrastructure-heavy/i);
});

test("known Phase-1 inconsistency regressions keep expected statuses", () => {
  for (const row of REGRESSION) {
    const llmStatuses =
      row.expected === "NO_BID"
        ? (["VERIFY", "MAY_BID", "CONDITIONAL_GO"] as const)
        : (["VERIFY"] as const);
    for (const llmStatus of llmStatuses) {
      const decision = decide({
        tenderId: row.id,
        title: row.title,
        emdAmount: row.emdAmount ?? "0",
        llmStatus,
      });
      assert.equal(
        decision.status,
        row.expected,
        `${row.id} llm=${llmStatus} expected ${row.expected} got ${decision.status} (${decision.dominantScope}) hits=${decision.excludedScopeHits.join("|")}`,
      );
    }
  }
});

test("hardware false-positive MAY_BID/CONDITIONAL_GO cases are forced to NO_BID", () => {
  const cases = [
    {
      id: "103549141",
      title:
        "supply and installation of smart-class rooms with LED interactive panels and classroom hardware",
    },
    {
      id: "103548560",
      title: "comprehensive AMC for hardware, software and LAN networking equipment",
    },
    {
      id: "102890647",
      title: "CORS network infrastructure AMC and maintenance of reference stations",
    },
    {
      id: "103484951",
      title: "VR/AI based fighter-aircraft training system and simulator procurement",
    },
    {
      id: "103507004",
      title: "SMS gateway operation and messaging service",
    },
    {
      id: "103523481",
      title: "turnkey AI coding labs setup with workstations and lab infrastructure",
    },
  ];
  for (const row of cases) {
    const decision = decide({
      tenderId: row.id,
      title: row.title,
      llmStatus: "MAY_BID",
    });
    assert.equal(decision.status, "NO_BID", row.id);
    assert.ok(
      decision.dominantScope.startsWith("EXCLUDED_") ||
        decision.excludedScopeHits.length > 0,
      `${row.id} should have excluded signals`,
    );
  }

  const enforced = enforcePhase1ScreeningDecisions({
    inputRows: cases.map((row) => ({
      canonicalId: `T247-${row.id}`,
      source: "TENDER247" as const,
      tender247Id: row.id,
      referenceNo: "",
      bidAssistId: "",
      tenderName: row.title,
      organization: "",
      location: "",
      deadline: "",
      estimatedCost: "1000000",
      emdAmount: "10000",
      sourceRefs: "",
      screeningStatus: "" as const,
      screeningReason: "",
    })),
    outputRows: cases.map((row) => ({
      canonicalId: `T247-${row.id}`,
      source: "TENDER247" as const,
      tender247Id: row.id,
      referenceNo: "",
      bidAssistId: "",
      tenderName: row.title,
      organization: "",
      location: "",
      deadline: "",
      estimatedCost: "1000000",
      emdAmount: "10000",
      sourceRefs: "",
      screeningStatus: "CONDITIONAL_GO" as const,
      screeningReason: "Incorrect GPT MAY_BID",
    })),
    snapshot: companySnapshot(),
    runDate: "2026-08-20",
  });
  assert.equal(enforced.corrected, cases.length);
  assert.ok(enforced.rows.every((row) => row.screeningStatus === "NO_GO"));
});

test("ChatGPT NO_BID is retained even when title matches preferred software keywords", () => {
  const decision = decide({
    tenderId: "103765885",
    title: "supply of - ios based laptop , ios based mobile - | quantity - 3",
    emdAmount: "0",
    llmStatus: "NO_BID",
  });
  assert.equal(decision.status, "NO_BID");
  assert.match(decision.reason, /LLM NO_BID retained/i);
});

test("VERIFY is invalid after a hard-gate failure even with a generic IT title", () => {
  const decision = decide({
    tenderId: "93674650",
    title: "Hiring of agency for IT projects - Milestone Basis",
    emdAmount: "12500000",
    llmStatus: "VERIFY",
  });
  assert.equal(decision.status, "NO_BID");
});

test("valid VERIFY remains when scope is generic and gates pass", () => {
  const agency = decide({
    tenderId: "100053264",
    title: "Hiring of agency for IT projects - Milestone Basis",
    emdAmount: "50000",
  });
  const msp = decide({
    tenderId: "103219603",
    title: "Selection of MSP",
    emdAmount: "100000",
  });
  assert.equal(agency.status, "VERIFY");
  assert.equal(msp.status, "VERIFY");
});

test("cyber audit, ETABS licence, and smart classroom are NO_BID not VERIFY", () => {
  assert.equal(
    decide({ tenderId: "x", title: "Cyber security audit", llmStatus: "VERIFY" }).status,
    "NO_BID",
  );
  assert.equal(
    decide({ tenderId: "x", title: "ETABS licence", llmStatus: "VERIFY" }).status,
    "NO_BID",
  );
  assert.equal(
    decide({
      tenderId: "x",
      title: "Smart classroom establishment and commissioning with interactive panels",
      llmStatus: "VERIFY",
    }).status,
    "NO_BID",
  );
});

test("enforcePhase1ScreeningDecisions overwrites ChatGPT VERIFY after EMD hard-gate failure", () => {
  const input: RunWorkbookRow = {
    canonicalId: "T247-93674650",
    source: "TENDER247",
    tender247Id: "93674650",
    referenceNo: "",
    bidAssistId: "",
    tenderName: "corrigendum : hiring of agency for it projects- milestone basis",
    organization: "Dept",
    location: "",
    deadline: "",
    estimatedCost: "0",
    emdAmount: "12500000",
    sourceRefs: "",
    screeningStatus: "",
    screeningReason: "",
  };
  const output: RunWorkbookRow = {
    ...input,
    screeningStatus: "VERIFY",
    screeningReason: "Generic IT title; verify documents",
  };
  const enforced = enforcePhase1ScreeningDecisions({
    inputRows: [input],
    outputRows: [output],
    snapshot: companySnapshot(),
    runDate: "2026-08-17",
  });
  assert.equal(enforced.rows[0]?.screeningStatus, "NO_GO");
  assert.match(enforced.rows[0]?.screeningReason || "", /EMD/i);
  assert.ok(enforced.corrected >= 1);
});
