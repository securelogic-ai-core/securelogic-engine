"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const score_1 = __importDefault(require("./routes/score"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use("/api", score_1.default);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`SecureLogic Engine listening on port ${PORT}`);
});
