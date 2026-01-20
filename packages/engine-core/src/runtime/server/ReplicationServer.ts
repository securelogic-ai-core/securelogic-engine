import express from "express";
import type { TransparencyStore } from "../store/TransparencyStore";

export function startReplicationServer(
  store: TransparencyStore,
  port: number
) {
  const app = express();
  app.use(express.json());

  app.post("/replication/append", async (req, res) => {
    await store.append(req.body);
    res.json({ ok: true });
  });

  app.get("/replication/all", async (_req, res) => {
    const all = await store.getAll();
    res.json(all);
  });

  app.listen(port, () => {
    console.log("Replication listening on", port);
  });
}
