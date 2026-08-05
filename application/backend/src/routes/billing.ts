import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';

type ContractBillingRow = { contract_value: number; currency: string; updated_at: string };
type BillingInstallmentRow = {
  id: string;
  amount: number;
  currency: string;
  due_date: string;
  status: 'unpaid' | 'paid';
  paid_date: string | null;
};

// tb-billing-brokerage-view-001: read-only brokerage-side view of the
// tenant's own contract billing -- RLS (contract_billing_select_admin /
// billing_installments_select_admin, shipped by tb-billing-installments-001)
// is the real enforcement; the app-level 403 below just gives a clean error
// message, same two-layer shape as GET /workspace/members.
export async function registerBillingRoutes(app: FastifyInstance) {
  app.get('/workspace/billing', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can view billing' });
    }

    const scoped = getScopedClient(request);

    const { data: billing, error: billingError } = await scoped
      .from('contract_billing')
      .select('contract_value, currency, updated_at')
      .maybeSingle<ContractBillingRow>();

    if (billingError) {
      request.log.error(billingError);
      return reply.status(500).send({ error: 'Could not load billing' });
    }

    const { data: installments, error: installmentsError } = await scoped
      .from('billing_installments')
      .select('id, amount, currency, due_date, status, paid_date')
      .order('due_date', { ascending: true })
      .returns<BillingInstallmentRow[]>();

    if (installmentsError) {
      request.log.error(installmentsError);
      return reply.status(500).send({ error: 'Could not load installments' });
    }

    return { contract_billing: billing ?? null, installments: installments ?? [] };
  });
}
