import { Router, Request, Response } from "express";
import multer from "multer";
import prisma from "../lib/prisma";
import { advance, revert, assignDriver, createLoad, updateLoad } from "../services/workflow";
import { WorkflowError, EligibilityError } from "../services/eligibility";
import { requireCapability, canDispatchWrite, scopeLoadsForActor } from "../middleware/permissions";
import { buildKey, uploadDocument, getPresignedUrl, deleteDocument } from "../services/storage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_DOCUMENT_MIMETYPES = ["application/pdf", "image/jpeg", "image/png"];
const DOCUMENT_TYPES = ["bill_of_lading", "pod", "other"];

/**
 * GET /api/loads
 * List loads scoped to the authenticated user's company (FR-3).
 */
router.get("/", async (req: Request, res: Response) => {
  const uploadIdFilter = req.query.uploadId
    ? { id: { in: (await prisma.upload.findUnique({ where: { id: req.query.uploadId as string } }))?.createdLoadIds ?? [] } }
    : {};
  const loads = await prisma.load.findMany({
    where: scopeLoadsForActor(req.auth!, { companyId: req.auth!.companyId, ...uploadIdFilter }),
    include: {
      currentStatus: true,
      driver: { select: { id: true, name: true } },
      vehicle: { select: { id: true, make: true, model: true, plate: true, unitNumber: true } },
      creator: { select: { id: true, name: true } },
      _count: { select: { documents: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(loads);
});

/**
 * POST /api/loads
 * Create a new load in "created" status.
 */
router.post("/", requireCapability(canDispatchWrite), async (req: Request, res: Response) => {
  const { origin, destination } = req.body;
  if (!origin || !destination) {
    return res.status(400).json({ error: "origin and destination are required" });
  }

  try {
    const load = await createLoad(origin, destination, req.auth!.companyId, req.auth!.userId);
    res.status(201).json(load);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(500).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * GET /api/loads/:id
 * Load detail with status history.
 */
router.get("/:id", async (req: Request, res: Response) => {
  const load = await prisma.load.findFirst({
    where: scopeLoadsForActor(req.auth!, { id: req.params.id, companyId: req.auth!.companyId }),
    include: {
      currentStatus: true,
      driver: true,
      vehicle: true,
      creator: { select: { id: true, name: true, email: true } },
      statusLogs: {
        include: {
          fromStatus: true,
          toStatus: true,
          actor: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!load) {
    return res.status(404).json({ error: "Load not found" });
  }

  res.json(load);
});

/**
 * PATCH /api/loads/:id
 * Body: { origin?, destination? }
 * FR-20: editable only while in the default "Created" status.
 */
router.patch("/:id", requireCapability(canDispatchWrite), async (req: Request, res: Response) => {
  const { origin, destination } = req.body;
  if (origin === undefined && destination === undefined) {
    return res.status(400).json({ error: "origin and/or destination are required" });
  }

  try {
    const updated = await updateLoad(req.params.id, req.auth!.userId, { origin, destination });
    res.json(updated);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * POST /api/loads/:id/assign
 * Body: { driverId, vehicleId }
 * Assigns driver + vehicle with eligibility check.
 */
router.post("/:id/assign", requireCapability(canDispatchWrite), async (req: Request, res: Response) => {
  const { driverId, vehicleId } = req.body;
  if (!driverId || !vehicleId) {
    return res.status(400).json({ error: "driverId and vehicleId are required" });
  }

  try {
    const updated = await assignDriver(
      req.params.id,
      driverId,
      vehicleId,
      req.auth!.userId
    );
    res.json(updated);
  } catch (e) {
    if (e instanceof EligibilityError) {
      return res.status(422).json({ error: "Driver not eligible", reason: e.message });
    }
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * POST /api/loads/:id/advance
 * Body: { targetStatusId }
 * Advances the load to the target status (validates transition from DB).
 * No blanket capability gate here — authorization is data-driven via the
 * current status's roleVisibility (checked inside advance() itself), since
 * FR-23/36/41 require different roles (maintenance_tech, compliance_officer)
 * to legitimately advance a load depending on which status it's currently in.
 */
router.post("/:id/advance", async (req: Request, res: Response) => {
  const { targetStatusId, comment, stopCount } = req.body;

  try {
    const result = await advance(req.params.id, targetStatusId, req.auth!.userId, { comment, stopCount });
    res.json(result);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    if (e instanceof EligibilityError) {
      return res.status(422).json({ error: "Driver not eligible", reason: e.message });
    }
    throw e;
  }
});

/**
 * POST /api/loads/:id/revert
 * Body: { targetStatusId }
 * Reverts the load to a previous status (validates reverse transition from DB).
 * Same rationale as advance() above — no blanket gate, roleVisibility does
 * the real check.
 */
router.post("/:id/revert", async (req: Request, res: Response) => {
  const { targetStatusId, comment } = req.body;
  if (!targetStatusId) {
    return res.status(400).json({ error: "targetStatusId is required" });
  }

  try {
    const result = await revert(req.params.id, targetStatusId, req.auth!.userId, { comment });
    res.json(result);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * POST /api/loads/:id/documents
 * multipart/form-data: file, type ("bill_of_lading" | "pod" | "other")
 */
router.post("/:id/documents", requireCapability(canDispatchWrite), upload.single("file"), async (req: Request, res: Response) => {
  const loadId = req.params.id as string;
  const type = req.body.type;

  if (!req.file) {
    return res.status(400).json({ error: "file is required" });
  }
  if (!DOCUMENT_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${DOCUMENT_TYPES.join(", ")}` });
  }
  if (!ALLOWED_DOCUMENT_MIMETYPES.includes(req.file.mimetype)) {
    return res.status(400).json({ error: "Only PDF, JPG, and PNG files are accepted" });
  }

  const load = await prisma.load.findFirst({ where: { id: loadId, companyId: req.auth!.companyId } });
  if (!load) {
    return res.status(404).json({ error: "Load not found" });
  }

  const key = buildKey(loadId, req.file.originalname);

  try {
    await uploadDocument(key, req.file.buffer, req.file.mimetype);
  } catch {
    return res.status(502).json({ error: "Failed to upload document to storage" });
  }

  const document = await prisma.loadDocument.create({
    data: {
      loadId,
      type,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      s3Key: key,
      uploadedById: req.auth!.userId,
    },
  });

  res.status(201).json(document);
});

/**
 * GET /api/loads/:id/documents
 * Returns every document with a freshly presigned URL.
 */
router.get("/:id/documents", async (req: Request, res: Response) => {
  const loadId = req.params.id as string;

  const load = await prisma.load.findFirst({
    where: scopeLoadsForActor(req.auth!, { id: loadId, companyId: req.auth!.companyId }),
  });
  if (!load) {
    return res.status(404).json({ error: "Load not found" });
  }

  const documents = await prisma.loadDocument.findMany({
    where: { loadId },
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const withUrls = await Promise.all(
    documents.map(async (d) => ({ ...d, url: await getPresignedUrl(d.s3Key) }))
  );

  res.json(withUrls);
});

/**
 * DELETE /api/loads/:id/documents/:docId
 */
router.delete("/:id/documents/:docId", requireCapability(canDispatchWrite), async (req: Request, res: Response) => {
  const loadId = req.params.id as string;
  const docId = req.params.docId as string;

  const document = await prisma.loadDocument.findFirst({
    where: { id: docId, loadId, load: { companyId: req.auth!.companyId } },
  });
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  await deleteDocument(document.s3Key);
  await prisma.loadDocument.delete({ where: { id: document.id } });

  res.status(204).send();
});

export default router;
