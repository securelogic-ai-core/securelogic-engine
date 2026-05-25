import { Router } from "express";
import multer from "multer";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import OpenAI from "openai";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { logger } from "../infra/logger.js";
import { instrumentOpenAIClient } from "../infra/providerQuotaAlert.js";

const router = Router();

function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return instrumentOpenAIClient(new OpenAI({ apiKey: key }));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "audio/webm",
      "audio/ogg",
      "audio/mp4",
      "audio/x-m4a",
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/mp3",
    ];
    const allowedExt = /\.(webm|ogg|mp4|mp3|wav|m4a)$/i;
    if (allowed.includes(file.mimetype) || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("unsupported_audio_type"));
    }
  }
});

const transcribeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) =>
    (req as any).organizationId ?? (req.ip ? ipKeyGenerator(req.ip) : "unknown"),
  message: {
    error: "rate_limit_exceeded",
    message: "Too many transcription requests. Wait 60 seconds."
  }
});

router.get("/ask/transcribe/status", (_req, res) => {
  res.status(200).json({ configured: !!process.env.OPENAI_API_KEY });
});

router.post(
  "/ask/transcribe",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  transcribeRateLimit,
  upload.single("audio"),
  async (req, res) => {
    try {
      const client = getOpenAIClient();
      if (!client) {
        res.status(503).json({
          error: "transcription_unavailable",
          message: "Voice transcription is not configured."
        });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({
          error: "no_audio",
          message: "No audio file provided."
        });
        return;
      }

      const audioFile = new File(
        [new Uint8Array(file.buffer)],
        file.originalname || "audio.webm",
        { type: file.mimetype || "audio/webm" }
      );

      const transcription = await client.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        language: "en",
      });

      res.status(200).json({ text: transcription.text });
    } catch (err) {
      logger.error(
        { event: "transcription_failed", err },
        "POST /api/ask/transcribe failed"
      );
      res.status(500).json({
        error: "transcription_failed",
        message: "Failed to transcribe audio."
      });
    }
  }
);

export default router;
