import crypto from "node:crypto";
import { Router, Request, Response } from "express";
import multer from "multer";
import prisma from "../lib/prisma";
import { requireCapability, canManageHelpArticles } from "../middleware/permissions";
import { uploadDocument, getPresignedUrl } from "../services/storage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const HELP_ARTICLE_WRITABLE_FIELDS = ["title", "summary", "keywords", "content", "published", "order", "visibleToCarriers"] as const;

function pickHelpArticleFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of HELP_ARTICLE_WRITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    picked[field] = body[field];
  }
  return picked;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * GET /api/help-articles
 * FR-51. Every authenticated role. Published only; a driver actor
 * additionally never sees visibleToCarriers: false rows.
 */
router.get("/", async (req: Request, res: Response) => {
  const where: Record<string, unknown> = { companyId: req.auth!.companyId, published: true };
  if (req.auth!.role === "driver" && !req.auth!.platformAdmin) {
    where.visibleToCarriers = true;
  }
  const articles = await prisma.helpArticle.findMany({ where, orderBy: [{ order: "asc" }, { title: "asc" }] });
  res.json(articles);
});

/**
 * GET /api/help-articles/admin
 * FR-51. Fleet Admin+. Every article, published and draft.
 */
router.get("/admin", requireCapability(canManageHelpArticles), async (req: Request, res: Response) => {
  const articles = await prisma.helpArticle.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: [{ order: "asc" }, { title: "asc" }],
  });
  res.json(articles);
});

/**
 * POST /api/help-articles
 * FR-51. Body: { title, summary, content, keywords?, published?, order?, visibleToCarriers? }
 */
router.post("/", requireCapability(canManageHelpArticles), async (req: Request, res: Response) => {
  const { title, summary, content } = req.body;
  if (!title || !summary || !content) {
    return res.status(400).json({ error: "title, summary, and content are required" });
  }

  const fields = pickHelpArticleFields(req.body);
  const article = await prisma.helpArticle.create({
    data: { companyId: req.auth!.companyId, ...fields, title, summary, content },
  });
  res.status(201).json(article);
});

/**
 * PATCH /api/help-articles/:id
 * FR-51. Body: any subset of the whitelisted fields.
 */
router.patch("/:id", requireCapability(canManageHelpArticles), async (req: Request, res: Response) => {
  const existing = await prisma.helpArticle.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Help article not found" });
  }

  const fields = pickHelpArticleFields(req.body);
  const updated = await prisma.helpArticle.update({ where: { id: existing.id }, data: fields });
  res.json(updated);
});

/**
 * POST /api/help-articles/images
 * FR-51. multipart/form-data: file. Returns { url } for the editor to
 * insert as an <img src>. Reuses the existing storage service — same
 * S3-or-in-memory fallback every other upload in this app already uses.
 */
router.post("/images", requireCapability(canManageHelpArticles), upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "file is required" });
  }
  const key = `help-articles/${crypto.randomUUID()}-${sanitizeFileName(req.file.originalname)}`;
  await uploadDocument(key, req.file.buffer, req.file.mimetype);
  const url = await getPresignedUrl(key);
  res.status(201).json({ url });
});

export default router;
