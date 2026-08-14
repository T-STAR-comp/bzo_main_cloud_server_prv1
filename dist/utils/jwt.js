"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.signRefreshToken = signRefreshToken;
exports.verifyAccessToken = verifyAccessToken;
exports.verifyRefreshToken = verifyRefreshToken;
exports.generateNumericCode = generateNumericCode;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_js_1 = require("../config.js");
const accessSignOptions = { expiresIn: config_js_1.config.jwt.accessTtl };
const refreshSignOptions = { expiresIn: config_js_1.config.jwt.refreshTtl };
function signAccessToken(userId, email, role = "user") {
    return jsonwebtoken_1.default.sign({ sub: userId, email, role, type: "access" }, config_js_1.config.jwt.accessSecret, accessSignOptions);
}
function signRefreshToken(userId, sessionId) {
    return jsonwebtoken_1.default.sign({ sub: userId, sid: sessionId, type: "refresh" }, config_js_1.config.jwt.refreshSecret, refreshSignOptions);
}
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, config_js_1.config.jwt.accessSecret);
}
function verifyRefreshToken(token) {
    return jsonwebtoken_1.default.verify(token, config_js_1.config.jwt.refreshSecret);
}
function generateNumericCode(length = 6) {
    let code = "";
    for (let i = 0; i < length; i++) {
        code += Math.floor(Math.random() * 10).toString();
    }
    return code;
}
