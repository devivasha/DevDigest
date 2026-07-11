CREATE TABLE "onboarding_tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"sections" jsonb NOT NULL,
	"repo_name" text NOT NULL,
	"index_file_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"index_updated_at" timestamp with time zone,
	"degraded" boolean DEFAULT false NOT NULL,
	"degraded_reason" text
);
--> statement-breakpoint
DROP TABLE "onboarding" CASCADE;--> statement-breakpoint
ALTER TABLE "onboarding_tours" ADD CONSTRAINT "onboarding_tours_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tours" ADD CONSTRAINT "onboarding_tours_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_tours_workspace_repo_uq" ON "onboarding_tours" USING btree ("workspace_id","repo_id");--> statement-breakpoint
CREATE INDEX "onboarding_tours_repo_idx" ON "onboarding_tours" USING btree ("repo_id");