import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.route";
import memberRouter from "./routes/member.route";
import eventRouter from "./routes/event.route";
import attendanceRouter from "./routes/attendance.route";
import { PrismaClient } from "@prisma/client";
import { startEventLifecycleScheduler } from "./services/event-lifecycle.service";

dotenv.config();

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
app.use("/events", eventRouter);
app.use("/attendance", attendanceRouter);

app.get("/", (_req, res) => res.json({ status: "ok" }));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

startEventLifecycleScheduler(prisma);

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

export default app;
