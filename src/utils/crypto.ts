import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function hashToken(token: string) {
  return bcrypt.hash(token, ROUNDS);
}

export async function verifyTokenHash(token: string, hash: string) {
  return bcrypt.compare(token, hash);
}
