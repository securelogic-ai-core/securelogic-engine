"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCatalogFiles = loadCatalogFiles;
var fs = require("fs");
function loadCatalogFiles(paths) {
    var allControls = [];
    for (var _i = 0, paths_1 = paths; _i < paths_1.length; _i++) {
        var p = paths_1[_i];
        var raw = fs.readFileSync(p, "utf-8");
        var json = JSON.parse(raw);
        if (!Array.isArray(json.controls)) {
            throw new Error("Invalid catalog format in ".concat(p));
        }
        allControls = allControls.concat(json.controls);
    }
    return allControls;
}
