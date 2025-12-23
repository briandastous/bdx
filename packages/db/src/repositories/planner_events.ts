import type { DbOrTx } from "../db.js";

export interface PlannerEventInput {
  jobId: string;
  targetId: string | null;
  targetParams: string | null;
  decision: string;
  reason?: string | null;
  plannedFor?: Date | null;
  plannerRunId?: string | null;
}

export async function recordPlannerEvent(db: DbOrTx, input: PlannerEventInput): Promise<bigint> {
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

  return row.id;
}
