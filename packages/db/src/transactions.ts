import type { Transaction } from "kysely";
import type { DbOrTx } from "./db.js";
import type { Database } from "./database.js";

function isTransaction(db: DbOrTx): db is Transaction<Database> {
  const candidate = db as { isTransaction?: boolean };
  return candidate.isTransaction === true;
}

export async function withTransaction<T>(
  db: DbOrTx,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  if (isTransaction(db)) {
    return fn(db);
  }
  return db.transaction().execute(fn);
}
