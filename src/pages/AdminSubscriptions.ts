import { BrilhoHeader } from '../components/BrilhoHeader';
import { Header, attachHeaderListeners } from '../components/Header';
import { toaster } from '../components/Toast';
import { Modal } from '../components/Modal';
import { auth } from '../lib/firebase';
import { API_BASE } from '../lib/apiConfig';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Avvvatars from 'avvvatars-react';
import { FilterSelector, attachFilterSelectorListeners, type FilterOption } from '../components/FilterSelector';
import { Tooltip, initAllTooltips } from '../components/Tooltip';
import { DeleteConfirmationModal } from '../components/DeleteConfirmationModal';
import { GenericDropdown, attachGenericDropdownListeners } from '../components/GenericDropdown';

const verifiedIconStripe = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#6faf6e" class="shrink-0" title="Stripe: Assinatura Verificada e Ativa"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12.01 2.011a3.2 3.2 0 0 1 2.113 .797l.154 .145l.698 .698a1.2 1.2 0 0 0 .71 .341l.135 .008h1a3.2 3.2 0 0 1 3.195 3.018l.005 .182v1c0 .27 .092 .533 .258 .743l.09 .1l.697 .698a3.2 3.2 0 0 1 .147 4.382l-.145 .154l-.698 .698a1.2 1.2 0 0 0 -.341 .71l-.008 .135v1a3.2 3.2 0 0 1 -3.018 3.195l-.182 .005h-1a1.2 1.2 0 0 0 -.743 .258l-.1 .09l-.698 .697a3.2 3.2 0 0 1 -4.382 .147l-.154 -.145l-.698 -.698a1.2 1.2 0 0 0 -.71 -.341l-.135 -.008h-1a3.2 3.2 0 0 1 -3.195 -3.018l-.005 -.182v-1a1.2 1.2 0 0 0 -.258 -.743l-.09 -.1l-.697 -.698a3.2 3.2 0 0 1 -.147 -4.382l.145 -.154l.698 -.698a1.2 1.2 0 0 0 .341 -.71l.008 -.135v-1l.005 -.182a3.2 3.2 0 0 1 3.013 -3.013l.182 -.005h1a1.2 1.2 0 0 0 .743 -.258l.1 -.09l.698 -.697a3.2 3.2 0 0 1 2.269 -.944zm3.697 7.282a1 1 0 0 0 -1.414 0l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.32 1.497l2 2l.094 .083a1 1 0 0 0 1.32 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z" /></svg>`;
const verifiedIconAsaas = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#2869d2" class="shrink-0" title="Asaas: Assinatura Verificada e Ativa"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12.01 2.011a3.2 3.2 0 0 1 2.113 .797l.154 .145l.698 .698a1.2 1.2 0 0 0 .71 .341l.135 .008h1a3.2 3.2 0 0 1 3.195 3.018l.005 .182v1c0 .27 .092 .533 .258 .743l.09 .1l.697 .698a3.2 3.2 0 0 1 .147 4.382l-.145 .154l-.698 .698a1.2 1.2 0 0 0 -.341 .71l-.008 .135v1a3.2 3.2 0 0 1 -3.018 3.195l-.182 .005h-1a1.2 1.2 0 0 0 -.743 .258l-.1 .09l-.698 .697a3.2 3.2 0 0 1 -4.382 .147l-.154 -.145l-.698 -.698a1.2 1.2 0 0 0 -.71 -.341l-.135 -.008h-1a3.2 3.2 0 0 1 -3.195 -3.018l-.005 -.182v-1a1.2 1.2 0 0 0 -.258 -.743l-.09 -.1l-.697 -.698a3.2 3.2 0 0 1 -.147 -4.382l.145 -.154l.698 -.698a1.2 1.2 0 0 0 .341 -.71l.008 -.135v-1l.005 -.182a3.2 3.2 0 0 1 3.013 -3.013l.182 -.005h1a1.2 1.2 0 0 0 .743 -.258l.1 -.09l.698 -.697a3.2 3.2 0 0 1 2.269 -.944zm3.697 7.282a1 1 0 0 0 -1.414 0l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.32 1.497l2 2l.094 .083a1 1 0 0 0 1.32 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z" /></svg>`;
const loaderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" title="Verificando assinatura..."><style>@keyframes spinner_qM83{0%{stroke-dasharray:0 150;stroke-dashoffset:0}47.5%{stroke-dasharray:42 150;stroke-dashoffset:-16}95%,100%{stroke-dasharray:42 150;stroke-dashoffset:-59}}@keyframes spinner_8Q3b{100%{transform:rotate(360deg)}}.spi{transform-origin:center;animation:spinner_8Q3b 2s linear infinite}.spi circle{stroke-linecap:round;animation:spinner_qM83 1.5s ease-in-out infinite}</style><g class="spi"><circle cx="12" cy="12" r="9.5" fill="none" /></g></svg>`;
const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// ====================== HELPERS ======================

function normalizeValue(value: any): string {
  return String(value ?? '').trim().toLowerCase();
}

function parseMoneyValue(value: any): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (value === null || value === undefined) return 0;

  let normalized = String(value).trim().replace(/[^\d,.-]/g, '');
  if (!normalized) return 0;

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isAnnualBillingCycle(value: any): boolean {
  return ['annual', 'year', 'yearly', 'anual'].includes(normalizeValue(value));
}

function isActiveClient(userItem: any): boolean {
  return userItem.isVerified === true;
}

