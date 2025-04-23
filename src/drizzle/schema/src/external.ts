import { pgTable, uuid, varchar, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { user } from "../index";

export const databaseTypeEnum = pgEnum("database_type", ["PostgreSQL","Table"]);
export const permissionEnum = pgEnum("permission", ["read", "write", "admin"]);

export const externalStorage = pgTable("external_storage", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: databaseTypeEnum("type").default("Table"),
  url: text("url").notNull(),
  permission: permissionEnum("permission").default("read"), 
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
