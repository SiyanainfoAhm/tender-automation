import {
  toTenderScreeningPreferenceSnapshot,
  type CompanyPreferenceSnapshot,
} from "./companyPreferences.js";
import {
  formatNullableInr,
  PHASE1_SCREENING_POLICY_VERSION,
  SCREENING_POLICY_FIELD_DEFS,
  type ScreeningPolicyKey,
  type TenderScreeningPreferenceSnapshot,
} from "./screeningPolicy.js";

export const PHASE1_SCREENING_PROMPT_VERSION = PHASE1_SCREENING_POLICY_VERSION;

function listOrNone(items: string[]): string {
  if (!items.length) return "(none stored)";
  return items.map((item) => `- ${item}`).join("\n");
}

function policyValue(
  snapshot: TenderScreeningPreferenceSnapshot,
  key: ScreeningPolicyKey,
): string | null {
  return snapshot.policies[key] ?? null;
}

/** Render a DB policy or an explicit not-supplied marker (never invent appetite). */
function optionalPolicy(
  ...parts: Array<string | null | undefined>
): string {
  const present = parts
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean);
  if (!present.length) return "(not supplied in database)";
  return present.join("; ");
}

function joinLabeled(
  entries: Array<{ label: string; value: string | null }>,
): string {
  const lines = entries
    .filter((entry) => entry.value)
    .map((entry) => `${entry.label}=${entry.value}`);
  return lines.length ? lines.join("; ") : "(not supplied in database)";
}

