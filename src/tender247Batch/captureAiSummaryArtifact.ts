import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import { clickAndSaveDownload } from "../tenderDetails/downloadHelpers.js";
import { isValidArtifact } from "./resumeArtifacts.js";
import { isPdfMagic, writeTextPdf } from "./simplePdf.js";
import { verifyCurrentTenderId } from "./verifyCurrentTenderId.js";

export type AiSummaryCaptureMethod = "NATIVE_DOWNLOAD" | "DOM_PDF" | "UNAVAILABLE";

export type AiSummaryCaptureResult = {
  attempted: boolean;
  available: boolean;
  status: "complete" | "unavailable" | "failed";
  method: AiSummaryCaptureMethod;
  path: string | null;
  size: number;
  sectionFound: boolean;
  scrollContainerFound: boolean;
};

type ScrollMetrics = {
  found: boolean;
  scrollHeight: number;
  clientHeight: number;
};

const AI_HEADING = /AI\s*Generated\s*Tender\s*Summary/i;

export async function locateAiSummarySection(page: Page): Promise<Locator | null> {
  const heading = page.getByText(AI_HEADING).first();
  if ((await heading.count().catch(() => 0)) === 0) {
    return null;
  }
  await heading.scrollIntoViewIfNeeded().catch(() => undefined);
  const section = heading
    .locator(
      "xpath=ancestor::*[self::div or self::section or self::article or self::aside][position()<=8][1]",
    )
    .first();
  if ((await section.count().catch(() => 0)) === 0) {
    return heading.locator("xpath=ancestor::*[1]").first();
  }
  return section;
}

export async function inspectAiSummaryScrollContainer(
  section: Locator,
): Promise<ScrollMetrics> {
  return section.evaluate((root) => {
    const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
    let best: { scrollHeight: number; clientHeight: number } | null = null;
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      if (node.scrollHeight > node.clientHeight + 4) {
        if (
          !best ||
          node.scrollHeight - node.clientHeight >
            best.scrollHeight - best.clientHeight
        ) {
          best = {
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
          };
        }
      }
    }
    if (!best) {
      return { found: false, scrollHeight: 0, clientHeight: 0 };
    }
    return {
      found: true,
      scrollHeight: best.scrollHeight,
      clientHeight: best.clientHeight,
    };
  });
}

export async function scrollAiSummaryInnerContainer(
  section: Locator,
  logger?: { info: (msg: string) => void },
): Promise<void> {
  const metrics = await section.evaluate(async (root) => {
    const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
    let scroller: HTMLElement | null = null;
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      if (node.scrollHeight > node.clientHeight + 4) {
        if (
          !scroller ||
          node.scrollHeight - node.clientHeight >
            scroller.scrollHeight - scroller.clientHeight
        ) {
          scroller = node;
        }
      }
    }
    if (!scroller) {
      return { found: false, scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
    }
    scroller.scrollTop = 0;
    let lastHeight = -1;
    let stable = 0;
    for (let i = 0; i < 40; i += 1) {
      const step = Math.max(40, Math.floor(scroller.clientHeight * 0.8));
      scroller.scrollTop = Math.min(
        scroller.scrollTop + step,
        scroller.scrollHeight,
      );
      await new Promise((r) => setTimeout(r, 50));
      if (scroller.scrollHeight === lastHeight) stable += 1;
      else stable = 0;
      lastHeight = scroller.scrollHeight;
      if (
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 &&
        stable >= 2
      ) {
        break;
      }
    }
    return {
      found: true,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    };
  });
  if (metrics.found) {
    logger?.info(`T247_AI_SUMMARY_SCROLL_TOP=${metrics.scrollTop}`);
    logger?.info(`T247_AI_SUMMARY_SCROLL_HEIGHT=${metrics.scrollHeight}`);
    logger?.info(`T247_AI_SUMMARY_CLIENT_HEIGHT=${metrics.clientHeight}`);
    logger?.info("T247_AI_SUMMARY_SCROLL_COMPLETE=true");
  }
}

export async function extractAiSummaryFullText(
  section: Locator,
  logger?: { info: (msg: string) => void },
): Promise<string> {
  const summaryText = await readActivePanelText(section, logger);
  const bidText = await readTabText(section, /Bid\s*[\/\-]\s*No\s*Bid/i, logger);
  const parts: string[] = [];
  if (summaryText.trim()) {
    parts.push("Summary", summaryText.trim());
  }
  if (bidText.trim() && bidText.trim() !== summaryText.trim()) {
    parts.push("Bid / No Bid Decision", bidText.trim());
  }
  if (parts.length === 0) {
    await scrollAiSummaryInnerContainer(section, logger);
    const fallback =
      (await section.innerText().catch(() => "")) ||
      (await section.textContent().catch(() => "")) ||
      "";
    return fallback.trim();
  }
  return parts.join("\n\n");
}

