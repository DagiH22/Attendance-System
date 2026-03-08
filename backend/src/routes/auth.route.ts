import { Router } from "express";
import { login, logout, me, refresh } from "../controllers/auth.controller";
import { verifyAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", verifyAuth, me);

export default router;
