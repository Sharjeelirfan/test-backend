import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();
const prisma = new PrismaClient();
const app = express();
app.use(cors({}));
app.use(express.json());

const JWT_SECRET = process.env.NEXT_PUBLIC_JWT_SECRET;

// const loginLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 5,
//   message: "Too many login attempts, please try again later.",
// });

app.get("/", (req, res) => {
  res.send("Hello from API");
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
      NEXT_PUBLIC_JWT_SECRET,
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
      NEXT_PUBLIC_JWT_SECRET,
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

  jwt.verify(token, NEXT_PUBLIC_JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    // console.log("Decoded user:", user); // check if userId exists

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
    const payload = jwt.verify(refreshToken, NEXT_PUBLIC_JWT_SECRET);

    // Generate new access token
    const newAccessToken = jwt.sign(
      { userId: payload.userId },
      NEXT_PUBLIC_JWT_SECRET,
      {
        expiresIn: "15m",
      }
    );

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
    console.log(notes);
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch public notes" });
  }
});

// Get private notes for current user
app.get("/notes/private", authenticateToken, async (req, res) => {
  try {
    console.log("Decoded user in /notes/private:", req.user); // 👈 check this
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
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