async function readActivePanelText(
  section: Locator,
  logger?: { info: (msg: string) => void },
): Promise<string> {
  await clickSectionTab(section, /^Summary$/i);
  await scrollAiSummaryInnerContainer(section, logger);
  return (
    (await section.innerText().catch(() => "")) ||
    (await section.textContent().catch(() => "")) ||
    ""
  );
}

async function readTabText(
  section: Locator,
  tabName: RegExp,
  logger?: { info: (msg: string) => void },
): Promise<string> {
  const clicked = await clickSectionTab(section, tabName);
  if (!clicked) return "";
  await scrollAiSummaryInnerContainer(section, logger);
  return (
    (await section.innerText().catch(() => "")) ||
    (await section.textContent().catch(() => "")) ||
    ""
  );
}

async function clickSectionTab(section: Locator, name: RegExp): Promise<boolean> {
  const tab = section
    .getByRole("tab", { name })
    .or(section.getByRole("button", { name }))
    .or(section.getByText(name))
    .first();
  if ((await tab.count().catch(() => 0)) === 0) return false;
  await tab.click({ timeout: 3_000 }).catch(() => undefined);
  await section.page().waitForTimeout(200).catch(() => undefined);
  return true;
}

async function expandAiSummaryContainer(section: Locator): Promise<() => Promise<void>> {
  const original = await section.evaluate((root) => {
    const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
    const changed: Array<{
      index: number;
      height: string;
      maxHeight: string;
      overflow: string;
      overflowY: string;
    }> = [];
    candidates.forEach((node, index) => {
      if (!(node instanceof HTMLElement)) return;
      const style = window.getComputedStyle(node);
      if (style.overflowY !== "auto" && style.overflowY !== "scroll") return;
      if (node.scrollHeight <= node.clientHeight + 4) return;
      changed.push({
        index,
        height: node.style.height,
        maxHeight: node.style.maxHeight,
        overflow: node.style.overflow,
        overflowY: node.style.overflowY,
      });
      node.style.height = `${Math.max(node.scrollHeight, node.clientHeight)}px`;
      node.style.maxHeight = "none";
      node.style.overflow = "visible";
      node.style.overflowY = "visible";
    });
    return changed;
  });

  return async () => {
    await section
      .evaluate((root, restored) => {
        const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
        for (const item of restored) {
          const node = candidates[item.index];
          if (!(node instanceof HTMLElement)) continue;
          node.style.height = item.height;
          node.style.maxHeight = item.maxHeight;
          node.style.overflow = item.overflow;
          node.style.overflowY = item.overflowY;
        }
      }, original)
      .catch(() => undefined);
  };
}

async function findNativeAiSummaryDownload(section: Locator): Promise<Locator | null> {
  const scoped = section
    .getByRole("link", { name: /PDF\s*Download|AI\s*Summary.*Download|Download\s*AI\s*Summary/i })
    .or(section.getByRole("button", { name: /PDF\s*Download|AI\s*Summary.*Download|Download\s*AI\s*Summary/i }))
    .or(section.getByText(/PDF\s*Download/i))
    .first();
  if ((await scoped.count().catch(() => 0)) === 0) {
    return null;
  }
  const label = ((await scoped.innerText().catch(() => "")) || "").trim();
  if (/download\s+all\s+documents/i.test(label)) return null;
  if (/nit|tender\s*document/i.test(label)) return null;
  return scoped;
}

/**
 * Capture AI_Summary.pdf: native download if present, otherwise full DOM text → PDF.
 * Never scrapes only the visible viewport of the inner scroller.
 */
