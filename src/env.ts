import { z } from 'zod'

require('dotenv').config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().url(),
  API_URL: z.string().url(),
  CLIENT_SECRET: z.string(),
  CLIENT_ID: z.string(),
  WEB_URL: z.string().url(),
  GOOGLE_API_KEY_AI : z.string(),
  TRIGGER_SECRET_KEY: z.string(),
  SESSION_SECRET: z.string(),
  JWT_SECRET: z.string(),
  SOCKET_PORT: z.string(),
  SOCKET_HOST: z.string().default("localhost"),
  OPENAI_API_KEY: z.string(),
  AI_DEFAULT_MODEL: z.string().default("gemini-1.5-flash"),
})

export const env = envSchema.parse(process.env)
