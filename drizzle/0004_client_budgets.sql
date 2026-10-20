CREATE TYPE "public"."budget_period" AS ENUM('monthly', 'annual');--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "marketing_budget_minor" bigint;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "marketing_budget_period" "budget_period";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "branding_budget_minor" bigint;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "branding_budget_period" "budget_period";