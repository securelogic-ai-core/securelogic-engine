import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

const AUDIT_DIR = path.resolve("data/audit");
const METER_FILE = path.join(AUDIT_DIR, "meter.json");

type MeterRecord = {
  count: number;
  lastSeen: string;
};

type MeterStore = Record<string, MeterRecord>;

function ensureStore(): MeterStore {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }

  if (!fs.existsSync(METER_FILE)) {
    fs.writeFileSync(METER_FILE, JSON.stringify({}), "utf-8");
  }

  return JSON.parse(fs.readFileSync(METER_FILE, "utf-8")) as MeterStore;
}

export function requestAudit(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const apiKey =
    (req as any).identity?.apiKey ??
    "unknown";

  const store = ensureStore();

  if (!store[apiKey]) {
    store[apiKey] = {
      count: 0,
      lastSeen: new Date().toISOString()
    };
  }

  store[apiKey].count += 1;
  store[apiKey].lastSeen = new Date().toISOString();

  fs.writeFileSync(METER_FILE, JSON.stringify(store, null, 2), "utf-8");

  (req as any).meter = store[apiKey];
  next();
}