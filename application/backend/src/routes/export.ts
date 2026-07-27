import type { FastifyInstance } from 'fastify';
import { ZipArchive } from 'archiver';
import { requireAuth, getScopedClient } from '../lib/auth.js';
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

// cap-listings-001's Listing entity, added to the export by
// tb-client-lifecycle-export-listings-001. tenant_id excluded like the other
// two column lists -- every row in a single-tenant export shares one tenant.
const LISTING_COLUMNS = [
  'id', 'property_id', 'agent_id', 'listing_type', 'price', 'price_currency',
  'status', 'exclusivity', 'authority_starts_at', 'authority_expires_at',
  'created_at', 'updated_at',
];

// tb-client-lifecycle-export-001: a GET route behind requireAuth already gets
// the availability rule for free -- 'blocked' is rejected outright and
// 'read_only' allows GET, per auth.ts's existing access_state handling.
// tb-client-lifecycle-export-contacts-001: zips properties.csv + contacts.csv
// together instead of returning a single properties CSV.
// tb-client-lifecycle-export-listings-001: adds listings.csv as a third entry
// now that cap-listings-001's `listings` table exists.
export async function registerExportRoutes(app: FastifyInstance) {
  app.get('/export', { preHandler: requireAuth }, async (request, reply) => {
    const tenantId = request.user!.tenantId;
    const supabase = getScopedClient(request);

    const { data: properties, error: propertiesError } = await supabase
      .from('properties')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (propertiesError) {
      request.log.error(propertiesError);
      return reply.status(500).send({ error: 'Could not load properties for export' });
    }

    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (contactsError) {
      request.log.error(contactsError);
      return reply.status(500).send({ error: 'Could not load contacts for export' });
    }

    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (listingsError) {
      request.log.error(listingsError);
      return reply.status(500).send({ error: 'Could not load listings for export' });
    }

    const propertiesCsv = toCsv((properties ?? []) as Record<string, unknown>[], PROPERTY_COLUMNS);
    const contactsCsv = toCsv((contacts ?? []) as Record<string, unknown>[], CONTACT_COLUMNS);
    const listingsCsv = toCsv((listings ?? []) as Record<string, unknown>[], LISTING_COLUMNS);

    const filename = `residoro-export-${new Date().toISOString().slice(0, 10)}.zip`;
    const archive = new ZipArchive();
    archive.append(propertiesCsv, { name: 'properties.csv' });
    archive.append(contactsCsv, { name: 'contacts.csv' });
    archive.append(listingsCsv, { name: 'listings.csv' });

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.send(archive);
    void archive.finalize();
  });
}
