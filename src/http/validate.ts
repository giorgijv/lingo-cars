import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodType } from "zod";

/** Wrap an async route so thrown/rejected errors reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Parse an unknown value with a zod schema; ZodError -> handled as 400. */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export { ZodError };
