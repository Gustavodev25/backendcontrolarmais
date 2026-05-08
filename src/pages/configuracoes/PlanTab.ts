import { openInvoiceModal } from './InvoiceModal';
import { openUpdateCardModal } from './UpdateCardModal';
import { toaster } from '../../components/Toast';
import { createStripeCustomerPortalSession } from '../../lib/stripe';

export function PlanTab(userData: any) {
  if (!userData) {
    return `
        <div class="flex items-center justify-center p-20">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#D97757]"></div>
          <p class="ml-3 text-[13px] text-[var(--color-text-secondary)]">Sincronizando com Firebase...</p>
        </div>
      `;
  }

  // Basic plan info mapping - common field names e dump exato do user
  const rawPlan = userData?.subscription?.plan || userData?.plan || userData?.plano || 'Pro';
  const plan = rawPlan.charAt(0).toUpperCase() + rawPlan.slice(1);

  // Suporta both formats: "monthly", "annual", "mensal", "anual", etc.
  const isAnnual = userData?.subscription?.billingCycle === 'annual' ||
    userData?.subscription?.billingCycle === 'yearly' ||
    userData?.billingCycle === 'annual' ||
    userData?.ciclo === 'anual';

  const price = userData?.subscription?.price || userData?.planPrice || userData?.valor || (plan.toLowerCase() === 'pro' ? '35,90' : '0,00');
  const rawStatus = userData?.subscription?.status || userData?.subscriptionStatus || userData?.status || 'Ativo';
  const statusMap: Record<string, string> = {
    'active': 'Ativo',
    'trialing': 'Período de teste',
    'past_due': 'Pagamento pendente',
    'canceled': 'Cancelado',
    'unpaid': 'Não pago',
  };
  const status = statusMap[rawStatus.toLowerCase()] || rawStatus;

  // Handle renewal date (from dump nextBillingDate: "2026-02-08")
  const rawRenewalDate = userData?.subscription?.nextBillingDate ||
    userData?.subscription?.renewalDate ||
    userData?.subscription?.currentPeriodEnd ||
    userData?.subscription?.current_period_end ||
    userData?.renewalDate ||
    userData?.nextBillingDate ||
    userData?.proximaRenovacao;

  // Logs apenas em desenvolvimento
  const isDev = false; // Set to true para debug
  const invoicesList = userData?.invoices || userData?.faturas || userData?.historico || [];
  if (isDev) {
    console.log('[PlanTab] rawRenewalDate:', rawRenewalDate);
    console.log('[PlanTab] Invoices count:', invoicesList.length);
  }

  let renewalDate = '—';
  if (rawRenewalDate) {
    if (typeof rawRenewalDate === 'object' && rawRenewalDate.seconds) {
      renewalDate = new Date(rawRenewalDate.seconds * 1000).toLocaleDateString('pt-BR');
    } else if (typeof rawRenewalDate === 'string' && rawRenewalDate.includes('T')) {
      // ISO string like "2026-03-19T03:00:00.000Z"
      renewalDate = new Date(rawRenewalDate).toLocaleDateString('pt-BR');
    } else if (typeof rawRenewalDate === 'string' && rawRenewalDate.includes('-')) {
      // "YYYY-MM-DD"
      const parts = rawRenewalDate.split('-');
      if (parts.length === 3) {
        renewalDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      } else {
        renewalDate = rawRenewalDate;
      }
    } else if (typeof rawRenewalDate === 'number') {
      // Unix timestamp in seconds
      renewalDate = new Date(rawRenewalDate * 1000).toLocaleDateString('pt-BR');
    } else {
      renewalDate = rawRenewalDate;
    }
  }

  // Fallback: SEMPRE calcular a partir da última fatura se não temos data válida
  // (Bug: webhook não está salvando currentPeriodEnd corretamente)
  if (renewalDate === '—' || !rawRenewalDate) {
    let invoicesList = userData?.invoices || userData?.faturas || userData?.historico || [];

    // Ordenar por data (mais recente primeiro)
    if (invoicesList.length > 0) {
      invoicesList = invoicesList.sort((a: any, b: any) => {
        const dateA = new Date(a?.date || a?.data || a?.dueDate || a?.created || 0).getTime();
        const dateB = new Date(b?.date || b?.data || b?.dueDate || b?.created || 0).getTime();
        return dateB - dateA; // descending order (newest first)
      });
    }

    if (invoicesList.length > 0) {
      const lastInvoice = invoicesList[0];
      const invDate = lastInvoice?.date || lastInvoice?.data || lastInvoice?.dueDate || lastInvoice?.created;
      if (invDate) {
        let baseDate: Date | null = null;
        if (typeof invDate === 'object' && invDate.seconds) {
          baseDate = new Date(invDate.seconds * 1000);
        } else if (typeof invDate === 'number') {
          // Unix timestamp
          baseDate = new Date(invDate * 1000);
        } else if (typeof invDate === 'string') {
          baseDate = new Date(invDate);
        }
        if (baseDate && !isNaN(baseDate.getTime())) {
          // Adicionar 1 mês (ou 1 ano se anual)
          if (isAnnual) {
            baseDate.setFullYear(baseDate.getFullYear() + 1);
          } else {
            baseDate.setMonth(baseDate.getMonth() + 1);
          }
          renewalDate = baseDate.toLocaleDateString('pt-BR');
        }
      }
    }
  }

  const nextBillingAmount = userData?.subscription?.nextAmount || userData?.nextBillingAmount || price;

  // Payment method info (from dump: paymentMethodDetails and subscription.creditCardLast4)
  const cardLast4 = userData?.paymentMethodDetails?.last4 ||
    userData?.subscription?.creditCardLast4 ||
    userData?.paymentMethod?.last4 ||
    userData?.cardLast4 ||
    userData?.finalCartao ||
    '••••';

  const cardBrand = (userData?.paymentMethodDetails?.brand ||
    userData?.subscription?.creditCardBrand ||
    userData?.paymentMethod?.brand ||
    userData?.cardBrand ||
    userData?.bandeira ||
    'VISA').toUpperCase();

  const cardExpiry = userData?.paymentMethodDetails?.expiry ||
    userData?.paymentMethod?.expiry ||
    userData?.cardExpiry ||
    userData?.validade ||
    '—/—';

  const autoRenewal = userData?.subscription?.autoRenew !== false &&
    userData?.subscription?.autoRenewal !== false &&
    userData?.autoRenewal !== false;
  const isStripeBilling = userData?.subscription?.provider === 'stripe';
  const isAsaasBilling = Boolean(
    userData?.subscription?.provider === 'asaas' ||
    userData?.subscription?.asaasSubscriptionId ||
    userData?.subscription?.asaasCustomerId ||
    userData?.asaasSubscriptionId ||
    userData?.asaasCustomerId
  );
  const isAsaasMigrationLocked = typeof sessionStorage !== 'undefined'
    && sessionStorage.getItem('asaasMigrationRequired') === '1';
  const paymentActionLabel = isStripeBilling ? 'Gerenciar' : 'Editar';
  const cancelActionLabel = isStripeBilling ? 'Abrir portal' : 'Cancelar plano';

  // Invoices list mapping
  let invoices = (userData?.invoices || userData?.faturas || userData?.historico || []);

  // Se o histórico de faturas estiver vazio mas houver connectionLogs (como no dump), 
  // podemos considerar que o usuário quer ver os registros de acesso ou que os logs 
  // de conexão estão sendo confundidos com o histórico. 
  // No entanto, o mais provável é que "Histórico" se refira a faturas.
  // Vamos manter o foco em faturas mas formatar melhor os campos.

  invoices = invoices.map((inv: any) => {
    // Handle Firestore Timestamp for invoice dates
    let formattedDate = inv.date || inv.data || inv.due_date || inv.timestamp || '—';
    if (formattedDate && typeof formattedDate === 'object' && formattedDate.seconds) {
      formattedDate = new Date(formattedDate.seconds * 1000).toLocaleDateString('pt-BR');
    } else if (typeof formattedDate === 'string' && formattedDate.includes('T')) {
      // ISO string check
      formattedDate = new Date(formattedDate).toLocaleDateString('pt-BR');
    }
    return {
      ...inv,
      formattedDate
    };
  });

  return `
    <div class="pt-root">
    <style>
      .pt-root * { box-sizing: border-box; margin: 0; padding: 0; }
      .pt-root {
        font-family: 'Sora', sans-serif;
        --pt-accent:       #D97757;
        --pt-accent-dim:   rgba(217,119,87,0.10);
        --pt-green:        #2dd4a0;
        --pt-green-dim:    rgba(45,212,160,0.10);
        --pt-r:            1.25rem;
      }

      @keyframes pt-up {
        from { opacity:0; transform:translateY(8px); }
        to   { opacity:1; transform:translateY(0); }
      }
      .pt-a1 { animation: pt-up .32s cubic-bezier(.22,1,.36,1) both; }
      .pt-a2 { animation: pt-up .32s cubic-bezier(.22,1,.36,1) .06s both; }
      .pt-a3 { animation: pt-up .32s cubic-bezier(.22,1,.36,1) .12s both; }
      .pt-a4 { animation: pt-up .32s cubic-bezier(.22,1,.36,1) .18s both; }

      /* ── layout ── */
      .pt-grid {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 760px;
      }

      .pt-header { margin-bottom: 1.25rem; }
      .pt-eyebrow {
        font-size: 10px; font-weight: 600; letter-spacing: .18em;
        text-transform: uppercase; color: var(--pt-accent); opacity: .8;
        margin-bottom: 4px;
      }
      .pt-title {
        font-size: 20px; font-weight: 600;
        color: var(--color-text); letter-spacing: -.02em;
      }

      /* ── shared card ── */
      .pt-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--pt-r);
        overflow: hidden;
      }

      .pt-actions { padding: 1.5rem; padding-top: 0; }
      .pt-btn {
        height: 34px; padding: 0 20px; border-radius: 8px;
        font-family: 'Sora', sans-serif; font-size: 11px; font-weight: 600;
        letter-spacing: .02em; cursor: pointer; border: none;
        transition: opacity .15s, background .15s;
        width: fit-content;
      }
      .pt-btn-primary { background: var(--pt-accent); color: #fff; }
      .pt-btn-primary:hover { opacity: .82; }
      .pt-btn-ghost {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
      }
      .pt-btn-ghost:hover { color: var(--color-text); background: var(--color-surface-hover); }

      /* ── meta pills under plans ── */
      .pt-meta-row {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1px;
        background: var(--color-border);
        border: 1px solid var(--color-border);
        border-radius: var(--pt-r);
        overflow: hidden;
      }
      @media (min-width: 480px) {
        .pt-meta-row { grid-template-columns: repeat(3, 1fr); }
      }
      .pt-meta-cell {
        background: var(--color-surface);
        padding: 12px 14px;
      }
      @media (min-width: 480px) {
        .pt-meta-cell { padding: 14px 16px; }
      }
      .pt-meta-label {
        font-size: 9px; font-weight: 600; letter-spacing: .15em;
        text-transform: uppercase; color: var(--color-text-secondary);
        margin-bottom: 5px;
      }
      .pt-meta-value {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 12px; font-weight: 400;
        color: var(--color-text);
      }

      /* ── section card header ── */
      .pt-section-head {
        padding: .875rem 1.25rem;
        border-bottom: 1px solid var(--color-border);
        display: flex; align-items: center; justify-content: space-between;
      }
      .pt-section-label {
        font-size: 10px; font-weight: 600; letter-spacing: .14em;
        text-transform: uppercase; color: var(--color-text-secondary);
      }
      .pt-link {
        font-size: 11px; font-weight: 500; color: var(--pt-accent);
        cursor: pointer; opacity: .75; transition: opacity .15s; text-decoration: none;
      }
      .pt-link:hover { opacity: 1; }

      /* ── payment ── */
      .pt-pay-body { padding: 1rem; }
      @media (min-width: 480px) { .pt-pay-body { padding: 1.25rem; } }
      .pt-card-visual {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: rgba(255,255,255,.018);
        min-width: 0;
      }
      .pt-chip {
        width: 22px; height: 16px; border-radius: 3px;
        background: linear-gradient(135deg,#c8a84b,#e9cc78); flex-shrink: 0;
      }
      .pt-card-num {
        font-family: 'IBM Plex Mono', monospace;
        font-size: clamp(10px, 2.5vw, 13px); font-weight: 400;
        color: var(--color-text); letter-spacing: .08em; flex: 1;
        min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .pt-card-brand {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10px; font-weight: 500;
        color: var(--color-text-secondary); letter-spacing: .08em; flex-shrink: 0;
      }
      .pt-pay-meta {
        margin-top: 8px; font-size: 11px;
        color: var(--color-text-secondary); font-weight: 400;
        line-height: 1.5;
      }

      /* ── invoices ── */
      .pt-invoice-list { padding: 6px; }
      .pt-invoice-row {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px; border-radius: 8px;
        cursor: pointer; transition: background .12s;
      }
      .pt-invoice-row:hover { background: var(--color-surface-hover); }
      .pt-invoice-row:hover .pt-dl { color: var(--color-text); }
      .pt-inv-dot {
        width: 4px; height: 4px; border-radius: 50%;
        background: var(--pt-green); flex-shrink: 0;
        box-shadow: 0 0 4px rgba(45,212,160,.35);
      }
      .pt-inv-month { font-size: 12px; font-weight: 500; color: var(--color-text); flex: 1; }
      .pt-inv-date {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10px; color: var(--color-text-secondary);
      }
      .pt-inv-amount {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 12px; color: var(--color-text);
        min-width: 52px; text-align: right;
      }
      .pt-dl { color: var(--color-text-secondary); transition: color .12s; flex-shrink: 0; }

      /* ── cancel row ── */
      .pt-cancel-row {
        padding: .75rem 1rem;
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px;
        border-top: 1px solid var(--color-border);
      }
      @media (min-width: 480px) {
        .pt-cancel-row { padding: .875rem 1.25rem; }
      }
      .pt-cancel-text { font-size: 11px; color: var(--color-text-secondary); flex: 1; min-width: 0; }
      .pt-cancel-link {
        font-size: 11px; font-weight: 500;
        color: var(--color-text-secondary); opacity: .5;
        cursor: pointer; transition: opacity .15s, color .15s; text-decoration: none;
        flex-shrink: 0; white-space: nowrap;
      }
      .pt-cancel-link:hover { opacity: 1; color: #e87474; }

      /* ── asaas migration alert ── */
      .pt-asaas-alert {
        border-color: rgba(217,119,87,0.25);
      }
      .pt-asaas-icon {
        color: #D97757;
        flex-shrink: 0;
      }
      .pt-asaas-content {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }
      .pt-asaas-content strong {
        color: var(--color-text);
        font-weight: 600;
      }
    </style>

    <div class="pt-root">
      <div class="pt-header pt-a1">
        <div class="pt-eyebrow">Assinatura</div>
        <div class="pt-title">Meu Plano</div>
      </div>

      <div class="pt-grid">

        <!-- Current plan + Asaas alert (grudado) -->
        <div class="pt-a2" style="display:flex;flex-direction:column;${isAsaasBilling ? 'gap:0;' : ''}">

          ${isAsaasBilling ? `
          <div style="
            background: ${isAsaasMigrationLocked ? 'rgba(217,119,87,0.08)' : 'var(--color-surface)'};
            border: 1px solid ${isAsaasMigrationLocked ? '#D97757' : 'var(--color-border)'};
            border-bottom: none;
            border-radius: var(--pt-r) var(--pt-r) 0 0;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 10px;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:${isAsaasMigrationLocked ? '#D97757' : 'var(--color-text-secondary)'};">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style="flex:1;min-width:0;">
              <p style="font-size:12px;font-weight:600;color:var(--color-text);margin-bottom:2px;">${isAsaasMigrationLocked ? 'Migração obrigatória para continuar' : 'Plano gerenciado pelo Asaas'}</p>
              <p style="font-size:11px;color:var(--color-text-secondary);line-height:1.45;">${isAsaasMigrationLocked ? 'Sua assinatura no Asaas precisa ser migrada para o Stripe para liberar o restante do sistema. Outras páginas estão bloqueadas até a migração.' : 'Sua assinatura está ativa no Asaas. Migre para o Stripe para gerenciar pagamentos diretamente.'}</p>
            </div>
            <button id="btn-migrate-to-stripe" style="
              flex-shrink:0;white-space:nowrap;
              background:var(--color-surface);
              border:1px solid var(--color-border);
              color:var(--color-text);
              padding:8px 16px;
              border-radius:12px;
              font-family:'Sora',sans-serif;
              font-size:13px;
              font-weight:500;
              cursor:pointer;
              transition:background .2s;
            " onmouseover="this.style.background='var(--color-surface-hover)'" onmouseout="this.style.background='var(--color-surface)'">
              Migrar para Stripe
            </button>
          </div>
          ` : ''}

          <div class="pt-card" style="${isAsaasBilling ? 'border-radius:0 0 var(--pt-r) var(--pt-r);border-top:none;' : ''}">
            <div class="pt-section-head">
              <span class="pt-section-label">Plano Atual</span>
            </div>
            <div class="pt-pay-body" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <div>
                <h3 style="font-size: 22px; font-weight: 600; color: var(--color-text); letter-spacing: -0.02em;">${plan}</h3>
                <p style="font-size: 12px; color: var(--color-text-secondary); margin-top: 4px;">Assinatura ativa vinculada à sua conta</p>
              </div>
              <div style="text-align: right;">
                <div style="display: flex; align-items: baseline; justify-content: flex-end; gap: 4px;">
                  <span class="pt-plan-currency" style="font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--color-text-secondary);">R$</span>
                  <span class="pt-plan-amount" style="font-family: 'IBM Plex Mono', monospace; font-size: clamp(24px, 6vw, 36px); color: var(--color-text); font-weight: 300; letter-spacing: -0.04em;">${price}</span>
                </div>
                <span class="pt-plan-period" style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--color-text-secondary);">${isAnnual ? 'ano' : 'mês'} — ${status}</span>
              </div>
            </div>
          </div>

        </div>

        <!-- Billing meta -->
        <div class="pt-meta-row pt-a3">
          <div class="pt-meta-cell">
            <div class="pt-meta-label">Renovação</div>
            <div class="pt-meta-value">${renewalDate}</div>
          </div>
          <div class="pt-meta-cell">
            <div class="pt-meta-label">Ciclo</div>
            <div class="pt-meta-value">${isAnnual ? 'Anual' : 'Mensal'}</div>
          </div>
          <div class="pt-meta-cell">
            <div class="pt-meta-label">Próxima cobrança</div>
            <div class="pt-meta-value">R$\u00a0${nextBillingAmount}</div>
          </div>
        </div>

        <!-- Payment method -->
        <div class="pt-card pt-a3">
          <div class="pt-section-head">
            <span class="pt-section-label">Método de Pagamento</span>
          </div>
          <div class="pt-pay-body">
            <div class="pt-card-visual">
              <div class="pt-chip"></div>
              <span class="pt-card-num">•••• •••• •••• ${cardLast4}</span>
              <span class="pt-card-brand">${cardBrand}</span>
            </div>
            <p class="pt-pay-meta">Expira ${cardExpiry} &nbsp;·&nbsp; ${autoRenewal ? 'Renovação automática ativa' : 'Renovação automática desativada'}</p>
          </div>
          <div class="pt-cancel-row">
            ${isAsaasBilling ? `
              <span class="pt-cancel-text">Assinatura gerenciada pelo <strong>Asaas</strong>. Para cancelar, entre em contato com o suporte.</span>
              <span style="font-size:10px;font-weight:600;letter-spacing:.08em;padding:3px 8px;border-radius:4px;background:rgba(217,119,87,0.12);color:#D97757;flex-shrink:0;">ASAAS</span>
            ` : `
              <span class="pt-cancel-text">Para alterar o método de pagamento, acesse o portal Stripe.</span>
              <a id="btn-manage-billing" class="pt-cancel-link">Abrir portal</a>
            `}
          </div>
        </div>

        <!-- Invoice history -->
        <div class="pt-card pt-a4">
          <div class="pt-section-head">
            <span class="pt-section-label">Histórico</span>
            <a class="pt-link">Ver tudo</a>
          </div>
          <div class="pt-invoice-list">
            ${invoices.length > 0 ? invoices.map((inv: any, index: number) => `
              <div class="pt-invoice-row" data-idx="${index}">
                <span class="pt-inv-dot"></span>
                <span class="pt-inv-month">
                  ${(() => {
      const rawMonth = inv.month || inv.mes || (inv.formattedDate !== '—' ? new Date(inv.date?.seconds * 1000 || inv.date).toLocaleString('pt-BR', { month: 'long' }) : 'Fatura');
      return rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
    })()}
                </span>
                <span class="pt-inv-date">${inv.formattedDate}</span>
                <span class="pt-inv-amount">R$\u00a0${inv.amount || inv.valor || inv.total || (inv.value ? String(inv.value).replace('.', ',') : '0,00')}</span>
              </div>
            `).join('') : `
              <div class="py-4 text-center">
                <p class="text-[12px] text-[var(--color-text-secondary)]">Nenhuma fatura encontrada no Firebase.</p>
              </div>
            `}
          </div>
        </div>

      </div>
    </div>
  `;
}

