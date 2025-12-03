"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlRetrievalEngine = void 0;
class ControlRetrievalEngine {
    /**
     * retrieve()
     *
     * Deterministic retrieval of control objects based solely on
     * activated control IDs. No modification, transformation, or
     * enrichment occurs here.
     */
    static retrieve(activatedControlIds, catalog) {
        if (!Array.isArray(activatedControlIds)) {
            throw new Error("activatedControlIds must be an array of strings.");
        }
        const lookup = new Map();
        for (const ctrl of catalog) {
            lookup.set(ctrl.id, ctrl);
        }
        const result = [];
        for (const id of activatedControlIds) {
            const found = lookup.get(id);
            if (found)
                result.push(found);
        }
        return result;
    }
}
exports.ControlRetrievalEngine = ControlRetrievalEngine;
