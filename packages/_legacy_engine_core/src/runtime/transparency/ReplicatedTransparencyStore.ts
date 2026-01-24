import type { TransparencyStore } from "../store/TransparencyStore";
import type { TransparencyEntry } from "./TransparencyChain";
import type { ReplicationAdapter } from "../replication/ReplicationAdapter";

export class ReplicatedTransparencyStore implements TransparencyStore {
  constructor(
    private local: TransparencyStore,
    private replication: ReplicationAdapter
  ) {}

  async append(entry: TransparencyEntry) {
    await this.local.append(entry);
    await this.replication.broadcast(entry);
  }

  async getLatest(): Promise<TransparencyEntry | null> {
    return this.local.getLatest();
  }

  async getAll(): Promise<TransparencyEntry[]> {
    return this.local.getAll();
  }

  async syncFromPeers(): Promise<void> {
    const remote = await this.replication.fetchAll();
    const local = await this.local.getAll();

    if (remote.length <= local.length) return;

    for (let i = local.length; i < remote.length; i++) {
      await this.local.append(remote[i]);
    }
  }
}
