import { pgTable, serial, varchar, text, timestamp , uuid  , pgEnum  , integer} from "drizzle-orm/pg-core";

export const type = pgEnum("type", [
  "ENTERPRISE",
  "SINGULAR",
  "SUPPORT",
  "BASIC",
  "CONSULTANCY",
]);

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(), 
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).unique(),
  googleId: varchar("google_id", { length: 255 }).unique(),
  remoteJid:text("remoteJid"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  prompt: text("prompt"),
  type: type("type").default("ENTERPRISE"),  
  avatar: text("avatar").notNull(),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow()
});
