import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import prisma from "../lib/prisma";
import { WorkflowError } from "./eligibility";
import { sendInviteEmail, sendPasswordResetEmail } from "./mailer";

const ASSIGNABLE_ROLES: UserRole[] = ["driver", "dispatcher", "maintenance_tech", "compliance_officer", "fleet_admin"];
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface InviteUserParams {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  carrierCompanyId?: string;
  driverId?: string;
  companyId: string;
}

async function createTokenAndSend(userId: string, name: string, email: string, isResend: boolean) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.inviteToken.create({
    data: { userId, token, expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS) },
  });
  const acceptUrl = `${process.env.CLIENT_BASE_URL || "http://localhost:5173"}/accept-invite?token=${token}`;
  await sendInviteEmail(email, name, acceptUrl, isResend);
}

/**
 * inviteUser — FR-6. Validates (spec §4), creates the User with an
 * unusable placeholder password and status "invited", then sends the
 * email. Throws WorkflowError before any write on every validation
 * failure — no partial User-without-InviteToken state.
 */
export async function inviteUser(params: InviteUserParams) {
  if (!ASSIGNABLE_ROLES.includes(params.role)) {
    throw new WorkflowError(`Invalid role: ${params.role}`);
  }

  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    throw new WorkflowError("A user with this email already exists");
  }

  if (params.role === "driver") {
    if (!params.carrierCompanyId || !params.driverId) {
      throw new WorkflowError("carrierCompanyId and driverId are required when role is driver");
    }
    const driver = await prisma.driver.findFirst({
      where: { id: params.driverId, companyId: params.companyId, carrierCompanyId: params.carrierCompanyId },
      include: { user: true },
    });
    if (!driver) {
      throw new WorkflowError("Driver not found in that carrier company");
    }
    if (driver.user) {
      throw new WorkflowError("Driver is already linked to a user");
    }
  } else if (params.carrierCompanyId || params.driverId) {
    throw new WorkflowError("carrierCompanyId/driverId only apply to the driver role");
  }

  const placeholderHash = await bcrypt.hash(crypto.randomUUID(), 10);
  const name = `${params.firstName} ${params.lastName}`.trim();

  const user = await prisma.user.create({
    data: {
      email: params.email,
      passwordHash: placeholderHash,
      name,
      role: params.role,
      companyId: params.companyId,
      status: "invited",
      driverId: params.role === "driver" ? params.driverId : undefined,
    },
  });

  await createTokenAndSend(user.id, name, user.email, false);

  return user;
}

/**
 * resendInvite — FR-6. 400 if the target user isn't currently "invited".
 * Issues a fresh InviteToken rather than mutating an existing one.
 */
export async function resendInvite(userId: string, actorCompanyId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, companyId: actorCompanyId } });
  if (!user) throw new WorkflowError("User not found");
  if (user.status !== "invited") throw new WorkflowError("User is not in invited status");

  await createTokenAndSend(user.id, user.name, user.email, true);
  return user;
}

async function findValidToken(token: string) {
  const inviteToken = await prisma.inviteToken.findUnique({ where: { token }, include: { user: true } });
  if (!inviteToken) throw new WorkflowError("Invite token not found");
  if (inviteToken.usedAt) throw new WorkflowError("Invite token has already been used");
  if (inviteToken.expiresAt < new Date()) throw new WorkflowError("Invite token has expired");
  return inviteToken;
}

/**
 * getInvitePreview — GET /auth/invite/:token. Read-only, no side effects.
 */
export async function getInvitePreview(token: string) {
  const inviteToken = await findValidToken(token);
  return { name: inviteToken.user.name, email: inviteToken.user.email, role: inviteToken.user.role };
}

/**
 * acceptInvite — FR-6. Sets the real password, activates the account,
 * marks the token used. Caller (routes/auth.ts) signs a JWT from the
 * returned user, same shape as /auth/login.
 */
export async function acceptInvite(token: string, password: string) {
  const inviteToken = await findValidToken(token);

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: inviteToken.userId }, data: { passwordHash, status: "active" } }),
    prisma.inviteToken.update({ where: { id: inviteToken.id }, data: { usedAt: new Date() } }),
  ]);

  return user;
}

/**
 * requestPasswordReset — FR-5. Always resolves without error, even when no
 * user matches the email, so callers (routes/auth.ts) can return a uniform
 * 200 and avoid leaking which emails have accounts.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });
  const resetUrl = `${process.env.CLIENT_BASE_URL || "http://localhost:5173"}/reset-password?token=${token}`;
  await sendPasswordResetEmail(user.email, user.name, resetUrl);
}

/**
 * resetPassword — FR-5. Validates the token same as findValidToken does for
 * invites, then updates the password and marks the token used in one
 * transaction.
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!resetToken) throw new WorkflowError("Password reset token not found");
  if (resetToken.usedAt) throw new WorkflowError("Password reset token has already been used");
  if (resetToken.expiresAt < new Date()) throw new WorkflowError("Password reset token has expired");

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
  ]);
}
