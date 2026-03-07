import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRouter from "./routes/auth.route";
import memberRouter from "./routes/member.route";
import eventRouter from "./routes/event.route";
import attendanceRouter from "./routes/attendance.route";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 4000;

app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/members", memberRouter);
app.use("/events", eventRouter);
app.use("/attendance", attendanceRouter);

app.get("/", (_req, res) => res.json({ status: "ok" }));

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

export default app;