export function attachPlanListeners(userData: any) {
  const openStripePortal = async () => {
    try {
      const result = await createStripeCustomerPortalSession(window.location.origin);
      if (!result.url) throw new Error('Nao foi possivel abrir o portal Stripe.');
      window.location.assign(result.url);
    } catch (error: any) {
      console.error('Stripe portal error:', error);
      toaster.create({
        title: 'Falha ao abrir portal',
        description: error.message || 'Nao foi possivel abrir o portal do Stripe.',
        type: 'error'
      });
    }
  };
  // Listener Migrar para Stripe (usuários Asaas legados)
  const migrateBtn = document.getElementById('btn-migrate-to-stripe');
  if (migrateBtn) {
    migrateBtn.addEventListener('click', async () => {
      migrateBtn.setAttribute('disabled', 'true');
      (migrateBtn as HTMLButtonElement).textContent = 'Aguarde...';
      try {
        const { migrateAsaasToStripe } = await import('../../lib/stripe');
        const result = await migrateAsaasToStripe(window.location.origin);
        if (result.url) {
          window.location.assign(result.url);
        }
      } catch (error: any) {
        migrateBtn.removeAttribute('disabled');
        (migrateBtn as HTMLButtonElement).textContent = 'Migrar para Stripe';
        toaster.create({
          title: 'Erro ao migrar',
          description: error.message || 'Não foi possível iniciar a migração.',
          type: 'error',
        });
      }
    });
  }

  // Listener Editar Cartão
  const editPayBtn = document.getElementById('btn-edit-payment');
  if (editPayBtn) {
    editPayBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (userData?.subscription?.provider === 'stripe') {
        await openStripePortal();
        return;
      }
      openUpdateCardModal(userData);
    });
  }

  const manageBillingBtn = document.getElementById('btn-manage-billing');
  if (manageBillingBtn) {
    manageBillingBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (userData?.subscription?.provider === 'stripe') {
        await openStripePortal();
        return;
      }
      toaster.create({
        title: 'Fluxo legado',
        description: 'Este usuario ainda e gerenciado pelo fluxo anterior.',
        type: 'message'
      });
    });
  }

  const invoices = (userData?.invoices || userData?.faturas || userData?.historico || []);

  const invoiceRows = document.querySelectorAll('.pt-invoice-row');
  invoiceRows.forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.getAttribute('data-idx') || '0');
      const invoice = invoices[idx];
      if (invoice) {
        openInvoiceModal(invoice);
      }
    });
  });
}
