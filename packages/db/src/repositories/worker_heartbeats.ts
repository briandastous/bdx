import type { DbOrTx } from "../db.js";

export async function recordWorkerHeartbeat(
  db: DbOrTx,
  params: { service: string; workerId: string; lastHeartbeatAt: Date },
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
