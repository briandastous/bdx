import { sql } from "kysely";
import type { DbOrTx } from "../db.js";
import type { JsonValue } from "../database.js";
import type { CursorPage, CursorParams } from "../pagination.js";
import { paginateQuery } from "../pagination.js";
import { wherePostActive } from "../queries/filters.js";
import { postSummaryColumns } from "../queries/projections.js";
import { ensureUsers } from "./users.js";
import type { IngestEventId, PostId, UserId } from "@bdx/ids";
import { PostId as PostIdBrand, UserId as UserIdBrand } from "@bdx/ids";

export interface PostInput {
  id: PostId;
  authorId: UserId;
  postedAt: Date;
  text: string | null;
  lang: string | null;
  rawJson: JsonValue | null;
}

export interface PostsMetaInput {
  postId: PostId;
  ingestEventId: IngestEventId;
  updatedAt: Date;
}

export interface PostSummaryRow {
  id: PostId;
  author_id: UserId;
  posted_at: Date;
  text: string | null;
  lang: string | null;
}

export async function getActivePostIdsByAuthors(
  db: DbOrTx,
  params: { authorIds: Iterable<UserId> },
): Promise<Set<PostId>> {
  const ids = Array.from(new Set(params.authorIds));
  if (ids.length === 0) return new Set();

  const rows = await wherePostActive(
    db.selectFrom("posts").select(["id"]).where("author_id", "in", ids),
  ).execute();

  return new Set(rows.map((row) => PostIdBrand(row.id)));
}

export async function upsertPosts(db: DbOrTx, rows: PostInput[]): Promise<number> {
  if (rows.length === 0) return 0;

  const authorIds = new Set<UserId>();
  for (const row of rows) {
    authorIds.add(row.authorId);
  }
  await ensureUsers(db, Array.from(authorIds));

  const values = rows.map((row) => ({
    id: row.id,
    author_id: row.authorId,
    posted_at: row.postedAt,
    text: row.text,
    lang: row.lang,
    raw_json: row.rawJson,
    is_deleted: false,
  }));

  const result = await db
    .insertInto("posts")
    .values(values)
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        text: sql`excluded.text`,
        lang: sql`excluded.lang`,
        raw_json: sql`excluded.raw_json`,
        is_deleted: false,
      }),
    )
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function upsertPostsMeta(db: DbOrTx, rows: PostsMetaInput[]): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map((row) => ({
    post_id: row.postId,
    ingest_event_id: row.ingestEventId,
    updated_at: row.updatedAt,
  }));

  const result = await db
    .insertInto("posts_meta")
    .values(values)
    .onConflict((oc) =>
      oc.columns(["post_id", "ingest_event_id"]).doUpdateSet({
        updated_at: sql`excluded.updated_at`,
      }),
    )
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function listPostsByAuthor(
  db: DbOrTx,
  params: {
    authorId: UserId;
    limit: number;
    cursor?: CursorParams;
  },
): Promise<CursorPage<PostSummaryRow>> {
  const query = wherePostActive(
    db
      .selectFrom("posts")
      .select(postSummaryColumns)
      .where("posts.author_id", "=", params.authorId),
  );

  const sorts = [
    { col: "posts.posted_at", dir: "desc", output: "posted_at" },
    { col: "posts.id", dir: "desc", output: "id" },
  ] as const;

  const page = await paginateQuery({
    query,
    sorts,
    limit: params.limit,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });

  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      id: PostIdBrand(row.id),
      author_id: UserIdBrand(row.author_id),
    })),
  };
}
