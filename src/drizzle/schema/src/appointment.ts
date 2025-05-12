import { pgTable, uuid, varchar, boolean, pgEnum, integer, decimal, timestamp, jsonb , text } from "drizzle-orm/pg-core";
import { client , user } from "../index";

export const appointmentStatusEnum = pgEnum("status_enum", ["pending", "completed", "in_progress"]);

export const appointment = pgTable('appointments', {
  id: uuid('id').primaryKey(),
  id_client: uuid('id_client').references(() => client.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }).notNull(),
  datetime_start: text('datetime_start'),
  datetime_end: text('datetime_end'),
  appointment_status: appointmentStatusEnum('status').notNull(),
  value: decimal('value', { precision: 10, scale: 2 }),
  name: varchar('name', { length: 255 }),
  description: varchar('description', { length: 255 }),
  quantity: integer('quantity'),
  category: varchar('category', { length: 255 }),
  price: decimal('price', { precision: 10, scale: 2 }),
  details: varchar('details', { length: 255 })
});
