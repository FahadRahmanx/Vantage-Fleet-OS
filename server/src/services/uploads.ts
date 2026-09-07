import { Prisma, UploadMode, UploadRowStatus, AliasKind } from "@prisma/client";
import ExcelJS from "exceljs";
import prisma from "../lib/prisma";
import { WorkflowError } from "./eligibility";

export interface RawImportRow {
  origin?: string;
  destination?: string;
  carrierName?: string;
  vehicleUnitNo?: string;
  driverName?: string;
}

export interface RowMatchResult {
  matchedVehicleId: string | null;
  matchedDriverId: string | null;
  hosNote: string | null;
  errors: string[];
  status: UploadRowStatus;
}

type Tx = Prisma.TransactionClient;

/**
 * matchOrCreateVehicle — FR-44's "vehicles found-or-created": an unmatched
 * unit number auto-creates a minimal Vehicle rather than erroring the row.
 * Idempotent-ish: called both at upload time and again at confirm time
 * (spec §5) as a defensive re-check against a stale read between the two.
 */
export async function matchOrCreateVehicle(
  tx: Tx,
  companyId: string,
  unitNumber: string | undefined
): Promise<string | null> {
  if (!unitNumber) return null;

  const existing = await tx.vehicle.findFirst({
    where: { companyId, unitNumber },
  });
  if (existing) return existing.id;

  const created = await tx.vehicle.create({
    data: {
      companyId,
      unitNumber,
      vin: `IMPORT-${crypto.randomUUID()}`,
      make: "Unknown",
      model: "Unknown",
      plate: "UNKNOWN",
      status: "active",
      dataSource: "import",
    },
  });
  return created.id;
}

/**
 * resolveCarrier — exact CarrierCompany.name match; legacy mode also
 * checks the Alias table. Carrier match is validation-only in this POC
 * (no write-through field on Load records it) — a miss is a row error,
 * a hit doesn't need to be returned to the caller.
 */
async function resolveCarrier(
  tx: Tx,
  companyId: string,
  mode: UploadMode,
  carrierName: string | undefined
): Promise<string | null> {
  if (!carrierName) return "Carrier name is required";

  const exact = await tx.carrierCompany.findFirst({
    where: { companyId, name: { equals: carrierName, mode: "insensitive" } },
  });
  if (exact) return null;

  if (mode === "legacy") {
    const alias = await tx.alias.findUnique({
      where: { companyId_kind_aliasText: { companyId, kind: "carrier", aliasText: carrierName } },
    });
    if (alias) {
      const target = await tx.carrierCompany.findUnique({ where: { id: alias.targetId } });
      if (target) return null;
    }
  }

  return `Carrier not found: ${carrierName}`;
}

/**
 * resolveVehicle — matches by unitNumber (+ alias in legacy mode), falling
 * back to found-or-created (§4 rule 2). Never errors the row.
 */
async function resolveVehicle(
  tx: Tx,
  companyId: string,
  mode: UploadMode,
  vehicleUnitNo: string | undefined
): Promise<string | null> {
  if (!vehicleUnitNo) return null;

  if (mode === "legacy") {
    const exact = await tx.vehicle.findFirst({ where: { companyId, unitNumber: vehicleUnitNo } });
    if (!exact) {
      const alias = await tx.alias.findUnique({
        where: { companyId_kind_aliasText: { companyId, kind: "vehicle", aliasText: vehicleUnitNo } },
      });
      if (alias) {
        const target = await tx.vehicle.findFirst({ where: { id: alias.targetId, companyId } });
        if (target) return target.id;
      }
    }
  }

  return matchOrCreateVehicle(tx, companyId, vehicleUnitNo);
}

/**
 * resolveDriver — matches by name (+ alias in legacy mode). Match-only,
 * never auto-created (§4 rule 3) — fabricating license/medical-cert data
 * would corrupt eligibility checks elsewhere in the system.
 */
async function resolveDriver(
  tx: Tx,
  companyId: string,
  mode: UploadMode,
  driverName: string | undefined
): Promise<{ id: string | null; error: string | null }> {
  if (!driverName) return { id: null, error: "Driver name is required" };

  const exact = await tx.driver.findFirst({
    where: { companyId, name: { equals: driverName, mode: "insensitive" } },
  });
  if (exact) return { id: exact.id, error: null };

  if (mode === "legacy") {
    const alias = await tx.alias.findUnique({
      where: { companyId_kind_aliasText: { companyId, kind: "driver", aliasText: driverName } },
    });
    if (alias) {
      const target = await tx.driver.findFirst({ where: { id: alias.targetId, companyId } });
      if (target) return { id: target.id, error: null };
    }
  }

  return { id: null, error: `Driver not found: ${driverName}` };
}

/**
 * hosNoteFor — informational-only annotation (spec §4 rule 5). Never
 * blocks row confirmation.
 */
