import { Router, Request, Response } from "express";
import { requireCapability, canManageSettings } from "../middleware/permissions";
import { getSetting, setSetting } from "../services/settings";
import { ALL_ROLES, AssignableRole, EMPTY_NAV_LAYOUT, NAV_REGISTRY, NavLayout, resolveNavForRole } from "../nav-registry";

const router = Router();

function layoutSettingKey(role: string) {
  return `nav_layout_${role}`;
}

function isAssignableRole(role: string): role is AssignableRole {
  return (ALL_ROLES as readonly string[]).includes(role);
}

async function getLayout(companyId: string, role: AssignableRole): Promise<NavLayout> {
  const raw = await getSetting(companyId, layoutSettingKey(role), JSON.stringify(EMPTY_NAV_LAYOUT));
  try {
    const parsed = JSON.parse(raw);
    return { order: Array.isArray(parsed.order) ? parsed.order : [], hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [] };
  } catch {
    return EMPTY_NAV_LAYOUT;
  }
}

/**
 * GET /api/nav-config
 * FR-53. Platform Admin builder screen data: the full registry plus each
 * assignable role's raw layout and resolved order.
 */
router.get("/", requireCapability(canManageSettings), async (req: Request, res: Response) => {
  const companyId = req.auth!.companyId;
  const roles: Record<string, { layout: NavLayout; resolved: string[] }> = {};
  for (const role of ALL_ROLES) {
    const layout = await getLayout(companyId, role);
    roles[role] = { layout, resolved: resolveNavForRole(role, layout) };
  }
  res.json({ registry: NAV_REGISTRY, roles });
});

/**
 * GET /api/nav-config/me
 * FR-53. Every authenticated non-admin session calls this on login to get
 * its own resolved sidebar order — no capability gate beyond being logged
 * in, since it only ever returns the caller's own role's resolved list.
 */
router.get("/me", async (req: Request, res: Response) => {
  const role = req.auth!.role;
  if (!isAssignableRole(role)) {
    return res.json([]);
  }
  const layout = await getLayout(req.auth!.companyId, role);
  res.json(resolveNavForRole(role, layout));
});

/**
 * PUT /api/nav-config/:role
 * FR-53. Body: { order: string[], hidden: string[] }. Sanitized to only
 * the keys the registry actually defines for that role — a stale client
 * registry snapshot shouldn't hard-fail a save, it should just drop what
 * it doesn't recognize.
 */
router.put("/:role", requireCapability(canManageSettings), async (req: Request, res: Response) => {
  const role = req.params.role as string;
  if (!isAssignableRole(role)) {
    return res.status(400).json({ error: "Unknown role" });
  }

  const eligibleKeys = new Set(NAV_REGISTRY.filter((i) => i.eligibleRoles.includes(role)).map((i) => i.key));
  const body = req.body as { order?: unknown; hidden?: unknown };
  const order = Array.isArray(body.order) ? body.order.filter((k) => eligibleKeys.has(k)) : [];
  const hidden = Array.isArray(body.hidden) ? body.hidden.filter((k) => eligibleKeys.has(k)) : [];

  await setSetting(req.auth!.companyId, layoutSettingKey(role), JSON.stringify({ order, hidden }));
  res.json({ layout: { order, hidden }, resolved: resolveNavForRole(role, { order, hidden }) });
});

/**
 * POST /api/nav-config/:role/reset
 * FR-53. No delete path exists on the Setting store by design — reset
 * overwrites with the empty layout instead, which resolves to the
 * registry's own default order with nothing hidden.
 */
router.post("/:role/reset", requireCapability(canManageSettings), async (req: Request, res: Response) => {
  const role = req.params.role as string;
  if (!isAssignableRole(role)) {
    return res.status(400).json({ error: "Unknown role" });
  }

  await setSetting(req.auth!.companyId, layoutSettingKey(role), JSON.stringify(EMPTY_NAV_LAYOUT));
  res.json({ layout: EMPTY_NAV_LAYOUT, resolved: resolveNavForRole(role, EMPTY_NAV_LAYOUT) });
});

export default router;
