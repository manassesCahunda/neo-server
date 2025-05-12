import { z } from "zod";

const levelEnum = z.enum([
"ENTERPRISE",
"SINGULAR",
"SUPPORT",
"BASIC",
"CONSULTANCY"
]);

export const userSchema = z.object({
  prompt: z.string(),
  type: levelEnum.default("ENTERPRISE"),
  remoteJid: z.string(),
});


export type userType = z.infer<typeof userSchema>;

export type userUpdateType = { userId: string;clientData: userType};

export const ClientSchema = z.object({
  userId: z.string().uuid(),
  platform: z.string().max(100),
  level: levelEnum.default("BASIC"),
  keyname: z.string().max(100),
  status: z.number(),
  key: z.string(),
  username: z.string().max(100)
});


export type ClientType = z.infer<typeof ClientSchema>;

const databaseTypeEnum = z.enum(["Table", "PostgreSQL"]);
const permissionEnum = z.enum(["read", "write", "admin"]);

export const DatabaseSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1),
  type: databaseTypeEnum.default("Table"),
  url: z.string().url(),
  permission: permissionEnum.default("read")
});


export type DatabaseType = z.infer<typeof DatabaseSchema>;