import type { OrderByDirection, ReferenceExpression, SelectQueryBuilder, StringReference } from "kysely";
import {
  base64UrlCodec,
  codecPipe,
  createPaginator,
  PostgresPaginationDialect,
  superJsonCodec,
  type CursorIncoming,
  type PaginatedResult,
} from "kysely-cursor";
import type { Database } from "./database.js";

export const cursorCodec = codecPipe(superJsonCodec, base64UrlCodec);

const paginator = createPaginator({
  dialect: PostgresPaginationDialect,
  cursorCodec,
});

export type CursorPage<T> = PaginatedResult<T>;

type MatchingKeys<Obj, M> = Extract<
  {
    [K in keyof Obj]-?: Obj[K] extends M ? K : never;
  }[keyof Obj],
  string
>;

type OptionallyQualified<TB, O, Allowed> = TB extends string
  ? MatchingKeys<O, Allowed> | `${TB}.${MatchingKeys<O, Allowed>}`
  : never;

type SortItem<DB, TB extends keyof DB, O, Allowed> =
  | {
      col: ReferenceExpression<DB, TB>;
      output: MatchingKeys<O, Allowed>;
      dir?: OrderByDirection;
    }
  | {
      col: StringReference<DB, TB> & OptionallyQualified<TB, O, Allowed>;
      dir?: OrderByDirection;
    };

type Sortable = string | number | boolean | Date | bigint;

export type SortSet<DB, TB extends keyof DB, O> = readonly [
  ...SortItem<DB, TB, O, Sortable | null>[],
  SortItem<DB, TB, O, Sortable>,
];

export type CursorParams = CursorIncoming;

export async function paginateQuery<TB extends keyof Database, O>(params: {
  query: SelectQueryBuilder<Database, TB, O>;
  sorts: SortSet<Database, TB, O>;
  limit: number;
  cursor?: CursorParams;
}): Promise<PaginatedResult<O>> {
  const args = {
    query: params.query,
    sorts: params.sorts,
    limit: params.limit,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  };
  return paginator.paginate(args);
}
