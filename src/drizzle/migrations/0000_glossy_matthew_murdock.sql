CREATE TYPE "public"."level" AS ENUM('PREMIUM', 'ENTERPRISE', 'BASIC', 'STANDARD');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('whatsapp', 'facebook', 'instagram', 'mail');--> statement-breakpoint
CREATE TYPE "public"."type" AS ENUM('ENTERPRISE', 'SINGULAR', 'SUPPORT', 'BASIC', 'CONSULTANCY');--> statement-breakpoint
CREATE TYPE "public"."database_type" AS ENUM('PostgreSQL', 'Table');--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('read', 'write', 'admin');--> statement-breakpoint
CREATE TYPE "public"."status_enum" AS ENUM('pending', 'completed', 'in_progress');--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"platform" "platform",
	"level" "level",
	"username" varchar(100),
	"keyname" varchar(100),
	"status" integer NOT NULL,
	"key" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"google_id" varchar(255),
	"remoteJid" integer,
	"access_token" text,
	"refresh_token" text,
	"prompt" text,
	"type" "type" NOT NULL,
	"avatar" text NOT NULL,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "external_storage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"type" "database_type" DEFAULT 'Table',
	"url" text NOT NULL,
	"permission" "permission" DEFAULT 'read',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_media_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"platform" "platform" NOT NULL,
	"username" varchar(255) NOT NULL,
	"connection_type" varchar(50),
	"profile_url" text,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_username" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"id_client" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"datetime_start" timestamp NOT NULL,
	"datetime_end" timestamp NOT NULL,
	"status" "status_enum" NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"category" varchar(255) NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"details" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_storage" ADD CONSTRAINT "external_storage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media_account" ADD CONSTRAINT "social_media_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_id_client_client_id_fk" FOREIGN KEY ("id_client") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;