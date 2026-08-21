import {
  toTenderScreeningPreferenceSnapshot,
  type CompanyPreferenceSnapshot,
} from "./companyPreferences.js";
import {
  configuredPolicyLines,
  formatNullableInr,
  hasSelectedScope,
  PHASE1_SCREENING_POLICY_VERSION,
  type TenderScreeningPreferenceSnapshot,
} from "./screeningPolicy.js";

export const PHASE1_SCREENING_PROMPT_VERSION = PHASE1_SCREENING_POLICY_VERSION;

function listOrNone(items: string[]): string {
  if (!items.length) return "(none stored)";
  return items.map((item) => `- ${item}`).join("\n");
}

function policyValue(
  snapshot: TenderScreeningPreferenceSnapshot,
  key: keyof TenderScreeningPreferenceSnapshot["policies"],
): string | null {
  return snapshot.policies[key] ?? null;
}

function deadlineRuleText(
  stored: string | null,
  kind: "expired" | "same-day",
): string {
  if (kind === "expired") {
    return stored
      ? `If the tender has already expired, apply the configured expired-tender rule: ${stored}.`
      : "If the tender has already expired, use NO_BID (Phase-1 status-priority default; no contrary database rule is stored).";
  }
  return stored
    ? `If closing date is the screening date, apply the configured same-day rule: ${stored}.`
    : "If closing date is the screening date, use NO_BID (Phase-1 status-priority default; no contrary database rule is stored).";
}

function otherPoliciesBlock(snapshot: TenderScreeningPreferenceSnapshot): string {
  const lines = configuredPolicyLines(snapshot.policies);
  if (!lines.length && !snapshot.customRules) return "";
  const custom =
    snapshot.customRules && Object.keys(snapshot.customRules).length
      ? `\n\nCUSTOM COMPANY RULES\n${Object.entries(snapshot.customRules)
          .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
          .join("\n")}`
      : "";
  if (!lines.length) return custom;
  return `

OTHER CURRENT SCREENING POLICIES
${lines.map((line) => `${line}`).join("\n")}${custom}`;
}

function preferredScopeInterpretation(
  snapshot: TenderScreeningPreferenceSnapshot,
): string {
  const itLike = hasSelectedScope(
    snapshot.preferredScopes,
    /information technology|software|system integration|mobile|website|application/i,
  );
  if (!itLike) {
    return `PREFERRED-SCOPE INTERPRETATION
Do not merely keyword-match the stored preferred-scope labels.
Treat a tender as in-scope only when the actual Excel evidence semantically
falls inside the currently selected preferred scopes above.
Do not treat unselected UI service-scope options as company preferences.`;
  }
  return `PREFERRED-SCOPE INTERPRETATION
Do not merely keyword-match the stored preferred-scope labels.
The following are interpretation examples only — they are NOT additional
company preferences. Consider them relevant only insofar as they semantically
fall inside the currently selected preferred scopes:

website / web portal; website redesign; web application;
mobile application; Android/iOS application; ERP; HRMS; payroll; CMS;
DMS / document management; MIS; dashboard; workflow application; e-office;
academic ERP; LMS / education systems; examination portal; e-counselling;
asset/property/land management systems; digital platforms; custom software;
application development; customization; implementation; software enhancement;
API/integration work; AI platform; chatbot; conversational AI;
relevant application AMC / O&M; digital marketing when software/portal led.

Do not treat unselected UI service-scope options as company preferences.`;
}

function excludedInterpretation(
  snapshot: TenderScreeningPreferenceSnapshot,
): string {
  const blocks: string[] = [];
  if (
    hasSelectedScope(snapshot.excludedScopes, /scanning|digitization|digitisation/i)
  ) {
    blocks.push(`SCANNING / DIGITIZATION
The current excluded scope includes Scanning / Digitization.
Excluded examples: document scanning; record scanning; physical file
digitization; archival scanning; physical-record conversion.
Potentially relevant (do not reject merely for the word "digital"):
digital transformation; software implementation; digital platform;
digitally enabled software system.`);
  }
  if (
    hasSelectedScope(
      snapshot.excludedScopes,
      /internet|connectivity|bandwidth|leased.?line/i,
    )
  ) {
    blocks.push(`INTERNET / CONNECTIVITY
The current excluded scope includes Internet / Connectivity Service.
Typical excluded examples: internet leased line; bandwidth; MPLS;
broadband; dark fibre; telecom circuit; point-to-point leased line;
connectivity provisioning.
Do not confuse application/cloud/software services with pure connectivity.`);
  }
  if (
    hasSelectedScope(snapshot.excludedScopes, /non-?it/i) ||
    snapshot.policies.nonIt
  ) {
    const policy = snapshot.policies.nonIt
      ? ` Apply the configured non-IT policy: ${snapshot.policies.nonIt}.`
      : "";
    blocks.push(`NON-IT INTERPRETATION
Where non-IT is currently excluded, treat clear operational/non-IT scopes
accordingly.${policy}
Examples that help interpret the configured exclusion: civil work;
construction; road work; water works; door-to-door collection;
transportation; housekeeping; physical meter reading; printing/distribution;
physical survey; equipment supply; facility-management work unrelated to
core IT; general non-IT consultancy.`);
  }
  return blocks.length ? `\n\n${blocks.join("\n\n")}` : "";
}

