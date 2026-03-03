import { Router } from "express";
import verifyAuth from "../middleware/auth.middleware";
import {
  createEvent,
  deactivateEvent,
  getAllEvents,
  getEventById,
} from "../controllers/event.controller";

const router = Router();

// All event routes require authentication
router.use(verifyAuth);

// create event (super admin only enforced in controller)
router.post("/", createEvent);

// get list of all events 
router.get("/", getAllEvents);

// get specific evenet by id
router.get("/:id", getEventById);

// deactivate an event (super admin only enforced in controller)
router.patch("/:id/deactivate", deactivateEvent);

export default router;
