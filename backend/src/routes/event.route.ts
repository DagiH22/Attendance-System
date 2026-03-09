import { Router } from "express";
import verifyAuth from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import {
  closeEvent,
  createEvent,
  deactivateEvent,
  getAllEvents,
  getEventById,
} from "../controllers/event.controller";

const router = Router();

// All event routes require authentication
router.use(verifyAuth);

// create event (super admin only)
router.post("/", requireRole("SUPER_ADMIN"), createEvent);

// get list of all events
router.get("/", getAllEvents);

// get specific evenet by id
router.get("/:id", getEventById);

// deactivate an event (super admin only)
router.patch("/:id/deactivate", requireRole("SUPER_ADMIN"), deactivateEvent);

// manually close an event without deactivating it
router.patch("/:id/close", requireRole("SUPER_ADMIN"), closeEvent);

export default router;
