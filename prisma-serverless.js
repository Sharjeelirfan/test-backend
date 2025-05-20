// prisma-serverless.js
import { PrismaClient } from "@prisma/client";

// Create a simple PrismaClient instance WITHOUT engineType
export const prisma = new PrismaClient({
  log: ["error"],
});

// Simple connection function
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