function isPayingClient(userItem: any): boolean {
  return userItem.isVerified === true;
}

function getMonthlyRevenue(userItem: any): number {
  if (!isPayingClient(userItem)) return 0;

  const verifiedAmount = parseMoneyValue(userItem.verifiedMonthlyAmount);
  if (verifiedAmount > 0) return verifiedAmount;

  const monthlyAmount = parseMoneyValue(userItem.subscriptionMonthlyAmount);
  if (monthlyAmount > 0) return monthlyAmount;

  const rawAmount = parseMoneyValue(
    userItem.subscriptionAmount ?? userItem.subscriptionPrice ?? userItem.nextAmount ?? userItem.price
  );

  if (rawAmount > 0) {
    return isAnnualBillingCycle(userItem.billingCycle) ? rawAmount / 12 : rawAmount;
  }

  return 0;
}

function getActiveClientSummary(users: any[]): { count: number; revenue: number } {
  return users.reduce((acc, userItem) => {
    if (!isPayingClient(userItem)) return acc;

    acc.count += 1;
    acc.revenue += getMonthlyRevenue(userItem);
    return acc;
  }, { count: 0, revenue: 0 });
}

function updateTableSummary(users: any[]): void {
  const summary = getActiveClientSummary(users);
  const activeCountEl = document.querySelector('.cc-active-client-count');
  const revenueEl = document.querySelector('.cc-active-revenue');

  if (activeCountEl) {
    activeCountEl.textContent = `${summary.count} cliente${summary.count !== 1 ? 's' : ''}`;
  }

  if (revenueEl) {
    revenueEl.textContent = moneyFormatter.format(summary.revenue);
  }
}

function statusBadge(status: string, verified: string | null): string {
  const s = (verified || status || '').toLowerCase();
  const map: Record<string, { label: string; cls: string }> = {
    active:   { label: 'Ativo',     cls: 'cc-badge-paid' },
    overdue:  { label: 'Inadimpl.', cls: 'cc-badge-pending' },
    past_due: { label: 'Inadimpl.', cls: 'cc-badge-pending' },
    trialing: { label: 'Trial',     cls: 'cc-badge-pending' },
    inactive: { label: 'Inativo',   cls: 'cc-badge-inactive' },
    canceled: { label: 'Cancelado', cls: 'cc-badge-inactive' },
    unpaid:   { label: 'Não Pago',  cls: 'cc-badge-charge' },
    error:    { label: 'Erro API',  cls: 'cc-badge-charge' },
  };
  const entry = map[s] ?? { label: status || '—', cls: 'cc-badge-inactive' };
  return `<span class="cc-badge ${entry.cls}">${entry.label}</span>`;
}

function providerBadge(provider: string): string {
  if (provider === 'asaas') {
    return `<span class="cc-category cc-category-asaas">Asaas</span>`;
  }
  if (provider === 'stripe') {
    return `<span class="cc-category cc-category-stripe">Stripe</span>`;
  }
  return `<span class="cc-category">—</span>`;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr || dateStr === 'N/A' || dateStr === '—') return 'Data não disponível';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtRelativeTime(dateStr: string | null): { text: string; color: string } {
  if (!dateStr) return { text: 'Nunca entrou', color: 'var(--color-text-secondary)' };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { text: 'Nunca entrou', color: 'var(--color-text-secondary)' };
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  let text: string;
  let color: string;

  if (diffSec < 60) {
    text = `Há ${diffSec}s`;
    color = '#22c55e';
  } else if (diffMin < 60) {
    text = `Há ${diffMin} min`;
    color = '#22c55e';
  } else if (diffHr < 24) {
    text = `Há ${diffHr}h`;
    color = diffHr < 6 ? '#22c55e' : '#f59e0b';
  } else if (diffDay < 7) {
    text = `Há ${diffDay} dia${diffDay !== 1 ? 's' : ''}`;
    color = '#f59e0b';
  } else {
    text = `Há ${diffDay} dias`;
    color = 'var(--color-text-secondary)';
  }

  return { text, color };
}

