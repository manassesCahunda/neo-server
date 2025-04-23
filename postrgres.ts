import { z } from 'zod';
import { pg } from '@/drizzle/client';
import { tool } from 'ai';


export const postgresTool = tool({
  description: `
    TABLES
      ***
       CREATE TYPE "public"."database_permission" AS ENUM('read', 'write', 'all');--> statement-breakpoint
        CREATE TYPE "public"."database_type" AS ENUM('postgres', 'mysql');--> statement-breakpoint
        CREATE TYPE "public"."user_access_level" AS ENUM('basic', 'admin');--> statement-breakpoint
        CREATE TABLE "database" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "user_id" uuid NOT NULL,
          "database_name" text NOT NULL,
          "type_database" "database_type" NOT NULL,
          "url" text NOT NULL,
          "permission" "database_permission" DEFAULT 'read' NOT NULL,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
        );
        --> statement-breakpoint
        CREATE TABLE "users" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "name" text NOT NULL,
          "email" text NOT NULL,
          "access_level" "user_access_level" DEFAULT 'basic' NOT NULL,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "google_id" text,
          "access_token" text,
          "refresh_token" text,
          "avatar" text NOT NULL,
          CONSTRAINT "users_email_unique" UNIQUE("email"),
          CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
        );
        --> statement-breakpoint
        CREATE TABLE "token" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "user_id" uuid NOT NULL,
          "google_id" text,
          "access_token" text,
          "google_token" text,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          CONSTRAINT "token_google_id_unique" UNIQUE("google_id")
        );
        --> statement-breakpoint
        ALTER TABLE "database" ADD CONSTRAINT "database_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
        ALTER TABLE "token" ADD CONSTRAINT "token_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
      ***
  `.trim(),
  parameters: z.object({
    query: z.string()
      .nonempty(`
        - A QUERY NÃO PODE SER VAZIA.  
        - FORNEÇA UMA QUERY VÁLIDA.
      `.trim())
      .describe(`
        - QUERY DO POSTGRES QUE SERÁ EXECUTADA.
      `.trim()),
    params: z.array(z.string())
      .describe(`
        - PARÂMETROS DA QUERY A SEREM EXECUTADOS.
      `.trim()),  
  }),
  execute: async ({ query, params }) => {
    const result = await pg.unsafe(query, params);
    console.log("\n COMMAND QUERY \n");
    console.log(`✅ QUERY-SQL: ${query} -- PARAMS: ${params} \n RESULT: ${JSON.stringify(result)}\n`);
    return JSON.stringify(result);
  }
});
