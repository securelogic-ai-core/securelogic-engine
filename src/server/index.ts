import express from "express";
import bodyParser from "body-parser";
import { verifyHandler } from "./verifyHandler";

const app = express();
app.use(bodyParser.json({ limit: "5mb" }));

app.post("/verify", verifyHandler);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`SecureLogic verifier running on ${port}`);
});