function otherDynamicPolicies(
  snapshot: TenderScreeningPreferenceSnapshot,
  alreadyShown: Set<ScreeningPolicyKey>,
): string {
  const leftover: string[] = [];
  for (const field of SCREENING_POLICY_FIELD_DEFS) {
    if (alreadyShown.has(field.key)) continue;
    const value = snapshot.policies[field.key];
    if (!value) continue;
    leftover.push(`${field.label}: ${value}`);
  }
  if (snapshot.customRules && Object.keys(snapshot.customRules).length) {
    for (const [key, value] of Object.entries(snapshot.customRules)) {
      leftover.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  if (!leftover.length) return "(none beyond the fields above)";
  return leftover.map((line) => `- ${line}`).join("\n");
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
  const eoi = policyValue(screening, "eoi");
  const empanelment = policyValue(screening, "empanelment");
  const cots = policyValue(screening, "cotsLicence");
  const productAmc = optionalPolicy(
    policyValue(screening, "softwareRenewal"),
    policyValue(screening, "oemProductAmc"),
  );
  const applicationAmc = policyValue(screening, "customSoftware");
  const manpower = joinLabeled([
    { label: "dedicated", value: policyValue(screening, "manpowerOnly") },
    { label: "heavy", value: policyValue(screening, "manpowerHeavy") },
  ]);
  const hardware = joinLabeled([
    { label: "only", value: policyValue(screening, "hardwareOnly") },
    { label: "dominant", value: policyValue(screening, "hardwareDominant") },
  ]);
  const gisSurvey = optionalPolicy(
    policyValue(screening, "gisFieldSurvey"),
    policyValue(screening, "gisSoftware")
      ? `GIS software/application=${policyValue(screening, "gisSoftware")}`
      : null,
  );
  const cyber = policyValue(screening, "cybersecurityOnly");
  const oem = policyValue(screening, "oemAuthorization");
  const partner = joinLabeled([
    { label: "partner", value: policyValue(screening, "partnerDependency") },
    { label: "consortium", value: policyValue(screening, "consortium") },
    { label: "jv", value: policyValue(screening, "jointVenture") },
  ]);

  const alreadyShown = new Set<ScreeningPolicyKey>([
    "sameDayDeadline",
    "eoi",
    "empanelment",
    "cotsLicence",
    "softwareRenewal",
    "oemProductAmc",
    "customSoftware",
    "manpowerOnly",
    "manpowerHeavy",
    "hardwareOnly",
    "hardwareDominant",
    "gisFieldSurvey",
    "gisSoftware",
    "cybersecurityOnly",
    "oemAuthorization",
    "partnerDependency",
    "consortium",
    "jointVenture",
  ]);

  const sameDayPolicyText = sameDay
    ? sameDay
    : "(not supplied in database — Phase-1 default: NO_BID for same-day closing)";
  const expiredNote = expired
    ? `Expired-tender policy from database: ${expired}.`
    : "Expired-tender policy: (not supplied in database — Phase-1 default: NO_BID).";

  const correlationId = `RUN-${options.runDate}`;

  return `SIYANA DAILY TENDER SCREENING

Company:
${companyName}

Maximum EMD:
${maxEmd}

Minimum Tender Value:
${minValue}

Maximum Tender Value:
${maxValue}

Preferred Scope:
${listOrNone(preferredScopes)}

Excluded Scope:
${listOrNone(excludedScopes)}

Run correlation ID:
${correlationId}

Attached workbook:
${options.sourceExcelName}

Expected unique tender rows:
${options.inputRowCount}

Phase-1 screening policy version:
${PHASE1_SCREENING_POLICY_VERSION}


================================================================
OPERATING BRIEF
================================================================

Follow this daily screening procedure.

Wherever numeric limits, preferred scopes, excluded scopes, or named
policies appear below, the CURRENT COMPANY BID PREFERENCES section is
authoritative and was loaded from the live company database.

Do not invent older static Siyana limits.
Do not replace current database values with remembered values.

1. Read the attached Tender247 export Excel file.

2. Reconcile awareness:
   - The attached workbook is the Tender247 daily export for this run
     (exact duplicates removed; column names normalized only).
   - No local company / NO_BID pre-filter was applied before this message.
   - Do NOT delete, merge, deduplicate, or drop any supplied rows.
   - Preserve every input row. Add Screening Status and Screening Reason only.
   - Every supplied Canonical ID / Tender ID must remain present exactly once.
   - If prior Project analysis is available, prior tender history may be used
     only as contextual/reference evidence.
   - Do not remove historical repeats from this workbook unless the current
     run explicitly requests historical repeat removal.

3. Evaluate every supplied tender row.

4. For every tender, first classify:
   - Tender Type
   - Primary Scope
   - Procurement Model
   - Dominant Scope
   - Mandatory Classification Flags

5. Apply hard gates before attractive IT/software interpretation.

6. Apply explicit excluded scopes and dominant-delivery exclusions.

7. Only after exclusions are cleared, evaluate preferred service scope.

8. Use VERIFY only for genuine ambiguity.

9. Manually audit all MAY_BID, WILL_BID and VERIFY candidates before
   finalizing.

10. Produce one completed XLSX workbook.

11. The main analysis sheet must contain every supplied tender row exactly
    once.


================================================================
CURRENT COMPANY BID PREFERENCES
================================================================

These values were loaded from the application database at screening time.

The database is authoritative.

Do not substitute other company rules.


FINANCIAL PREFERENCES

Maximum EMD:
${maxEmd}

Minimum Tender Value:
${minValue}

Maximum Tender Value:
${maxValue}

Same-day deadline policy:
${sameDayPolicyText}

${expiredNote}


Preferred Scope:

${listOrNone(preferredScopes)}


Excluded Scope:

${listOrNone(excludedScopes)}


OPTIONAL DELIVERY-MODEL POLICIES

Use these only when supplied by the database.

If a policy is not supplied:
- do not invent company appetite;
- still classify the tender correctly;
- use VERIFY only when the missing policy genuinely prevents a reliable
  final decision.

EOI policy:
${optionalPolicy(eoi)}

Empanelment policy:
${optionalPolicy(empanelment)}

COTS / Licence / Subscription policy:
${optionalPolicy(cots)}

Product-specific Software AMC policy:
${productAmc}

Custom Application / Website AMC policy:
${optionalPolicy(applicationAmc)}

API / SaaS Subscription policy:
(not supplied in database)

Dedicated Manpower / Resource Augmentation policy:
${manpower}

Hardware-dominant Work policy:
${hardware}

Internet / Network / Telecom policy:
(not supplied in database)

GIS Field / DGPS / Drone Survey policy:
${gisSurvey}

Cybersecurity-only / Audit / VAPT policy:
${optionalPolicy(cyber)}

Industrial Automation / SCADA / PLC policy:
(not supplied in database)

OEM-dependent Bid policy:
${optionalPolicy(oem)}

Partner / JV / Consortium policy:
${partner}

Other Current Policies:
${otherDynamicPolicies(screening, alreadyShown)}


================================================================
SCREENING METHOD
================================================================

The attached workbook is the Tender247 daily export for this run
(exact duplicates removed; column names normalized only).

No local company / NO_BID pre-filter was applied before this message.

Do not remove rows.
Do not merge rows.
Do not perform another deduplication pass.
Evaluate exactly the supplied Tender247 rows.

Evaluate exactly all supplied rows.
Do not delete, merge, deduplicate or omit input rows.


================================================================
PHASE-1 STATUS PRIORITY
================================================================

Apply statuses in this strict order.

A later attractive keyword must NOT override an earlier hard failure,
explicit exclusion, or excluded dominant delivery model.


1. HARD FINANCIAL / DATE GATES

Apply first.

- Same-day deadline → NO_BID
  unless the current company policy explicitly allows same-day bids.

- Expired deadline → NO_BID.

- EMD greater than current Maximum EMD → NO_BID.

- Tender Value greater than current Maximum Tender Value → NO_BID.

- Tender Value below a meaningful configured minimum → NO_BID.

A stored minimum of zero is not a meaningful floor.


2. EXPLICIT EXCLUDED TENDER TYPE / SCOPE

Evaluate Tender Name + Tender Brief + visible source fields.

If visible evidence clearly establishes an excluded tender type or scope,
return NO_BID.

Do NOT use VERIFY merely because the RFP/ATC has not been reviewed.


3. DOMINANT PROCUREMENT / DELIVERY MODEL

Determine what the buyer is actually purchasing.

Even if preferred IT/software terminology appears, return NO_BID when the
dominant procurement model is excluded under CURRENT COMPANY BID PREFERENCES.

Examples of possible dominant models:

- hardware/equipment procurement;
- OEM/COTS licence/product procurement;
- product-specific AMC;
- connectivity/telecom;
- field survey/mapping;
- manpower/resource augmentation;
- cybersecurity-only service;
- audit/compliance consultancy;
- industrial automation/SCADA/PLC;
- non-IT operational work;
- specialist partner/JV/OEM-dependent delivery.


4. PREFERRED SCOPE

Only after Steps 1–3 pass, evaluate whether the actual delivery matches
CURRENT PREFERRED SERVICE SCOPE.


5. VERIFY

Use VERIFY only when all of the following are true:

- no hard financial/date gate failed;
- no explicit excluded scope is established;
- no excluded dominant procurement model is established;
- preferred scope cannot be confidently established or rejected;
- available Excel evidence is genuinely insufficient;
- detailed documents are actually required to determine fit.

Do NOT use VERIFY merely because:
- PQ/TQ details are absent;
- the RFP/ATC is not attached;
- eligibility criteria are unknown.


================================================================
HARD-FILTER DECISION ORDER
================================================================

Apply exactly in this order:

1. Deadline / expiry
2. EMD
3. Tender value
4. Tender type
5. Explicit excluded scope
6. Dominant procurement / delivery model
7. Hardware / infrastructure dependency
8. OEM / partner / JV dependency
9. COTS / product / licence / subscription
10. Manpower / specialist resource dependency
11. Network / connectivity
12. GIS / field-survey dependency
13. Cybersecurity-only dependency
14. Industrial automation / SCADA / PLC dependency
15. Preferred software/application fit
16. Final Phase-1 status


================================================================
MANDATORY CLASSIFICATION
================================================================

BEFORE assigning a final status, classify EVERY tender.

The following fields must be internally determined for every row.

Tender Type:
- TENDER
- RFP
- RFQ
- EOI
- EMPANELMENT
- OTHER

Primary Scope:
Examples:
- WEBSITE_PORTAL
- MOBILE_APPLICATION
- ERP_HRMS_BUSINESS_APP
- SOFTWARE_IT_GENERAL
- AI_CHATBOT_ANALYTICS
- GIS_APPLICATION
- GIS_FIELD_SURVEY
- CYBERSECURITY
- NETWORK_TELECOM
- HARDWARE_INFRASTRUCTURE
- EDUCATION_LMS_EXAMINATION
- DATABASE_DATA_PLATFORM
- DIGITAL_MARKETING
- INDUSTRIAL_AUTOMATION
- NON_IT_OTHER

Procurement Model:
Examples:
- CUSTOM_DEVELOPMENT
- SOFTWARE_IMPLEMENTATION
- APPLICATION_AMC
- PRODUCT_SPECIFIC_AMC
- COTS_LICENSE
- SAAS_API_SUBSCRIPTION
- HARDWARE_SUPPLY
- HARDWARE_DOMINANT_MIXED
- DEDICATED_MANPOWER
- RESOURCE_AUGMENTATION
- MANAGED_SERVICE_OM
- CONSULTANCY_AUDIT
- FIELD_SURVEY_MAPPING
- NETWORK_CONNECTIVITY
- CYBERSECURITY_SERVICE
- INDUSTRIAL_AUTOMATION
- OEM_DEPENDENT
- PARTNER_JV_DEPENDENT
- OTHER_UNCLEAR

Dominant Scope:
Describe the dominant delivery model in one short phrase.


================================================================
MANDATORY CLASSIFICATION FLAGS
================================================================

For EVERY tender determine:

Hard Gate Failed:
YES / NO

EOI:
YES / NO

Empanelment:
YES / NO

Scanning / Digitization:
YES / NO

Data Entry:
YES / NO

Dedicated Manpower:
YES / NO

Resource Augmentation:
YES / NO

COTS / Product / Licence:
YES / NO

Product-specific AMC:
YES / NO

API / SaaS Subscription:
YES / NO

Hardware Dominant:
YES / NO

Network / Connectivity:
YES / NO

GIS Field Survey:
YES / NO

Cybersecurity Only:
YES / NO

Industrial Automation / SCADA:
YES / NO

OEM Dependency:
YES / NO

Partner / JV Dependency:
YES / NO

Non-IT Dominant:
YES / NO

Preferred Scope Match:
YES / NO / UNCLEAR

Classification Confidence:
HIGH / MEDIUM / LOW


================================================================
FINAL STATUS CONSISTENCY RULE
================================================================

The final status MUST be logically consistent with the classification.

The model must NOT produce a positive status that contradicts its own
classification/reason.


IF:

Hard Gate Failed = YES
→ NO_BID


IF:

A category explicitly excluded by CURRENT COMPANY BID PREFERENCES = YES
→ NO_BID


IF:

Dominant procurement/delivery model is explicitly disallowed by current
company policy
→ NO_BID


IF:

Preferred Scope Match = YES
AND no hard failure applies
AND no explicit exclusion applies
AND no excluded dominant model applies
AND classification confidence is HIGH or MEDIUM
→ MAY_BID or WILL_BID


IF:

No exclusion is established
AND classification is genuinely ambiguous
→ VERIFY


A Screening Reason containing conclusions such as:

- "excluded"
- "hardware dominated"
- "manpower dominated"
- "resource augmentation"
- "COTS/product procurement"
- "product-specific AMC"
- "connectivity dominated"
- "survey dominated"
- "industrial automation"
- "cybersecurity-only"
- "non-IT dominant"
- "partner/JV dependent"

MUST NOT be paired with:

MAY_BID
or
WILL_BID


If such contradiction occurs, correct the status before finalizing.


================================================================
DEADLINE LOGIC
================================================================

If the tender has already expired:
→ NO_BID.

If closing date equals screening date:
→ NO_BID
unless current policy explicitly allows same-day bids.

If deadline is missing or ambiguous:
do not invent it.

Continue other screening checks.


================================================================
EMD LOGIC
================================================================

If disclosed EMD exceeds current Maximum EMD:
→ NO_BID.

If EMD is:
- zero;
- missing;
- "Refer to Documents";
- not disclosed;

do NOT reject solely for that reason.

Continue screening.


================================================================
TENDER VALUE LOGIC
================================================================

If disclosed value exceeds current Maximum Tender Value:
→ NO_BID.

If disclosed value falls below a meaningful configured minimum:
→ NO_BID.

A minimum of INR 0 is not a meaningful floor.

If value is:
- zero;
- missing;
- "Refer Docs";
- not disclosed;

do NOT automatically reject.

Continue screening.


================================================================
PREFERRED-SCOPE INTERPRETATION
================================================================

Do not merely keyword-match preferred-scope labels.

Interpret the actual work being procured.

Examples of potentially preferred work, only where supported by CURRENT
PREFERRED SERVICE SCOPE:

- website development;
- website redesign;
- web portal;
- web application;
- mobile application;
- Android/iOS application;
- ERP;
- HRMS;
- payroll;
- CMS;
- DMS/document management;
- MIS;
- dashboard;
- workflow application;
- e-office;
- academic ERP;
- LMS;
- education portal;
- examination portal;
- e-counselling;
- digital platform;
- custom software development;
- application development;
- software implementation;
- customization;
- enhancement;
- API integration;
- system integration;
- AI platform;
- chatbot;
- conversational AI;
- relevant application AMC;
- relevant application O&M.

Do not treat unselected service-scope options as preferences.


================================================================
GENERIC IT TITLE RULE
================================================================

Do not reject a tender merely because its title says:

"Hiring of Agency for IT Projects - Milestone Basis"

If the title/brief reveals actual software scope:
evaluate the revealed scope.

If actual scope remains unavailable/generic:
→ VERIFY.

Do not invent either relevance or non-relevance.


================================================================
HARDWARE INTERPRETATION
================================================================

Do not reject merely because incidental hardware is mentioned.

Determine whether hardware/equipment procurement, installation or
maintenance is DOMINANT.

Typical hardware-dominant indicators:

- server/storage supply;
- firewall appliances;
- routers/switches;
- CCTV/cameras;
- interactive panels;
- UPS;
- workstation procurement;
- smart-class hardware;
- surveillance equipment;
- industrial controllers;
- physical security devices;
- data-centre equipment.

If hardware is dominant AND current company policy excludes such delivery:
→ NO_BID.

If hardware is only incidental to a substantial custom software project:
continue evaluating the software scope.


================================================================
COTS / LICENCE / PRODUCT INTERPRETATION
================================================================

Distinguish:

CUSTOM SOFTWARE
from
COMMERCIAL PRODUCT PROCUREMENT.

COTS/product indicators include:

- licence purchase;
- licence renewal;
- subscription;
- commercial software;
- product upgrade;
- named proprietary software;
- OEM product;
- commercial tool suite;
- pre-owned product AMC;
- proprietary software support.

Examples may include:
- ETABS
- PSCAD
- ArcGIS
- AutoCAD
- Adobe
- Microsoft licences
- MongoDB Enterprise
- NX
- commercial security software
- specialized engineering tools

Do NOT automatically treat the word "software" as custom development.

If COTS/product procurement is explicitly excluded by CURRENT COMPANY
BID PREFERENCES:
→ NO_BID.

If no current COTS policy is supplied:
classify accurately and use VERIFY only if company appetite cannot be
determined.


================================================================
APPLICATION AMC VS PRODUCT AMC
================================================================

This distinction is mandatory.

APPLICATION AMC examples:
- maintenance of an existing custom website;
- maintenance of a custom web portal;
- maintenance/support of a custom business application;
- website redesign + maintenance;
- application enhancement/support.

PRODUCT AMC examples:
- proprietary software AMC;
- OEM product AMC;
- commercial software support;
- pre-owned software product AMC;
- named specialist software AMC.

Do not classify Product AMC as Application AMC merely because the tender
contains the word "software".


================================================================
MANPOWER INTERPRETATION
================================================================

Distinguish:

SOFTWARE PROJECT
from
DEDICATED RESOURCE PROCUREMENT.

Dedicated manpower/resource augmentation indicators:

- hiring developers;
- hiring web developers;
- hiring application developers;
- hiring database professionals;
- manpower supply;
- operator supply;
- staffing;
- person-month procurement;
- dedicated resource pool;
- resource augmentation;
- technical manpower;
- data-entry manpower.

A tender titled:

"Hiring of Professionals for Application Development"

may still be MANPOWER procurement rather than a software-development project.

Classify based on what the buyer is purchasing.

If dedicated manpower/resource augmentation is excluded by current company
policy:
→ NO_BID.


================================================================
NETWORK / CONNECTIVITY INTERPRETATION
================================================================

Typical network/connectivity scopes:

- internet leased line;
- bandwidth;
- MPLS;
- broadband;
- dark fibre;
- telecom circuits;
- private 5G;
- WAN connectivity;
- network infrastructure;
- connectivity provisioning;
- SMS/messaging gateway service when primarily communication-service based.

Do not confuse application/cloud work with pure connectivity.

If the dominant procurement is connectivity/network service and current
policy excludes it:
→ NO_BID.


================================================================
GIS INTERPRETATION
================================================================

GIS must not automatically be accepted or rejected.

Software-oriented GIS:
- GIS web application;
- GIS dashboard;
- map-based software;
- GIS portal;
- GIS/MIS platform;
- GIS visualization;
- GIS system integration.

Survey-oriented GIS:
- DGPS survey;
- drone survey;
- physical asset survey;
- property survey;
- land survey;
- pipeline mapping survey;
- total-station survey;
- field mapping;
- large physical survey exercise.

Classify the delivery model first.

If GIS field survey is excluded under CURRENT COMPANY BID PREFERENCES:
→ NO_BID.


================================================================
CYBERSECURITY INTERPRETATION
================================================================

Differentiate:

SECURITY COMPONENT WITHIN SOFTWARE PROJECT

from

CYBERSECURITY-ONLY PROCUREMENT.

Cybersecurity-only examples:

- VAPT-only;
- security audit;
- ISO 27001 audit;
- SOC;
- SIEM;
- EDR/EPP product;
- deception technology;
- digital forensics;
- security compliance consultancy;
- DPDP compliance consultancy;
- security product procurement.

Do NOT equate "cyber" with general preferred IT scope.

If cybersecurity-only work is excluded under CURRENT COMPANY BID PREFERENCES:
→ NO_BID.


================================================================
INDUSTRIAL AUTOMATION INTERPRETATION
================================================================

Identify industrial/physical automation separately from normal software.

Examples:

- SCADA;
- PLC;
- DCS;
- substation automation;
- plant automation;
- water-treatment automation;
- gate automation;
- electrical automation;
- industrial controller AMC;
- process-control automation.

A software interface does not automatically make such work a preferred
software project.

If industrial automation is excluded by CURRENT COMPANY BID PREFERENCES:
→ NO_BID.


================================================================
OEM / PARTNER / JV INTERPRETATION
================================================================

Distinguish:

normal third-party integration

from

a tender materially dependent on:

- mandatory OEM authorization;
- specialist hardware partner;
- pre-bid teaming;
- consortium;
- JV;
- subcontractor;
- backend partner;
- certified product partner;
- specialized external delivery capability.

If current company policy disallows that dependency:
→ NO_BID.

If no policy is supplied:
do not invent partnership appetite.


================================================================
SCANNING / DIGITIZATION
================================================================

Excluded scanning/digitization examples:

- document scanning;
- record scanning;
- file digitization;
- archival scanning;
- physical-record conversion;
- scanning manpower.

Do NOT reject merely because the tender contains:
- digital transformation;
- digital platform;
- digital application;
- digitized workflow.

Judge the actual work.


================================================================
NON-IT INTERPRETATION
================================================================

Where NON-IT is excluded, typical non-target work includes:

- civil construction;
- road work;
- water work;
- physical transportation;
- housekeeping;
- physical meter reading;
- printing/distribution;
- physical survey;
- equipment-only supply;
- general operational services;
- non-IT consultancy;
- training/event work unrelated to software implementation;
- mechanical/electrical maintenance.


================================================================
VERIFY VS MAY_BID RULE
================================================================

VERIFY is not the default.

Use VERIFY only for genuine ambiguity.

Do NOT use VERIFY merely because:
- the RFP has not been reviewed;
- PQ details are absent;
- turnover is unknown;
- experience requirements are unknown;
- ISO criteria are unknown.

Phase-1 is scope screening.

If:

Preferred Scope Match = YES
AND all visible financial gates pass
AND no excluded scope/delivery model applies
→ MAY_BID.

If the tender is an unusually strong visible match:
→ WILL_BID.

If visible evidence clearly establishes exclusion:
→ NO_BID.


================================================================
WILL_BID INTERPRETATION
================================================================

Use WILL_BID sparingly.

WILL_BID is appropriate only when:

- preferred scope match is exceptionally strong;
- scope is clearly visible;
- delivery model is clearly acceptable;
- no hard gate fails;
- no exclusion applies;
- no major dependency ambiguity exists.

Otherwise use MAY_BID for good Phase-1 candidates.


================================================================
MULTIPLE FAILURE RULE
================================================================

If more than one hard/exclusion rule fails, include the most important
reasons.

Example:

NO_BID —
Tender value exceeds current maximum and the dominant work is
scanning/digitization.

Do not stop at the first keyword if another important failure is also visible.

Keep reasons concise.


================================================================
DECISION REASON QUALITY
================================================================

Every row must have a tender-specific reason.

Bad:
"Not suitable."

Bad:
"Out of scope."

Bad:
"IT tender."

Good:
"Dedicated web-developer resources are being hired on a staffing basis;
resource augmentation is the dominant procurement model and is excluded."

Good:
"NX CAD/CAM software-bundle maintenance is proprietary product support,
not custom application AMC."

Good:
"CMS-based website redesign and development matches preferred website
scope; no visible Phase-1 hard filter fails."

Good:
"GIS terminology is present, but the dominant work is a multi-location
physical asset survey; field-survey-heavy work is excluded."


================================================================
DO NOT INVENT QUALIFICATION DATA
================================================================

Do not invent:

- turnover;
- experience years;
- project count;
- office requirement;
- ISO requirement;
- manpower requirement;
- OEM requirement;
- MSME exemption;
- Startup exemption;
- eligibility requirement;

unless actually present in supplied Excel fields.

Phase-1 is not detailed PQ/TQ qualification.


================================================================
MANDATORY POSITIVE-CANDIDATE AUDIT
================================================================

Before finalizing, re-read EVERY:

VERIFY
MAY_BID
WILL_BID

candidate.

For each candidate ask:

1. Is this actually dedicated manpower?
2. Is this actually COTS/product/licence/subscription?
3. Is this product-specific AMC rather than custom application AMC?
4. Is hardware/equipment dominant?
5. Is network/connectivity dominant?
6. Is GIS actually field-survey work?
7. Is this industrial automation/SCADA/PLC?
8. Is this cybersecurity/compliance-only?
9. Is this consultancy/training/non-core work?
10. Does delivery depend on OEM/partner/JV capability?
11. Does the status contradict the Screening Reason?

Correct false positives before returning the workbook.


================================================================
FINAL VALIDATION
================================================================

Before returning:

1. Verify every supplied input row remains exactly once.

2. Verify total main-sheet rows = ${options.inputRowCount}.

3. Verify no row was silently removed.

4. Verify hard-gate failures are NO_BID.

5. Verify explicit exclusions are NO_BID where company policy requires.

6. Verify no Screening Reason says "excluded" while status is
   MAY_BID or WILL_BID.

7. Verify all VERIFY rows are genuinely ambiguous.

8. Verify all MAY_BID/WILL_BID rows have positive preferred-scope evidence.

9. Verify status counts sum to total tender rows.

10. Verify no invented facts appear in reasons.


================================================================
STRICT PHASE-1 STATUS CONTRACT
================================================================

IMPORTANT:

This is ONLY Phase-1 tender screening.

Do NOT perform final tender qualification.
Do NOT decide commercial bidding approval.
Do NOT generate GO / NO_GO style decisions.

The only allowed output statuses are:

NO_BID
VERIFY
MAY_BID
WILL_BID


FORBIDDEN OUTPUT STATUSES:

GO
NO_GO
CONDITIONAL_GO
PARTNER_BID
REJECTED
QUALIFIED
DISQUALIFIED


If the tender requires:
- partner,
- JV,
- consortium,
- OEM support,
- subcontractor,
- additional verification,
- missing eligibility information,

DO NOT create a partner decision.

Instead:

If the scope itself is unsuitable:
→ NO_BID

If scope cannot be decided from Excel evidence:
→ VERIFY

If scope matches but needs normal detailed qualification later:
→ MAY_BID


================================================================
CONDITIONAL_GO HANDLING
================================================================

The concept of CONDITIONAL_GO does not exist in this Phase-1 screening.

Never output CONDITIONAL_GO.

Examples:

Wrong:

Status:
CONDITIONAL_GO

Reason:
"Need OEM partner"


Correct:

Status:
VERIFY

Reason:
"Visible scope appears relevant, but OEM dependency and delivery responsibility cannot be determined from supplied Excel fields."


OR:


Status:
NO_BID

Reason:
"OEM-dependent hardware procurement is dominant and excluded under current company preferences."


================================================================
PARTNER/JV HANDLING
================================================================

Partner/JV dependency is only a classification factor.

It is NOT a final status.

Never output:

PARTNER_BID


Decision:

If partner dependency makes the tender unsuitable:
→ NO_BID

If partner dependency cannot be determined:
→ VERIFY

If normal integration work is visible:
→ MAY_BID/WILL_BID


================================================================
STATUSES
================================================================

Use exactly:

NO_BID
VERIFY
MAY_BID
WILL_BID

Do NOT use:

NO_GO
GO
CONDITIONAL_GO
PARTNER_BID
REJECTED
QUALIFIED
DISQUALIFIED


NO_BID

Use when visible Excel evidence establishes:
- hard financial/date failure;
- explicit excluded tender type;
- excluded scope;
- excluded dominant procurement model;
- excluded dependency.


VERIFY

Use only for genuine scope/delivery ambiguity where no exclusion can
already be established.


MAY_BID

Use when:
- visible scope positively matches preferred scope;
- no hard gate fails;
- no explicit/dominant exclusion applies.


WILL_BID

Use sparingly for exceptionally strong Phase-1 matches.


================================================================
FINAL RESPONSE VALIDATION
================================================================

Before generating / returning the XLSX:

Scan every Screening Status cell.

Allowed:

NO_BID
VERIFY
MAY_BID
WILL_BID

If any cell contains:

GO
NO_GO
CONDITIONAL_GO
PARTNER_BID
REJECTED
QUALIFIED
DISQUALIFIED

replace it before returning the workbook:

- GO → WILL_BID
- NO_GO / REJECTED / DISQUALIFIED → NO_BID
- CONDITIONAL_GO / QUALIFIED → MAY_BID
- PARTNER_BID → VERIFY (or NO_BID if partner/OEM dependency makes the tender unsuitable)

The workbook is invalid if any forbidden status remains.


================================================================
OUTPUT CONTRACT
================================================================

Preserve every existing source column on the main analysis sheet.

Add/update:

- Screening Status
- Screening Reason

Recommended additional classification columns:

- Tender Type
- Primary Scope
- Procurement Model
- Dominant Scope
- Classification Confidence

Optional helper sheets:

- Summary
- RFP Classification
- Screening Audit

Do not return only shortlisted rows.

Do not delete NO_BID rows.

Do not return prose instead of XLSX.

Return exactly one completed XLSX workbook.

Mandatory classification flags are internal reasoning fields only. Do not add them as columns to the returned Excel unless explicitly requested.


================================================================
ROW RECONCILIATION
================================================================

The returned main analysis sheet must contain exactly:

${options.inputRowCount}

tender rows.

Every input Canonical ID / Tender ID must remain present exactly once.

NO_BID rows remain part of the audit trail.
`;
}
