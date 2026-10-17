import { Router } from "express";
import verifyAuth from "../middleware/auth.middleware";
import {
  markAttendance,
  excuseMember,
  undoAttendance,
  updateAttendanceStatus,
} from "../controllers/attendance.controller";

const router = Router();

// All attendance routes require authentication
router.use(verifyAuth);

// Mark attendance (QR or MANUAL)
router.post("/", markAttendance);

// Mark a member as EXCUSED
router.post("/excuse", excuseMember);

// Undo a mistaken attendance mark (soft delete)
router.patch("/:id/undo", undoAttendance);
router.delete("/:id", undoAttendance);

// Change attendance status (PRESENT / LATE / EXCUSED)
router.patch("/:id/status", updateAttendanceStatus);

export default router;
