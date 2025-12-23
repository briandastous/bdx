import type { DbOrTx } from "../../db.js";

export async function listSpecifiedUsersInputs(
  db: DbOrTx,
  instanceId: bigint,
): Promise<bigint[]> {
  const rows = await db
    .selectFrom("segment_specified_users_inputs")
    .select(["user_external_id"])
    .where("instance_id", "=", instanceId)
    .orderBy("user_external_id", "asc")
    .execute();

  return rows.map((row) => row.user_external_id);
}

export async function replaceSpecifiedUsersInputs(
  db: DbOrTx,
  params: { instanceId: bigint; userExternalIds: Iterable<bigint> },
): Promise<number> {
  const ids = Array.from(new Set(params.userExternalIds)).sort((a, b) => (a < b ? -1 : 1));

  await db
    .deleteFrom("segment_specified_users_inputs")
    .where("instance_id", "=", params.instanceId)
    .execute();

  if (ids.length === 0) return 0;

  const values = ids.map((userId) => ({
    instance_id: params.instanceId,
    user_external_id: userId,
  }));

  const result = await db
    .insertInto("segment_specified_users_inputs")
    .values(values)
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}