export function buildTenderScreeningPrompt(options: {
  companySnapshot: CompanyPreferenceSnapshot;
  runDate: string;
  sourceExcelName: string;
  inputRowCount: number;
}): string {
  const screening = toTenderScreeningPreferenceSnapshot(options.companySnapshot);
  const { companyName, financial, preferredScopes, excludedScopes } = screening;
  const maxEmd = formatNullableInr(financial.maxEmdInr);
  const minValue = formatNullableInr(financial.minTenderValueInr);
  const maxValue = formatNullableInr(financial.maxTenderValueInr);
  const sameDay = policyValue(screening, "sameDayDeadline");
  const expired = policyValue(screening, "expiredTender");
  const hardwareOnly = policyValue(screening, "hardwareOnly");
  const hardwareDominant = policyValue(screening, "hardwareDominant");
  const oem = policyValue(screening, "oemAuthorization");
  const partner = policyValue(screening, "partnerDependency");
  const consortium = policyValue(screening, "consortium");
  const jv = policyValue(screening, "jointVenture");
  const gisSoftware = policyValue(screening, "gisSoftware");
  const gisField = policyValue(screening, "gisFieldSurvey");
  const cyberOnly = policyValue(screening, "cybersecurityOnly");
  const cots = policyValue(screening, "cotsLicence");
  const renewal = policyValue(screening, "softwareRenewal");
  const oemAmc = policyValue(screening, "oemProductAmc");
  const manpowerOnly = policyValue(screening, "manpowerOnly");
  const manpowerHeavy = policyValue(screening, "manpowerHeavy");
  const genericTitle = policyValue(screening, "genericItTitle");
  const customSoftware = policyValue(screening, "customSoftware");
  const eoi = policyValue(screening, "eoi");
  const empanelment = policyValue(screening, "empanelment");

  return `SIYANA DAILY TENDER SCREENING

Company:
${companyName}

Run correlation ID: RUN-${options.runDate}

Attached workbook: ${options.sourceExcelName}

Expected unique tender rows: ${options.inputRowCount}

Phase-1 screening policy version: ${PHASE1_SCREENING_POLICY_VERSION}

================================================================
OPERATING BRIEF
================================================================

Follow this daily screening procedure. Wherever numeric limits, preferred
scopes, excluded scopes, or named policies appear below, the CURRENT COMPANY
BID PREFERENCES section is authoritative (loaded from the live company
database). Do not invent older static Siyana limits.

1. Read the supplied tender Excel file(s).

2. Reconcile awareness:
   - The application has already normalized and deduplicated the attached
     workbook for this run.
   - Do NOT delete, merge, or drop any supplied rows.
   - If prior Project analysis is available in this ChatGPT Project, you may
     note likely cross-day duplicates in Screening Reason, but every input
     Canonical ID / Tender ID must remain present exactly once in the main
     analysis sheet.

3. Show processing counts (in an optional Summary sheet and/or concise
   reasoning): input rows, preferred-fit candidates, VERIFY candidates,
   NO_BID counts by major gate/exclusion family.

4. Classify each supplied tender (add columns when helpful):
   - Tender Type
   - Primary Scope
   - Procurement Model
   - Dominant Scope

5. Hard gates (use live financial/date preferences):
   - Deadline today / already expired → NO_BID
     (unless a contrary deadline policy is stored below)
   - EMD above current Maximum EMD (${maxEmd}) → NO_BID
   - Tender value above current Maximum Tender Value (${maxValue}) → NO_BID
   - Disclosed value below a meaningful configured minimum (${minValue}) → NO_BID
     (a stored minimum of INR 0 is not a meaningful floor)

6. Exclusions / non-target dominant work (honour CURRENT excluded scopes and
   policies; illustrative families):
   - EOI${eoi ? ` (configured: ${eoi})` : ""}
   - Empanelment${empanelment ? ` (configured: ${empanelment})` : ""}
   - Scanning / digitization
   - Pure connectivity
   - Hardware-dominant delivery
   - Dedicated manpower / staffing supply
   - COTS / licence / subscription / product renewal
   - Specialist product AMC / OEM product AMC
   - Field / DGPS / drone survey
   - SCADA / industrial automation as dominant scope
   - Cybersecurity-only audit / VAPT / managed security-only
   - Partner / JV / OEM-heavy dependency where configured policy says so

7. Preferred fit (honour CURRENT preferred scopes; illustrative families):
   - Website / web portal
   - Mobile app
   - ERP / HRMS
   - CMS / DMS / MIS
   - Custom software
   - AI / chatbot
   - Relevant application AMC / O&M
   - Digital marketing when portal/software-led
   - LMS / education systems

8. Generic ambiguous IT title with no usable Excel scope → VERIFY
   (or the configured generic-IT-title policy below).

9. Manually audit all MAY_BID / WILL_BID and VERIFY candidates before
   finalizing. Preferred-scope keywords must not override a hard gate or a
   clearly excluded dominant scope.

10. Produce one XLSX workbook. Allowed sheets:
    - Summary (counts / gate tallies) — optional
    - Today's Analysis / main tenders sheet — REQUIRED
    - RFP Classification — optional helper sheet
    - Duplicates Removed — optional notes only; do not remove supplied rows
      from the main analysis sheet

11. The main analysis sheet must contain every supplied tender row
    (${options.inputRowCount} rows). The application already removed internal
    duplicates before attachment; treat the attached rows as the run universe.

================================================================
CURRENT COMPANY BID PREFERENCES
================================================================
These values were loaded from the application database at screening time.
The database is authoritative. Do not substitute other company rules.

FINANCIAL PREFERENCES

Maximum EMD:
${maxEmd}

Minimum Tender Value:
${minValue}

Maximum Tender Value:
${maxValue}

PREFERRED SERVICE SCOPE

${listOrNone(preferredScopes)}

EXCLUDED SCOPE

${listOrNone(excludedScopes)}${otherPoliciesBlock(screening)}

================================================================
SCREENING METHOD
================================================================

The attached workbook has already been normalized and deduplicated by
the application.

Do not remove rows.
Do not merge rows.
Do not perform another deduplication pass.
Evaluate exactly the supplied normalized rows.

Evaluate exactly all ${options.inputRowCount} rows.
Do not delete, merge, deduplicate or omit input rows.

PHASE-1 STATUS PRIORITY
Apply statuses in this order. A later attractive keyword must not override an
earlier hard failure.

1. Apply hard financial/date gates first.
   - Same-day / expired deadline → NO_BID
     (unless a contrary deadline policy is stored in CURRENT COMPANY BID
     PREFERENCES above)
   - EMD greater than the current company maximum → NO_BID
   - Tender value greater than the current company maximum → NO_BID
   A disclosed value below a meaningful configured minimum also → NO_BID.

2. Apply explicit excluded-scope rules from Tender Name + Tender Brief.
   If the title/brief clearly shows an excluded or non-target scope,
   return NO_BID immediately.
   DO NOT return VERIFY simply because the RFP/ATC has not been reviewed.

3. Apply the dominant-scope rule.
   Even if an IT/software word appears, classify NO_BID when the dominant
   procurement is hardware, OEM/COTS licensing, connectivity, survey,
   manpower, audit/compliance, infrastructure, SCADA/industrial automation,
   or other excluded work.

4. Use VERIFY only as a last resort when ALL of:
   - No hard financial/date gate failed; AND
   - No explicit excluded scope clearly applies; AND
   - No excluded dominant scope can be determined; AND
   - The tender cannot be confidently classified as preferred; AND
   - Detailed documents are genuinely required to know whether the scope fits.

HARD_GATE_FAILED => NO_BID. VERIFY is prohibited after a hard gate fails.
Preferred-scope keyword presence (ERP, software, AI, GIS, CMS, AMC, O&M)
does not override a clearly excluded dominant delivery model.

The application will deterministically override VERIFY to NO_BID when a
hard gate or excluded dominant scope already applies.

5. Use MAY_BID / WILL_BID only when the visible scope positively matches
   the preferred software/application scope and no exclusion dominates.
   (Phase-1 does not use the older master-prompt "GO" label.)

HARD-FILTER DECISION ORDER
1. Deadline / expiry
2. EMD
3. Tender value
4. Explicit excluded scope from Tender Name + Tender Brief
5. Dominant-scope / non-target work
6. Hardware/OEM/partner dependency
7. Product/licence vs custom development
8. Specialist-service/resource dependency
9. Preferred software/application fit
10. Assign Phase-1 status

Do not invent missing facts. Apply hard failures before softer scope analysis.

DEADLINE LOGIC
${deadlineRuleText(expired, "expired")}
${deadlineRuleText(sameDay, "same-day")}
If deadline is missing or ambiguous, do not invent it.

EMD LOGIC
If a disclosed EMD exceeds the current Maximum EMD (${maxEmd}), use NO_BID.
If EMD is zero, missing, "Refer to Documents", or not disclosed, do not
reject solely for that reason. Continue with excluded-scope and dominant-scope
analysis.

TENDER VALUE LOGIC
Disclosed value above the current maximum (${maxValue}) → NO_BID.
Disclosed value below the configured minimum (${minValue}) → NO_BID if a
meaningful minimum is configured (a stored minimum of INR 0 is not a
meaningful floor).
Zero/missing/"Refer Docs" value must NOT automatically be rejected.
Continue excluded-scope and dominant-scope analysis where value is unknown.

${preferredScopeInterpretation(screening)}

GENERIC IT TITLE RULE
Do not reject a tender merely because its title says:
"Hiring of Agency for IT Projects - Milestone Basis"
If the title itself reveals the actual software scope, assess that scope.
If the title is generic and actual scope is unavailable from the Excel,
use ${genericTitle ?? "VERIFY"} rather than inventing either relevance or
non-relevance.
${
  genericTitle
    ? `Configured generic-IT-title policy: ${genericTitle}.`
    : "No separate generic-IT-title policy is stored; default interpretation is VERIFY when the title is generic and Excel scope is unavailable."
}

HARDWARE INTERPRETATION
Do not reject merely because incidental hardware is mentioned.
Determine whether hardware/equipment procurement and deployment is the
dominant execution requirement. If it is, apply the dominant-scope rule and
use NO_BID when hardware is excluded or hardware-dominant policy is NO_BID.
Example: "AI CCTV deployment" must not look attractive because of "AI" if
execution is camera/hardware dominated.
Typical hardware-dominant indicators: server/storage supply; interactive
panels; CCTV/cameras; firewall appliances; UPS; network equipment;
data-centre equipment; industrial controllers; large surveillance deployment.
${hardwareOnly ? `Configured hardware-only policy: ${hardwareOnly}.` : "No hardware-only policy is stored; do not invent one."}
${hardwareDominant ? `Configured hardware-dominant policy: ${hardwareDominant}.` : "No hardware-dominant policy is stored; do not invent one."}
Also honour "Hardware Only" if it appears in the current excluded scopes.

OEM / PARTNER / JV INTERPRETATION
Distinguish normal third-party product integration from a tender whose
delivery materially depends on OEM authorization, a specialist hardware
partner, consortium, JV, subcontracting partner, or specialized external
capability.
${oem ? `OEM authorization policy: ${oem}.` : "No OEM-authorization policy is stored; do not assume the company will or will not obtain OEM authorization."}
${partner ? `Partner-dependency policy: ${partner}.` : ""}
${consortium ? `Consortium policy: ${consortium}.` : ""}
${jv ? `Joint-venture policy: ${jv}.` : ""}
Do not assume partnership appetite unless a current database policy says so.

GIS INTERPRETATION
GIS must NOT automatically be accepted or rejected.
Software-oriented GIS examples: GIS web application; GIS dashboard;
map-based software; GIS visualization; GIS/MIS platform; GIS system
integration.
Survey/resource-heavy GIS examples: DGPS survey; field survey; drone
survey; property survey; large mapping exercise; physical asset survey;
specialized surveying resources.
${gisSoftware ? `Configured GIS software/application policy: ${gisSoftware}.` : "No GIS-software policy is stored; do not invent one."}
${gisField ? `Configured GIS field-survey policy: ${gisField}.` : "No GIS field-survey policy is stored; do not invent one."}
If the exact GIS nature cannot be determined from Excel, use VERIFY.

CYBERSECURITY INTERPRETATION
Differentiate a security component inside a software implementation from a
cybersecurity-only professional service (VAPT-only, security audit,
ISO 27001 audit, SOC, SIEM, digital forensics, managed security).
${cyberOnly ? `Configured cybersecurity-only policy: ${cyberOnly}.` : "No cybersecurity-only policy is stored; do not invent one."}
Do NOT equate the word "cyber" with preferred IT scope automatically.

COTS / LICENCE / RENEWAL INTERPRETATION
Distinguish custom software development from product licence purchase,
subscription, licence renewal, OEM software AMC, or commercial
off-the-shelf product procurement.
COTS-style examples: ETABS; PSCAD; MongoDB Enterprise licence; Adobe;
Microsoft; AutoCAD; ArcGIS; commercial backup/security licences.
${customSoftware ? `Configured custom-software policy: ${customSoftware}.` : ""}
${cots ? `Configured COTS/licence policy: ${cots}.` : "No COTS/licence policy is stored; do not invent one."}
${renewal ? `Configured software-renewal/product-AMC policy: ${renewal}.` : ""}
${oemAmc ? `Configured OEM product AMC policy: ${oemAmc}.` : ""}
Do NOT automatically treat "software" as custom development.

MANPOWER INTERPRETATION
Distinguish a software project with reasonable project staffing from
dedicated manpower supply, computer-operator supply, data-entry manpower,
a large dedicated developer pool, or resource augmentation.
${manpowerOnly ? `Configured dedicated-manpower policy: ${manpowerOnly}.` : "No dedicated-manpower policy is stored; do not invent one."}
${manpowerHeavy ? `Configured manpower-heavy policy: ${manpowerHeavy}.` : ""}
If manpower intensity cannot be determined, use VERIFY.
${excludedInterpretation(screening)}

STATUSES
--------

Use exactly:
NO_BID
VERIFY
MAY_BID
WILL_BID

Do NOT use the older master-prompt GO status for Phase-1.

NO_BID
Use when available Excel evidence is sufficient to conclude that the tender
clearly fails a hard financial/date gate, an explicit excluded/non-target
scope in Tender Name or Tender Brief, or a dominant-scope exclusion.
Do not wait for RFP/ATC review once that evidence is already visible.

VERIFY
Use only when ALL of these are true:
- The title/brief is genuinely generic or ambiguous; AND
- No hard exclusion can be established from Tender Name, Tender Brief, or
  other visible Excel fields; AND
- Detailed documents are needed to know whether the scope fits.
Do NOT use VERIFY merely because the RFP/ATC has not been reviewed.
Do NOT use VERIFY when the title/brief already shows excluded or dominant
non-target work.

MAY_BID
Use only when the visible scope positively matches the preferred
software/application scope AND no exclusion dominates AND no hard
financial/date gate fails.
Absence of PQ/TQ/RFP details is normal at Phase-1 and is not a reason to
avoid MAY_BID.

WILL_BID
Use only when the visible scope is an unusually strong preferred-scope match,
all disclosed Phase-1 gates pass, and no exclusion dominates. Do not overuse
WILL_BID because detailed qualification still occurs later.

VERY IMPORTANT VERIFY VS MAY_BID RULE
Do not use VERIFY merely because detailed PQ/TQ eligibility information is
absent from a Phase-1 Excel.
Do not use VERIFY simply because the RFP/ATC has not been reviewed.
If the tender clearly matches preferred scope and all available Phase-1
financial/exclusion gates pass, use MAY_BID.
If Tender Name or Tender Brief already shows excluded or dominant non-target
scope, use NO_BID immediately.

MULTIPLE FAILURE RULE
If a tender violates more than one hard rule, include the most important
reasons. Example: NO_BID — EMD exceeds the current company maximum and the
primary scope is excluded scanning/digitization work.
Do not stop reasoning after the first keyword if another important hard
failure is also visible. Keep reasons concise.

DECISION REASON QUALITY
Every row must have a tender-specific reason.
Bad: "Not suitable."
Bad: "Out of scope."
Good: "Internet leased-line connectivity is the primary procurement and is
excluded under the current Internet / Connectivity Service preference."
Good: "CMS-based website design and development matches preferred software
scope; no visible Phase-1 hard filter fails, so proceed to detailed
qualification."

DO NOT INVENT QUALIFICATION DATA
Do not invent turnover requirement, experience years, project count, office
requirement, ISO requirements, manpower requirement, OEM requirement, MSME
exemption, or Startup exemption unless actually present in a supplied
workbook field. Phase-1 is not detailed RFP qualification.

OUTPUT CONTRACT
Preserve every existing source column on the main analysis sheet.
Add/update Screening Status and Screening Reason.
You may also add classification columns when useful:
Tender Type, Primary Scope, Procurement Model, Dominant Scope.
Optional sheets (Summary, RFP Classification, Duplicates Removed) are
allowed, but the main tenders analysis sheet remains mandatory and must
keep every input row.
Do not return only shortlisted rows.
Do not return prose instead of XLSX.
Return exactly one completed XLSX workbook.

ROW RECONCILIATION
The returned main analysis sheet must contain exactly ${options.inputRowCount} tender rows.
Every input Canonical ID / Tender ID must remain present exactly once.
Do not delete NO_BID rows. NO_BID remains part of the audit trail.
`;
}
