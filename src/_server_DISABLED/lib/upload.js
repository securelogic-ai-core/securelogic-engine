"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditSprintUpload = void 0;
var multer_1 = require("multer");
var path_1 = require("path");
var fs_1 = require("fs");
var uploadDir = path_1.default.join(process.cwd(), "uploads", "audit-sprint");
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
var storage = multer_1.default.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, uploadDir);
    },
    filename: function (_req, file, cb) {
        var unique = "".concat(Date.now(), "-").concat(Math.round(Math.random() * 1e9));
        cb(null, "".concat(unique, "-").concat(file.originalname));
    }
});
exports.auditSprintUpload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});
