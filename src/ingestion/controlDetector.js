"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlDetector = void 0;
var ControlDetector = /** @class */ (function () {
    function ControlDetector() {
    }
    ControlDetector.detect = function (text) {
        var lower = text.toLowerCase();
        var found = [];
        for (var _i = 0, _a = Object.keys(this.controlKeywords); _i < _a.length; _i++) {
            var control = _a[_i];
            var keywords = this.controlKeywords[control];
            if (keywords.some(function (k) { return lower.includes(k); })) {
                found.push(control);
            }
        }
        return found;
    };
    ControlDetector.controlKeywords = {
        "AC-1": ["access control", "authentication", "authorization"],
        "IR-1": ["incident response", "security incident", "breach handling"],
        "CM-1": ["change management", "change control"],
        "BC-1": ["business continuity", "disaster recovery", "drp"]
    };
    return ControlDetector;
}());
exports.ControlDetector = ControlDetector;
