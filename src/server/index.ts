import express from "express";
import scoreRouter from "./routes/score";

const app = express();

app.use(express.json());
app.use("/api", scoreRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SecureLogic Engine listening on port ${PORT}`);
});
