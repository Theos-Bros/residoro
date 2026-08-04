import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { canEditSetting } from '../lib/settingsDelegation.js';

type CommissionSettingsBody = {
  default_brokerage_pct?: number;
  default_agent_pct?: number;
  default_co_broker_pct?: number;
};
type CreateCommissionEarningsBody = {
  closing_id?: string;
  total_commission?: number;
  currency?: string;
};

function isValidPct(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

export async function registerCommissionRoutes(app: FastifyInstance) {
  // tb-commission-structure-001: Settings' sixth sub-section, following
  // MatchingSettingsPanel's exact view-all/edit-gated shape.
  app.get('/settings/commission', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('workspace_commission_settings')
      .select('default_brokerage_pct, default_agent_pct, default_co_broker_pct')
      .eq('tenant_id', request.user!.tenantId)
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load commission settings' });
    }

    const can_edit = await canEditSetting(supabase, request.user!.tenantId, request.user!.id, request.user!.role, 'commission');
    return { ...data, can_edit };
  });

  app.patch<{ Body: CommissionSettingsBody }>('/settings/commission', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const canEdit = await canEditSetting(supabase, request.user!.tenantId, request.user!.id, request.user!.role, 'commission');
    if (!canEdit) {
      return reply.status(403).send({ error: 'Only an admin or a delegated member can edit commission settings' });
    }

    const { default_brokerage_pct, default_agent_pct, default_co_broker_pct } = request.body ?? {};
    if (!isValidPct(default_brokerage_pct) || !isValidPct(default_agent_pct) || !isValidPct(default_co_broker_pct)) {
      return reply
        .status(400)
        .send({ error: 'default_brokerage_pct, default_agent_pct, and default_co_broker_pct must each be 0-100' });
    }
    if (default_brokerage_pct + default_agent_pct + default_co_broker_pct !== 100) {
      return reply.status(400).send({ error: 'default_brokerage_pct + default_agent_pct + default_co_broker_pct must equal 100' });
    }

    const { data, error } = await supabase
      .from('workspace_commission_settings')
      .update({ default_brokerage_pct, default_agent_pct, default_co_broker_pct })
      .eq('tenant_id', request.user!.tenantId)
      .select('default_brokerage_pct, default_agent_pct, default_co_broker_pct')
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not save commission settings' });
    }
    return { ...data, can_edit: true };
  });

  // tb-commission-structure-001: record the manually-entered total commission
  // for a completed Closing -- confirmed with the user, since real deals
  // sometimes negotiate a flat fee rather than a price-derived %. Splits it
  // brokerage/agent/co-broker using whichever workspace_commission_settings
  // percentages are current right now, snapshotted onto the row so a later
  // settings change never alters it. Open to any tenant member (a
  // transactional record, same precedent as offers/contracts/closings --
  // not a Settings sub-panel, which is the only thing admin-gated here).
  app.post<{ Body: CreateCommissionEarningsBody }>('/commission-earnings', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { closing_id, total_commission, currency } = request.body ?? {};

    if (!closing_id) {
      return reply.status(400).send({ error: 'closing_id is required' });
    }
    if (typeof total_commission !== 'number' || !Number.isFinite(total_commission) || total_commission <= 0) {
      return reply.status(400).send({ error: 'total_commission must be a positive number' });
    }

    const { data: closing, error: closingError } = await supabase
      .from('closings')
      .select('id, currency, completed_at')
      .eq('id', closing_id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{ id: string; currency: string; completed_at: string | null }>();

    if (closingError) {
      request.log.error(closingError);
      return reply.status(500).send({ error: 'Could not load the closing' });
    }
    if (!closing) {
      return reply.status(404).send({ error: 'Closing not found in your workspace' });
    }
    if (!closing.completed_at) {
      return reply.status(400).send({ error: 'Commission can only be recorded against a completed closing' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('commission_earnings')
      .select('id')
      .eq('closing_id', closing.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle<{ id: string }>();

    if (existingError) {
      request.log.error(existingError);
      return reply.status(500).send({ error: 'Could not check for existing commission earnings' });
    }
    if (existing) {
      return reply.status(400).send({ error: 'Commission earnings already recorded for this closing' });
    }

    const { data: settings, error: settingsError } = await supabase
      .from('workspace_commission_settings')
      .select('default_brokerage_pct, default_agent_pct, default_co_broker_pct')
      .eq('tenant_id', request.user!.tenantId)
      .single<{ default_brokerage_pct: number; default_agent_pct: number; default_co_broker_pct: number }>();

    if (settingsError || !settings) {
      request.log.error(settingsError);
      return reply.status(500).send({ error: 'Could not load commission settings' });
    }

    const brokerage_pct = settings.default_brokerage_pct;
    const agent_pct = settings.default_agent_pct;
    const co_broker_pct = settings.default_co_broker_pct;

    const { data: earnings, error: earningsError } = await supabase
      .from('commission_earnings')
      .insert({
        tenant_id: request.user!.tenantId,
        closing_id: closing.id,
        total_commission,
        currency: currency ?? closing.currency,
        brokerage_pct,
        agent_pct,
        co_broker_pct,
        brokerage_amount: (total_commission * brokerage_pct) / 100,
        agent_amount: (total_commission * agent_pct) / 100,
        co_broker_amount: (total_commission * co_broker_pct) / 100,
        created_by: request.user!.id,
      })
      .select('*')
      .single();

    if (earningsError || !earnings) {
      request.log.error(earningsError);
      return reply.status(500).send({ error: 'Could not record commission earnings' });
    }

    return reply.status(201).send(earnings);
  });

  app.get<{ Params: { id: string } }>(
    '/closings/:id/commission-earnings',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data, error } = await supabase
        .from('commission_earnings')
        .select('*')
        .eq('closing_id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load commission earnings' });
      }
      return { commission_earnings: data ?? null };
    },
  );
}
