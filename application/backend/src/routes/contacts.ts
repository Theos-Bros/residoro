import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';

type ContactRow = {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  is_company: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ListQuery = { is_company?: string };

type CreateContactBody = {
  name?: string;
  type?: string;
  is_company?: boolean;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
};

type UpdateContactBody = Partial<CreateContactBody>;

const CONTACT_COLUMNS = 'id, tenant_id, name, type, email, phone, company, notes, is_company, created_by, created_at, updated_at';

// tb-properties-owner-linking-001: contacts previously had no brokerage-
// facing read route -- only written via Migration's CSV import
// (tb-migration-contacts-001) and read via the operator-facing export
// (export.ts). This is the first route that lets an agent/admin browse
// contacts directly, for the property-creation owner picker.
//
// tb-crm-contacts-page-001: extends the original list-only route with the
// full CRUD ContactsPage needs -- GET gains an optional is_company filter
// (mirroring projects.ts's /developers shape), plus POST/GET :id/PATCH/DELETE.
export async function registerContactsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ListQuery }>('/contacts', { preHandler: requireAuth }, async (request, reply) => {
    let query = getScopedClient(request)
      .from('contacts')
      .select(CONTACT_COLUMNS)
      .eq('tenant_id', request.user!.tenantId)
      .order('name', { ascending: true });

    if (request.query.is_company !== undefined) {
      query = query.eq('is_company', request.query.is_company === 'true');
    }

    const { data, error } = await query.returns<ContactRow[]>();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load contacts' });
    }

    return { contacts: data ?? [] };
  });

  app.post<{ Body: CreateContactBody }>('/contacts', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { name, type, is_company, email, phone, company, notes } = request.body ?? {};

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }
    if (!type || !type.trim()) {
      return reply.status(400).send({ error: 'type is required' });
    }

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        name: name.trim(),
        type: type.trim(),
        is_company: is_company ?? false,
        email: email ?? null,
        phone: phone ?? null,
        company: company ?? null,
        notes: notes ?? null,
      })
      .select(CONTACT_COLUMNS)
      .single<ContactRow>();

    if (error || !data) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not create the contact' });
    }
    return reply.status(201).send(data);
  });

  app.get<{ Params: { id: string } }>('/contacts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await getScopedClient(request)
      .from('contacts')
      .select(CONTACT_COLUMNS)
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<ContactRow>();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the contact' });
    }
    if (!data) {
      return reply.status(404).send({ error: 'Contact not found in your workspace' });
    }
    return data;
  });

  app.patch<{ Params: { id: string }; Body: UpdateContactBody }>(
    '/contacts/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { name, type, is_company, email, phone, company, notes } = request.body ?? {};

      if (name !== undefined && !name.trim()) {
        return reply.status(400).send({ error: 'name cannot be empty' });
      }
      if (type !== undefined && !type.trim()) {
        return reply.status(400).send({ error: 'type cannot be empty' });
      }

      const updateFields: Record<string, unknown> = {};
      if (name !== undefined) updateFields.name = name.trim();
      if (type !== undefined) updateFields.type = type.trim();
      if (is_company !== undefined) updateFields.is_company = is_company;
      if (email !== undefined) updateFields.email = email;
      if (phone !== undefined) updateFields.phone = phone;
      if (company !== undefined) updateFields.company = company;
      if (notes !== undefined) updateFields.notes = notes;

      const { data, error } = await supabase
        .from('contacts')
        .update(updateFields)
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select(CONTACT_COLUMNS)
        .maybeSingle<ContactRow>();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the contact' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Contact not found in your workspace' });
      }
      return data;
    },
  );

  // tb-crm-contacts-page-001: checks every known reference to a contact
  // before deleting, so a still-referenced contact fails with a clear,
  // named 409 rather than a raw foreign-key-violation string (properties.
  // owner_id has no DB-level FK yet -- see tb-crm-owner-fk-001, currently
  // blocked -- so this app-layer check is the only enforcement for that
  // reference today; projects.developer_id and listings.buyer_contact_id
  // already have real FKs, but checking explicitly here keeps the error
  // message consistent and named across all three, not just the ones the
  // database happens to enforce).
  app.delete<{ Params: { id: string } }>('/contacts/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can delete a contact' });
    }

    const supabase = getScopedClient(request);
    const tenantId = request.user!.tenantId;
    const contactId = request.params.id;

    const [{ data: properties, error: propertiesError }, { data: projects, error: projectsError }, { data: listings, error: listingsError }] =
      await Promise.all([
        supabase.from('properties').select('id').eq('tenant_id', tenantId).eq('owner_id', contactId),
        supabase.from('projects').select('id').eq('tenant_id', tenantId).eq('developer_id', contactId),
        supabase.from('listings').select('id').eq('tenant_id', tenantId).eq('buyer_contact_id', contactId),
      ]);

    if (propertiesError || projectsError || listingsError) {
      request.log.error(propertiesError ?? projectsError ?? listingsError);
      return reply.status(500).send({ error: 'Could not check existing references to this contact' });
    }

    const referencedBy: string[] = [];
    if ((properties ?? []).length > 0) referencedBy.push('properties');
    if ((projects ?? []).length > 0) referencedBy.push('projects');
    if ((listings ?? []).length > 0) referencedBy.push('listings');

    if (referencedBy.length > 0) {
      return reply.status(409).send({
        error: `Cannot delete: this contact is still referenced by ${referencedBy.join(', ')}`,
        referenced_by: referencedBy,
      });
    }

    const { error } = await supabase.from('contacts').delete().eq('id', contactId).eq('tenant_id', tenantId);

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not delete the contact' });
    }
    return reply.status(204).send();
  });
}
