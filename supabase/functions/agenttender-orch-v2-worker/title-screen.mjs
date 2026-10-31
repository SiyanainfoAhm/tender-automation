// Title screen (2026-10-29): obvious non-fit tenders go straight to NO_GO from the listing title,
// with no AI call and no document processing. Mirrors the owner's manual clean-up rules.
// A title that mentions development / portal / website / app / implementation work is never
// decided here; it goes on to the quick screen.
export const TITLE_SCREEN_VERSION = "TITLE_SCREEN_20261031_1";

export const TITLE_RULES = [
  ["HARDWARE", /(all-in-one pc|\baio\b|desktop computer|desktop 280|amd ryzen|\blaptops?\b|notebook \(q|macbook|keyboard and mouse|storage area network|\bsan\) storage|server chassis|id card printer|ptz camera|dome camera|smart class equipment|gateways for pabx|patient calling unit|tripod turnstile|printer cartridge|a4 paper|false ceiling|video wall systems|variable message led|vc solution with|data acquisition module|signal generator|signal analy[sz]er|network analy[sz]er|curve tracer|auto titrator|genotyping system|magnetometer|hand held gps|gps (?:tracker|antenna|500)|gnss\)|survey rover receiver|prismatic compass|concrete test hammer|probing solution|spare parts|supply of materials|komatsu|hydraulic oil|airframe|multi role drone|abb ac800m|\bes50-)/i],
  ["SOFTWARE_LICENSE_SUBSCRIPTION_RENEWAL", /(microsoft office|\bms ?office\b|\bwindows? 11\b|antivirus|quick heal|office productivity suite|operating system software|red hat enterprise linux|power ?bi premium|microsoft planner|campus agreement|autocad|comsol|matlab|rhino \(version|nx software licen|nx design|grammarly|icdd database|cias licen|utp licen|burp suite|digital signature certificate|\(v3\) \(q2\)|software \(q2\)|software \(q3\)|studio 5000|abbyy|e-books|software licen[cs]e(?:s)? (?:for|renewal)|licen[cs]e renewal|subscription renewal|fortinet|firewall\b|email security solution|enterprise email solution)/i],
  ["PLC_SCADA_OT", /(\bplc\b|scada|substation automation|ring main unit|excitation control|connectorisation)/i],
  ["CCTV_GPS_CONTROL_ROOM", /(amc of integrated security and surveillance|cctv repair|cctv amc)/i],
  ["TELECOM_NETWORK_INFRASTRUCTURE", /(internet leased|leased[- ]line|internet facilit|bandwidth of|backup internet|landline and broadband|installatoin of network|installation of network|optical fib(?:er|re) (?:laying|cable))/i],
  ["CYBER_SECURITY", /(cyber security audit|security audit|security operation cent(?:er|re)|\bsoc\b for)/i],
  ["MANPOWER", /(hiring of professionals|providing resources|ctc ?\+ ?margin|supply of manpower|manpower (?:supply|services|outsourcing)|outsourcing of manpower|hiring of manpower|subject matter experts?;|skilled manpower|forward deployment agenc)/i],
  ["NON_IT_SERVICES", /(translation services|scanning and digiti[sz]ation|meter reading|aquifer|hydrogeolog|water supply scheme|surface water based|overhauling of|boiler|drone survey|gis related survey|site-related statutory|social media agency|record management service|records managemet|records management service|data recovery from|repair and overhauling|maintain computers, printers|pre-owned products|bulk sms|whatsapp services|whatspp|customer service cent(?:er|re)s?|coffee table book|anticipatory action|management consulting firm|tekla|structural detailing|bill distribution)/i],
  ["CONSTRUCTION_CIVIL", /(civil works?|construction of|building works|road works|esic hospital|wap\/c-c\/)/i],
  // 2026-10-31 owner clean-up of CONDITIONAL_GO list
  ["CLOUD_HOSTING_INFRA", /(virtual machine \(compute\)|public cloud;|cloud (?:vm|virtual machines?|hosting services?|infrastructure services?)|managed cloud service|object storage;|block storage;)/i],
  ["HARDWARE", /(smart class ?rooms?|virtual class ?rooms? (?:equipment|hardware)|interactive (?:flat )?panels?)/i],
  ["SOFTWARE_RESALE", /(api management \(apim\)|\bapim\b platform|application programming interface management|labview|\beda tools?\b|software package\b)/i],
];

// Words that mean the tender may be real software work: never decided by title.
const SOFTWARE_WORK = /(develop|portal|web ?site|web ?application|mobile app|\bapp\b|implementation of (?:a |an )?(?:software|system|erp|application)|customi[sz]ation|ai\/ml|machine learning|chatbot|\berp\b|\bcrm\b|\bhrms\b|\blms\b|learning management|workflow|dashboard|integration)/i;

// Patterns that are NO_GO even when the title mentions an app or development
// (the app/development is a tool for the excluded service, not the deliverable).
const STRONG_RULES = [
  ["NON_IT_SERVICES", /(meter reading through mobile app|bill distribution services)/i],
  // "development tools" / "development of GIS database" are supply or survey work, not software builds.
  ["SOFTWARE_RESALE", /(software licen[cs]es? and development tools|\beda tools?\b|\blabview\b)/i],
  ["GIS_SURVEY_PROCESSING", /(gis data ?base for (?:road|storm|drain|water|sewer|utility|property|land)|gis mapping of (?:road|storm|drain|utility|property))/i],
  ["MANPOWER", /(ctc ?\+ ?margin|forward deployment agenc)/i],
];

export function titleScreen(tender) {
  const title = String(tender?.title || "");
  if (!title.trim()) return null;
  for (const [code, pattern] of STRONG_RULES) {
    const m = title.match(pattern);
    if (m) return { decision: "NO_GO", rule_code: code, matched: m[0], version: TITLE_SCREEN_VERSION,
      reason: `NO_GO — title screen: ${code} ("${m[0]}") — not software development/IT services work.` };
  }
  if (SOFTWARE_WORK.test(title)) return null;
  for (const [code, pattern] of TITLE_RULES) {
    const m = title.match(pattern);
    if (m) return { decision: "NO_GO", rule_code: code, matched: m[0], version: TITLE_SCREEN_VERSION,
      reason: `NO_GO — title screen: ${code} ("${m[0]}") — not software development/IT services work.` };
  }
  return null;
}
