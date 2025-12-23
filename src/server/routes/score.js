"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var handleRequest_1 = require("../handlers/handleRequest");
var router = (0, express_1.Router)();
router.post("/score", function (req, res) {
    var _a;
    try {
        var input = req.body;
        var result = (0, handleRequest_1.handleRequest)(input);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: (_a = err.message) !== null && _a !== void 0 ? _a : "Unknown error" });
    }
});
exports.default = router;
