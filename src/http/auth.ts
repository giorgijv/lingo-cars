import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PrismaClient, User } from "@prisma/client";
import { resolveSessionToken } from "../auth/session.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/** Attaches `req.user` for a valid session token; 401s otherwise. */
export function requireAuth(db: PrismaClient): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    resolveSessionToken(db, token)
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: "unauthorized" });
          return;
        }
        req.user = user;
        next();
      })
      .catch(next);
  };
}
