import { Router } from "express";
import verifyAuth from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import {
  getAllStudies,
  getStudyById,
  createStudy,
  updateStudy,
  deleteStudy,
  addSessionsToStudy,
  getStudyStats,
  getStudyGrid,
  exportStudyExcel,
  getNotParticipatingMembers,
  exportNotParticipatingExcel,
} from "../controllers/study.controller";

const router = Router();

// All study routes require authentication
router.use(verifyAuth);

// List all studies with session counts
router.get("/", getAllStudies);

// Create study (super admin only)
router.post("/", requireRole("SUPER_ADMIN"), createStudy);

// Get study not-participating excel export (ADMIN and SUPER_ADMIN)
router.get("/:id/not-participating/export", exportNotParticipatingExcel);

// Get study not-participating members (ADMIN and SUPER_ADMIN)
router.get("/:id/not-participating", getNotParticipatingMembers);

// Get study detail with sessions and summary stats
router.get("/:id", getStudyById);

// Update study (super admin only)
router.patch("/:id", requireRole("SUPER_ADMIN"), updateStudy);
router.put("/:id", requireRole("SUPER_ADMIN"), updateStudy);

// Delete study (super admin only)
router.delete("/:id", requireRole("SUPER_ADMIN"), deleteStudy);

// Add sessions to study (super admin only)
router.post("/:id/sessions", requireRole("SUPER_ADMIN"), addSessionsToStudy);

// Study stats endpoint
router.get("/:id/stats", getStudyStats);

// Study member x session grid endpoint
router.get("/:id/grid", getStudyGrid);

// Study Excel export
router.get("/:id/export/excel", exportStudyExcel);

export default router;
