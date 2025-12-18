import express from "express";
import scoreRouter from "./routes/score";
import auditSprintRouter from "./routes/auditSprint";

const app = express();

app.use(express.json());

// ROUTES (THIS IS THE KEY)
app.use("/api", scoreRouter);               // exposes POST /api/score
app.use("/api/audit-sprint", auditSprintRouter); // exposes POST /api/audit-sprint

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SecureLogic Engine listening on port ${PORT}`);
});
