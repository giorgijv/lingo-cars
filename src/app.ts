import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma as defaultPrisma } from "./db.js";
import { createRouter } from "./routes.js";

/**
 * Express app factory. All Phase 0 logic lives behind this API (thin client,
 * D7). Accepts a PrismaClient for testability; defaults to the shared client.
 */
export function createApp(db: PrismaClient = defaultPrisma): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", phase: 0 });
  });

  app.use(createRouter(db));

  // 404
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // Central error handler — maps validation & known DB errors to HTTP status.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "validation_error", issues: err.issues });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return res.status(404).json({ error: "not_found" });
      if (err.code === "P2002") return res.status(409).json({ error: "conflict", target: err.meta?.target });
      if (err.code === "P2003") return res.status(400).json({ error: "foreign_key_violation", meta: err.meta });
    }
    const message = err instanceof Error ? err.message : "internal_error";
    return res.status(500).json({ error: message });
  });

  return app;
}
