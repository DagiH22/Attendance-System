import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRouter from "./routes/auth.route";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 4000;

app.use(cors());
app.use(express.json());

// Mount routers
app.use("/api/auth", authRouter);

app.get("/", (_req, res) => res.json({ status: "ok" }));

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

export default app;
