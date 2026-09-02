import prisma from "../lib/prisma";
import { advance } from "./workflow";
import { WorkflowError } from "./eligibility";

/**
 * createRoute(companyId, creatorId, loadIds)
 *
 * FR-38: groups loads into a route (stop order = the order given). Any
 * attached load already sitting in a dispatch-board status (isDispatchStatus)
 * with a driver+vehicle assigned is auto-advanced via advance()'s existing
 * default-target fallback — "selecting eligible loads auto-advances them."
 * A load that isn't eligible (or isn't in a dispatch-eligible status yet)
 * is simply left where it is, not treated as an error — route creation
 * itself always succeeds if the loads are valid.
 */
export async function createRoute(companyId: string, creatorId: string, loadIds: string[]) {
  if (loadIds.length === 0) {
    throw new WorkflowError("A route requires at least one load");
  }

  const loads = await prisma.load.findMany({
    where: { id: { in: loadIds } },
    include: { currentStatus: true },
  });
  if (loads.length !== loadIds.length) {
    throw new WorkflowError("One or more loads not found");
  }
  for (const load of loads) {
    if (load.companyId !== companyId) {
      throw new WorkflowError("Load does not belong to actor's company");
    }
  }

  const count = await prisma.route.count();
  const reference = `RTE${String(count + 1).padStart(5, "0")}`;

  const route = await prisma.route.create({
    data: {
      companyId,
      creatorId,
      reference,
      stops: {
        create: loadIds.map((loadId, i) => ({ loadId, sequence: i })),
      },
    },
    include: { stops: { include: { load: { include: { currentStatus: true } } }, orderBy: { sequence: "asc" } } },
  });

  const autoAdvanced: string[] = [];
  for (const load of loads) {
    if (load.currentStatus.isDispatchStatus && load.driverId && load.vehicleId) {
      try {
        await advance(load.id, undefined, creatorId);
        autoAdvanced.push(load.id);
      } catch {
        // Not eligible / no default edge configured — leave the load where
        // it is rather than failing the whole route creation.
      }
    }
  }

  return { route, autoAdvanced };
}
