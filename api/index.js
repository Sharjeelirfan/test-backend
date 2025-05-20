// api/index.js
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs"; // Use only bcryptjs
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { prisma, connectPrisma } from "../prisma-serverless.js";
dotenv.config();
const app = express();
app.use(cors({}));
app.use(express.json());

connectPrisma().catch(console.error);
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-development";

// Add proper cleanup for serverless
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

app.get("/", (req, res) => {
  res.send("API is running");
});

app.get("/env-debug", (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV || "not set",
    vercel: process.env.VERCEL || "not set",
    vercelEnv: process.env.VERCEL_ENV || "not set",
    region: process.env.VERCEL_REGION || "not set",
    DATABASE_URL: process.env.DATABASE_URL ? "set (hidden)" : "not set",
  });
});

// Add a debug route to check Prisma connection
// Add this to your api/index.js
app.get("/debug", async (req, res) => {
  try {
    // Test database connection
    const userCount = await prisma.user.count();

    res.json({
      status: "OK",
      databaseConnected: true,
      userCount,
      environment: {
        nodeEnv: process.env.NODE_ENV || "not set",
        databaseUrl: process.env.DATABASE_URL ? "set (hidden)" : "not set",
        port: process.env.PORT || "not set",
      },
      prismaVersion: prisma._engineConfig.version,
    });
  } catch (error) {
    console.error("Debug route error:", error);
    res.status(500).json({
      status: "ERROR",
      error: error.message,
      code: error.code,
      meta: error.meta,
    });
  }
});
// Register Route
app.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser)
      return res.status(400).json({ error: "Email already exists" });

    const roleUpper = role.toUpperCase();

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, role: roleUpper },
    });

    // Generate tokens
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.name,
        useremail: user.email,
        role: roleUpper,
      },
      JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );
    const refreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Send response with tokens
    res.json({
      message: "User registered successfully",
      userId: user.id,
      token,
      refreshToken,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login Route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  // console.log(email, password);

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      {
        userId: user.id,
        username: user.name,
        useremail: user.email,
        role: user.role,
      },
      JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    const refreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ token, refreshToken });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Middleware to authenticate JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);

    req.user = user;
    next();
  });
}

// Refresh Token Route
app.post("/refresh-token", async (req, res) => {
  const refreshToken = req.body.refreshToken;

  if (!refreshToken)
    return res.status(401).json({ error: "No refresh token provided" });

  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET);

    // Generate new access token
    const newAccessToken = jwt.sign({ userId: payload.userId }, JWT_SECRET, {
      expiresIn: "15m",
    });

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired refresh token" });
  }
});

// Create Note
app.post("/notes", authenticateToken, async (req, res) => {
  const { title, description, visibility, tags } = req.body;
  try {
    const note = await prisma.note.create({
      data: {
        title,
        description,
        visibility,
        tags,
        userId: req.user.userId,
      },
    });
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get User Notes
app.get("/notes", authenticateToken, async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      where: { userId: req.user.userId },
    });
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get Note by ID
app.get("/notes/:id", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid note ID" });
  }
  try {
    const note = await prisma.note.findUnique({
      where: { id },
    });

    if (!note || note.userId !== req.user.userId) {
      return res.status(404).json({ message: "Note not found" });
    }

    res.json(note);
  } catch (err) {
    console.error("Error fetching note:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update Note
app.put("/notes/:id", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, description, visibility, tags } = req.body;

  try {
    const note = await prisma.note.findUnique({
      where: { id },
    });

    if (!note || note.userId !== req.user.userId) {
      return res.status(404).json({ error: "Note not found or unauthorized" });
    }

    const updatedNote = await prisma.note.update({
      where: { id },
      data: {
        title,
        description,
        visibility,
        tags,
      },
    });

    res.json(updatedNote);
  } catch (err) {
    console.error("Error updating note:", err);
    res.status(500).json({ error: "Failed to update note" });
  }
});

// Delete Note
app.delete("/notes/:id", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const note = await prisma.note.findUnique({
      where: { id },
    });

    if (!note || note.userId !== req.user.userId) {
      return res.status(404).json({ error: "Note not found or unauthorized" });
    }

    await prisma.note.delete({
      where: { id },
    });

    res.json({ message: "Note deleted successfully" });
  } catch (err) {
    console.error("Error deleting note:", err);
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// Get public notes
app.get("/notes/public", async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      where: {
        visibility: "PUBLIC",
      },
    });
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch public notes" });
  }
});

// Get private notes for current user
app.get("/notes/private", authenticateToken, async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      where: {
        userId: req.user.userId,
        visibility: "PRIVATE",
      },
    });

    res.json(notes);
  } catch (err) {
    console.error("Error in /notes/private:", err);
    res.status(500).json({ error: "Failed to fetch private notes" });
  }
});

// Start the server
if (import.meta.url === import.meta.main) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

export default app;

const port = 4000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
