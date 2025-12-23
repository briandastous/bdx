import type { DbOrTx } from "../db.js";
import type {
  PlannerRunId,
  SchedulerJobId,
  SchedulerPlannerEventId,
  SchedulerTargetId,
} from "@bdx/ids";
import { SchedulerPlannerEventId as SchedulerPlannerEventIdBrand } from "@bdx/ids";

export interface PlannerEventInput {
  jobId: SchedulerJobId;
  targetId: SchedulerTargetId | null;
  targetParams: string | null;
  decision: string;
  reason?: string | null;
  plannedFor?: Date | null;
  plannerRunId?: PlannerRunId | null;
}

export async function recordPlannerEvent(
  db: DbOrTx,
  input: PlannerEventInput,
): Promise<SchedulerPlannerEventId> {
  const row = await db
    .insertInto("scheduler_planner_events")
    .values({
      job_id: input.jobId,
      target_id: input.targetId,
      target_params: input.targetParams,
      decision: input.decision,
      reason: input.reason ?? null,
      planned_for: input.plannedFor ?? null,
      planner_run_id: input.plannerRunId ?? null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  return SchedulerPlannerEventIdBrand(row.id);
}
