"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.hashToken = hashToken;
exports.verifyTokenHash = verifyTokenHash;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const ROUNDS = 12;
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, ROUNDS);
}
async function verifyPassword(password, hash) {
    return bcryptjs_1.default.compare(password, hash);
}
async function hashToken(token) {
    return bcryptjs_1.default.hash(token, ROUNDS);
}
async function verifyTokenHash(token, hash) {
    return bcryptjs_1.default.compare(token, hash);
}
