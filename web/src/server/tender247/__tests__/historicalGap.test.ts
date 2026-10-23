import { describe, expect, it } from "vitest";
import { classifyHistoricalGap, normalizeHistoricalFilename, type GapCanonical } from "@/server/tender247/historicalGap";

const source = (filename = "Notice Final.pdf", size: number | null = 10) => ({ documentid: "current-token", filename, size, contentType: "application/pdf" });
const canonical = (overrides: Partial<GapCanonical> = {}): GapCanonical => ({ id: "doc", tender_id: "tender", external_document_id: "legacy-token", file_name: "Notice_Final.pdf", mime_type: "application/pdf", file_size_bytes: 10, storage_url: "https://sharepoint/file", sharepoint_drive_item_id: "item", tender247TenderId: "t247", ...overrides });

describe("historical Tender247 gap classification", () => {
  it("normalizes safe filename substitutions conservatively", () => expect(normalizeHistoricalFilename(" Notice%20Final_file.pdf ")).toBe("notice final file.pdf"));
  it("confirms an exact metadata match", () => expect(classifyHistoricalGap(source(), [canonical()]).classification).toBe("CONFIRMED_EXISTING"));
  it("treats duplicate filenames as ambiguous", () => expect(classifyHistoricalGap(source(), [canonical(), canonical({ id: "doc-2" })]).classification).toBe("AMBIGUOUS"));
  it("identifies changed versions when same filename has a different size", () => expect(classifyHistoricalGap(source("Notice Final.pdf", 12), [canonical()]).classification).toBe("SOURCE_ONLY_CHANGED_VERSION"));
  it("uses probable rather than confirmed matching when size is unavailable", () => expect(classifyHistoricalGap(source("Notice Final.pdf", null), [canonical()]).classification).toBe("PROBABLE_EXISTING"));
  it("never promotes an identity mismatch to missing without independent proof", () => expect(classifyHistoricalGap(source("Other.pdf", 12), [canonical()]).classification).toBe("AMBIGUOUS"));
  it("only permits confirmed missing when an explicit independent proof is supplied", () => expect(classifyHistoricalGap(source("Other.bin", 12), [], true).classification).toBe("CONFIRMED_MISSING"));
});
