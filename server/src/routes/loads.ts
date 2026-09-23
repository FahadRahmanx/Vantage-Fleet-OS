import { Router, Request, Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import prisma from "../lib/prisma";
import { advance, revert, assignDriver, createLoad, updateLoad } from "../services/workflow";
import { WorkflowError, EligibilityError } from "../services/eligibility";
import { requireCapability, canDispatchWrite, canBulkRevert, scopeLoadsForActor } from "../middleware/permissions";
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
      routeStop: { select: { route: { select: { id: true, reference: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(loads);
});

/**
 * POST /api/loads/export
 * Small feature: exports the client's already-filtered, already-sorted
 * Loads list view to .xlsx. Body: { loadIds: string[] } — company-scoped,
 * so an id belonging to another company simply isn't in the result rather
 * than erroring (same read the caller already had via GET /api/loads).
 */
router.post("/export", async (req: Request, res: Response) => {
  const { loadIds } = req.body as { loadIds?: unknown };
  if (!Array.isArray(loadIds) || loadIds.length === 0) {
    return res.status(400).json({ error: "loadIds must be a non-empty array" });
  }

  const loads = await prisma.load.findMany({
    where: scopeLoadsForActor(req.auth!, { id: { in: loadIds }, companyId: req.auth!.companyId }),
    include: {
      currentStatus: true,
      driver: { select: { name: true } },
      vehicle: { select: { plate: true } },
      routeStop: { select: { route: { select: { reference: true } } } },
    },
  });
  const byId = new Map(loads.map((l) => [l.id, l]));
  const ordered = loadIds.map((id) => byId.get(id as string)).filter((l): l is (typeof loads)[number] => !!l);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Loads");
  sheet.addRow(["Reference", "Origin", "Destination", "Status", "Driver", "Vehicle", "Route", "Created"]);
  sheet.getRow(1).font = { bold: true };
  for (const l of ordered) {
    sheet.addRow([
      l.reference,
      l.origin,
      l.destination,
      l.currentStatus.name,
      l.driver?.name ?? "",
      l.vehicle?.plate ?? "",
      l.routeStop?.route.reference ?? "",
      l.createdAt.toISOString().slice(0, 10),
    ]);
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="loads-export.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
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
 * POST /api/loads/bulk-advance
 * FR-32. Body: { loadIds: string[] }. Each load resolves via its own
 * default-transition edge (same resolution advance() does when no
 * explicit target is given). Never all-or-nothing — one bad load in the
 * batch doesn't block the rest.
 */
router.post("/bulk-advance", requireCapability(canDispatchWrite), async (req: Request, res: Response) => {
  const { loadIds } = req.body;
  if (!Array.isArray(loadIds) || loadIds.length === 0) {
    return res.status(400).json({ error: "loadIds must be a non-empty array" });
  }

  const results: { loadId: string; success: boolean; error?: string }[] = [];
  for (const loadId of loadIds) {
    try {
      await advance(loadId, undefined, req.auth!.userId, { batch: true });
      results.push({ loadId, success: true });
    } catch (e) {
      const message = e instanceof WorkflowError || e instanceof EligibilityError ? e.message : "Unexpected error";
      results.push({ loadId, success: false, error: message });
    }
  }
  res.json({ results });
});

/**
 * POST /api/loads/bulk-revert
 * FR-33. Body: { loadIds: string[], targetStatusId: string }. Gated to
 * fleet_admin/platformAdmin (canBulkRevert), stricter than single-load
 * revert's roleVisibility-only gate.
 */
router.post("/bulk-revert", requireCapability(canBulkRevert), async (req: Request, res: Response) => {
  const { loadIds, targetStatusId } = req.body;
  if (!Array.isArray(loadIds) || loadIds.length === 0 || !targetStatusId) {
    return res.status(400).json({ error: "loadIds (non-empty array) and targetStatusId are required" });
  }

  const results: { loadId: string; success: boolean; error?: string }[] = [];
  for (const loadId of loadIds) {
    try {
      await revert(loadId, targetStatusId, req.auth!.userId, { batch: true });
      results.push({ loadId, success: true });
    } catch (e) {
      const message = e instanceof WorkflowError ? e.message : "Unexpected error";
      results.push({ loadId, success: false, error: message });
    }
  }
  res.json({ results });
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
