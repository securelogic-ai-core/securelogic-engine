import { Router, Request, Response } from "express";
import { auditSprintUpload } from "../lib/upload";

const router = Router();

router.post(
  "/",
  auditSprintUpload.array("documents", 5),
  (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) ?? [];

    return res.json({
      uploaded: files.map(f => ({
        name: f.originalname,
        size: f.size,
        type: f.mimetype
      }))
    });
  }
);

export default router;