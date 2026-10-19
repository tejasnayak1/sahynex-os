CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deal_id" uuid,
	"lead_id" uuid,
	"title" text NOT NULL,
	"purpose" text DEFAULT 'discovery' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"location" text,
	"attendees" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"agenda" text,
	"organizer_id" uuid NOT NULL,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"outcome" text,
	"task_id" uuid,
	"ics_uid" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"invite_emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_subject" CHECK (deal_id is not null or lead_id is not null),
	CONSTRAINT "meetings_time_order" CHECK (end_at > start_at)
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetings_deal" ON "meetings" USING btree ("deal_id","start_at");--> statement-breakpoint
CREATE INDEX "meetings_lead" ON "meetings" USING btree ("lead_id","start_at");--> statement-breakpoint
CREATE INDEX "meetings_org_start" ON "meetings" USING btree ("org_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_ics_uid" ON "meetings" USING btree ("ics_uid");