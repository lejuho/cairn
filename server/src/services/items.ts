import type { ItemListData, ItemListQuery } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { listEventsForItems } from "../repositories/events.js";
import { listTasksForItems } from "../repositories/tasks.js";

export function listItems(db: CairnDatabase, query: ItemListQuery): ItemListData {
  return {
    scope: query.scope,
    events: listEventsForItems(db, query.scope, query.limit),
    tasks: listTasksForItems(db, query.scope, query.limit)
  };
}
