import express, { type Express, type NextFunction, type Request, type Response } from "express";

/**
 * Express app factory. Routes (§7 of the proposal) are mounted in Step 9;
 * for now the app exposes a health check and JSON error handling so the
 * scaffold is runnable and testable.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", phase: 0 });
  });

  // Fallback 404
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // Central error handler (JSON)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal_error";
    res.status(500).json({ error: message });
  });

  return app;
}
