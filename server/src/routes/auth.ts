import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { signToken } from "../middleware/auth";

const router = Router();

/**
 * POST /auth/login
 * Body: { email, password }
 * Returns: { token, user: { id, email, name, role, companyId } }
 */
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    platformAdmin: user.platformAdmin,
    driverId: user.driverId ?? undefined,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      platformAdmin: user.platformAdmin,
      driverId: user.driverId,
      companyId: user.companyId,
    },
  });
});

export default router;
