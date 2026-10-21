import { Router } from "express";
import verifyAuth from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import {
  closeEvent,
  createEvent,
  deactivateEvent,
  deleteEvent,
  exportEventAttendanceExcel,
  exportEventAbsenteesExcel,
  getAllEvents,
  getSessionLocations,
  getEventAttendance,
  getEventClusterById,
  getEventById,
  getEventAbsentees,
  getPresentMembersForEvent,
  rescheduleEvent,
  cancelEvent,
  updateEvent,
  updateEventCluster,
} from "../controllers/event.controller";

const router = Router();

// All event routes require authentication
router.use(verifyAuth);

// create event (super admin only)
router.post("/", requireRole("SUPER_ADMIN"), createEvent);

// get distinct past locations, most used first (Item 3)
router.get("/locations", getSessionLocations);

// get list of all events (supports studyId, sessionType, status filters)
router.get("/", getAllEvents);

// get event cluster by id
router.get("/cluster/:clusterId", getEventClusterById);

// get paginated attendance list for a specific event
router.get("/:eventId/attendance", getEventAttendance);

// export attendance list for a specific event
router.get("/:eventId/attendance/export/excel", exportEventAttendanceExcel);
router.get("/:id/export/excel", exportEventAttendanceExcel);

// get present members list
router.get("/:eventId/present-members", getPresentMembersForEvent);

// get absentees and stats for a specific event
router.get("/:id/absentees", getEventAbsentees);
router.get("/:id/absentees/export", exportEventAbsenteesExcel);
router.get("/:id/absentees/export/excel", exportEventAbsenteesExcel);

// get specific event by id (includes stats and absentees)
router.get("/:id", getEventById);

// reschedule an event (super admin only)
router.patch("/:id/reschedule", requireRole("SUPER_ADMIN"), rescheduleEvent);

// cancel an event (super admin only)
router.patch("/:id/cancel", requireRole("SUPER_ADMIN"), cancelEvent);

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
