"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseText = parseText;
function parseText(doc) {
    return {
        text: doc.rawContent,
        blocks: doc.rawContent.split("\\n"),
        metadata: {}
    };
}
