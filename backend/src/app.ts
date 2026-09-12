import express from "express";
import cookieparser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";

const app = express();

app.use(express.json());
app.use(cookieparser());
app.use(morgan("dev"));
app.use(helmet());

app.get("/health", (_req, res) => {
  res.json({ status: "OK", timestamp: new Date() });
});

// app.use("/api/auth");

export default app;