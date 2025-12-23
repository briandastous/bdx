import type { DbOrTx } from "../db.js";
import type { WorkerId, WorkerServiceName } from "@bdx/ids";

export async function recordWorkerHeartbeat(
  db: DbOrTx,
  params: { service: WorkerServiceName; workerId: WorkerId; lastHeartbeatAt: Date },
): Promise<void> {
  await db
    .insertInto("worker_heartbeats")
    .values({
      service: params.service,
      worker_id: params.workerId,
      started_at: params.lastHeartbeatAt,
      last_heartbeat_at: params.lastHeartbeatAt,
    })
    .onConflict((oc) =>
      oc.columns(["service", "worker_id"]).doUpdateSet({
        last_heartbeat_at: params.lastHeartbeatAt,
      }),
    )
    .execute();
}
