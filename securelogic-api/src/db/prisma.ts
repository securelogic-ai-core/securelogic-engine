import "dotenv/config";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env");
}

export const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});
