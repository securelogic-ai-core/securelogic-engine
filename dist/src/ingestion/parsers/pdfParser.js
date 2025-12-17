"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePDF = parsePDF;
async function parsePDF(doc) {
    return {
        text: doc.extractedText || "",
        blocks: doc.extractedText ? doc.extractedText.split("\\n") : [],
        metadata: {}
    };
}
