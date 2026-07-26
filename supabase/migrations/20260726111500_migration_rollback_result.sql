-- ============================================================================
-- Migration: Import Batch Rollback -- persist the outcome
-- Tracer Bullet: tb-migration-rollback-001 (theos-registry)
-- ============================================================================

-- Follow-up to 20260726110000_migration_rollback.sql, found during that
-- tracer bullet's own live verification: imported_properties.property_id /
-- imported_contacts.contact_id reference properties/contacts with no ON
-- DELETE clause, so deleting a 'success' row's target while its own tracking
-- row still points at it violates that FK -- the rollback endpoint must null
-- the tracking row's FK column first, then delete the target. That ordering
-- fix lives in application code (migrations.ts), not here.
--
-- could_not_revert stores the rollback response's own could_not_revert list
-- (target ids it could not delete/restore, for any reason) so GET
-- /migrations/batches/:batchId can return exactly what the rollback action
-- itself found, without needing to re-derive it from tracking-row state on
-- every read.
alter table public.import_batches add column if not exists could_not_revert jsonb not null default '[]'::jsonb;
