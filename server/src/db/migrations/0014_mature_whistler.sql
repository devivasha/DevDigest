ALTER TABLE "ci_installations" ADD COLUMN "ingest_secret_hash" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "version" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_installation_pr_ranat_uq" UNIQUE NULLS NOT DISTINCT("ci_installation_id","pr_number","ran_at");