function renderRow(userItem: any): string {
  const roleLabel = userItem.isAdmin ? '<span class="cc-badge cc-badge-paid">Admin</span>' : '<span class="cc-badge cc-badge-inactive">Usuário</span>';
  
  let planLabel = userItem.plan === 'pro' 
    ? '<span class="cc-badge cc-badge-paid">Pro</span>' 
    : '<span class="cc-badge cc-badge-inactive">Sem plano</span>';

  let providerHtml = '<span class="cc-badge cc-badge-inactive">Sistema</span>';
  if (userItem.provider === 'asaas') {
    providerHtml = `<img src="/assets/logo/assas.png" class="cc-provider-img" title="Asaas" />`;
  } else if (userItem.provider === 'stripe') {
    providerHtml = `<img src="/assets/logo/stripe.png" class="cc-provider-img" title="Stripe" />`;
  } else if (userItem.plan === 'pro') {
    providerHtml = `<span class="cc-badge cc-badge-inactive">Legado</span>`;
  }

  const targetIcon = userItem.provider === 'asaas' ? verifiedIconAsaas : verifiedIconStripe;
  
  let verifiedBadgeHtml = '';
  if (userItem.isVerified === true) {
    verifiedBadgeHtml = Tooltip({
      id: `v-t-${userItem.uid}`,
      className: `user-verify-badge-${userItem.uid}`,
      content: targetIcon,
      text: `Assinatura verificada no ${userItem.provider === 'asaas' ? 'Asaas' : 'Stripe'}`
    });
  } else if (userItem.isVerified === undefined && (userItem.provider === 'stripe' || userItem.provider === 'asaas')) {
    verifiedBadgeHtml = Tooltip({
      id: `v-t-${userItem.uid}`,
      className: `user-verify-badge-${userItem.uid}`,
      content: loaderIcon,
      text: `Verificando status no ${userItem.provider === 'asaas' ? 'Asaas' : 'Stripe'}...`
    });
  }

  return `
    <tr>
      <td>
        <div class="flex items-center gap-3">
          <div class="avvvatar-target shrink-0" data-val="${userItem.email || userItem.uid}" style="width:32px;height:32px;border-radius:12px;overflow:hidden;"></div>
          <div class="overflow-hidden">
            <div class="flex items-center gap-1.5" style="font-weight:500;font-size:13px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;" title="${userItem.name}">
              <span class="truncate">${userItem.name}</span>
              ${verifiedBadgeHtml}
            </div>
            <div style="font-size:11.5px;color:var(--color-text-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;" title="${userItem.email}">${userItem.email}</div>
          </div>
        </div>
      </td>
      <td>${roleLabel}</td>
      <td>${planLabel}</td>
      <td>${providerHtml}</td>
      <td>
        ${(() => {
          const rel = fmtRelativeTime(userItem.lastLogin);
          const days = userItem.activeDaysCount || 0;
          const dotColor = rel.color === '#22c55e' ? '#22c55e' : rel.color === '#f59e0b' ? '#f59e0b' : 'var(--color-text-secondary)';
          return `
            <div style="display:flex;flex-direction:column;gap:2px;">
              <div style="display:flex;align-items:center;gap:5px;">
                <span style="width:6px;height:6px;border-radius:50%;background:${dotColor};flex-shrink:0;"></span>
                <span style="font-size:13px;font-weight:500;white-space:nowrap;color:${rel.color};">${rel.text}</span>
              </div>
              <div style="font-size:11px;color:var(--color-text-secondary);white-space:nowrap;padding-left:11px;">
                ${days > 0 ? `${days} dia${days !== 1 ? 's' : ''} de uso` : 'Sem registros'}
              </div>
            </div>
          `;
        })()}
      </td>
      <td style="font-variant-numeric:tabular-nums;white-space:nowrap;font-size:13px;">
        ${fmtDate(userItem.createdAt)}
      </td>
      <td style="text-align:right;">
        <!-- Desktop: 3 botões separados -->
        <div class="flex items-center justify-end gap-2 cc-desktop-actions">
          <button class="cc-action-btn user-btn-info" data-user='${JSON.stringify(userItem).replace(/'/g, "&#39;")}' title="Ver Informações">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
             </svg>
          </button>
          <button class="cc-action-btn user-btn-admin" data-uid="${userItem.uid}" data-is-admin="${userItem.isAdmin}" title="${userItem.isAdmin ? 'Remover Admin' : 'Tornar Admin'}">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${userItem.isAdmin ? '#D97757' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
             </svg>
          </button>
          <button class="cc-action-btn user-btn-delete" data-uid="${userItem.uid}" title="Excluir Usuário">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>
             </svg>
          </button>
        </div>
        <!-- Mobile: menu de 3 pontos -->
        <div class="cc-mobile-actions" style="position:relative;">
          <button id="user-mob-${userItem.uid}" class="cc-action-btn user-mob-trigger"
                  data-user='${JSON.stringify(userItem).replace(/'/g, "&#39;")}'
                  data-uid="${userItem.uid}" data-is-admin="${userItem.isAdmin}" title="Opções">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
            </svg>
          </button>
          ${GenericDropdown({
            id: `user-mob-${userItem.uid}`,
            width: '180px',
            items: [
              {
                id: `user-mi-info-${userItem.uid}`,
                label: 'Ver Informações',
                icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
              },
              {
                id: `user-mi-adm-${userItem.uid}`,
                label: userItem.isAdmin ? 'Remover Admin' : 'Tornar Admin',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${userItem.isAdmin ? '#D97757' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
              },
              {
                id: `user-mi-del-${userItem.uid}`,
                label: 'Excluir Usuário',
                icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>',
                variant: 'danger',
              },
            ],
          })}
        </div>
      </td>
    </tr>
  `;
}

function renderTableContent(users: any[]): string {
  if (users.length === 0) {
    return `
      <tr>
        <td colspan="7" style="padding:60px 0;text-align:center;border:none;color:var(--color-text-secondary);font-size:13px;">
          Nenhum usuário encontrado com este filtro.
        </td>
      </tr>
    `;
  }
  return users.map((u) => renderRow(u)).join('');
}

let allUsersGlobal: any[] = [];
let filteredUsersGlobal: any[] = [];

const filters1: FilterOption[] = [
  { id: 'all_status',   label: 'Todos Status' },
  { id: 'active_subs',  label: 'Pagantes' },
  { id: 'pro',          label: 'Usuários PRO' },
];

const filters2: FilterOption[] = [
  { id: 'all_providers', label: 'Todos Provedores' },
  { id: 'stripe',        label: 'Stripe' },
  { id: 'asaas',         label: 'Asaas' },
];

const filters3: FilterOption[] = [
  { id: 'all',          label: 'Todos Usuários' },
  { id: 'admins',       label: 'Admins' },
];

