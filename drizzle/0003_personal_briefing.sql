ALTER TYPE "public"."integration_provider" ADD VALUE 'google_workspace';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'instagram';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'ai_assistant';--> statement-breakpoint
CREATE TABLE "ai_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"content" jsonb NOT NULL,
	"facts" jsonb NOT NULL,
	"model" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text,
	"date" date NOT NULL,
	"followers" integer,
	"media_count" integer,
	"recent_media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_google_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"google_email" text,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_briefs" ADD CONSTRAINT "ai_briefs_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_briefs" ADD CONSTRAINT "ai_briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_snapshots" ADD CONSTRAINT "instagram_snapshots_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_google_connections" ADD CONSTRAINT "user_google_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_google_connections" ADD CONSTRAINT "user_google_connections_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_briefs_user_day" ON "ai_briefs" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_snapshots_day" ON "instagram_snapshots" USING btree ("org_id","ig_user_id","date");