async function hosNoteFor(tx: Tx, driverId: string | null): Promise<string | null> {
  if (!driverId) return null;
  const count = await tx.dutyStatusEntry.count({ where: { driverId } });
  return count > 0 ? "matched" : "no ledger data";
}

/**
 * matchAndValidateRow — runs every §4 rule for one row. Called both when
 * an Upload is first created (createUpload) and when re-validating rows
 * after an alias is added (addAliasAndRevalidate).
 */
export async function matchAndValidateRow(
  tx: Tx,
  companyId: string,
  mode: UploadMode,
  raw: RawImportRow
): Promise<RowMatchResult> {
  const errors: string[] = [];

  if (!raw.origin?.trim()) errors.push("Origin is required");
  if (!raw.destination?.trim()) errors.push("Destination is required");

  const carrierError = await resolveCarrier(tx, companyId, mode, raw.carrierName);
  if (carrierError) errors.push(carrierError);

  const matchedVehicleId = await resolveVehicle(tx, companyId, mode, raw.vehicleUnitNo);

  const { id: matchedDriverId, error: driverError } = await resolveDriver(tx, companyId, mode, raw.driverName);
  if (driverError) errors.push(driverError);

  const hosNote = await hosNoteFor(tx, matchedDriverId);

  return {
    matchedVehicleId,
    matchedDriverId,
    hosNote,
    errors,
    status: errors.length === 0 ? "ok" : "error",
  };
}

export const TEMPLATE_HEADERS = ["origin", "destination", "carrierName", "vehicleUnitNo", "driverName"] as const;

/**
 * parseWorkbook — reads the fixed-template .xlsx into raw rows. Rejects
 * anything that isn't a readable, macro-free workbook before a single
 * UploadRow is created (spec §7 — malformed files fail at parse, not
 * mid-transaction).
 */
export async function parseWorkbook(buffer: Buffer): Promise<RawImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new WorkflowError("Could not read file — expected a .xlsx spreadsheet");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new WorkflowError("Workbook has no sheets");
  }

  const headerRow = sheet.getRow(1).values as (string | undefined)[];
  // ExcelJS rows are 1-indexed with index 0 empty; slice it off.
  const headers = headerRow.slice(1).map((h) => String(h ?? "").trim());
  const headerIndex = Object.fromEntries(TEMPLATE_HEADERS.map((h) => [h, headers.indexOf(h)]));
  const missing = TEMPLATE_HEADERS.filter((h) => headerIndex[h] === -1);
  if (missing.length > 0) {
    throw new WorkflowError(`Missing required column(s): ${missing.join(", ")}`);
  }

  const rows: RawImportRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values as (string | number | undefined)[];
    const get = (col: string) => {
      const idx = headerIndex[col];
      const v = values[idx + 1];
      return v === undefined || v === null ? undefined : String(v).trim();
    };
    const raw: RawImportRow = {
      origin: get("origin"),
      destination: get("destination"),
      carrierName: get("carrierName"),
      vehicleUnitNo: get("vehicleUnitNo"),
      driverName: get("driverName"),
    };
    if (Object.values(raw).some((v) => v)) rows.push(raw);
  });

  if (rows.length === 0) {
    throw new WorkflowError("Workbook has no data rows");
  }

  return rows;
}

/**
 * buildTemplateWorkbook — FR-46's downloadable template, with
 * carrier/vehicle dropdowns populated from the requesting company's
 * actual records.
 */
export async function buildTemplateWorkbook(companyId: string): Promise<ExcelJS.Workbook> {
  const [carriers, vehicles] = await Promise.all([
    prisma.carrierCompany.findMany({ where: { companyId }, select: { name: true } }),
    prisma.vehicle.findMany({ where: { companyId }, select: { unitNumber: true } }),
  ]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Loads");
  sheet.addRow([...TEMPLATE_HEADERS]);
  sheet.getRow(1).font = { bold: true };

  if (carriers.length > 0) {
    const list = carriers.map((c) => `"${c.name.replace(/"/g, "")}"`).join(",");
    for (let r = 2; r <= 200; r++) {
      sheet.getCell(`C${r}`).dataValidation = { type: "list", formulae: [list] };
    }
  }
  if (vehicles.length > 0) {
    const list = vehicles.map((v) => `"${v.unitNumber}"`).join(",");
    for (let r = 2; r <= 200; r++) {
      sheet.getCell(`D${r}`).dataValidation = { type: "list", formulae: [list] };
    }
  }

  return workbook;
}

/**
 * createUpload — parses the file, creates the Upload + one UploadRow per
 * data row with matching/validation already applied, sets status to
 * "validated". One transaction so a crash mid-parse never leaves a
 * partial Upload.
 */
export async function createUpload(
  companyId: string,
  mode: UploadMode,
  fileName: string,
  buffer: Buffer,
  actorId: string
) {
  const rawRows = await parseWorkbook(buffer);

  return prisma.$transaction(async (tx) => {
    const upload = await tx.upload.create({
      data: { companyId, mode, fileName, totalRows: rawRows.length, createdById: actorId },
    });

    let errorRows = 0;
    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const result = await matchAndValidateRow(tx, companyId, mode, raw);
      if (result.status === "error") errorRows++;
      await tx.uploadRow.create({
        data: {
          uploadId: upload.id,
          rowIndex: i,
          rawData: raw as Prisma.InputJsonValue,
          carrierName: raw.carrierName,
          vehicleUnitNo: raw.vehicleUnitNo,
          driverName: raw.driverName,
          origin: raw.origin,
          destination: raw.destination,
          matchedVehicleId: result.matchedVehicleId,
          matchedDriverId: result.matchedDriverId,
          hosNote: result.hosNote,
          errors: result.errors,
          status: result.status,
        },
      });
    }

    return tx.upload.update({
      where: { id: upload.id },
      data: { errorRows, status: "validated" },
      include: { rows: true },
    });
  }, { timeout: 30000 });
}

