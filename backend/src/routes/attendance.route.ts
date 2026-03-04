import { Router } from "express";
import verifyAuth from "../middleware/auth.middleware";
import { markAttendance } from "../controllers/attendance.controller";

const router = Router();

// All attendance routes require authentication
router.use(verifyAuth);

// mark attendance
router.post("/", markAttendance);

export default router;
