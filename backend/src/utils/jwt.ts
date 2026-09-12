import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const signToken = (payload: { id: string; email: string }) => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET) as { id: string; email: string };
};