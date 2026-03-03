import { Router } from "express";
import { login } from "../controllers/auth.controller";

const router = Router();

// POST /login -> authController.login
router.post("/login", login);

export default router;
