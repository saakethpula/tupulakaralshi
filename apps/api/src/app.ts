import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { allowedFrontendOrigins } from "./config.js";
import { attachCurrentUser, requireAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { groupsRouter } from "./routes/groups.js";
import { healthRouter } from "./routes/health.js";
import { marketsRouter } from "./routes/markets.js";
import { meRouter } from "./routes/me.js";

export const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedFrontendOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true
  })
);
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.use("/health", healthRouter);
app.use("/api", requireAuth, attachCurrentUser);
app.use("/api/me", meRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/markets", marketsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
