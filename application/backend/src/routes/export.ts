import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { toCsv } from '../lib/csv.js';

const PROPERTY_COLUMNS = [
  'id', 'type', 'owner_type', 'owner_id', 'title', 'address', 'city', 'province',
  'latitude', 'longitude', 'floor_area_sqm', 'lot_area_sqm', 'bedrooms', 'bathrooms',
  'parking_slots', 'price', 'price_currency', 'status', 'verification_status',
  'created_at', 'updated_at',
];

// tb-client-lifecycle-export-001: a GET route behind requireAuth already gets
// the availability rule for free -- 'blocked' is rejected outright and
// 'read_only' allows GET, per auth.ts's existing access_state handling.
// Properties only for this pass; contacts/listings don't exist in residoro
// yet (see the tracer bullet's Context for why).
export async function registerExportRoutes(app: FastifyInstance) {
  app.get('/export', { preHandler: requireAuth }, async (request, reply) => {
    const { data: properties, error } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: true });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load properties for export' });
    }

    const csv = toCsv((properties ?? []) as Record<string, unknown>[], PROPERTY_COLUMNS);
    const filename = `residoro-properties-export-${new Date().toISOString().slice(0, 10)}.csv`;

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(csv);
  });
}
