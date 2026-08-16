import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import OpenAI from "openai";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { askFeatureFlag } from "../lib/askFeatureFlag.js";
import { askVoiceEnabled } from "../lib/ask/askVoiceFeatureFlag.js";
import { writeAuditEvent } from "../lib/auditLog.js";
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
  // Keyed on the ORG (attachOrganizationContext has run by this point in the
  // chain). The previous key read `req.organizationId` — a field nothing ever
  // assigns — so every request fell through to req.ip, and behind Cloudflare's
  // rotating edge IPs each edge got its own 10/min bucket: effectively no
  // per-org limit on a paid model call. Same fragmentation class as the
  // adminLockout fix (resolveThrottleIdentity).
  keyGenerator: (req) =>
    (req as any).organizationContext?.organizationId ??
    (req.ip ? ipKeyGenerator(req.ip) : "unknown"),
  message: {
    error: "rate_limit_exceeded",
    message: "Too many transcription requests. Wait 60 seconds."
  }
});

/**
 * Independent voice kill switch (ASK-C C-9). 404 with the same body a
 * nonexistent route would produce, matching askFeatureFlag's convention.
 * Mounted AFTER askFeatureFlag: killing Ask kills voice (voice exists only
 * to feed Ask); killing voice never touches text Ask.
 */
function voiceFeatureFlag(_req: Request, res: Response, next: NextFunction): void {
  if (!askVoiceEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}

/**
 * Tenant voice governance (ASK-C C-1): an org admin's disablement is enforced
 * HERE, engine-side, regardless of client behavior. Mounted after
 * attachOrganizationContext (which loads the grant with the org row — no
 * added query) and BEFORE multer, so a disabled tenant's audio is never even
 * parsed. 403 (not 404): the surface exists; this tenant turned it off.
 */
function requireOrgVoiceEnabled(req: Request, res: Response, next: NextFunction): void {
  const ctx = (req as any).organizationContext as { voiceInputEnabled?: boolean } | undefined;
  if (ctx?.voiceInputEnabled === false) {
    res.status(403).json({
      error: "voice_disabled_for_org",
      message: "Voice input is disabled for your organization. Please type your question instead.",
    });
    return;
  }
  next();
}

router.get("/ask/transcribe/status", (_req, res) => {
  // Honest availability: configured means the key exists AND the kill switch
  // is not thrown — a killed capability must not advertise itself.
  res.status(200).json({ configured: !!process.env.OPENAI_API_KEY && askVoiceEnabled() });
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

// Chain = authorization EQUIVALENCE with text Ask (ASK-C C-7): every gate on
// POST /api/ask gates voice identically — Ask kill switch, voice kill switch,
// API key, org context, entitlement, seat policy, org-keyed rate limit. A
// caller who cannot ask by text must not be able to spend voice processing.
router.post(
  "/ask/transcribe",
  askFeatureFlag,
  voiceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  requireOrgVoiceEnabled,
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
          organizationId: (req as any).organizationContext?.organizationId ?? null,
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

      // ASK-C C-8: every transcription is an auditable per-org event — the
      // FACT and SHAPE of voice processing (sizes, mime, outcome), never the
      // content, matching the Ask precedent that answers stay out of the
      // audit log. This is the ledger's record that a user's audio was
      // processed by the disclosed provider.
      writeAuditEvent({
        organizationId: (req as any).organizationContext?.organizationId ?? null,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: (req as { userId?: string }).userId ?? null,
        eventType: "ask.voice.transcribed",
        resourceType: "ask",
        resourceId: null,
        payload: {
          audio_bytes: file!.size,
          audio_mime: file!.mimetype ?? null,
          transcript_length: transcription.text?.length ?? 0,
          provider: "openai_whisper",
          correlation_id: cid,
        },
        ipAddress: req.ip ?? null,
      });

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
