import express from "express";
import path from "path";
import { db } from "../../services/intelligence-worker/src/storage/db";

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "src/portal/views"));

app.get("/intelligence", (req, res) => {

  const issues = db.prepare(`
    SELECT id,title,created_at
    FROM newsletter_issues
    WHERE status='sent'
    ORDER BY created_at DESC
  `).all();

  res.render("intelligenceList", { issues });

});

app.get("/intelligence/:id", (req, res) => {

  const issue = db.prepare(`
    SELECT *
    FROM newsletter_issues
    WHERE id=?
  `).get(req.params.id);

  res.render("intelligenceIssue", { issue });

});

app.listen(4000, () => {
  console.log("SecureLogic Intelligence Portal running on port 4000");
});

app.get("/", (req,res)=>{
  res.redirect("/intelligence");
});

