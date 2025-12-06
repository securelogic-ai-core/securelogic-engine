"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
function normalizeText(parsed) {
    const tokens = parsed.text
        .toLowerCase()
        .replace(/[^a-z0-9\\s]/g, "")
        .split(/\\s+/)
        .filter(Boolean);
    return {
        textBlocks: parsed.blocks,
        tokens,
        metadata: parsed.metadata || {}
    };
}
