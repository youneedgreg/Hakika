CREATE TYPE "public"."audit_kind" AS ENUM('request', 'payment', 'proof', 'verdict', 'override', 'milestone');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('foreman', 'fundi', 'supplier');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('info', 'warn', 'block');--> statement-breakpoint
CREATE TYPE "public"."finding_type" AS ENUM('price_above_market', 'qty_above_plan', 'unverified_supplier', 'cheaper_verified_supplier', 'missing_info');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'sw');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('whatsapp', 'simulator');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'image', 'voice', 'location', 'template');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('planned', 'in_progress', 'awaiting_proof', 'verified', 'held', 'paid');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('materials', 'labour');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'captured', 'denied', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proof_purpose" AS ENUM('delivery', 'progress');--> statement-breakpoint
CREATE TYPE "public"."proof_request_status" AS ENUM('issued', 'used', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."proof_source" AS ENUM('capture_page', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('received', 'parsed', 'checked', 'awaiting_approval', 'approved', 'paid', 'awaiting_proof', 'verified', 'held', 'declined', 'failed');--> statement-breakpoint
CREATE TYPE "public"."verdict_outcome" AS ENUM('verified', 'needs_fresh_proof', 'suspicious');--> statement-breakpoint
CREATE TYPE "public"."webhook_provider" AS ENUM('paypal', 'twilio');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"home_location" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "audit_kind" NOT NULL,
	"action" text NOT NULL,
	"description" text NOT NULL,
	"actor" text NOT NULL,
	"request_id" text,
	"payment_id" text,
	"proof_id" text,
	"milestone_id" text,
	"amount_kes_cents" bigint,
	"amount_usd_cents" bigint,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"position" integer NOT NULL,
	"type" "finding_type" NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"message" text NOT NULL,
	"data" jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "findings_request_id_position_unique" UNIQUE("request_id","position")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"day" date PRIMARY KEY NOT NULL,
	"kes_per_usd" numeric(14, 6) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_plan_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"milestone_id" text NOT NULL,
	"item_key" text NOT NULL,
	"description" text NOT NULL,
	"qty" double precision NOT NULL,
	"unit" text NOT NULL,
	CONSTRAINT "material_plan_lines_milestone_id_item_key_unique" UNIQUE("milestone_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"contact_id" text,
	"direction" "message_direction" NOT NULL,
	"channel" "message_channel" NOT NULL,
	"kind" "message_kind" NOT NULL,
	"body" text,
	"media_path" text,
	"media_content_type" text,
	"latitude" double precision,
	"longitude" double precision,
	"template_key" text,
	"language" "language",
	"twilio_sid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_twilio_sid_unique" UNIQUE("twilio_sid")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"status" "milestone_status" DEFAULT 'planned' NOT NULL,
	"planned_start" date NOT NULL,
	"planned_end" date NOT NULL,
	"depends_on_id" text,
	"labour_kes_cents" bigint,
	"labour_contact_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_project_id_position_unique" UNIQUE("project_id","position"),
	CONSTRAINT "milestones_dates_ordered" CHECK ("milestones"."planned_end" >= "milestones"."planned_start")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"request_id" text,
	"milestone_id" text,
	"payee_supplier_id" text,
	"payee_contact_id" text,
	"payee_email" text NOT NULL,
	"amount_kes_cents" bigint NOT NULL,
	"amount_usd_cents" bigint NOT NULL,
	"kes_per_usd" numeric(14, 6) NOT NULL,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"paypal_request_id" text NOT NULL,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone,
	CONSTRAINT "payments_paypal_request_id_unique" UNIQUE("paypal_request_id"),
	CONSTRAINT "payments_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "payments_paypal_capture_id_unique" UNIQUE("paypal_capture_id"),
	CONSTRAINT "payments_amounts_positive" CHECK ("payments"."amount_kes_cents" > 0 and "payments"."amount_usd_cents" > 0),
	CONSTRAINT "payments_kind_matches_payee" CHECK (
    ("payments"."kind" = 'materials' and "payments"."request_id" is not null
      and "payments"."payee_supplier_id" is not null and "payments"."payee_contact_id" is null)
    or ("payments"."kind" = 'labour' and "payments"."milestone_id" is not null
      and "payments"."payee_contact_id" is not null and "payments"."payee_supplier_id" is null)),
	CONSTRAINT "payments_captured_has_capture_id" CHECK ("payments"."status" <> 'captured' or ("payments"."paypal_capture_id" is not null and "payments"."captured_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "price_references" (
	"id" text PRIMARY KEY NOT NULL,
	"item_key" text NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"median_kes_cents" bigint NOT NULL,
	"source" text NOT NULL,
	"observed_on" date NOT NULL,
	CONSTRAINT "price_references_item_key_unique" UNIQUE("item_key")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"site_label" text NOT NULL,
	"site_lat" double precision NOT NULL,
	"site_lng" double precision NOT NULL,
	"site_radius_m" integer NOT NULL,
	"budget_kes_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_site_radius_positive" CHECK ("projects"."site_radius_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "proof_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"payment_id" text,
	"contact_id" text,
	"purpose" "proof_purpose" NOT NULL,
	"code" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "proof_request_status" DEFAULT 'issued' NOT NULL,
	"replaces_id" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "proof_requests_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "proof_requests_expiry_after_issue" CHECK ("proof_requests"."expires_at" > "proof_requests"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"proof_request_id" text,
	"source" "proof_source" NOT NULL,
	"blob_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"dhash" text NOT NULL,
	"capture_lat" double precision,
	"capture_lng" double precision,
	"accuracy_m" double precision,
	"client_time" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proofs_proof_request_id_unique" UNIQUE("proof_request_id"),
	CONSTRAINT "proofs_dhash_hex" CHECK ("proofs"."dhash" ~ '^[0-9a-f]{16}$')
);
--> statement-breakpoint
CREATE TABLE "request_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"position" integer NOT NULL,
	"item_key" text NOT NULL,
	"description" text NOT NULL,
	"qty" double precision NOT NULL,
	"unit" text NOT NULL,
	"unit_price_kes_cents" bigint NOT NULL,
	"reference_unit_price_kes_cents" bigint,
	CONSTRAINT "request_lines_request_id_position_unique" UNIQUE("request_id","position"),
	CONSTRAINT "request_lines_qty_positive" CHECK ("request_lines"."qty" > 0),
	CONSTRAINT "request_lines_price_not_negative" CHECK ("request_lines"."unit_price_kes_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text,
	"contact_id" text,
	"message_id" text,
	"status" "request_status" DEFAULT 'received' NOT NULL,
	"quote_image_path" text,
	"quoted_supplier_id" text,
	"quoted_supplier_name" text,
	"quoted_total_kes_cents" bigint,
	"recommended_supplier_id" text,
	"recommended_total_kes_cents" bigint,
	"summary" text,
	"parsed" jsonb,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"role" "contact_role" NOT NULL,
	"whatsapp_number" text NOT NULL,
	"language" "language" NOT NULL,
	"paypal_email" text,
	"supplier_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_contacts_project_id_whatsapp_number_unique" UNIQUE("project_id","whatsapp_number")
);
--> statement-breakpoint
CREATE TABLE "supplier_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"item_key" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price_kes_cents" bigint NOT NULL,
	"observed_on" date NOT NULL,
	CONSTRAINT "supplier_prices_supplier_id_item_key_unique" UNIQUE("supplier_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"paypal_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"proof_id" text NOT NULL,
	"outcome" "verdict_outcome" NOT NULL,
	"checks" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"model_id" text,
	"raw_model_output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overridden_at" timestamp with time zone,
	"override_reason" text,
	"overridden_by" text,
	CONSTRAINT "verdicts_proof_id_unique" UNIQUE("proof_id"),
	CONSTRAINT "verdicts_override_has_reason" CHECK ("verdicts"."overridden_at" is null or ("verdicts"."override_reason" is not null and "verdicts"."overridden_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "webhook_provider" NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_provider_event_id_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_proof_id_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."proofs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_plan_lines" ADD CONSTRAINT "material_plan_lines_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_site_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."site_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_depends_on_id_milestones_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_labour_contact_id_site_contacts_id_fk" FOREIGN KEY ("labour_contact_id") REFERENCES "public"."site_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payee_supplier_id_suppliers_id_fk" FOREIGN KEY ("payee_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payee_contact_id_site_contacts_id_fk" FOREIGN KEY ("payee_contact_id") REFERENCES "public"."site_contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_contact_id_site_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."site_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_replaces_id_proof_requests_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."proof_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_proof_request_id_proof_requests_id_fk" FOREIGN KEY ("proof_request_id") REFERENCES "public"."proof_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_lines" ADD CONSTRAINT "request_lines_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_contact_id_site_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."site_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_quoted_supplier_id_suppliers_id_fk" FOREIGN KEY ("quoted_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_recommended_supplier_id_suppliers_id_fk" FOREIGN KEY ("recommended_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_contacts" ADD CONSTRAINT "site_contacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_contacts" ADD CONSTRAINT "site_contacts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_proof_id_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."proofs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_overridden_by_user_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_events_project_id_at_index" ON "audit_events" USING btree ("project_id","at");--> statement-breakpoint
CREATE INDEX "messages_project_id_created_at_index" ON "messages" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_project_id_created_at_index" ON "payments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_owner_id_index" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "proof_requests_milestone_id_status_index" ON "proof_requests" USING btree ("milestone_id","status");--> statement-breakpoint
CREATE INDEX "proofs_project_id_received_at_index" ON "proofs" USING btree ("project_id","received_at");--> statement-breakpoint
CREATE INDEX "requests_project_id_status_index" ON "requests" USING btree ("project_id","status");