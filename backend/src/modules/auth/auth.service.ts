import { prisma } from "../../config/db";
import { hashPassword, comparePassword } from "../../utils/password";
import { signToken } from "../../utils/jwt";
import { AUTH_MESSAGES } from "./auth.constant";
import { LoginDto, RegisterDto } from "./auth.types";

export const authService = {
  // REGISTER
  async register(data: RegisterDto) {
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      throw { status: 409, message: AUTH_MESSAGES.EMAIL_EXISTS };
    }

    const hashed = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email, password: hashed },
    });

    // password hata ke bhejo
    const { password, ...safeUser } = user;
    return safeUser;
  },

  // LOGIN
  async login(data: LoginDto) {
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (!user) {
      throw { status: 401, message: AUTH_MESSAGES.INVALID_CREDS };
    }

    const ok = await comparePassword(data.password, user.password);
    if (!ok) {
      throw { status: 401, message: AUTH_MESSAGES.INVALID_CREDS };
    }

    const token = signToken({ id: user.id, email: user.email });

    const { password, ...safeUser } = user;
    return { user: safeUser, token };
  },

  // ME (profile)
  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw { status: 404, message: AUTH_MESSAGES.USER_NOT_FOUND };
    }
    const { password, ...safeUser } = user;
    return safeUser;
  },

  // LOGOUT — JWT me server-side logout nahi hota,
  // client token delete karta hai. Yahan sirf response bhejne ke liye placeholder.
  async logout() {
    return true;
  },
};
