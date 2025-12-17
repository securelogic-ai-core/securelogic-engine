"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeDocument = routeDocument;
const pdfParser_1 = require("../parsers/pdfParser");
const docxParser_1 = require("../parsers/docxParser");
const textParser_1 = require("../parsers/textParser");
async function routeDocument(doc) {
    switch (doc.type.toLowerCase()) {
        case "pdf":
            return (0, pdfParser_1.parsePDF)(doc);
        case "docx":
            return (0, docxParser_1.parseDocx)(doc);
        case "txt":
        case "markdown":
            return (0, textParser_1.parseText)(doc);
        default:
            return (0, textParser_1.parseText)(doc); // fallback
    }
}
