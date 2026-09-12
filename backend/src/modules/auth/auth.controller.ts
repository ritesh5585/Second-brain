import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { AuthRequest } from "../../middleware/authenticate";
import { AUTH_MESSAGES } from "./auth.constant";

export const authController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await authService.register(req.body);
      res.status(201).json({
        success: true,
        message: AUTH_MESSAGES.REGISTERED,
        data: user,
      });
    } catch (err) {
      next(err);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.login(req.body);
      res.status(200).json({
        success: true,
        message: AUTH_MESSAGES.LOGGED_IN,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async me(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await authService.me(req.user!.id);
      res.json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  },

  async logout(_req: Request, res: Response, next: NextFunction) {
    try {
      await authService.logout();
      res.json({ success: true, message: AUTH_MESSAGES.LOGGED_OUT });
    } catch (err) {
      next(err);
    }
  },
};
