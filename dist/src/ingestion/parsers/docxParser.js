"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDocx = parseDocx;
async function parseDocx(doc) {
    return {
        text: doc.extractedText || "",
        blocks: doc.extractedText ? doc.extractedText.split("\\n") : [],
        metadata: {}
    };
}
