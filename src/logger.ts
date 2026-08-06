import fs from "node:fs";
import path from "node:path";
import { getTodayIsoDate } from "./dateUtils.js";
import { ensureDir, resolveProjectPath } from "./fileUtils.js";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export class Logger {
  private readonly logFilePath: string;
  private readonly sourceName: string | undefined;

  constructor(logRoot: string, sourceName?: string) {
    const root = resolveProjectPath(logRoot);
    ensureDir(root);
    this.logFilePath = path.join(root, `${getTodayIsoDate()}.log`);
    this.sourceName = sourceName;
  }

  get filePath(): string {
    return this.logFilePath;
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }

  debug(message: string): void {
    this.write("DEBUG", message);
  }

  private write(level: LogLevel, message: string): void {
    const stamp = new Date().toISOString();
    const source = this.sourceName ? ` [${this.sourceName}]` : "";
    const line = `${stamp} ${level}${source} ${message}`;
    console.log(line);
    fs.appendFileSync(this.logFilePath, `${line}\n`, { encoding: "utf8" });
  }
}

/** Never log secrets — strip common sensitive keys from objects. */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
