import express from "express";
import { db } from "../storage/db";
import { addSubscriber } from "../storage/subscriberStore";

const app = express();
app.use(express.json());

app.get("/intelligence", (req, res) => {

  const issues = db.prepare(`
    SELECT id,title,created_at
    FROM newsletter_issues
    WHERE status='sent'
    ORDER BY created_at DESC
  `).all();

  res.json(issues);
});

app.get("/intelligence/:id", (req, res) => {

  const issue = db.prepare(`
    SELECT *
    FROM newsletter_issues
    WHERE id=?
  `).get(req.params.id);

  res.json(issue);
});

app.post("/subscribe", (req, res) => {

  const { email } = req.body;

  addSubscriber(email);

  res.json({ success: true });

});

app.listen(3000, () => {
  console.log("SecureLogic Intelligence API running");
});
