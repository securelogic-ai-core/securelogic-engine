import type { ReplicationAdapter } from "../ReplicationAdapter";
import type { TransparencyEntry } from "../../transparency/TransparencyChain";

export class HttpReplicationAdapter implements ReplicationAdapter {
  constructor(private peers: string[]) {}

  async broadcast(entry: TransparencyEntry) {
    await Promise.all(
      this.peers.map(p =>
        fetch(`${p}/replication/append`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry)
        }).catch(() => {})
      )
    );
  }

  async fetchAll(): Promise<TransparencyEntry[]> {
    for (const p of this.peers) {
      try {
        const r = await fetch(`${p}/replication/all`);
        if (r.ok) return await r.json();
      } catch {}
    }
    return [];
  }
}
