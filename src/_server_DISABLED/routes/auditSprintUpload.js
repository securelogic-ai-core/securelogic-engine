"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var upload_1 = require("../lib/upload");
var router = (0, express_1.Router)();
router.post("/", upload_1.auditSprintUpload.array("documents", 5), function (req, res) {
    var _a;
    var files = (_a = req.files) !== null && _a !== void 0 ? _a : [];
    return res.json({
        uploaded: files.map(function (f) { return ({
            name: f.originalname,
            size: f.size,
            type: f.mimetype
        }); })
    });
});
exports.default = router;