let activeFilter1 = localStorage.getItem('admin_filter_status') || 'all_status';
let activeFilter2 = localStorage.getItem('admin_filter_provider') || 'all_providers';
let activeFilter3 = localStorage.getItem('admin_filter_access') || 'all';

function applyFilterAndRender() {
    // Save to localStorage
    localStorage.setItem('admin_filter_status', activeFilter1);
    localStorage.setItem('admin_filter_provider', activeFilter2);
    localStorage.setItem('admin_filter_access', activeFilter3);
  const tbody = document.querySelector('.cc-table tbody');
  const countSpan = document.querySelector('.cc-table-count');
  if (!tbody) return;

  filteredUsersGlobal = allUsersGlobal.filter((u: any) => {
    // Filtro do Grupo 1 (Status/Plano)
    const match1 = activeFilter1 === 'all_status' ||
                   (activeFilter1 === 'active_subs' && isPayingClient(u)) ||
                   (activeFilter1 === 'pro' && u.plan === 'pro');
    
    // Filtro do Grupo 2 (Provedor)
    const match2 = activeFilter2 === 'all_providers' || u.provider === activeFilter2;
    
    // Filtro do Grupo 3 (Geral/Admin)
    const match3 = activeFilter3 === 'all' || (activeFilter3 === 'admins' && u.isAdmin === true);

    return match1 && match2 && match3;
  });

  tbody.innerHTML = renderTableContent(filteredUsersGlobal);
  if (countSpan) {
    countSpan.textContent = `${filteredUsersGlobal.length} usuário${filteredUsersGlobal.length !== 1 ? 's' : ''}`;
  }
  updateTableSummary(filteredUsersGlobal);

  // Re-render Avvvatars
  document.querySelectorAll('.avvvatar-target').forEach(el => {
    const val = el.getAttribute('data-val') || 'User';
    const root = createRoot(el);
    root.render(createElement(Avvvatars, { value: val, size: 32, style: 'shape' }));
  });

  attachUserActionListeners();
  initAllTooltips();
}

function attachUserActionListeners() {
    document.querySelectorAll('.user-btn-info').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = JSON.parse(btn.getAttribute('data-user') || '{}');
        showUserModal(u);
      });
    });

    document.querySelectorAll('.user-btn-admin').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.getAttribute('data-uid');
        const currentState = btn.getAttribute('data-is-admin') === 'true';
        const action = currentState ? 'Remover Admin' : 'Tornar Admin';
        DeleteConfirmationModal({
          title: action,
          description: currentState
            ? 'Tem certeza que deseja remover a permissão de administrador deste usuário?'
            : 'Tem certeza que deseja conceder permissão de administrador a este usuário?',
          onConfirm: async () => {
            const uState = auth.currentUser;
            if (!uState) throw new Error('Não autenticado.');
            const t = await uState.getIdToken();
            const r = await fetch(`${API_BASE}/api/admin/users/${uid}/toggle-admin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
              body: JSON.stringify({ isAdmin: !currentState })
            });
            if (!r.ok) throw new Error('Falha ao alterar perfil de admin.');
            toaster.create({ title: 'Sucesso', description: 'Permissão de administrador atualizada.', type: 'success' });
            loadSubscriptions();
          }
        });
      });
    });

    document.querySelectorAll('.user-btn-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.getAttribute('data-uid');
        DeleteConfirmationModal({
          title: 'Excluir Usuário',
          description: 'Esta ação é irreversível. O usuário será removido do banco de dados e do authentication.',
          onConfirm: async () => {
            const uState = auth.currentUser;
            if (!uState) throw new Error('Não autenticado.');
            const t = await uState.getIdToken();
            const r = await fetch(`${API_BASE}/api/admin/users/${uid}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${t}` }
            });
            const ans = await r.json();
            if (!r.ok) throw new Error(ans.error || 'Falha ao excluir o usuário.');
            toaster.create({ title: 'Sucesso', description: 'Usuário excluído definitivamente.', type: 'success' });
            loadSubscriptions();
          }
        });
      });
    });

    // Mobile: menu 3 pontos
    document.querySelectorAll('.user-mob-trigger').forEach(trigBtn => {
      const uid = trigBtn.getAttribute('data-uid');
      if (!uid) return;

      attachGenericDropdownListeners(`user-mob-${uid}`, `user-mob-${uid}`);

      document.getElementById(`user-mi-info-${uid}`)?.addEventListener('click', () => {
        const u = JSON.parse(trigBtn.getAttribute('data-user') || '{}');
        showUserModal(u);
      });

      document.getElementById(`user-mi-adm-${uid}`)?.addEventListener('click', () => {
        const currentState = trigBtn.getAttribute('data-is-admin') === 'true';
        const action = currentState ? 'Remover Admin' : 'Tornar Admin';
        DeleteConfirmationModal({
          title: action,
          description: currentState
            ? 'Tem certeza que deseja remover a permissão de administrador deste usuário?'
            : 'Tem certeza que deseja conceder permissão de administrador a este usuário?',
          onConfirm: async () => {
            const uState = auth.currentUser;
            if (!uState) throw new Error('Não autenticado.');
            const t = await uState.getIdToken();
            const r = await fetch(`${API_BASE}/api/admin/users/${uid}/toggle-admin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
              body: JSON.stringify({ isAdmin: !currentState })
            });
            if (!r.ok) throw new Error('Falha ao alterar perfil de admin.');
            toaster.create({ title: 'Sucesso', description: 'Permissão de administrador atualizada.', type: 'success' });
            loadSubscriptions();
          }
        });
      });

      document.getElementById(`user-mi-del-${uid}`)?.addEventListener('click', () => {
        DeleteConfirmationModal({
          title: 'Excluir Usuário',
          description: 'Esta ação é irreversível. O usuário será removido do banco de dados e do authentication.',
          onConfirm: async () => {
            const uState = auth.currentUser;
            if (!uState) throw new Error('Não autenticado.');
            const t = await uState.getIdToken();
            const r = await fetch(`${API_BASE}/api/admin/users/${uid}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${t}` }
            });
            const ans = await r.json();
            if (!r.ok) throw new Error(ans.error || 'Falha ao excluir o usuário.');
            toaster.create({ title: 'Sucesso', description: 'Usuário excluído definitivamente.', type: 'success' });
            loadSubscriptions();
          }
        });
      });
    });
}