async function loadUploadForActor(tx: Tx, uploadId: string, actorCompanyId: string) {
  const upload = await tx.upload.findUnique({ where: { id: uploadId }, include: { rows: true } });
  if (!upload) throw new WorkflowError("Upload not found");
  if (upload.companyId !== actorCompanyId) {
    throw new WorkflowError("Upload does not belong to actor's company");
  }
  return upload;
}

/**
 * addAliasAndRevalidate — FR-45's "add-alias-and-revalidate without
 * re-uploading". Legacy mode only. Re-runs matching only on rows that are
 * currently erroring, so an unrelated row's state never changes.
 */
export async function addAliasAndRevalidate(
  uploadId: string,
  kind: AliasKind,
  aliasText: string,
  targetId: string,
  actorId: string
) {
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const upload = await loadUploadForActor(tx, uploadId, actor.companyId);

    if (upload.mode !== "legacy") {
      throw new WorkflowError("Aliases can only be added to legacy-mode uploads");
    }

    await tx.alias.upsert({
      where: { companyId_kind_aliasText: { companyId: actor.companyId, kind, aliasText } },
      create: { companyId: actor.companyId, kind, aliasText, targetId },
      update: { targetId },
    });

    for (const row of upload.rows) {
      if (row.status === "ok") continue;
      const result = await matchAndValidateRow(tx, actor.companyId, upload.mode, {
        origin: row.origin ?? undefined,
        destination: row.destination ?? undefined,
        carrierName: row.carrierName ?? undefined,
        vehicleUnitNo: row.vehicleUnitNo ?? undefined,
        driverName: row.driverName ?? undefined,
      });
      await tx.uploadRow.update({
        where: { id: row.id },
        data: {
          matchedVehicleId: result.matchedVehicleId,
          matchedDriverId: result.matchedDriverId,
          hosNote: result.hosNote,
          errors: result.errors,
          status: result.status,
        },
      });
    }

    const errorRows = await tx.uploadRow.count({ where: { uploadId, status: "error" } });
    return tx.upload.update({
      where: { id: uploadId },
      data: { errorRows },
      include: { rows: true },
    });
  }, { timeout: 30000 });
}

/**
 * confirmUpload — all-or-nothing (spec §5): every row must already be
 * "ok" or the whole call throws before any Load is created. One
 * transaction creates one Load per row; vehicle matching is re-resolved
 * defensively in case of a stale read since the upload was validated.
 */
export async function confirmUpload(uploadId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const upload = await loadUploadForActor(tx, uploadId, actor.companyId);

    if (upload.status !== "validated") {
      throw new WorkflowError(`Upload is not in a confirmable state (status: ${upload.status})`);
    }
    if (upload.rows.some((r) => r.status !== "ok")) {
      throw new WorkflowError("Every row must be valid before confirming");
    }

    const createdStatus = await tx.dispatchStatus.findFirst({
      where: { companyId: actor.companyId, isDefault: true },
    });
    if (!createdStatus) throw new WorkflowError("No default status found for this company");

    const createdLoadIds: string[] = [];
    for (const row of upload.rows) {
      const vehicleId = row.vehicleUnitNo
        ? await matchOrCreateVehicle(tx, actor.companyId, row.vehicleUnitNo)
        : null;

      const count = await tx.load.count();
      const reference = `VFO${String(count + 1).padStart(7, "0")}`;
      const load = await tx.load.create({
        data: {
          reference,
          origin: row.origin!,
          destination: row.destination!,
          companyId: actor.companyId,
          creatorId: actor.id,
          driverId: row.matchedDriverId,
          vehicleId,
          currentStatusId: createdStatus.id,
        },
      });
      createdLoadIds.push(load.id);
    }

    return tx.upload.update({
      where: { id: uploadId },
      data: { status: "complete", createdLoadIds },
      include: { rows: true },
    });
  }, { timeout: 30000 });
}
