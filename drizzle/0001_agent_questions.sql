CREATE TABLE "agent_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"ip_hash" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_questions_asked_at_index" ON "agent_questions" USING btree ("asked_at");--> statement-breakpoint
CREATE INDEX "agent_questions_ip_hash_asked_at_index" ON "agent_questions" USING btree ("ip_hash","asked_at");