async function loadSubscriptions(): Promise<void> {
  const container = document.getElementById('admin-subscriptions-content-area');
  if (!container) return;

  container.innerHTML = `
    <div class="cc-table-wrapper">
      <div class="cc-loading">
        <div class="cc-spinner"></div>
        <span class="cc-loading-text">Carregando assinaturas…</span>
      </div>
    </div>
  `;

  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Não autenticado.');
    const token = await user.getIdToken();

    const res = await fetch(`${API_BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Erro desconhecido');
    }

    const data = await res.json();
    allUsersGlobal = data.users || [];
    filteredUsersGlobal = [...allUsersGlobal];

    container.innerHTML = `
      <div class="cc-table-wrapper">
        <div class="cc-table-header">
          <div class="cc-table-header-left">
            <span class="cc-table-header-title">Controle de Usuários</span>
          </div>
          <div class="cc-table-header-right">
            <div class="cc-table-kpis" aria-label="Resumo de clientes ativos">
              <div class="cc-table-kpi" title="Apenas usuários com assinatura ativa verificada no Stripe ou Asaas (exclui trial e legados não pagantes).">
                <span class="cc-table-kpi-label">Pagantes</span>
                <strong class="cc-table-kpi-value cc-active-client-count">0 clientes</strong>
              </div>
              <div class="cc-table-kpi" title="Soma do valor mensal real cobrado no provedor para os clientes pagantes.">
                <span class="cc-table-kpi-label">Receita/mês</span>
                <strong class="cc-table-kpi-value cc-active-revenue">${moneyFormatter.format(0)}</strong>
              </div>
            </div>
            <div class="cc-header-sep"></div>
            <div id="verify-loading-indicator" style="display:none;align-items:center;gap:5px;">
              <div class="cc-spinner-xs"></div>
              <span style="font-size:11px;color:var(--color-text-secondary);">Buscando dados verificados…</span>
            </div>
            <span class="cc-table-count" style="font-size:12px;font-weight:600;color:var(--color-text-secondary);">
              ${allUsersGlobal.length} usuário${allUsersGlobal.length !== 1 ? 's' : ''}
            </span>
            <div class="cc-header-sep"></div>
            <button id="btn-refresh-subs" class="cc-action-btn" title="Atualizar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="cc-table-scroll">
          <table class="cc-table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Acesso</th>
                <th>Plano</th>
                <th>Sistema / Provedor</th>
                <th>Atividade</th>
                <th>Criado em</th>
                <th style="text-align:right;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableContent(allUsersGlobal)}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-refresh-subs')?.addEventListener('click', loadSubscriptions);

    // Apply current filters after load
    applyFilterAndRender();

    // Check verified status lazily for users with stripe or asaas provider
    const usersToVerify = allUsersGlobal.filter(u =>
      (u.provider === 'stripe' || u.provider === 'asaas') && u.isVerified === undefined
    );
    let pendingVerifications = usersToVerify.length;

    if (pendingVerifications > 0) {
      const verifyIndicator = document.getElementById('verify-loading-indicator');
      if (verifyIndicator) verifyIndicator.style.display = 'flex';
    }

    const onVerifySettled = () => {
      pendingVerifications--;
      if (pendingVerifications <= 0) {
        const verifyIndicator = document.getElementById('verify-loading-indicator');
        if (verifyIndicator) verifyIndicator.style.display = 'none';
      }
    };

    usersToVerify.forEach(u => {
      fetch(`${API_BASE}/api/admin/users/${u.uid}/verify-payment`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        if (data.verified) {
          u.isVerified = true;
          u.isPaying = data.paying === true;
          if (data.status) u.providerStatus = data.status;
          if (typeof data.monthlyAmount === 'number' && data.monthlyAmount > 0) {
            u.verifiedMonthlyAmount = data.monthlyAmount;
          }
          const finalIcon = u.provider === 'asaas' ? verifiedIconAsaas : verifiedIconStripe;
          document.querySelectorAll(`.user-verify-badge-${u.uid}`).forEach(el => {
            (el as HTMLElement).style.display = 'inline-flex';
            (el as HTMLElement).innerHTML = finalIcon;
          });
          // Update the data-user stored string on the info button
          document.querySelectorAll(`button[data-uid="${u.uid}"].user-btn-info`).forEach(btn => {
            try {
              const uData = JSON.parse(btn.getAttribute('data-user') || '{}');
              uData.isVerified = true;
              uData.isPaying = u.isPaying;
              uData.providerStatus = u.providerStatus;
              uData.verifiedMonthlyAmount = u.verifiedMonthlyAmount;
              btn.setAttribute('data-user', JSON.stringify(uData));
            } catch(e){}
          });
        } else {
          u.isVerified = false;
          u.isPaying = false;
          document.querySelectorAll(`.user-verify-badge-${u.uid}`).forEach(el => {
            (el as HTMLElement).style.display = 'none';
          });
        }
        if (activeFilter1 === 'active_subs') {
          applyFilterAndRender();
        } else {
          updateTableSummary(filteredUsersGlobal);
        }
        onVerifySettled();
      })
      .catch(() => {
        u.isVerified = false;
        u.isPaying = false;
        document.querySelectorAll(`.user-verify-badge-${u.uid}`).forEach(el => {
           (el as HTMLElement).style.display = 'none';
        });
        if (activeFilter1 === 'active_subs') {
          applyFilterAndRender();
        } else {
          updateTableSummary(filteredUsersGlobal);
        }
        onVerifySettled();
      });
    });

  } catch (err: any) {
    container.innerHTML = `
      <div class="cc-table-wrapper">
        <div class="cc-loading">
          <span class="cc-loading-text" style="color:#ef4444;">Erro: ${err.message}</span>
          <button id="btn-retry-subs" style="margin-top:12px;padding:6px 16px;border-radius:8px;background:var(--color-surface);border:1px solid var(--color-border);font-size:12px;cursor:pointer;color:var(--color-text-secondary);">
            Tentar novamente
          </button>
        </div>
      </div>
    `;
    document.getElementById('btn-retry-subs')?.addEventListener('click', loadSubscriptions);
  }
}

