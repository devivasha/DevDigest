CREATE TABLE "eval_set_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_version" integer,
	"system_prompt" text,
	"model" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"traces_passed" integer,
	"traces_total" integer,
	"duration_ms" integer,
	"cost_usd" double precision,
	"under_min" boolean
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "set_run_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "eval_set_runs" ADD CONSTRAINT "eval_set_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_set_runs_ws_idx" ON "eval_set_runs" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_set_run_id_eval_set_runs_id_fk" FOREIGN KEY ("set_run_id") REFERENCES "public"."eval_set_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_owner_name_uq" ON "eval_cases" USING btree ("workspace_id","owner_id","name");--> statement-breakpoint
CREATE INDEX "eval_runs_set_run_idx" ON "eval_runs" USING btree ("set_run_id");--> statement-breakpoint
CREATE INDEX "eval_runs_ws_idx" ON "eval_runs" USING btree ("workspace_id");