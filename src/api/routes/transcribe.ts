import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import OpenAI from "openai";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { logger } from "../infra/logger.js";
import { instrumentOpenAIClient } from "../infra/providerQuotaAlert.js";
import {
  classifyTranscribeOutcome,
  statusForOutcome,
  rootCauseHint,
  type TranscribeOutcome,
} from "../lib/voiceTranscribeDiagnostics.js";

const router = Router();

// Correlation id carried from the browser through the app proxy to here, so one
// iPad attempt is traceable end-to-end. Kept short and non-PII.
const DIAGNOSTIC_HEADER = "x-voice-diagnostic-id";

function correlationId(req: Request): string {
  const raw = req.headers[DIAGNOSTIC_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value && value.trim()) || "none";
}

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
    // Browsers send parameterised types like "audio/webm; codecs=opus" — match
    // on the base MIME (before the first ";") so the allow-list works without
    // relying solely on the filename extension.
    const baseMime = (file.mimetype || "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (allowed.includes(baseMime) || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("unsupported_audio_type"));
    }
  }
});

// Run multer but capture any rejection on the request instead of bubbling to the
// global error handler — so the handler can classify and log it uniformly with
// the correlation id (an unsupported-format reject otherwise returned an opaque
// 500 with no diagnostic).
function uploadAudio(req: Request, res: Response, next: NextFunction) {
  upload.single("audio")(req, res, (err: unknown) => {
    if (err) {
      const e = err as { code?: string; message?: string };
      // multer size-limit surfaces err.code === "LIMIT_FILE_SIZE"; the
      // fileFilter reject surfaces err.message === "unsupported_audio_type".
      (req as Request & { multerErrorCode?: string }).multerErrorCode =
        e.code || e.message || "upload_error";
    }
    next();
  });
}

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

// Friendly, non-sensitive messages per outcome. Unknown codes fall back to a
// generic message client-side.
const OUTCOME_MESSAGE: Record<TranscribeOutcome, string> = {
  ok: "ok",
  transcription_unavailable: "Voice transcription is not configured.",
  unsupported_audio_type: "This audio format isn't supported.",
  file_too_large: "That recording is too large. Please record a shorter clip.",
  no_audio: "No audio file provided.",
  empty_audio: "No audio was captured. Please try recording again.",
  openai_error: "Failed to transcribe audio.",
  unexpected_exception: "Failed to transcribe audio.",
};

router.post(
  "/ask/transcribe",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  transcribeRateLimit,
  uploadAudio,
  async (req, res) => {
    const cid = correlationId(req);
    const multerErrorCode =
      (req as Request & { multerErrorCode?: string }).multerErrorCode ?? null;
    const file = req.file;
    const hasApiKey = !!process.env.OPENAI_API_KEY;

    // Single, non-sensitive diagnostic logger. Never logs audio bytes, secrets,
    // or user PII — only the correlation id, content negotiation, sizes, and the
    // classified outcome.
    const logDiagnostic = (
      outcome: TranscribeOutcome,
      extra?: Record<string, unknown>
    ) => {
      logger.info(
        {
          event: "voice_transcribe_diagnostic",
          correlationId: cid,
          organizationId: (req as any).organizationId ?? null,
          received_content_type: req.headers["content-type"] ?? null,
          file_mimetype: file?.mimetype ?? null,
          file_originalname: file?.originalname ?? null,
          file_size: file?.size ?? 0,
          multer_error_code: multerErrorCode,
          outcome,
          root_cause_hint: rootCauseHint(outcome),
          ...extra,
        },
        "voice transcribe diagnostic"
      );
    };

    const respond = (outcome: TranscribeOutcome) => {
      const status = statusForOutcome(outcome);
      res
        .status(status)
        .json({ error: outcome, message: OUTCOME_MESSAGE[outcome], correlationId: cid });
    };

    // Pre-OpenAI classification (upload reject / config / missing / empty).
    const pre = classifyTranscribeOutcome({
      hasApiKey,
      multerErrorCode,
      hasFile: !!file,
      fileSize: file?.size ?? 0,
      openaiThrew: false,
      unexpectedThrew: false,
    });
    if (pre !== "ok") {
      logDiagnostic(pre);
      respond(pre);
      return;
    }

    const client = getOpenAIClient();
    // hasApiKey was true, so client is non-null; guard defensively.
    if (!client) {
      logDiagnostic("transcription_unavailable");
      respond("transcription_unavailable");
      return;
    }

    try {
      const audioFile = new File(
        [new Uint8Array(file!.buffer)],
        file!.originalname || "audio.webm",
        { type: file!.mimetype || "audio/webm" }
      );

      const transcription = await client.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        language: "en",
      });

      logDiagnostic("ok", { text_length: transcription.text?.length ?? 0 });
      res.status(200).json({ text: transcription.text, correlationId: cid });
    } catch (err) {
      // Distinguish an OpenAI/Whisper failure (cause F) from an unexpected
      // server exception. The OpenAI SDK throws APIError subclasses with a
      // `status`; treat anything from the call here as openai_error.
      const outcome: TranscribeOutcome = "openai_error";
      logger.error(
        {
          event: "transcription_failed",
          correlationId: cid,
          err_name: (err as { name?: string })?.name ?? null,
          err_status: (err as { status?: number })?.status ?? null,
        },
        "POST /api/ask/transcribe failed"
      );
      logDiagnostic(outcome);
      respond(outcome);
    }
  }
);

export default router;
