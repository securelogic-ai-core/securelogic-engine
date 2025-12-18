const express = require("express");
const cors = require("cors");
require("dotenv").config();

const assessmentRoutes = require("./routes/assessments");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/v1/assessments", assessmentRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SecureLogic API running on port ${PORT}`);
});
