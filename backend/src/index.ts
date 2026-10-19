import dotenv from "dotenv";
import path from "path";

if (process.env.NODE_ENV === "test") {
  dotenv.config({ path: path.resolve(__dirname, "../.env.test"), override: true });
} else {
  dotenv.config({ path: path.resolve(__dirname, "../.env.local"), override: true });
  dotenv.config();
}

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.route";
import memberRouter from "./routes/member.route";
import eventRouter from "./routes/event.route";
import attendanceRouter from "./routes/attendance.route";
import dashboardRouter from "./routes/dashboard.route";
import studyRouter from "./routes/study.route";
import { PrismaClient } from "@prisma/client";
import { startEventLifecycleScheduler } from "./services/event-lifecycle.service";

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const clientOrigin = process.env.CLIENT_URL ?? "http://localhost:5173";

app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/members", memberRouter);

/**
 * DOMAIN GLOSSARY:
 * UI / Client / Docs: "Session" is used (Study contains Sessions; standalone sessions are without a study).
 * Backend DB / Prisma: Model is named "Event".
 * /sessions is registered as an alias to /events to support clean REST paths without breaking v1.
 */
app.use("/events", eventRouter);
app.use("/sessions", eventRouter);
app.use("/attendance", attendanceRouter);
app.use("/dashboard", dashboardRouter);
app.use("/studies", studyRouter);

app.get("/", (_req, res) => res.json({ status: "ok" }));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

if (process.env.NODE_ENV !== "test") {
  startEventLifecycleScheduler(prisma);
  app.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
  });
}

export default app;
