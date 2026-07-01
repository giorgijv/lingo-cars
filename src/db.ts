import { PrismaClient } from "@prisma/client";

/**
 * Single shared Prisma client. The app connects via a restricted role that has
 * NO update/delete grants on the Attempt table (append-only, Rule 4) — enforced
 * additionally by a DB trigger created in the SQL migration.
 */
export const prisma = new PrismaClient();
