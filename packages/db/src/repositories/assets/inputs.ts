import type { DbOrTx } from "../../db.js";
import type { AssetInstanceId, UserId } from "@bdx/ids";
import { UserId as UserIdBrand } from "@bdx/ids";

export async function listSpecifiedUsersInputs(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<UserId[]> {
  const rows = await db
    .selectFrom("segment_specified_users_inputs")
    .select(["user_id"])
    .where("instance_id", "=", instanceId)
    .orderBy("user_id", "asc")
    .execute();

  return rows.map((row) => UserIdBrand(row.user_id));
}

export async function replaceSpecifiedUsersInputs(
  db: DbOrTx,
  params: { instanceId: AssetInstanceId; userIds: Iterable<UserId> },
): Promise<number> {
  const ids = Array.from(new Set(params.userIds)).sort((a, b) => (a < b ? -1 : 1));

  await db
    .deleteFrom("segment_specified_users_inputs")
    .where("instance_id", "=", params.instanceId)
    .execute();

  if (ids.length === 0) return 0;

  const values = ids.map((userId) => ({
    instance_id: params.instanceId,
    user_id: userId,
  }));

  const result = await db
    .insertInto("segment_specified_users_inputs")
    .values(values)
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}
