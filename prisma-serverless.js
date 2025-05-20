// prisma-serverless.js
import { PrismaClient } from "@prisma/client";

// Prevent multiple instances in development
const globalForPrisma = global;
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["query", "info", "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Connection handling for serverless
export async function connectPrisma() {
  try {
    await prisma.$connect();
    console.log("Successfully connected to database");
    return prisma;
  } catch (error) {
    console.error("Failed to connect to database:", error);
    return null;
  }
}