function showUserModal(userItem: any) {
  const modalAvContainerId = `modal-av-${Math.random().toString(36).substr(2, 9)}`;
  const modalTooltipId = `m-v-t-${userItem.uid}`;
  const targetIcon = userItem.provider === 'asaas' ? verifiedIconAsaas : verifiedIconStripe;
  let modalVerifyHtml = '';
  
  if (userItem.isVerified === true) {
    modalVerifyHtml = Tooltip({
      id: modalTooltipId,
      className: `user-verify-badge-${userItem.uid}`,
      content: targetIcon,
      text: `Assinatura verificada no ${userItem.provider === 'asaas' ? 'Asaas' : 'Stripe'}`
    });
  } else if (userItem.isVerified === undefined && (userItem.provider === 'stripe' || userItem.provider === 'asaas')) {
    modalVerifyHtml = Tooltip({
      id: modalTooltipId,
      className: `user-verify-badge-${userItem.uid}`,
      content: loaderIcon,
      text: `Verificando status no ${userItem.provider === 'asaas' ? 'Asaas' : 'Stripe'}...`
    });
  }

  const content = `
    <div class="px-4 sm:px-8 pt-6 pb-6 border-b border-[var(--color-border)]">
      <div class="flex items-center gap-4">
         <div id="${modalAvContainerId}" class="shrink-0" style="width:52px;height:52px;border-radius:16px;overflow:hidden;"></div>
         <div class="overflow-hidden">
           <div class="flex items-center gap-1.5 font-semibold text-[var(--color-text)] text-lg whitespace-nowrap overflow-hidden text-ellipsis max-w-[250px]" title="${userItem.name}">
             <span class="truncate">${userItem.name}</span>
             ${modalVerifyHtml}
           </div>
           <div class="text-[var(--color-text-secondary)] text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[250px]" title="${userItem.email}">${userItem.email}</div>
         </div>
      </div>
    </div>
    
    <div class="flex flex-col text-sm text-[var(--color-text)] pb-4">
      <div class="flex justify-between items-center px-4 sm:px-8 py-3 border-b border-[var(--color-border)]/50">
        <span class="text-[var(--color-text-secondary)]">ID / UID</span>
        <div class="flex items-center gap-2">
           <span class="font-mono text-xs opacity-75 truncate max-w-[180px]" title="${userItem.uid}">${userItem.uid}</span>
           <button id="modal-btn-copy-uid" class="p-1 hover:bg-[var(--color-surface-hover)] rounded transition-colors text-[var(--color-text-secondary)]" title="Copiar ID">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
               <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
             </svg>
           </button>
        </div>
      </div>
      <div class="flex justify-between items-center px-4 sm:px-8 py-3 border-b border-[var(--color-border)]/50">
        <span class="text-[var(--color-text-secondary)]">Criado em</span>
        <span>${fmtDate(userItem.createdAt)}</span>
      </div>
      <div class="flex justify-between items-center px-4 sm:px-8 py-3 border-b border-[var(--color-border)]/50">
        <span class="text-[var(--color-text-secondary)]">Plano</span>
        <span class="capitalize font-medium">${userItem.plan === 'pro' ? 'Pro' : 'Sem plano'}</span>
      </div>
      <div class="flex justify-between items-center px-4 sm:px-8 py-3 border-b border-[var(--color-border)]/50">
        <span class="text-[var(--color-text-secondary)]">Acesso</span>
        <span class="font-medium">${userItem.isAdmin ? 'Administrador' : 'Padrão'}</span>
      </div>
      <div class="flex justify-between items-center px-4 sm:px-8 py-3 border-b border-[var(--color-border)]/50">
        <span class="text-[var(--color-text-secondary)]">Provedor</span>
        <div class="flex items-center gap-2">
          ${userItem.provider === 'asaas' ? `<img src="/assets/logo/assas.png" class="cc-provider-img" /> <span class="capitalize font-medium">Asaas</span>` : 
            userItem.provider === 'stripe' ? `<img src="/assets/logo/stripe.png" class="cc-provider-img" /> <span class="capitalize font-medium">Stripe</span>` :
            `<span class="capitalize font-medium">Sistema / Base</span>`}
        </div>
      </div>
      <div class="flex justify-between items-center px-4 sm:px-8 py-3">
        <span class="text-[var(--color-text-secondary)]">Status (Sistema de Pag.)</span>
        <span class="capitalize font-medium">${userItem.status === 'unknown' ? 'Não aplicável' : userItem.status}</span>
      </div>
    </div>
  `;

  Modal({
    title: 'Detalhes do Usuário',
    content,
    showFooter: false,
    fieldsPadding: 'p-0'
  });

  const avEl = document.getElementById(modalAvContainerId);
  if (avEl) {
    const root = createRoot(avEl);
    root.render(createElement(Avvvatars, { value: userItem.email || userItem.uid, size: 52, style: 'shape' }));
  }

  // Listener para o botão de cópia no modal
  const copyBtn = document.getElementById('modal-btn-copy-uid');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(userItem.uid).then(() => {
        toaster.create({ title: 'Copiado', description: 'ID do usuário copiado.', type: 'success' });
        copyBtn.style.color = 'var(--color-primary)';
        setTimeout(() => { copyBtn.style.color = ''; }, 1000);
      });
    });
  }

  // Inicializar tooltip do modal
  if (modalVerifyHtml) {
    import('../components/Tooltip').then(m => m.attachTooltipListeners(modalTooltipId));
  }
}

