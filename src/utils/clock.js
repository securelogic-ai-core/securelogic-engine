"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Clock = void 0;
exports.Clock = {
    today: function () {
        return new Date().toISOString().split("T")[0];
    }
};
