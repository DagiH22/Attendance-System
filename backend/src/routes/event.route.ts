import { Router } from "express";
import verifyAuth from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import {
  closeEvent,
  createEvent,
  deactivateEvent,
  deleteEvent,
  exportEventAttendanceExcel,
  getAllEvents,
  getEventAttendance,
  getEventClusterById,
  getEventById,
  getPresentMembersForEvent,
  updateEvent,
  updateEventCluster,
} from "../controllers/event.controller";

const router = Router();

// All event routes require authentication
router.use(verifyAuth);

// create event (super admin only)
router.post("/", requireRole("SUPER_ADMIN"), createEvent);

// get list of all events
router.get("/", getAllEvents);

// get event cluster by id
router.get("/cluster/:clusterId", getEventClusterById);

// get paginated attendance list for a specific event
router.get("/:eventId/attendance", getEventAttendance);

// export attendance list for a specific event
router.get("/:eventId/attendance/export/excel", exportEventAttendanceExcel);

// get specific evenet by id
router.get("/:eventId/present-members", getPresentMembersForEvent);

// get specific event by id
router.get("/:id", getEventById);

// deactivate an event (super admin only)
router.patch("/:id/deactivate", requireRole("SUPER_ADMIN"), deactivateEvent);

// manually close an event without deactivating it
router.patch("/:id/close", requireRole("SUPER_ADMIN"), closeEvent);

// edit an event (super admin only)
router.patch("/:id", requireRole("SUPER_ADMIN"), updateEvent);

// edit a cluster (super admin only)
router.patch(
  "/cluster/:clusterId",
  requireRole("SUPER_ADMIN"),
  updateEventCluster,
);

// delete an upcoming event (super admin only)
router.delete("/:id", requireRole("SUPER_ADMIN"), deleteEvent);

export default router;
