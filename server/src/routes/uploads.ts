import { Router, Request, Response } from "express";
import multer from "multer";
import prisma from "../lib/prisma";
import { WorkflowError } from "../services/eligibility";
import { requireCapability, canDispatchWrite } from "../middleware/permissions";
import { createUpload, addAliasAndRevalidate, confirmUpload, buildTemplateWorkbook } from "../services/uploads";

const router = Router();

// Accept only the real .xlsx mimetype — rejects .xlsm (macro-enabled) and
// anything else at the boundary, before a single UploadRow is created.
const XLSX_MIMETYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== XLSX_MIMETYPE) {
      return cb(new Error("Only .xlsx spreadsheets are accepted"));
    }
    cb(null, true);
  },
});

function handleUploadError(e: unknown, res: Response) {
  if (e instanceof WorkflowError) {
    const status = e.message.includes("not found") || e.message.includes("does not belong") ? 404 : 400;
    return res.status(status).json({ error: e.message });
  }
  throw e;
}

/**
 * GET /api/uploads/template
 * FR-46 — downloadable pre-formatted spreadsheet with carrier/vehicle
 * dropdowns for the requesting company.
 */
router.get("/template", async (req: Request, res: Response) => {
  const workbook = await buildTemplateWorkbook(req.auth!.companyId);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="load-import-template.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

/**
 * GET /api/uploads
 * FR-46 — upload history for the acting company, newest first.
 */
router.get("/", async (req: Request, res: Response) => {
  const uploads = await prisma.upload.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  res.json(uploads);
});

/**
 * GET /api/uploads/:id
 * Full upload + all rows, for the preview screen.
 */
router.get("/:id", async (req: Request, res: Response) => {
  const found = await prisma.upload.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
    include: {
      rows: { orderBy: { rowIndex: "asc" } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!found) return res.status(404).json({ error: "Upload not found" });
  res.json(found);
});

/**
 * POST /api/uploads
 * multipart/form-data: file (.xlsx), mode ("standard" | "legacy").
 */
router.post("/", requireCapability(canDispatchWrite), upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const mode = req.body.mode === "legacy" ? "legacy" : "standard";

  try {
    const result = await createUpload(req.auth!.companyId, mode, req.file.originalname, req.file.buffer, req.auth!.userId);
    res.status(201).json(result);
  } catch (e) {
    handleUploadError(e, res);
  }
});

/**
 * POST /api/uploads/:id/aliases
 * Legacy mode only. body: { kind, aliasText, targetId }.
 */
router.post("/:id/aliases", requireCapability(canDispatchWrite), async (req: Request, res: Response) => {
  const { kind, aliasText, targetId } = req.body;
  if (!kind || !aliasText || !targetId) {
    return res.status(400).json({ error: "kind, aliasText, and targetId are required" });
  }

  try {
    const result = await addAliasAndRevalidate(req.params.id as string, kind, aliasText, targetId, req.auth!.userId);
    res.json(result);
  } catch (e) {
    handleUploadError(e, res);
  }
});

/**
 * POST /api/uploads/:id/confirm
 */
router.post("/:id/confirm", requireCapability(canDispatchWrite), async (req: Request, res: Response) => {
  try {
    const result = await confirmUpload(req.params.id as string, req.auth!.userId);
    res.json(result);
  } catch (e) {
    handleUploadError(e, res);
  }
});

export default router;
