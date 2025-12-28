import fs from "fs/promises";
import path from "path";
import type { AuditEventV1 } from "../../audit/AuditEventV1";
import type { AuditStore } from "../AuditStore";

const BASE = path.resolve("data/audit");

export class FsAuditStore implements AuditStore {
  async append(event: AuditEventV1) {
    await fs.mkdir(BASE, { recursive: true });
    const file = path.join(BASE, `${event.tenantId}.log`);
    await fs.appendFile(file, JSON.stringify(event) + "\n");
  }
}
