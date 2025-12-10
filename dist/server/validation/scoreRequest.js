"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoreRequestSchema = void 0;
const zod_1 = require("zod");
exports.ScoreRequestSchema = zod_1.z.object({
    controls: zod_1.z.array(zod_1.z.any()),
    intake: zod_1.z.record(zod_1.z.string(), zod_1.z.any())
});
