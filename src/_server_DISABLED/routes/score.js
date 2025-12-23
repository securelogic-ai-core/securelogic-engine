"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var RunnerEngine_1 = require("../../engine/RunnerEngine");
var router = (0, express_1.Router)();
router.post("/", function (req, res) {
    var input = req.body;
    res.json(RunnerEngine_1.RunnerEngine.run(input));
});
exports.default = router;