export async function captureAiSummaryArtifact(options: {
  detailPage: Page;
  context: BrowserContext;
  tenderFolder: string;
  t247Id: string;
  timeoutMs: number;
  logger: Logger;
  skipIfPresent?: boolean;
}): Promise<AiSummaryCaptureResult> {
  const { detailPage, context, tenderFolder, t247Id, timeoutMs, logger } =
    options;
  const canonical = path.join(tenderFolder, "AI_Summary.pdf");
  logger.info(`T247_AI_SUMMARY_START=${t247Id}`);
  logger.info(`T247_AI_SUMMARY_CAPTURE_START=${t247Id}`);
  await verifyCurrentTenderId(detailPage, t247Id, logger);

  if (options.skipIfPresent && isValidArtifact(canonical) && isPdfMagic(canonical)) {
    logger.info("T247_AI_SUMMARY_CAPTURE_METHOD=NATIVE_DOWNLOAD");
    logger.info("T247_AI_SUMMARY_CAPTURE_SUCCESS=true");
    logger.info("T247_AI_SUMMARY_SAVED=true");
    logger.info("T247_AI_SUMMARY_VERIFIED=true");
    logger.info(`T247_AI_SUMMARY_PATH=${canonical}`);
    logger.info(`T247_AI_SUMMARY_SIZE=${fs.statSync(canonical).size}`);
    return {
      attempted: true,
      available: true,
      status: "complete",
      method: "NATIVE_DOWNLOAD",
      path: canonical,
      size: fs.statSync(canonical).size,
      sectionFound: true,
      scrollContainerFound: true,
    };
  }

  const section = await locateAiSummarySection(detailPage);
  if (!section) {
    logger.info("T247_AI_SUMMARY_SECTION_FOUND=false");
    logger.info("T247_AI_SUMMARY_CAPTURE_METHOD=UNAVAILABLE");
    logger.info("T247_AI_SUMMARY_CAPTURE_SUCCESS=false");
    return {
      attempted: true,
      available: false,
      status: "unavailable",
      method: "UNAVAILABLE",
      path: null,
      size: 0,
      sectionFound: false,
      scrollContainerFound: false,
    };
  }
  logger.info("T247_AI_SUMMARY_SECTION_FOUND=true");

  const metrics = await inspectAiSummaryScrollContainer(section);
  logger.info(
    `T247_AI_SUMMARY_SCROLL_CONTAINER_FOUND=${metrics.found}`,
  );
  logger.info(`T247_AI_SUMMARY_SCROLL_HEIGHT=${metrics.scrollHeight}`);
  logger.info(`T247_AI_SUMMARY_CLIENT_HEIGHT=${metrics.clientHeight}`);

  const native = await findNativeAiSummaryDownload(section);
  if (native) {
    try {
      const record = await clickAndSaveDownload({
        page: detailPage,
        context,
        clickTarget: async () => {
          await native.scrollIntoViewIfNeeded().catch(() => undefined);
          await native.click({ timeout: 15_000 });
        },
        destinationDir: tenderFolder,
        preferredBaseName: "AI_Summary",
        preferredExtension: "pdf",
        canonicalFileName: "AI_Summary.pdf",
        timeoutMs,
        logger,
        kind: "ai_summary",
        linkText: "AI Summary PDF Download",
      });
      if (record.status === "success" && isValidArtifact(canonical)) {
        logger.info("T247_AI_SUMMARY_CAPTURE_METHOD=NATIVE_DOWNLOAD");
        logger.info("T247_AI_SUMMARY_CAPTURE_SUCCESS=true");
    logger.info("T247_AI_SUMMARY_SAVED=true");
    logger.info("T247_AI_SUMMARY_VERIFIED=true");
        logger.info(`T247_AI_SUMMARY_PATH=${canonical}`);
        logger.info(`T247_AI_SUMMARY_SIZE=${fs.statSync(canonical).size}`);
        return {
          attempted: true,
          available: true,
          status: "complete",
          method: "NATIVE_DOWNLOAD",
          path: canonical,
          size: fs.statSync(canonical).size,
          sectionFound: true,
          scrollContainerFound: metrics.found,
        };
      }
    } catch (error) {
      if (
        error instanceof AutomationError &&
        error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
      ) {
        throw error;
      }
      logger.warn(
        `Native AI Summary download failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const restore = await expandAiSummaryContainer(section);
  try {
    const fullText = await extractAiSummaryFullText(section, logger);
    if (!fullText.trim()) {
      logger.info("T247_AI_SUMMARY_CAPTURE_METHOD=UNAVAILABLE");
      logger.info("T247_AI_SUMMARY_CAPTURE_SUCCESS=false");
      return {
        attempted: true,
        available: false,
        status: "unavailable",
        method: "UNAVAILABLE",
        path: null,
        size: 0,
        sectionFound: true,
        scrollContainerFound: metrics.found,
      };
    }
    writeTextPdf(
      canonical,
      "AI Generated Tender Summary – Bid / No Bid Decision",
      fullText,
    );
  } finally {
    await restore();
    await clickSectionTab(section, /^Summary$/i);
  }

  if (isValidArtifact(canonical) && isPdfMagic(canonical)) {
    const size = fs.statSync(canonical).size;
    logger.info("T247_AI_SUMMARY_CAPTURE_METHOD=DOM_PDF");
    logger.info("T247_AI_SUMMARY_CAPTURE_SUCCESS=true");
    logger.info("T247_AI_SUMMARY_SAVED=true");
    logger.info("T247_AI_SUMMARY_VERIFIED=true");
    logger.info(`T247_AI_SUMMARY_PATH=${canonical}`);
    logger.info(`T247_AI_SUMMARY_SIZE=${size}`);
    return {
      attempted: true,
      available: true,
      status: "complete",
      method: "DOM_PDF",
      path: canonical,
      size,
      sectionFound: true,
      scrollContainerFound: metrics.found,
    };
  }

  logger.info("T247_AI_SUMMARY_CAPTURE_SUCCESS=false");
  return {
    attempted: true,
    available: false,
    status: "failed",
    method: "DOM_PDF",
    path: null,
    size: 0,
    sectionFound: true,
    scrollContainerFound: metrics.found,
  };
}

export async function dismissThenRetry<T>(
  page: Page,
  logger: Logger,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    await dismissTender247Interruptions(page, logger).catch((err) => {
      if (
        err instanceof AutomationError &&
        err.code === "TENDER247_REMINDER_MODAL_BLOCKING"
      ) {
        throw err;
      }
    });
    throw error;
  }
}
