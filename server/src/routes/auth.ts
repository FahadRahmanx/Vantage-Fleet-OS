import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { signToken } from "../middleware/auth";
import { getInvitePreview, acceptInvite, requestPasswordReset, resetPassword } from "../services/users";
import { WorkflowError } from "../services/eligibility";

const router = Router();

/**
 * POST /auth/login
 * Body: { email, password }
 * Returns: { token, user: { id, email, name, role, companyId } }
 */
router.post("/login", async (req: Request, res: Response) => {
  const { email, password, rememberMe } = req.body;

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
  }, rememberMe ? "30d" : "24h");

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

/**
 * GET /auth/invite/:token
 * Public — prefills the accept-invite page.
 */
router.get("/invite/:token", async (req: Request, res: Response) => {
  try {
    const preview = await getInvitePreview(req.params.token as string);
    res.json(preview);
  } catch (e) {
    if (e instanceof WorkflowError) {
      const status = e.message.includes("not found") ? 404 : 410;
      return res.status(status).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * POST /auth/accept-invite
 * Public. Body: { token, password }. Returns the same { token, user }
 * shape as /auth/login so the client can reuse its post-login logic.
 */
router.post("/accept-invite", async (req: Request, res: Response) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: "token and password are required" });
  }

  try {
    const user = await acceptInvite(token, password);
    const signed = signToken({
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      platformAdmin: user.platformAdmin,
      driverId: user.driverId ?? undefined,
    });
    res.json({
      token: signed,
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
  } catch (e) {
    if (e instanceof WorkflowError) {
      const status = e.message.includes("not found") ? 404 : 410;
      return res.status(status).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * POST /auth/forgot-password
 * Public. Body: { email }. Always 200 — never reveals whether the email
 * matches an account.
 */
router.post("/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }
  await requestPasswordReset(email);
  res.json({ ok: true });
});

/**
 * POST /auth/reset-password
 * Public. Body: { token, password }.
 */
router.post("/reset-password", async (req: Request, res: Response) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: "token and password are required" });
  }
  try {
    await resetPassword(token, password);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof WorkflowError) {
      const status = e.message.includes("not found") ? 404 : 410;
      return res.status(status).json({ error: e.message });
    }
    throw e;
  }
});

export default router;
