"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlDetector = void 0;
class ControlDetector {
    static detect(text) {
        const lower = text.toLowerCase();
        const found = [];
        for (const control of Object.keys(this.controlKeywords)) {
            const keywords = this.controlKeywords[control];
            if (keywords.some((k) => lower.includes(k))) {
                found.push(control);
            }
        }
        return found;
    }
}
exports.ControlDetector = ControlDetector;
ControlDetector.controlKeywords = {
    "AC-1": ["access control", "authentication", "authorization"],
    "IR-1": ["incident response", "security incident", "breach handling"],
    "CM-1": ["change management", "change control"],
    "BC-1": ["business continuity", "disaster recovery", "drp"]
};
