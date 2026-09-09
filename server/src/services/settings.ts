import prisma from "../lib/prisma";

/**
 * getSetting — never throws on a missing key; returns `fallback` instead,
 * since every consumer must supply a sane default (FR-55's store has no
 * schema-of-allowed-keys to validate against).
 */
export async function getSetting(companyId: string, key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { companyId_key: { companyId, key } } });
  return row?.value ?? fallback;
}

export async function getAllSettings(companyId: string) {
  return prisma.setting.findMany({ where: { companyId }, orderBy: { key: "asc" } });
}

/**
 * setSetting — upsert on the (companyId, key) unique constraint. No
 * delete path exists (spec §6) — an unwanted key is overwritten, not
 * removed.
 */
export async function setSetting(companyId: string, key: string, value: string) {
  return prisma.setting.upsert({
    where: { companyId_key: { companyId, key } },
    create: { companyId, key, value },
    update: { value },
  });
}
