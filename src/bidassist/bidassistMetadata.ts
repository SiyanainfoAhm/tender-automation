import { openingDateFromIso } from "./bidassistConfig.js";
import {
  deriveBidassistIds,
  writeBidassistMetadata,
} from "./bidassistDownload.js";
import type { BidassistCardInfo, BidassistDocumentMeta } from "./bidassistTypes.js";
import type { Logger } from "../logger.js";

export { deriveBidassistIds, writeBidassistMetadata };

/** Normalize opening-date filter values for metadata (ISO when possible). */
export function resolveOpeningDateMeta(options: {
  fromDisplay: string;
  toDisplay: string | null;
  fromEnvRaw?: string;
}): { fromIso: string; toIso: string | null } {
  return {
    fromIso: openingDateFromIso(options.fromEnvRaw || options.fromDisplay),
    toIso: options.toDisplay
      ? openingDateFromIso(options.toDisplay)
      : null,
  };
}

export function buildMetadataPayload(options: {
  card: BidassistCardInfo;
  bidassistId: string;
  folderId: string;
  originalZipFile: string;
  documents: BidassistDocumentMeta[];
  openingDateFilterFrom: string;
  openingDateFilterTo: string | null;
  category: string;
  tenderFolder: string;
  logger: Logger;
}): ReturnType<typeof writeBidassistMetadata> {
  return writeBidassistMetadata(options);
}
