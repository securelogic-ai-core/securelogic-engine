import express from "express";
import cors from "cors";

import auditSprintRouter from "./routes/auditSprint";
import auditSprintResultRouter from "./routes/auditSprintResult";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json());

// IMPORTANT: Mount result router FIRST so it can’t be shadowed by any generic audit-sprint middleware.
app.use("/api/audit-sprint/result", auditSprintResultRouter);

// Keep audit-sprint router strictly scoped (POST /intake only).
app.use("/api/audit-sprint", auditSprintRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 SecureLogic Engine listening on port ${PORT}`);
});