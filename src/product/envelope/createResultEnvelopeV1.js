import { canonicalize } from "./canonicalize.js";
import { createHash } from "crypto";
export function createResultEnvelopeV1(payload) {
    const payloadHash = createHash("sha256")
        .update(JSON.stringify(canonicalize(payload)))
        .digest("hex");
    const envelope = {
        version: "result-envelope-v1",
        issuedAt: new Date().toISOString(),
        result: payload,
        // test + integrity alias (NOT part of contract)
        payload,
        payloadHash,
        signatures: [],
    };
    return envelope;
}
