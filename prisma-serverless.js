// prisma-serverless.js - simplified version
import { PrismaClient } from "@prisma/client";

// Create a new PrismaClient instance with explicit engine type
export const prisma = new PrismaClient({
  engineType: "binary",
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
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
