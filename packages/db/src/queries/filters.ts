import type { SelectQueryBuilder } from "kysely";
import type { DB as Database } from "../database.js";

export function whereUserActive<O>(
  qb: SelectQueryBuilder<Database, "users", O>,
): SelectQueryBuilder<Database, "users", O> {
  return qb.where("users.is_deleted", "=", false);
}

export function wherePostActive<O>(
  qb: SelectQueryBuilder<Database, "posts", O>,
): SelectQueryBuilder<Database, "posts", O> {
  return qb.where("posts.is_deleted", "=", false);
}

export function whereFollowActive<O>(
  qb: SelectQueryBuilder<Database, "follows", O>,
): SelectQueryBuilder<Database, "follows", O> {
  return qb.where("follows.is_deleted", "=", false);
}
