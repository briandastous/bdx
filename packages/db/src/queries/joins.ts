import type { JoinReferenceExpression, SelectQueryBuilder } from "kysely";
import type { Database } from "../database.js";

const assetInstancesJoin = "asset_instances as instances" as const;
const assetParamsJoin = "asset_params as params" as const;

type DatabaseWithInstances<DB extends Database> = DB & { instances: DB["asset_instances"] };
type DatabaseWithParams<DB extends Database> = DB & { params: DB["asset_params"] };

export function joinAssetInstances<DB extends Database, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  sourceColumn: JoinReferenceExpression<DB, keyof DB, typeof assetInstancesJoin>,
): SelectQueryBuilder<DatabaseWithInstances<DB>, TB | "instances", O> {
  const joinColumn = "instances.id" as JoinReferenceExpression<DB, TB, typeof assetInstancesJoin>;
  const sourceRef = sourceColumn as JoinReferenceExpression<DB, TB, typeof assetInstancesJoin>;
  return query.innerJoin(assetInstancesJoin, joinColumn, sourceRef) as SelectQueryBuilder<
    DatabaseWithInstances<DB>,
    TB | "instances",
    O
  >;
}

export function joinAssetParams<DB extends Database, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  sourceColumn: JoinReferenceExpression<DB, keyof DB, typeof assetParamsJoin>,
): SelectQueryBuilder<DatabaseWithParams<DB>, TB | "params", O> {
  const joinColumn = "params.id" as JoinReferenceExpression<DB, TB, typeof assetParamsJoin>;
  const sourceRef = sourceColumn as JoinReferenceExpression<DB, TB, typeof assetParamsJoin>;
  return query.innerJoin(assetParamsJoin, joinColumn, sourceRef) as SelectQueryBuilder<
    DatabaseWithParams<DB>,
    TB | "params",
    O
  >;
}
