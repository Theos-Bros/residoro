import type { FastifyInstance } from 'fastify';
import { ZipArchive } from 'archiver';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { toCsv } from '../lib/csv.js';

const PROPERTY_COLUMNS = [
  'id', 'type', 'owner_type', 'owner_id', 'title', 'address', 'city', 'province',
  'latitude', 'longitude', 'floor_area_sqm', 'lot_area_sqm', 'bedrooms', 'bathrooms',
  'parking_slots', 'price', 'price_currency', 'status', 'verification_status',
  'created_at', 'updated_at',
];

// tb-migration-contacts-001's Contact entity, added to the export by
// tb-client-lifecycle-export-contacts-001.
const CONTACT_COLUMNS = ['id', 'name', 'type', 'email', 'phone', 'company', 'notes', 'created_at', 'updated_at'];

// tb-client-lifecycle-export-001: a GET route behind requireAuth already gets
// the availability rule for free -- 'blocked' is rejected outright and
// 'read_only' allows GET, per auth.ts's existing access_state handling.
// tb-client-lifecycle-export-contacts-001: now zips properties.csv +
// contacts.csv together instead of returning a single properties CSV --
// listings still don't exist in residoro, so they're still not included.
export async function registerExportRoutes(app: FastifyInstance) {
  app.get('/export', { preHandler: requireAuth }, async (request, reply) => {
    const tenantId = request.user!.tenantId;

    const { data: properties, error: propertiesError } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (propertiesError) {
      request.log.error(propertiesError);
      return reply.status(500).send({ error: 'Could not load properties for export' });
    }

    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (contactsError) {
      request.log.error(contactsError);
      return reply.status(500).send({ error: 'Could not load contacts for export' });
    }

    const propertiesCsv = toCsv((properties ?? []) as Record<string, unknown>[], PROPERTY_COLUMNS);
    const contactsCsv = toCsv((contacts ?? []) as Record<string, unknown>[], CONTACT_COLUMNS);

    const filename = `residoro-export-${new Date().toISOString().slice(0, 10)}.zip`;
    const archive = new ZipArchive();
    archive.append(propertiesCsv, { name: 'properties.csv' });
    archive.append(contactsCsv, { name: 'contacts.csv' });

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.send(archive);
    void archive.finalize();
  });
}
