import bcrypt from "bcryptjs";
import { env } from "../config/env";

export const hashPassword = (plain: string) => {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
};

export const comparePassword = (plain: string, hashed: string) => {
  return bcrypt.compare(plain, hashed);
};