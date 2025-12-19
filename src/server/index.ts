import express from "express";
import auditSprintRouter from "./routes/auditSprint";
import auditSprintPdfRouter from "./routes/auditSprintPdf";
import { licenseRateLimiter } from "./middleware/licenseRateLimit";

const app = express();

// --------------------
// Core middleware
// --------------------
app.use(express.json());

// --------------------
// Health check
// --------------------
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// --------------------
// Rate-limited API routes
// --------------------
app.use("/api", licenseRateLimiter);
app.use("/api/audit-sprint", auditSprintRouter);
app.use("/api/audit-sprint/pdf", auditSprintPdfRouter);

// --------------------
// Server startup
// --------------------
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`SecureLogic Engine listening on port ${PORT}`);
});

export default app;