import { 
  pgTable, serial, varchar, text, timestamp, integer, pgEnum, unique ,uuid
} from "drizzle-orm/pg-core";
import { user } from "../index";

 const platformEnum = pgEnum("platform", ["whatsapp", "facebook", "instagram", "mail"]);

export const socialMediaAccount = pgTable("social_media_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  connectionType: varchar("connection_type", { length: 50 }), 
  profileUrl: text("profile_url"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    uniqueUsername: unique("unique_username").on(table.username),
  };
});
