import express from "express";
import { getDashboardAnalytics } from "../controllers/dashboard.controller";
import { verifyAuth } from "../middleware/auth.middleware";

const router = express.Router();

router.use(verifyAuth);

router.get("/", getDashboardAnalytics);

export default router;
