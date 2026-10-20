ALTER TABLE "deliverables" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "priority" "priority" DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "job_title" text;