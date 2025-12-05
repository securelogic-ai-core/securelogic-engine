"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivationEngine = void 0;
class ActivationEngine {
    /**
     * Control is activated if ANY intake trigger matches ANY control triggerTag.
     */
    static activate(intake, catalog) {
        const triggers = intake.triggers ?? [];
        return catalog.filter(ctrl => {
            if (!ctrl.triggerTags || ctrl.triggerTags.length === 0) {
                return false; // no triggerTags = cannot activate
            }
            return ctrl.triggerTags.some(tag => triggers.includes(tag.toLowerCase()));
        });
    }
}
exports.ActivationEngine = ActivationEngine;
