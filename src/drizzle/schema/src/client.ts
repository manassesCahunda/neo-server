import { pgTable, uuid, varchar, boolean, pgEnum, integer } from "drizzle-orm/pg-core";
import { user } from "../index";

export const platformEnum = pgEnum("platform", ["whatsapp", "facebook", "instagram", "mail"]);
export const levelEnum = pgEnum("level", ["PREMIUM", "ENTERPRISE", "BASIC", "STANDARD"]);

export const client = pgTable("client", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
  platform: platformEnum("platform"),
  level: levelEnum("level"),
  username: varchar("username", { length: 100 }),
  keyname: varchar("keyname", { length: 100 }),
  status: integer("status").notNull(),
  key: varchar("key", { length: 255 }) 
});