export function renderAdminSubscriptions(user: any) {
  if (user?.isAdmin !== true) {
    window.dispatchEvent(new CustomEvent('app-navigate', { detail: { page: 'dashboard' } }));
    return;
  }
  const app = document.querySelector<HTMLDivElement>('#app')!;

  app.innerHTML = `
    <div id="admin-shell" class="min-h-screen text-[var(--color-text)] flex flex-col relative overflow-hidden bg-[var(--color-background)]">
      ${BrilhoHeader()}
      ${Header({ user })}

      <style>
        @keyframes fadein {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .animate-fadein { animation: fadein 0.25s ease forwards; }

        /* Table wrapper */
        .cc-table-wrapper {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 16px;
          overflow: visible;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        /* Table header */
        .cc-table-header {
          padding: 14px 20px;
          border-bottom: 1px solid var(--color-border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .cc-table-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .cc-table-header-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--color-text-secondary);
        }
        .cc-table-header-right {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-shrink: 0;
        }
        .cc-table-kpis {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .cc-table-kpi {
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
          white-space: nowrap;
        }
        .cc-table-kpi-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-text-secondary);
        }
        .cc-table-kpi-value {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text);
        }
        .cc-table-count {
          white-space: nowrap;
        }
        .cc-header-sep {
          width: 1px;
          height: 14px;
          background: var(--color-border);
          flex-shrink: 0;
        }

        /* Table scroll */
        .cc-table-scroll {
          overflow-x: auto;
        }

        /* Table */
        .cc-table {
          width: 100%;
          min-width: 720px;
          border-collapse: separate;
          border-spacing: 0;
        }
        .cc-table thead tr {
          border-bottom: 1px solid var(--color-border);
        }
        .cc-table th {
          padding: 11px 16px;
          font-size: 10.5px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--color-text-secondary);
          text-align: left;
          white-space: nowrap;
        }
        .cc-table th:last-child { text-align: right; }
        .cc-table td {
          padding: 13px 16px;
          font-size: 13px;
          border-bottom: 1px solid var(--color-border-light, rgba(255,255,255,0.04));
          vertical-align: middle;
          color: var(--color-text);
        }
        .cc-table tbody tr:last-child td { border-bottom: none; }
        .cc-table tbody tr { transition: background 0.15s; }
        .cc-table tbody tr:hover { background: var(--color-surface-hover); }

        /* Status badge */
        .cc-badge {
          display: inline-flex;
          align-items: center;
          font-size: 13px;
          font-weight: 500;
        }
        .cc-badge-paid    { color: var(--color-text); }
        .cc-badge-pending { color: var(--color-text); }
        .cc-badge-charge  { color: var(--color-text); }
        .cc-badge-inactive { color: var(--color-text); opacity: 0.8; }

        /* Category / provider pill */
        .cc-category {
          display: inline-block;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 500;
          border-radius: 6px;
          background: var(--color-surface-hover);
          color: var(--color-text-secondary);
          border: 1px solid var(--color-border);
          white-space: nowrap;
        }
        .cc-category-asaas {
          background: rgba(99,102,241,0.1);
          color: #818cf8;
          border-color: rgba(99,102,241,0.2);
        }
        html[data-theme="light"] .cc-category-asaas {
          color: #4f46e5;
          background: rgba(99,102,241,0.08);
        }
        .cc-category-stripe {
          background: rgba(56,189,248,0.1);
          color: #38bdf8;
          border-color: rgba(56,189,248,0.2);
        }
        html[data-theme="light"] .cc-category-stripe {
          color: #0284c7;
          background: rgba(56,189,248,0.08);
        }

        .cc-provider-img {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          object-fit: contain;
          vertical-align: middle;
        }

        /* Action button */
        .cc-action-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          text-decoration: none;
        }
        .cc-action-btn:hover {
          color: var(--color-text);
          background: transparent;
        }
        .user-btn-delete:hover {
          color: #ef4444 !important;
        }
        .user-btn-admin:hover {
          color: #D97757 !important;
        }

        /* Loading */
        .cc-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 56px 24px;
          gap: 12px;
        }
        .cc-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--color-border);
          border-top-color: var(--color-text-secondary);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        .cc-spinner-xs {
          width: 11px;
          height: 11px;
          border: 1.5px solid var(--color-border);
          border-top-color: var(--color-text-secondary);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          flex-shrink: 0;
        }
        .cc-loading-text {
          font-size: 13px;
          color: var(--color-text-secondary);
        }
        /* Desktop vs mobile actions */
        .cc-desktop-actions { display: flex; }
        .cc-mobile-actions  { display: none; }

        /* Filter chips container */
        .admin-filters-scroller {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          padding: 4px 2px;
          margin: -4px -2px;
        }
        .admin-filters-scroller::-webkit-scrollbar { display: none; }

        /* Mobile responsiveness */
        @media (max-width: 767px) {
          .cc-table-header {
            padding: 12px 14px;
            gap: 8px;
            flex-wrap: wrap;
          }
          .cc-table-header-right {
            width: 100%;
            gap: 10px;
            flex-wrap: wrap;
            justify-content: space-between;
          }
          .cc-table-header-left {
            flex: 1;
          }
          .cc-table-kpis {
            flex: 1 1 100%;
            gap: 10px;
          }
          .cc-table-kpi {
            flex: 1 1 auto;
          }
          .cc-table-kpi-value {
            font-size: 11.5px;
          }

          /* Card layout: converte tabela em lista de cards */
          .cc-table-scroll {
            overflow-x: visible;
          }
          .cc-table {
            min-width: 0;
            display: block;
          }
          .cc-table thead {
            display: none;
          }
          .cc-table tbody {
            display: block;
          }
          .cc-table tbody tr {
            position: relative;
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
            padding: 16px 130px 16px 14px;
            gap: 6px 8px;
            border-bottom: 1px solid var(--color-border);
          }
          /* Mais espaço entre os botões de ação no mobile */
          .cc-table td:nth-child(7) .flex {
            gap: 14px;
          }
          .cc-table tbody tr:last-child {
            border-bottom: none;
          }
          .cc-table td {
            padding: 0;
            border-bottom: none;
            font-size: 13px;
          }

          /* Linha 1: info do usuário (largura total, restando espaço p/ ações absolutas) */
          .cc-table td:nth-child(1) {
            flex: 0 0 100%;
            min-width: 0;
            padding-bottom: 8px;
            order: 1;
          }

          /* Troca desktop → mobile actions */
          .cc-desktop-actions { display: none; }
          .cc-mobile-actions  { display: flex; align-items: center; }

          /* Ações: absoluto no canto superior direito, fora do fluxo flex */
          .cc-table td:nth-child(7) {
            position: absolute;
            top: 8px;
            right: 14px;
          }

          /* Linha 2: badges (Acesso, Plano, Provedor) */
          .cc-table td:nth-child(2),
          .cc-table td:nth-child(3),
          .cc-table td:nth-child(4) {
            flex: 0 0 auto;
            order: 3;
          }

          /* Linha 3: atividade */
          .cc-table td:nth-child(5) {
            flex: 0 0 100%;
            order: 4;
            padding-top: 2px;
          }

          /* Criado em: oculto no mobile (disponível no modal) */
          .cc-table td:nth-child(6) {
            display: none;
          }
        }
      </style>

      <main class="flex-1 w-full max-w-6xl mx-auto px-4 md:px-10 p-8 pt-24 md:pt-32">
        <div class="w-full animate-fadein">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h2 class="text-[22px] font-semibold text-[var(--color-text)] tracking-tight leading-none">Painel de controles do sistema</h2>
              <p class="text-[13px] text-[var(--color-text-secondary)] mt-2">Visão geral de todos os usuários criados no sistema atual e antigo.</p>
            </div>
            <div class="admin-filters-scroller">
               ${FilterSelector({ id: 'selector-status' })}
               ${FilterSelector({ id: 'selector-provider' })}
               ${FilterSelector({ id: 'selector-access' })}
            </div>
          </div>

          <div id="admin-subscriptions-content-area" class="mt-2">
            <!-- preenchido via JS -->
          </div>
        </div>
      </main>
    </div>
  `;

  attachHeaderListeners();

  // Initialize Filter Selectors once
  attachFilterSelectorListeners({
    id: 'selector-status',
    filters: filters1,
    initialFilterId: activeFilter1,
    onFilterChange: (id) => { activeFilter1 = id; applyFilterAndRender(); }
  });

  attachFilterSelectorListeners({
    id: 'selector-provider',
    filters: filters2,
    initialFilterId: activeFilter2,
    onFilterChange: (id) => { activeFilter2 = id; applyFilterAndRender(); }
  });

  attachFilterSelectorListeners({
    id: 'selector-access',
    filters: filters3,
    initialFilterId: activeFilter3,
    onFilterChange: (id) => { activeFilter3 = id; applyFilterAndRender(); }
  });

  async function syncStripeAndLoad(user: any) {
    try {
      const token = await user.getIdToken();
      await fetch(`${API_BASE}/api/admin/stripe/sync-users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch {
      // sync silencioso — não bloqueia o carregamento
    }
    loadSubscriptions();
  }

  if (auth.currentUser) {
    syncStripeAndLoad(auth.currentUser);
  } else {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      unsubscribe();
      if (u) syncStripeAndLoad(u);
    });
  }
}
