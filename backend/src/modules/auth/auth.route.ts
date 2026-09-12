import { Router } from "express";
import { authController } from "./auth.controller";
import { validate } from "../../middleware/validate";
import { registerSchema, loginSchema } from "./auth.validation";
import { authenticate } from "../../middleware/authenticate";

const router = Router();

router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);
router.get("/me", authenticate, authController.me);
router.post("/logout", authenticate, authController.logout);

export default router;
