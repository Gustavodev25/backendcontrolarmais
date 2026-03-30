import { Header, attachHeaderListeners } from '../components/Header';
import { CategoryService } from '../services/categoryService';
import { BrilhoHeader } from '../components/BrilhoHeader';
import { auth, db } from '../lib/firebase';
import { setDoc, deleteDoc, doc, getDoc } from 'firebase/firestore';
import {
  DynamicIsland,
} from '../components/DynamicIsland';
import { toaster } from '../components/Toast';
import gsap from 'gsap';
import { openDetailedClosingDateModal, saveClosingDates } from '../components/ClosingDateModal';
import { renderCardSelector as renderCardSelectorComponent, CardSelectorStyles } from '../components/CardSelector';
import type { DynamicDirection } from '../components/DynamicIsland';

import { EmptyState, initEmptyStateLotties } from '../components/EmptyState';

import { Modal } from '../components/Modal';
import { GenericDropdown, attachGenericDropdownListeners } from '../components/GenericDropdown';
import { Input } from '../components/Input';
import { useTheme } from '../components/ThemeManager';
import {
  BillConstructor,
  normalizeExactDateForMonth
} from '../lib/BillConstructor';
import type {
  ComputedBill,
  ComputedFinanceCharge,
  LegacyClosingDateConfig
} from '../lib/BillConstructor';
import { getPluggyCanonicalDocRef, getPluggyDocRef, loadPluggyRecords, loadPluggyRecordsWithCache } from '../lib/pluggyFirestore';
import { clearUserCache } from '../lib/indexedDBCache';
import {
  getTransactionInvoiceMonthKey,
  moveTransactionToInvoice,
  normalizeMonthKey
} from '../services/invoiceService';

(window as any).openDetailedClosingDateModal = openDetailedClosingDateModal;

// Expose cache-clearing utility for debugging: console → clearCache()
(window as any).clearCache = () => {
  const userId = auth.currentUser?.uid;
  if (userId) {
    clearUserCache(userId).then(() => {
      console.log('[Cache] Cache limpo. Recarregue a página para buscar dados frescos.');
    });
  } else {
    console.warn('[Cache] Nenhum usuário autenticado.');
  }
};

// Global cached state
let allTransactions: any[] = [];
let cachedAccountsMap: Map<string, any> = new Map();
let currentFilter: string = 'history';
let billConstructor = new BillConstructor();
let invoicesByAccountId: Map<string, ComputedBill[]> = new Map();
let invoiceRowsByAccountId: Map<string, InvoiceTableRow[]> = new Map();
let selectedAccountId: string | null = null;
let searchQuery: string = '';

// Infinite scroll pagination state
const PAGE_SIZE = 30;
let currentVisibleCount = PAGE_SIZE;
let currentFilteredRows: InvoiceTableRow[] = [];
let infiniteScrollObserver: IntersectionObserver | null = null;
let isLoadingMore = false;

let ccCategoryMap: Map<string, string> = new Map(); // originalKey -> translated name

// Mapeamento estático completo Pluggy -> Português (fallback quando usuário não tem no Firestore)
const PLUGGY_TO_CATEGORY_FALLBACK: Record<string, string> = {
  // Alimentação
  'eating out': 'Restaurante',
  'food delivery': 'Delivery',
  'groceries': 'Supermercado',
  'restaurants': 'Restaurante',
  'bars and pubs': 'Bares',
  'bakeries': 'Padaria',
  'fast food': 'Fast Food',
  'coffee shops': 'Cafeteria',
  // Viagem
  'accommodation': 'Hospedagem',
  'airport and airlines': 'Passagens aéreas',
  'mileage programs': 'Programas de milhas',
  'travel': 'Viagem',
  'hotels': 'Hospedagem',
  // Finanças
  'account fees': 'Tarifas conta',
  'credit card': 'Cartão de crédito',
  'credit card fees': 'Tarifas cartão',
  'income taxes': 'IR',
  'interests charged': 'Juros',
  'loans': 'Empréstimos',
  'taxes': 'Impostos',
  'wire transfer fees and atm fees': 'Tarifas bancárias',
  'financing': 'Financiamento',
  'real estate financing': 'Financiamento imobiliário',
  'vehicle financing': 'Financiamento veicular',
  'student loan': 'Empréstimo estudantil',
  'late payment and overdraft costs': 'Multas e juros',
  'investments': 'Investimentos',
  'savings': 'Poupança',
  'overdraft': 'Cheque especial',
  // Transferências
  'bank slip': 'Boleto',
  'credit card payment': 'Pagamento cartão',
  'debt card': 'Cartão débito',
  'debit card': 'Cartão débito',
  'same person transfer - pix': 'Transf. própria Pix',
  'transfer - pix': 'Transf. Pix',
  'transfer - ted': 'Transf. TED',
  'transfer - doc': 'Transf. DOC',
  'transfer': 'Transferência',
  'wire transfer': 'Transferência',
  'pix': 'Pix',
  'same person transfer': 'Transf. própria',
  'same person transfer - ted': 'Transf. própria TED',
  'deposit': 'Depósito',
  'withdrawal': 'Saque',
  'atm withdrawal': 'Saque caixa',
  // Transporte
  'bicycle': 'Bicicleta',
  'car rental': 'Aluguel carro',
  'gas stations': 'Combustível',
  'parking': 'Estacionamento',
  'public transportation': 'Ônibus / metrô',
  'taxi and ride-hailing': 'Táxi / apps',
  'vehicle maintenance': 'Manutenção',
  'toll': 'Pedágio',
  'tolls': 'Pedágio',
  // Entretenimento
  'cinema, theater and concerts': 'Cinema / shows',
  'entertainment': 'Lazer',
  'leisure': 'Lazer',
  'lottery': 'Loterias',
  'music streaming': 'Streaming música',
  'video streaming': 'Streaming vídeo',
  'gaming': 'Jogos',
  'sports': 'Esportes',
  'books and magazines': 'Livros e revistas',
  // Compras
  'clothing': 'Roupas',
  'electronics': 'Eletrônicos',
  'online shopping': 'Compras online',
  'shopping': 'Compras',
  'furniture': 'Móveis',
  'pets': 'Pets',
  'gifts': 'Presentes',
  'beauty': 'Beleza',
  'cosmetics': 'Cosméticos',
  // Moradia
  'rent': 'Aluguel',
  'condominium': 'Condomínio',
  'utilities': 'Serviços',
  'electricity': 'Energia',
  'water': 'Água',
  'gas': 'Gás',
  'internet': 'Internet',
  'telephone': 'Telefone',
  'phone': 'Telefone',
  'home maintenance': 'Manutenção casa',
  'home insurance': 'Seguro residencial',
  // Saúde
  'health': 'Saúde',
  'health insurance': 'Plano de saúde',
  'pharmacy': 'Farmácia',
  'medical': 'Médico',
  'dental': 'Dentista',
  'gym': 'Academia',
  'hospital': 'Hospital',
  // Educação
  'education': 'Educação',
  'school': 'Escola',
  'courses': 'Cursos',
  'university': 'Universidade',
  // Seguros
  'insurance': 'Seguro',
  'life insurance': 'Seguro vida',
  'vehicle insurance': 'Seguro auto',
  // Receitas
  'salary': 'Salário',
  'income': 'Renda',
  'investment-income': 'Investimentos',
  'retirement': 'Aposentadoria',
  'entrepreneurial activities': 'Ativ. empresarial',
  'government aid': 'Benefícios governo',
  'non-recurring income': 'Renda eventual',
  'refund': 'Reembolso',
  'cashback': 'Cashback',
  // Outros
  'alimony': 'Pensão',
  'benefit programs': 'Programas de benefícios',
  'digital services': 'Serviços digitais',
  'donation': 'Doações',
  'subscriptions': 'Assinaturas',
  'subscription': 'Assinatura',
  'other': 'Outros',
  'others': 'Outros',
  'uncategorized': 'Sem categoria',
};

function getCcCategoryName(rawCategory: string): string {
  const key = (rawCategory || '').toLowerCase().trim();
  if (!key) return 'Outros';

  // 1. Buscar nas categorias do Firestore do usuário (originalKey)
  if (ccCategoryMap.has(key)) return ccCategoryMap.get(key)!;

  // 2. Buscar correspondência por nome da categoria
  for (const [, name] of ccCategoryMap) {
    if (name.toLowerCase() === key) return name;
  }

  // 3. Fallback estático Pluggy -> PT-BR
  if (PLUGGY_TO_CATEGORY_FALLBACK[key]) return PLUGGY_TO_CATEGORY_FALLBACK[key];

  // 4. Busca parcial no fallback (ex: "transfer - ted" parcial match com "transfer")
  for (const [fallbackKey, fallbackName] of Object.entries(PLUGGY_TO_CATEGORY_FALLBACK)) {
    if (key.startsWith(fallbackKey) || fallbackKey.startsWith(key)) {
      return fallbackName;
    }
  }

  // 5. Capitalize como último recurso, se não for um ID numérico da api
  if (rawCategory && isNaN(Number(rawCategory))) {
    return rawCategory.charAt(0).toUpperCase() + rawCategory.slice(1);
  }

  return 'Outros';
}

// ====================== HELPERS ======================

function getInstallmentInfo(tx: any) {
  const meta = tx.creditCardMetadata || {};
  const instNumber: number | null = meta.installmentNumber ?? tx.installmentNumber ?? null;
  const instTotal: number | null = meta.totalInstallments ?? tx.totalInstallments ?? null;
  const purchaseAmount: number | null = meta.purchaseAmount ?? (instTotal && tx.amount ? tx.amount * instTotal : null);
  const isInstallment = instNumber != null && instTotal != null && instTotal > 1;
  return { instNumber, instTotal, purchaseAmount, isInstallment };
}

function getReleaseDate(tx: any): Date {
  const raw = tx.creditCardMetadata?.releaseDate || tx.date;
  return raw?.toDate ? raw.toDate() : new Date(raw);
}

function showPageOverlay(message: string) {
  let overlay = document.getElementById('cc-global-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cc-global-overlay';
    overlay.className = 'cc-global-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="flex flex-col items-center">
      <div class="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4"></div>
      <p class="text-[16px] font-semibold text-white tracking-tight">${message}</p>
    </div>
  `;

  // Force reflow
  overlay.getBoundingClientRect();
  overlay.classList.add('active');
}

function hidePageOverlay() {
  const overlay = document.getElementById('cc-global-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 350);
  }
}

function showDeleteRefundModal(tx: any) {
  Modal({
    title: 'Excluir Reembolso',
    content: '<p class="text-[14px] text-[var(--color-text-secondary)]">Tem certeza que deseja excluir este reembolso? A transação original voltará ao valor normal na fatura.</p>',
    confirmText: 'Excluir',
    onConfirm: async () => {
      try {
        const row = document.querySelector(`tr[data-tx-id="${tx.id}"]`) ||
          document.querySelector(`div[data-refund-id="${tx.id}"]`);

        if (row) {
          const loader = row.querySelector('.card-loader-overlay');
          if (loader) {
            loader.classList.remove('opacity-0', 'pointer-events-none');
            loader.classList.add('opacity-100');
          }
        } else {
          showPageOverlay('Excluindo reembolso...');
        }

        await deleteDoc(getPluggyDocRef(tx));
        toaster.create({ title: "Sucesso", description: "Reembolso excluído.", type: "success" });

        // Refresh everything from Firestore to ensure consistent state
        const user = auth.currentUser;
        if (user) {
          await loadCreditCardTransactions(user.uid);
        }
      } catch (error) {
        console.error('Erro ao excluir reembolso:', error);
        toaster.create({ title: "Erro", description: "Não foi possível excluir.", type: "error" });
      } finally {
        hidePageOverlay();
      }
    }
  });
}

function fmtBRL(value: number): string {
  const formatted = value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [reais, centavos] = formatted.split(',');
  return `<span class="num-currency">R$</span><span class="num-integer">${reais}</span><span class="num-cents">,${centavos}</span>`;
}

type InvoiceTableRowType = ComputedBill['typeKey'] | 'unknown';

interface TransactionTableRow {
  kind: 'transaction';
  id: string;
  accountId: string;
  invoiceType: InvoiceTableRowType;
  sortTime: number;
  transaction: any;
}

interface FinanceChargeTableRow {
  kind: 'finance-charge';
  id: string;
  accountId: string;
  invoiceType: ComputedBill['typeKey'];
  sortTime: number;
  invoice: ComputedBill;
  charge: ComputedFinanceCharge;
}

type InvoiceTableRow = TransactionTableRow | FinanceChargeTableRow;

const FINANCE_CHARGE_LABELS: Record<string, string> = {
  LATE_PAYMENT_REMUNERATIVE_INTEREST: 'Juros remuneratorios',
  LATE_PAYMENT_FEE: 'Multa por atraso',
  LATE_PAYMENT_INTEREST: 'Juros de mora',
  IOF: 'IOF',
  OTHER: 'Outros encargos'
};

function toTimeMs(value: any): number {
  if (!value) return 0;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }

  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted.getTime() : 0;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getFinanceChargeLabel(charge: ComputedFinanceCharge): string {
  return FINANCE_CHARGE_LABELS[charge.type] || charge.type.replace(/_/g, ' ').toLowerCase();
}

function getFinanceChargeReferenceDate(invoice: ComputedBill): Date | null {
  return invoice.dueDate || invoice.closeDate || invoice.periodEnd || invoice.periodStart || null;
}

function buildInvoiceTableRows(accountId: string, transactions: any[], invoices: ComputedBill[]): InvoiceTableRow[] {
  const transactionRows: InvoiceTableRow[] = transactions.map((transaction) => ({
    kind: 'transaction',
    id: String(transaction.id),
    accountId,
    invoiceType: transaction.computedInvoiceType || 'unknown',
    sortTime: toTimeMs(transaction.creditCardMetadata?.releaseDate || transaction.date),
    transaction
  }));

  const financeChargeRows: InvoiceTableRow[] = invoices.flatMap((invoice) =>
    invoice.financeCharges.map((charge) => ({
      kind: 'finance-charge',
      id: `${invoice.id}-${charge.id}`,
      accountId,
      invoiceType: invoice.typeKey,
      sortTime: toTimeMs(getFinanceChargeReferenceDate(invoice)),
      invoice,
      charge
    }))
  );

  return [...transactionRows, ...financeChargeRows].sort((left, right) => {
    if (right.sortTime !== left.sortTime) {
      return right.sortTime - left.sortTime;
    }

    if (left.kind === 'transaction' && right.kind === 'transaction') {
      const txL = left.transaction;
      const txR = right.transaction;
      if (txR.isRefund && txR.originalTransactionId === txL.id) return -1;
      if (txL.isRefund && txL.originalTransactionId === txR.id) return 1;
    }

    if (left.kind === right.kind) {
      return right.id.localeCompare(left.id, 'pt-BR');
    }

    return left.kind === 'finance-charge' ? 1 : -1;
  });
}

function sumInvoiceTableRows(rows: InvoiceTableRow[]): number {
  return rows.reduce((sum, row) => {
    if (row.kind === 'finance-charge') {
      return sum + Number(row.charge.amount || 0);
    }

    if (billConstructor.isInvoicePayment(row.transaction)) {
      return sum;
    }

    return sum + Number(row.transaction.amount || 0);
  }, 0);
}

function compareAccounts(left: any, right: any): number {
  const leftName = String(left?.name || left?.id || '').toLocaleLowerCase('pt-BR');
  const rightName = String(right?.name || right?.id || '').toLocaleLowerCase('pt-BR');
  if (leftName === rightName) {
    return String(left?.id || '').localeCompare(String(right?.id || ''), 'pt-BR');
  }
  return leftName.localeCompare(rightName, 'pt-BR');
}

export function getAccountDisplayName(account: any): string {
  const name = String(account?.name || account?.creditData?.brand || account?.id || 'Cartao').trim();
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatShortDate(date?: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatFullDate(date?: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getOriginalAccountDates(account: any): { closeDate: string | null; dueDate: string | null } {
  const closeDate = BillConstructor.parseDate(account?.creditData?.balanceCloseDate);
  const dueDate = BillConstructor.parseDate(account?.creditData?.balanceDueDate);
  return {
    closeDate: formatFullDate(closeDate),
    dueDate: formatFullDate(dueDate)
  };
}

function getTransactionDisplayInvoiceMonthKey(tx: any, invoices: ComputedBill[]): string | null {
  const storedMonthKey = getTransactionInvoiceMonthKey(tx);
  if (storedMonthKey) {
    return storedMonthKey;
  }

  const billId = tx?.creditCardMetadata?.billId;
  if (billId) {
    const matchedByBillId = invoices.find((invoice) => invoice._pluggyBillIds?.includes(billId));
    if (matchedByBillId?.referenceMonth) {
      return matchedByBillId.referenceMonth;
    }
  }

  const computedMonthKey = normalizeMonthKey(tx?.computedInvoiceMonthKey);
  if (computedMonthKey) {
    return computedMonthKey;
  }

  if (tx?.computedBillName) {
    const matchedByName = invoices.find((invoice) => invoice.name === tx.computedBillName);
    if (matchedByName?.referenceMonth) {
      return matchedByName.referenceMonth;
    }
  }

  if (tx?.computedInvoiceType && tx.computedInvoiceType !== 'unknown') {
    const matchedByType = invoices.find((invoice) => invoice.typeKey === tx.computedInvoiceType);
    if (matchedByType?.referenceMonth) {
      return matchedByType.referenceMonth;
    }
  }

  const parsedDate = BillConstructor.parseDate(tx?.date);
  return parsedDate ? BillConstructor.toMonthKey(parsedDate) : null;
}

function getInvoiceCountLabel(count: number): string {
  return `${count} transaç${count === 1 ? 'ão' : 'ões'}`;
}

// ====================== COMPONENTES ======================

function CreditCardsContent(): string {
  const theme = useTheme().current;
  const historyLottie = theme === 'dark' ? '/assets/lottie/faturahistorico.json' : '/assets/lottie/faturahistoricopreto.json';

  return `
    <div class="w-full animate-fadein">
 
       <!-- Header row -->
        <div class="cc-header-grid">
          <div class="cc-header-title">
            <h2 class="text-[22px] font-semibold text-[var(--color-text)] tracking-tight leading-none">Cartões de Crédito</h2>
            <p class="text-[13px] text-[var(--color-text-secondary)] mt-2">Gerencie as faturas e limites dos seus cartões conectados.</p>
          </div>
          <div id="card-selector-slot" class="cc-header-card relative"></div>
          <div class="cc-header-actions flex items-center gap-3">
            <div id="closing-date-reminder-container" class="flex items-center"></div>
            <button id="btn-closing-settings" class="bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] p-2.5 rounded-xl transition-all duration-200" title="Configurar Fechamento">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
            </button>
          </div>
        </div>

      <!-- Summary Cards -->
      <div class="cc-cards-grid" id="summary-cards">
        <!-- Card: Histórico -->
        <div class="cc-card cc-card-clickable group" id="card-history-container" data-filter="history" style="isolation: isolate;">
          <div class="cc-card-header">
            <div class="cc-card-label">Histórico</div>
            <div class="cc-card-lottie-wrapper" id="lottie-history-wrapper">
                <lottie-player id="lottie-history-player" src="${historyLottie}" background="transparent" speed="1" style="width: 22px; height: 22px;" class="cc-card-lottie"></lottie-player>
            </div>
          </div>
          <div class="cc-card-body">
            <div class="cc-card-value" id="card-history">—</div>
            <div class="cc-card-sub" id="card-history-sub">carregando...</div>
          </div>
        </div>

        <!-- Card: Última Fatura -->
        <div class="cc-card cc-card-clickable group" id="card-last-container" data-filter="last" style="isolation: isolate;">
          <div class="cc-card-header">
            <div class="cc-card-label">Última Fatura</div>
            <div class="cc-card-lottie-wrapper" id="lottie-last-wrapper">
                <lottie-player id="lottie-last-player" src="/assets/lottie/faturafechada.json" background="transparent" speed="1" style="width: 22px; height: 22px;" class="cc-card-lottie"></lottie-player>
            </div>
          </div>
          <div class="cc-card-body">
            <div class="cc-card-value" id="card-last">—</div>
            <div class="cc-card-sub" id="card-last-sub">carregando...</div>
          </div>
        </div>

        <!-- Card: Fatura Atual -->
        <div class="cc-card cc-card-clickable group" id="card-current-container" data-filter="current" style="isolation: isolate;">
          <div class="cc-card-header">
            <div class="cc-card-label">Fatura Atual</div>
            <div class="cc-card-lottie-wrapper" id="lottie-current-wrapper">
                <lottie-player id="lottie-current-player" src="/assets/lottie/faturaatual.json" background="transparent" speed="1" style="width: 22px; height: 22px;" class="cc-card-lottie"></lottie-player>
            </div>
          </div>
          <div class="cc-card-body">
            <div class="cc-card-value" id="card-current">—</div>
            <div class="cc-card-sub" id="card-current-sub">carregando...</div>
          </div>
        </div>
      </div>

      <!-- Transactions Table Container -->
      <div id="credit-cards-container" class="mt-10">
        <div class="cc-loading">
          <div class="cc-spinner"></div>
          <p class="cc-loading-text">Carregando transações...</p>
        </div>
      </div>
    </div>
  `;
}

export function renderCreditCards(user: any) {
  const app = document.querySelector<HTMLDivElement>('#app')!;

  sessionStorage.setItem('currentPage', 'credit-cards');
  sessionStorage.removeItem('currentTab');

  app.innerHTML = `
    <div class="min-h-screen text-[var(--color-text)] flex flex-col relative overflow-hidden bg-[var(--color-background)]">
      ${BrilhoHeader()}
      ${Header({ user })}

      <style>
        @keyframes fadein {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .animate-fadein { animation: fadein 0.3s ease forwards; }

        @keyframes logoPulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
        .animate-logo-pulse { animation: logoPulse 2s ease-in-out infinite; }

        @keyframes fastPulse {
          0% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 0.5; transform: scale(1.2); }
          100% { opacity: 0.2; transform: scale(0.8); }
        }
        .animate-pulse-fast { animation: fastPulse 2s ease-in-out infinite; }

        /* Page typography */
        .cc-eyebrow {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #D97757;
          opacity: 0.8;
          margin-bottom: 4px;
        }
        .cc-page-title {
          font-size: 20px;
          font-weight: 600;
          color: var(--color-text);
          letter-spacing: -0.02em;
          line-height: 1;
        }

        /* Cache badge */
        .cc-cache-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          margin-left: 10px;
          padding: 2px 8px;
          border-radius: 12px;
          background: transparent;
          border: 1px solid var(--color-border, rgba(255,255,255,0.08));
          font-size: 11px;
          font-weight: 400;
          color: var(--color-text-secondary, #888);
          opacity: 0;
          transform: translateX(-4px);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          vertical-align: middle;
          position: relative;
          top: -1px;
        }
        .cc-cache-badge.visible {
          opacity: 1;
          transform: translateX(0);
        }
        .cc-cache-badge.hiding {
          opacity: 0;
          transform: translateX(4px);
        }
        .cc-cache-badge svg {
          opacity: 0.45;
          flex-shrink: 0;
        }
        .cc-cache-badge span {
          white-space: nowrap;
        }
        .cc-cache-pulse {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--color-text-secondary, #888);
          animation: cachePulse 1.5s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes cachePulse {
          0%, 100% { opacity: 0.25; transform: scale(0.8); }
          50% { opacity: 0.8; transform: scale(1.15); }
        }

        /* Header grid */
        .cc-header-grid {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          grid-template-areas: "title actions" "card card";
          gap: 12px 8px;
          margin-bottom: 24px;
        }
        .cc-header-title   { grid-area: title; }
        .cc-header-card    { grid-area: card; align-self: center; }
        .cc-header-actions { grid-area: actions; align-self: center; }
        @media (min-width: 768px) {
          .cc-header-grid {
            grid-template-columns: 1fr auto auto;
            grid-template-rows: auto;
            grid-template-areas: "title card actions";
            align-items: center;
          }
        }

        /* Summary Cards Grid */
        .cc-cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        @media (max-width: 640px) {
          .cc-cards-grid { grid-template-columns: 1fr; }
        }

        /* Individual Card */
        .cc-card {
          position: relative;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 16px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: cardIn 0.35s ease both;
          transition: border-color 0.2s ease, transform 0.2s ease;
        }
        .cc-card-clickable {
          cursor: pointer;
          user-select: none;
        }
        .cc-card-clickable:hover {
          border-color: var(--color-text-secondary);
          transform: translateY(-1px);
        }
        .cc-card-clickable:active {
          transform: translateY(0) scale(0.99);
        }

        .cc-card-clickable.active {
          border-color: var(--color-border-hover, rgba(217,119,87,0.5));
          box-shadow: none;
        }

        .cc-card:nth-child(1) { animation-delay: 0.05s; }
        .cc-card:nth-child(2) { animation-delay: 0.10s; }
        .cc-card:nth-child(3) { animation-delay: 0.15s; }

        .cc-card-header {
          padding: 14px 20px;
          border-bottom: 1px solid var(--color-border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .cc-card-body {
          padding: 20px 20px 22px;
        }

        .cc-card-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--color-text-secondary);
        }

        .cc-card-clickable.active .cc-card-label {
          color: #D97757;
        }

        .cc-card-lottie-wrapper {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .cc-card-lottie {
          transform: scale(1.1);
          filter: brightness(1.1);
        }

        .cc-card-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .cc-card-value {
          display: flex;
          align-items: baseline;
          gap: 2px;
          margin-bottom: 6px;
        }

        .num-currency {
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text-secondary);
          margin-right: 2px;
        }

        .num-integer {
          font-family: 'Sora', sans-serif;
          font-size: 26px;
          font-weight: 600;
          color: var(--color-text);
          letter-spacing: -0.02em;
          line-height: 1;
        }

        .num-cents {
          font-size: 16px;
          font-weight: 500;
          color: var(--color-text-secondary);
        }

        .cc-card-sub {
          font-size: 11px;
          color: var(--color-text-secondary);
          font-weight: 400;
        }

        .cc-accent-current  { background: #6366f1; box-shadow: 0 0 4px rgba(99, 102, 241, 0.4); }
        .cc-accent-last     { background: #f59e0b; box-shadow: 0 0 4px rgba(245, 158, 11, 0.4); }
        .cc-accent-history  { background: #10b981; box-shadow: 0 0 4px rgba(16, 185, 129, 0.4); }

        /* Section heading above table */
        .cc-section-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-bottom: 14px;
        }

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

        .cc-search-wrapper {
          flex: 1;
          max-width: 240px;
          margin-left: 8px;
          transition: all 0.3s ease;
          opacity: 0.6;
        }
        .cc-search-wrapper:focus-within {
          opacity: 1;
          max-width: 300px;
        }
        .cc-search-wrapper input {
          padding-top: 6px !important;
          padding-bottom: 6px !important;
          height: 32px !important;
          background: rgba(0,0,0,0.2) !important;
          border-radius: 10px !important;
          font-size: 11px !important;
        }

        .cc-table-header-right {
          display: flex;
          align-items: center;
          gap: 20px;
          flex-shrink: 0;
        }

        .cc-header-total {
          display: flex;
          align-items: baseline;
          gap: 1px;
        }
        .cc-header-total .num-currency { font-size: 11px; }
        .cc-header-total .num-integer  { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
        .cc-header-total .num-cents    { font-size: 11px; }

        .cc-header-dates {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .cc-header-date-item {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .cc-header-date-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-text-secondary);
          opacity: 0.7;
        }

        .cc-header-date-value {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text);
          font-variant-numeric: tabular-nums;
        }

        .cc-header-sep {
          width: 1px;
          height: 14px;
          background: var(--color-border);
          flex-shrink: 0;
        }

        .cc-table-scroll {
          overflow: visible;
        }

        /* Table */
        .cc-table {
          width: 100%;
          min-width: 820px;
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
        .cc-table tbody tr {
          transition: background 0.15s;
        }
        .cc-table tbody tr:hover {
          background: var(--color-surface-hover);
        }

        /* Grouped visual for Original Transaction + Refund */
        .cc-table tbody tr.cc-row-has-refund {
          border-bottom: none !important;
        }
        .cc-table tbody tr.cc-row-has-refund td {
          padding-bottom: 4px;
        }
        .cc-table tbody tr.cc-row-refund {
          background-color: rgba(239, 68, 68, 0.02) !important;
          border-top: none !important;
        }
        html[data-theme="dark"] .cc-table tbody tr.cc-row-refund {
          background-color: rgba(239, 68, 68, 0.05) !important;
        }
        .cc-table tbody tr.cc-row-refund td {
          padding-top: 4px;
        }
        .cc-table tbody tr.cc-row-refund .cc-amount {
          color: #ef4444;
          opacity: 0.8;
          text-decoration: line-through;
        }
        .cc-table tbody tr.cc-row-refund .cc-badge {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        /* Payment row (pagamento de fatura) */
        .cc-table tbody tr.cc-row-payment {
          background-color: rgba(16, 185, 129, 0.03) !important;
        }
        html[data-theme="dark"] .cc-table tbody tr.cc-row-payment {
          background-color: rgba(16, 185, 129, 0.06) !important;
        }
        .cc-table tbody tr.cc-row-payment td {
          opacity: 0.65;
        }
        .cc-table tbody tr.cc-row-payment:hover td {
          opacity: 0.9;
        }
        .cc-table tbody tr.cc-row-payment .cc-amount {
          color: #10b981;
        }
        .cc-table tbody tr.cc-row-payment .cc-category {
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
          border-color: rgba(16, 185, 129, 0.25);
        }

        /* Payment pill */
        .cc-payment-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 1px 7px;
          border-radius: 20px;
          font-size: 10px;
          font-weight: 600;
          background: rgba(16, 185, 129, 0.12);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.28);
          white-space: nowrap;
          margin-left: 6px;
          vertical-align: middle;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }

        .cc-global-overlay {
          position: fixed;
          inset: 0;
          z-index: 500;
          background: transparent;
          backdrop-filter: blur(4px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          opacity: 0;
          pointer-events: none;
          transition: all 0.3s ease;
        }
        .cc-global-overlay.active {
          opacity: 1;
          pointer-events: auto;
        }

        .cc-table tr {
          position: relative;
        }

        .card-loader-overlay {
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
        }

        /* Elevate the z-index of the row/cell when dropdown is open */
        .cc-table td:has(.active),
        .cc-row-estornado-banner td:has(.active) {
          z-index: 100 !important;
        }

        /* ── Banner "Estornado" ── */
        .cc-row-estornado-banner td {
          padding: 0 !important;
          border: none !important;
          background: transparent !important;
        }
        .cc-row-estornado-banner:hover td {
          background: transparent !important;
        }
        .cc-estornado-badge {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border-radius: 0;
          font-size: 11px;
          font-weight: 600;
          color: #10b981;
          background: rgba(16, 185, 129, 0.06);
          width: 100%;
          line-height: normal;
          user-select: none;
          border: none !important;
        }
        .cc-estornado-badge .cc-estornado-label {
          display: flex;
          align-items: center;
          gap: 12px;
          opacity: 0.9;
        }
        .cc-estornado-badge .cc-estornado-value {
          margin-left: 14px;
          display: flex;
          align-items: baseline;
        }
        .cc-estornado-badge .num-currency { font-size: 11px; opacity: 0.8; }
        .cc-estornado-badge .num-integer { font-size: 15px; font-weight: 700; }
        .cc-estornado-badge .num-cents { font-size: 11px; opacity: 0.8; }
        .cc-estornado-badge .cc-amount {
          display: inline-flex;
          align-items: baseline;
          gap: 1px;
        }

        /* Amount */
        .cc-amount {
          display: inline-flex;
          align-items: baseline;
          gap: 1px;
        }
        .cc-amount .num-currency { font-size: 11px; }
        .cc-amount .num-integer  { font-size: 14px; font-weight: 700; }
        .cc-amount .num-cents    { font-size: 11px; }

        .cc-total-sub {
          display: flex;
          align-items: baseline;
          gap: 2px;
          font-size: 10px;
          color: var(--color-text-secondary);
          margin-top: 1px;
          opacity: 0.8;
        }
        .cc-total-sub .num-currency { font-size: 9px; }
        .cc-total-sub .num-integer  { font-size: 10px; font-weight: 500; }
        .cc-total-sub .num-cents    { font-size: 9px; }

        /* Installment pill */
        .cc-installment-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 1px 7px;
          border-radius: 20px;
          font-size: 10px;
          font-weight: 600;
          background: var(--color-surface-hover);
          color: var(--color-text-secondary);
          border: 1px solid var(--color-border);
          white-space: nowrap;
          margin-left: 6px;
          vertical-align: middle;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .cc-installment-pill-charge {
          background: rgba(217, 119, 87, 0.12);
          color: #d97757;
          border-color: rgba(217, 119, 87, 0.28);
        }
        /* Category pill */
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
        .cc-category-charge {
          background: rgba(217, 119, 87, 0.12);
          color: #d97757;
          border-color: rgba(217, 119, 87, 0.28);
        }

        /* Status badge */
        .cc-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 500;
        }
        .cc-badge::before {
          content: '';
          width: 5px;
          height: 5px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cc-badge-paid    { background: rgba(16,185,129,0.08); color: #10b981; }
        .cc-badge-paid::before    { background: #10b981; }
        .cc-badge-pending { background: rgba(245,158,11,0.08); color: #f59e0b; }
        .cc-badge-pending::before { background: #f59e0b; }
        .cc-badge-charge  { background: rgba(217,119,87,0.12); color: #d97757; }
        .cc-badge-charge::before  { background: #d97757; }

        .cc-row-charge {
          background: linear-gradient(90deg, rgba(217,119,87,0.08), rgba(217,119,87,0.02));
        }
        .cc-row-charge:hover {
          background: linear-gradient(90deg, rgba(217,119,87,0.14), rgba(217,119,87,0.06));
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
          opacity: 1;
          transition: background 0.15s, color 0.15s;
        }
        .cc-action-btn:hover { 
          background: var(--color-surface-hover); 
          color: var(--color-text);
        }

        /* Loading state */
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
        .cc-loading-text {
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        /* Infinite scroll sentinel */
        .cc-load-more-sentinel {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          gap: 10px;
        }
        .cc-load-more-sentinel .cc-load-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid var(--color-border);
          border-top-color: #D97757;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        .cc-load-more-sentinel .cc-load-text {
          font-size: 12px;
          color: var(--color-text-secondary);
          font-weight: 500;
        }
        .cc-pagination-info {
          text-align: center;
          padding: 14px 16px 18px;
          font-size: 11px;
          color: var(--color-text-secondary);
          font-weight: 500;
          letter-spacing: 0.02em;
          opacity: 0.7;
        }

        /* Modal Details */
        .cc-modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          animation: fadein 0.2s ease;
        }
        .cc-modal {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 16px;
          width: min(90vw, 600px);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);
        }
        .cc-modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid var(--color-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .cc-modal-title {
          font-size: 16px;
          font-weight: 600;
        }
        .cc-modal-close {
          background: transparent;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
        }
        .cc-modal-content {
          padding: 24px;
          overflow-y: auto;
          background: #000;
        }
        .cc-json {
          font-family: 'Fira Code', monospace;
          font-size: 11px;
          color: #10b981;
          white-space: pre-wrap;
          line-height: 1.6;
          background: rgba(0,0,0,0.2);
          padding: 16px;
          border-radius: 12px;
          border: 1px solid var(--color-border);
        }
        .lottie-dropdown-icon {
          filter: brightness(1.2) saturate(0.8);
        }

        /* Closing Date Reminder Pill */
        .closing-reminder-pill {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.05);
          backdrop-filter: blur(8px);
        }
        .closing-reminder-content {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .closing-reminder-icon {
          color: #D97757;
          opacity: 0.9;
        }
        .closing-reminder-text {
          font-size: 13px;
          color: var(--color-text-secondary);
          font-weight: 500;
          letter-spacing: -0.01em;
        }
        .closing-reminder-text strong {
          color: var(--color-text);
          font-weight: 600;
        }
        .closing-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-left: 4px;
          padding-left: 12px;
          border-left: 1px solid var(--color-border-light);
        }
        .closing-reminder-btn {
          border: none;
          background: transparent;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 10px;
          border-radius: 6px;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .btn-yes { 
          color: #10b981; 
          background: rgba(16,185,129,0.05);
        }
        .btn-yes:hover { 
          background: rgba(16,185,129,0.12);
          transform: translateY(-1px);
        }
        .btn-no { 
          color: var(--color-text-secondary);
          background: transparent;
        }
        .btn-no:hover { 
          color: #ef4444;
          background: rgba(239,68,68,0.05);
        }

        /* Loader Styles */
        .closing-reminder-loader {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          color: var(--color-text-secondary);
          font-size: 13px;
        }
        .mini-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid var(--color-border);
          border-top-color: #D97757;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        /* Manual Closing Date Modal Styles */
        .closing-modal-list {
          display: flex;
          flex-direction: column;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          margin-top: 8px;
        }
        .closing-modal-list-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
        }
        .closing-modal-list-item.has-divider {
          border-bottom: 1px solid var(--color-border);
        }
        .closing-modal-label {
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text);
        }
        .closing-modal-copy {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
          padding-right: 12px;
        }
        .closing-modal-sublabel {
          font-size: 11px;
          color: var(--color-text-secondary);
        }

        .closing-modal-input {
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text);
          border-radius: 8px;
          padding: 8px 12px;
          width: 135px;
          text-align: center;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          cursor: text;
          transition: all 0.2s ease;
        }
        .closing-modal-input:hover {
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.15);
        }
        .closing-modal-input:focus {
          border-color: #D97757;
          background: rgba(217, 119, 87, 0.05);
        }
        .closing-modal-input::-webkit-calendar-picker-indicator {
          filter: invert(0.6);
          cursor: pointer;
          opacity: 0.6;
          transition: opacity 0.2s ease;
        }
        html[data-theme="light"] .closing-modal-input::-webkit-calendar-picker-indicator {
          filter: invert(0);
        }
        .closing-modal-input::-webkit-calendar-picker-indicator:hover {
          opacity: 1;
        }
        .closing-modal-lead {
          font-size: 14px;
          line-height: 1.55;
          color: var(--color-text-secondary);
          margin-bottom: 14px;
        }
        .closing-modal-list--app {
          background: #1A1A1A;
          border-color: #2A2A2A;
          border-radius: 16px;
          overflow: hidden;
        }
        .closing-modal-list--app .closing-modal-list-item {
          gap: 12px;
          padding: 14px 16px;
          background: #1A1A1A;
        }
        .closing-modal-list--app .closing-modal-list-item.has-divider {
          border-bottom-color: #2A2A2A;
        }

        .closing-modal-bank-copy {
          color: var(--color-text-secondary);
          font-size: 13px;
          line-height: 1.55;
        }
        .closing-modal-bank-copy strong {
          color: var(--color-text);
          font-weight: 700;
        }
        .closing-modal-day-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .closing-modal-day-label {
          font-size: 15px;
          color: #909090;
        }
        .closing-modal-input--day {
          width: 54px;
          min-width: 54px;
          padding: 8px 10px;
          text-align: right;
          font-size: 16px;
          font-weight: 700;
          border-color: rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
        }
        @media (max-width: 480px) {
          .closing-modal-list-item {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
          .closing-modal-copy {
            padding-right: 0;
          }
          .closing-modal-input {
            width: 100%;
            box-sizing: border-box;
          }
          .closing-modal-day-wrapper {
            width: 100%;
            justify-content: space-between;
          }
          .closing-modal-input--day {
            width: 72px;
            min-width: 72px;
          }
        }
        .closing-modal-footer {
          margin-top: 24px;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }
        .btn-modal-save {
          background: #D97757;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          font-size: 13px;
        }
        .btn-modal-cancel {
          background: transparent;
          color: var(--color-text-secondary);
          border: 1px solid var(--color-border);
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          font-size: 13px;
        }
        .cc-nav-arrow {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }
        .cc-nav-arrow:hover {
          background: var(--color-surface-hover);
          color: var(--color-text);
          border-color: var(--color-text-secondary);
        }
        .cc-nav-arrow:active {
          transform: scale(0.95);
        }

        .cc-card.drag-over {
          border-color: #D97757 !important;
          transform: scale(1.02) translateY(-2px);
          box-shadow: 0 8px 25px rgba(217, 119, 87, 0.2);
        }



        .cc-row-loader-overlay {
          position: absolute;
          inset: 0;
          z-index: 50;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          pointer-events: none;
          transition: all 0.3s ease;
          border-radius: 8px;
          width: 0; /* JS will activate */
          height: 100%;
        }
        .cc-row-loader-overlay.active {
          opacity: 1;
          pointer-events: all;
          width: 100%; /* Cover ONLY the row width */
        }
        
        /* Ensure table cells don't clip the row overlay */
        tr[data-tx-id] {
          position: relative !important;
          transition: z-index 0s;
          z-index: 1;
        }
        tr[data-tx-id]:hover, tr[data-tx-id]:focus-within {
          z-index: 100;
        }
        
        /* Make the first cell the anchor but let the overlay grow */
        tr[data-tx-id] td:first-child {
          position: static !important;
        }

        /* ── Mobile: layout responsivo para celulares ── */
        @media (max-width: 640px) {
          /* Header da tabela: empilha verticalmente */
          .cc-table-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 14px;
          }
          .cc-table-header-left {
            width: 100%;
          }
          .cc-search-wrapper {
            max-width: none;
            flex: 1;
            min-width: 0;
            margin-left: 0;
          }
          .cc-table-header-right {
            width: 100%;
            flex-wrap: wrap;
            gap: 8px 14px;
          }
          .cc-header-dates {
            flex-wrap: wrap;
            gap: 8px 12px;
          }

          /* Tabela: layout de cartões */
          .cc-table-wrapper {
            overflow: hidden;
          }
          .cc-table {
            display: block;
            min-width: 0;
            width: 100%;
          }
          .cc-table thead {
            display: none;
          }
          .cc-table tbody {
            display: block;
          }

          /* Cada linha vira um grid de 2 colunas */
          .cc-table tbody tr {
            display: grid !important;
            grid-template-columns: 1fr auto;
            grid-template-rows: auto auto auto;
            column-gap: 10px;
            row-gap: 5px;
            padding: 12px 14px;
            border-bottom: 1px solid var(--color-border-light);
          }
          .cc-table tbody tr:last-child {
            border-bottom: none;
          }
          .cc-table tbody tr td {
            display: block;
            padding: 0;
            border: none;
            font-size: 13px;
          }

          /* td 1: Data compra → linha 3, col 1 */
          .cc-table tbody tr td:nth-child(1) {
            grid-column: 1;
            grid-row: 3;
            font-size: 11px;
            white-space: nowrap;
          }
          /* td 2: Data lançamento → oculto no mobile */
          .cc-table tbody tr td:nth-child(2) {
            display: none !important;
          }
          /* td 3: Descrição → linha 1, col 1 */
          .cc-table tbody tr td:nth-child(3) {
            grid-column: 1;
            grid-row: 1;
          }
          /* td 4: Categoria → linha 2, col 1 */
          .cc-table tbody tr td:nth-child(4) {
            grid-column: 1;
            grid-row: 2;
          }
          /* td 5: Valor → linha 1, col 2 (alinhado à direita) */
          .cc-table tbody tr td:nth-child(5) {
            grid-column: 2;
            grid-row: 1;
            text-align: right;
            white-space: nowrap;
          }
          /* td 6: Fatura → linha 2, col 2 */
          .cc-table tbody tr td:nth-child(6) {
            grid-column: 2;
            grid-row: 2;
            text-align: right;
            font-size: 11px;
            color: var(--color-text-secondary);
          }
          /* td 7: Ações → linha 3, col 2 */
          .cc-table tbody tr td:nth-child(7) {
            grid-column: 2;
            grid-row: 3;
            text-align: right;
          }

          /* Banner "Estornado": sobreescreve grid, fica em bloco */
          .cc-row-estornado-banner {
            display: block !important;
          }
          .cc-row-estornado-banner td {
            display: block !important;
          }
        }

        ${CardSelectorStyles()}
      </style>

      <main class="flex-1 w-full max-w-6xl mx-auto px-4 md:px-10 p-4 md:p-8 pt-20 md:pt-24">
        <div class="w-full px-2 md:px-0">
          ${CreditCardsContent()}
        </div>
      </main>
    </div>
  `;

  attachHeaderListeners();
  loadCreditCardTransactions(user.uid);
  startPeriodicLotties();

  // Handle filtering
  const summaryGrid = document.querySelector('#summary-cards');
  if (summaryGrid) {
    summaryGrid.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest('.cc-card-clickable');
      if (card) {
        const filter = card.getAttribute('data-filter');
        if (filter) {
          setActiveSummaryCard(filter);
          renderFilteredTransactions(filter);
        }
      }
    });
  }

  const syncHandler = () => {
    loadCreditCardTransactions(user.uid);
  };

  const calculateInvoiceHandler = () => {
    // Show loaders on cards
    const cards = document.querySelectorAll('.cc-card');
    cards.forEach(card => {
      if (!card.querySelector('.card-loader-overlay')) {
        card.insertAdjacentHTML('beforeend', `
          <div class="card-loader-overlay absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center transition-all duration-300" style="border-radius: 20px;">
            <div class="w-8 h-8 border-2 border-[#D97757]/30 border-t-[#D97757] rounded-full animate-spin mb-3"></div>
            <p class="text-[13px] font-medium text-white tracking-tight">Calculando...</p>
          </div>
        `);
      }
    });

    // Show loader on table
    const tableContainer = document.getElementById('credit-cards-container');
    if (tableContainer) {
      tableContainer.style.position = 'relative';
      tableContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 mt-10">
           <div class="relative flex items-center justify-center w-20 h-20 mb-6">
              <div class="absolute inset-0 bg-[#D97757] rounded-full blur-xl opacity-20 animate-pulse-fast"></div>
              <img src="/assets/logo/logo.png" alt="Controlar Mais" class="relative w-12 h-12 object-contain animate-logo-pulse" />
           </div>
           <h3 class="text-[15px] font-semibold text-[var(--color-text)] tracking-tight mb-2">Calculando Faturas...</h3>
           <p class="text-[13px] text-[var(--color-text-secondary)] max-w-sm text-center">Aguarde enquanto organizamos suas transações e recalculamos os fechamentos e vencimentos.</p>
        </div>
      `;
    }


    loadCreditCardTransactions(user.uid);
  };

  startPeriodicLotties();

  window.addEventListener('app-closing-dates-saved', calculateInvoiceHandler);
  window.addEventListener('app-sync-completed', syncHandler);
  window.addEventListener('app-navigate', () => {
    window.removeEventListener('app-sync-completed', syncHandler);
    window.removeEventListener('app-closing-dates-saved', calculateInvoiceHandler);
    cleanupInfiniteScroll();
  }, { once: true });
}



function getSortedAccounts(): any[] {
  return Array.from(cachedAccountsMap.values()).sort(compareAccounts);
}

function getSelectedAccount(): any | null {
  if (selectedAccountId && cachedAccountsMap.has(selectedAccountId)) {
    return cachedAccountsMap.get(selectedAccountId) || null;
  }

  const firstAccount = getSortedAccounts()[0] || null;
  selectedAccountId = firstAccount?.id || null;
  return firstAccount;
}

function getSelectedInvoices(): ComputedBill[] {
  const account = getSelectedAccount();
  if (!account?.id) return [];
  return invoicesByAccountId.get(account.id) || [];
}

function getSelectedTransactions(): any[] {
  const account = getSelectedAccount();
  if (!account?.id) return [];
  return allTransactions.filter((transaction) => transaction.accountId === account.id);
}

function getSelectedInvoiceRows(): InvoiceTableRow[] {
  const account = getSelectedAccount();
  if (!account?.id) return [];
  return invoiceRowsByAccountId.get(account.id) || [];
}

function buildClosingModalBills(account: any, bills: ComputedBill[]): ComputedBill[] {
  const periods = billConstructor.calculateInvoicePeriodDates(account, []);
  const desiredBills: Array<{
    typeKey: ComputedBill['typeKey'];
    referenceMonth: string;
    closeDate: Date;
    periodStart: Date;
    dueDate: Date;
    status: ComputedBill['status'];
    isClosed: boolean;
  }> = [
      {
        typeKey: 'beforeLast',
        referenceMonth: periods.beforeLastMonthKey,
        closeDate: periods.beforeLastClosingDate,
        periodStart: periods.beforeLastInvoiceStart,
        dueDate: periods.beforeLastDueDate,
        status: 'PAID',
        isClosed: true
      },
      {
        typeKey: 'last',
        referenceMonth: periods.lastMonthKey,
        closeDate: periods.lastClosingDate,
        periodStart: periods.lastInvoiceStart,
        dueDate: periods.lastDueDate,
        status: 'CLOSED',
        isClosed: true
      },
      {
        typeKey: 'current',
        referenceMonth: periods.currentMonthKey,
        closeDate: periods.currentClosingDate,
        periodStart: periods.currentInvoiceStart,
        dueDate: periods.currentDueDate,
        status: 'OPEN',
        isClosed: false
      },
      {
        typeKey: 'next',
        referenceMonth: periods.nextMonthKey,
        closeDate: periods.nextClosingDate,
        periodStart: periods.nextInvoiceStart,
        dueDate: periods.nextDueDate,
        status: 'OPEN',
        isClosed: false
      },
      {
        typeKey: 'following',
        referenceMonth: periods.followingMonthKey,
        closeDate: periods.followingClosingDate,
        periodStart: periods.followingInvoiceStart,
        dueDate: periods.followingDueDate,
        status: 'OPEN',
        isClosed: false
      }
    ];

  return desiredBills.map((desiredBill) => {
    const existingBill = bills.find((bill) => bill.typeKey === desiredBill.typeKey)
      || bills.find((bill) => bill.referenceMonth === desiredBill.referenceMonth);

    if (existingBill) {
      return existingBill;
    }

    const [year, month] = desiredBill.referenceMonth.split('-').map(Number);
    return {
      id: `closing-modal-${account.id}-${desiredBill.typeKey}-${desiredBill.referenceMonth}`,
      accountId: account.id,
      name: getAccountDisplayName(account),
      month,
      year,
      isCurrent: desiredBill.typeKey === 'current',
      periodEnd: desiredBill.closeDate,
      periodStart: desiredBill.periodStart,
      dueDate: desiredBill.dueDate,
      closeDate: desiredBill.closeDate,
      total: 0,
      pluggyTotal: null,
      financeCharges: [],
      financeChargesTotal: 0,
      minimumPaymentAmount: null,
      allowsInstallments: null,
      isClosed: desiredBill.isClosed,
      transactions: [],
      referenceMonth: desiredBill.referenceMonth,
      typeKey: desiredBill.typeKey,
      status: desiredBill.status,
      _pluggyBillIds: []
    };
  });
}

function setActiveSummaryCard(filter: string) {
  document.querySelectorAll('.cc-card-clickable').forEach((card) => card.classList.remove('active'));
  const selectedCard = document.querySelector(`.cc-card-clickable[data-filter="${filter}"]`);
  selectedCard?.classList.add('active');
}

async function migrateLegacyClosingDatesIfNeeded(userId: string, accounts: any[], allPluggyBills: any[]) {
  const legacyConfigData = await BillConstructor.loadLegacyConfig(userId);
  if (!legacyConfigData?.config || !legacyConfigData.userConfigured) {
    return;
  }

  const legacyConfig: LegacyClosingDateConfig = legacyConfigData.config;
  const daysByType: Record<ComputedBill['typeKey'], number> = {
    beforeLast: legacyConfig.atrasada,
    last: legacyConfig.anterior,
    current: legacyConfig.atual,
    next: legacyConfig.proxima,
    following: legacyConfig.seguinte
  };

  for (const account of accounts) {
    if (BillConstructor.hasClosingSettings(account)) {
      continue;
    }

    const accountTransactions = allTransactions.filter((transaction) => transaction.accountId === account.id);
    const accountBills = allPluggyBills.filter((bill) => bill.accountId === account.id);
    const provisionalInvoices = billConstructor.buildInvoicesPluggyFirst(account, accountBills, accountTransactions);
    const monthOverrides: Record<string, { closingDay?: number; exactDate?: string }> = {};

    provisionalInvoices.forEach((invoice) => {
      const closingDay = daysByType[invoice.typeKey];
      const exactDate = normalizeExactDateForMonth(invoice.referenceMonth, closingDay);
      if (!closingDay || !exactDate) {
        return;
      }

      monthOverrides[invoice.referenceMonth] = {
        closingDay,
        exactDate
      };
    });

    const uniqueDays = new Set(Object.values(daysByType));
    const lastInvoice = provisionalInvoices.find((invoice) => invoice.typeKey === 'last');
    const nextSettings = {
      closingDay: legacyConfig.atual,
      applyToAll: uniqueDays.size === 1,
      lastClosingDate: lastInvoice
        ? monthOverrides[lastInvoice.referenceMonth]?.exactDate
        : BillConstructor.normalizePluggyDate(account?.creditData?.balanceCloseDate) || undefined,
      monthOverrides,
      updatedAt: new Date().toISOString()
    };

    await setDoc(getPluggyCanonicalDocRef(userId, 'accounts', account.id), {
      userId,
      closingDateSettings: nextSettings
    }, { merge: true });

    account.closingDateSettings = nextSettings;
    cachedAccountsMap.set(account.id, account);
  }
}

function openSelectedAccountClosingModal(userId: string) {
  const account = getSelectedAccount();
  const invoices = getSelectedInvoices();
  if (!account || invoices.length === 0) {
    return;
  }

  const originalDates = getOriginalAccountDates(account);
  openDetailedClosingDateModal({
    userId,
    accountId: account.id,
    accountName: getAccountDisplayName(account),
    bankName: account?.institution?.name || account?.connector?.name || undefined,
    suggestedDay: BillConstructor.getSuggestedClosingDay(account),
    bills: buildClosingModalBills(account, invoices),
    closingDateSettings: account.closingDateSettings,
    originalCloseDate: originalDates.closeDate,
    originalDueDate: originalDates.dueDate
  });
}

function bindClosingSettingsButton(userId: string) {
  const button = document.getElementById('btn-closing-settings') as HTMLButtonElement | null;
  if (!button) return;

  button.onclick = () => openSelectedAccountClosingModal(userId);
  button.disabled = !getSelectedAccount();
}

function renderCardSelector(userId: string, direction: DynamicDirection = 'reset') {
  const accounts = getSortedAccounts();
  const selectedAccount = getSelectedAccount();
  const currentIndex = accounts.findIndex(a => a.id === selectedAccount.id);
  const prevAccount = accounts[currentIndex - 1] || accounts[accounts.length - 1];
  const nextAccount = accounts[currentIndex + 1] || accounts[0];

  renderCardSelectorComponent({
    slotId: 'card-selector-slot',
    accounts,
    selectedAccount,
    getAccountDisplayName,
    onPrevCard: (accountId: string) => {
      selectedAccountId = accountId;
      updateSelectedAccountView(userId, 'prev');
    },
    onNextCard: (accountId: string) => {
      selectedAccountId = accountId;
      updateSelectedAccountView(userId, 'next');
    }
  }, direction);
}

function updateSelectedAccountView(userId: string, direction: DynamicDirection = 'reset') {
  renderCardSelector(userId, direction);
  bindClosingSettingsButton(userId);
  updateSummaryCards();
  renderClosingDateReminder(userId);
  setActiveSummaryCard(currentFilter);
  renderFilteredTransactions(currentFilter);
}

function renderClosingDateReminder(userId: string) {
  const container = document.getElementById('closing-date-reminder-container')!;
  if (!container) return;

  const account = getSelectedAccount();
  const invoices = getSelectedInvoices();

  if (!account || invoices.length === 0 || BillConstructor.hasClosingSettings(account) || !BillConstructor.hasAutomaticBillingData(account)) {
    container.innerHTML = '';
    return;
  }

  showClosingDateReminder(userId, account, invoices);
}

// Flag to prevent concurrent loads
let isLoadingFromNetwork = false;

function sortTransactionsByDate(txs: any[]): any[] {
  return txs.sort((a, b) => {
    const toMs = (d: any) => {
      if (!d) return 0;
      if (d instanceof Date) return d.getTime();
      if (d?.toDate) return d.toDate().getTime();
      return new Date(d).getTime();
    };
    return toMs(b.date) - toMs(a.date);
  });
}

function processLoadedData(
  userId: string,
  accounts: any[],
  transactions: any[],
  pluggyBills: any[],
  options: { skipMigration?: boolean } = {}
) {
  cachedAccountsMap.clear();
  const creditAccounts = accounts
    .filter((account) => account.type === 'CREDIT')
    .sort(compareAccounts);
  creditAccounts.forEach((account) => {
    cachedAccountsMap.set(account.id, account);
  });

  allTransactions = sortTransactionsByDate(transactions);

  allTransactions.forEach(tx => {
    tx.computedBillName = '';
    tx.computedInvoiceType = 'unknown';
    tx.computedInvoiceMonthKey = null;
  });

  invoicesByAccountId.clear();
  invoiceRowsByAccountId.clear();

  for (const [accId, accData] of cachedAccountsMap.entries()) {
    const accountTxs = allTransactions.filter(t => t.accountId === accId);
    const accountBills = pluggyBills.filter(b => b.accountId === accId);

    const invoices = billConstructor.buildInvoicesPluggyFirst(accData, accountBills, accountTxs);
    invoicesByAccountId.set(accId, invoices);

    for (const inv of invoices) {
      for (const tx of inv.transactions) {
        const ptr = allTransactions.find(t => t.id === tx.id);
        if (ptr) {
          ptr.computedBillName = inv.name;
          ptr.computedInvoiceType = inv.typeKey;
          ptr.computedInvoiceMonthKey = inv.referenceMonth;
        }
      }
    }

    invoiceRowsByAccountId.set(accId, buildInvoiceTableRows(accId, accountTxs, invoices));
  }

  if (selectedAccountId && !cachedAccountsMap.has(selectedAccountId)) {
    selectedAccountId = null;
  }
}

function renderLoadedView(userId: string) {
  if (!getSelectedAccount()) {
    updateSummaryCards();
    renderCardSelector(userId);
    bindClosingSettingsButton(userId);
    renderClosingDateReminder(userId);
    renderFilteredTransactions(currentFilter);
    return;
  }

  updateSelectedAccountView(userId);
}

function showCacheBadge(cacheAge: string) {
  const existing = document.getElementById('cc-cache-badge');
  if (existing) existing.remove();

  const titleH2 = document.querySelector('.cc-header-title h2');
  if (!titleH2) return;

  const badge = document.createElement('span');
  badge.id = 'cc-cache-badge';
  badge.className = 'cc-cache-badge';
  badge.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
    </svg>
    <span>${cacheAge}</span>
    <div class="cc-cache-pulse"></div>
  `;
  titleH2.appendChild(badge);

  requestAnimationFrame(() => {
    badge.classList.add('visible');
  });
}

function hideCacheBadge() {
  const badge = document.getElementById('cc-cache-badge');
  if (badge) {
    badge.classList.remove('visible');
    badge.classList.add('hiding');
    setTimeout(() => badge.remove(), 300);
  }
}

async function loadCreditCardTransactions(userId: string) {
  const container = document.getElementById('credit-cards-container');
  if (!container) return;

  try {
    // Step 1: Try to load from IndexedDB cache for instant render
    const [
      cachedAccounts,
      cachedTransactions,
      cachedBills
    ] = await Promise.all([
      loadPluggyRecordsWithCache<any>(userId, 'accounts'),
      loadPluggyRecordsWithCache<any>(userId, 'creditCardTransactions'),
      loadPluggyRecordsWithCache<any>(userId, 'creditCardBills')
    ]);

    const anyFromCache = cachedAccounts.fromCache || cachedTransactions.fromCache || cachedBills.fromCache;
    const hasCachedData = cachedAccounts.records.length > 0;

    // Step 2: If we have cached data, render immediately
    if (anyFromCache && hasCachedData) {
      // Load categories (fast, local)
      try {
        const mappings = await CategoryService.ensureCategoryMappings(userId);
        ccCategoryMap = CategoryService.buildCategoryMap(mappings);
      } catch (err) {
        console.error('Erro ao carregar categorias para cartões:', err);
      }

      processLoadedData(
        userId,
        cachedAccounts.records,
        cachedTransactions.records,
        cachedBills.records,
        { skipMigration: true }
      );

      renderLoadedView(userId);
      showCacheBadge(cachedTransactions.cacheAge || cachedAccounts.cacheAge || 'recente');

      console.log('[Cache] Renderizado com dados do cache. Buscando dados frescos...');
    }

    // Step 3: Fetch fresh data from Firestore (in background if cache was used)
    if (isLoadingFromNetwork) return;
    isLoadingFromNetwork = true;

    try {
      const [freshAccounts, freshTransactions, freshBills] = await Promise.all([
        cachedAccounts.fetchFresh(),
        cachedTransactions.fetchFresh(),
        cachedBills.fetchFresh()
      ]);

      // Load categories if not loaded yet
      if (!anyFromCache || !hasCachedData) {
        try {
          const mappings = await CategoryService.ensureCategoryMappings(userId);
          ccCategoryMap = CategoryService.buildCategoryMap(mappings);
        } catch (err) {
          console.error('Erro ao carregar categorias para cartões:', err);
        }
      }

      await migrateLegacyClosingDatesIfNeeded(userId, freshAccounts.filter(a => a.type === 'CREDIT'), freshBills);

      processLoadedData(
        userId,
        freshAccounts,
        freshTransactions,
        freshBills
      );

      renderLoadedView(userId);
      hideCacheBadge();

      if (anyFromCache && hasCachedData) {
        console.log('[Cache] Dados atualizados do Firestore. Interface re-renderizada.');
      }
    } finally {
      isLoadingFromNetwork = false;
    }

  } catch (error) {
    console.error('Erro ao buscar transações do cartão:', error);
    container.innerHTML = `
            <p style="font-size:13px;color:#ef4444;text-align:center;padding:48px;">
                Erro ao carregar transações. Verifique o console para mais detalhes.
            </p>
        `;
  }
}

function getCardDates(account?: any | null): { closeDate: string | null; dueDate: string | null } {
  const closeDate = formatShortDate(BillConstructor.parseDate(account?.creditData?.balanceCloseDate));
  const dueDate = formatShortDate(BillConstructor.parseDate(account?.creditData?.balanceDueDate));
  return { closeDate, dueDate };
}

function cleanupInfiniteScroll() {
  if (infiniteScrollObserver) {
    infiniteScrollObserver.disconnect();
    infiniteScrollObserver = null;
  }
  isLoadingMore = false;
}

function attachRowListeners(rows: InvoiceTableRow[], startIdx: number, endIdx: number) {
  for (let index = startIdx; index < endIdx && index < rows.length; index++) {
    const row = rows[index];
    if (row.kind === 'transaction') {
      const tx = row.transaction;

      const prevRow = rows[index - 1];
      const isConsumedByBanner = tx.isRefund && prevRow && prevRow.kind === 'transaction' && prevRow.transaction.id === tx.originalTransactionId;
      if (isConsumedByBanner) continue;

      attachGenericDropdownListeners(`tx-action-trigger-${tx.id}`, `tx-action-dropdown-${tx.id}`);

      const nextRow = rows[index + 1];
      if (nextRow && nextRow.kind === 'transaction' && nextRow.transaction.isRefund && nextRow.transaction.originalTransactionId === tx.id) {
        const rtx = nextRow.transaction;
        attachGenericDropdownListeners(`trigger-refund-${rtx.id}`, `dropdown-refund-${rtx.id}`);

        document.getElementById(`tx-action-delete-${rtx.id}`)?.addEventListener('click', () => {
          showDeleteRefundModal(rtx);
        });
      }

      document.getElementById(`tx-action-detail-${tx.id}`)?.addEventListener('click', () => {
        (window as any).openTransactionDetail(tx);
      });
      document.getElementById(`tx-action-refund-total-${tx.id}`)?.addEventListener('click', () => {
        (window as any).openRefundTotal(tx);
      });
      document.getElementById(`tx-action-refund-custom-${tx.id}`)?.addEventListener('click', () => {
        (window as any).openRefundCustom(tx);
      });

      if (tx.isRefund) {
        document.getElementById(`tx-action-delete-${tx.id}`)?.addEventListener('click', () => {
          showDeleteRefundModal(tx);
        });
      }

      const txInvoices = invoicesByAccountId.get(tx.accountId) || [];
      if (!tx.isRefund && document.getElementById(`tx-move-trigger-${tx.id}`)) {
        attachGenericDropdownListeners(`tx-move-trigger-${tx.id}`, `tx-move-dropdown-${tx.id}`);

        document.getElementById(`tx-move-item-${tx.id}`)?.addEventListener('click', async () => {
          const targetType = tx.computedInvoiceType === 'current' ? 'last' : 'current';
          const targetInvoice = txInvoices.find((invoice) => invoice.typeKey === targetType);
          if (!targetInvoice?.referenceMonth) return;

          await updateTransactionInvoice(tx, { targetMonthKey: targetInvoice.referenceMonth });
        });
      }
    } else if (row.kind === 'finance-charge') {
      const chargeIdStr = row.id.replace(/[^a-zA-Z0-9]/g, '_');
      attachGenericDropdownListeners(`charge-action-trigger-${chargeIdStr}`, `charge-action-dropdown-${chargeIdStr}`);

      document.getElementById(`charge-action-detail-${chargeIdStr}`)?.addEventListener('click', () => {
        const acc = cachedAccountsMap.get(row.accountId) || {};
        const invoice = row.invoice;
        const charge = row.charge;
        const chargeJsonObj = {
          ...charge,
          accountId: row.accountId,
          accountName: getAccountDisplayName(acc),
          invoiceId: invoice.id,
          invoiceName: invoice.name,
          invoiceType: invoice.typeKey,
          dueDate: invoice.dueDate?.toISOString() || null,
          closeDate: invoice.closeDate?.toISOString() || null
        };
        (window as any).openFinanceChargeDetail(chargeJsonObj);
      });
    }
  }
}

function loadMoreRows() {
  if (isLoadingMore) return;
  const totalRows = currentFilteredRows.length;
  if (currentVisibleCount >= totalRows) return;

  isLoadingMore = true;

  const tbody = document.querySelector('#credit-cards-container .cc-table tbody');
  if (!tbody) {
    isLoadingMore = false;
    return;
  }

  const prevCount = currentVisibleCount;
  const nextCount = Math.min(currentVisibleCount + PAGE_SIZE, totalRows);
  currentVisibleCount = nextCount;

  // Remove old sentinel
  const oldSentinel = document.getElementById('cc-load-more-sentinel');
  if (oldSentinel) oldSentinel.remove();

  // Remove old pagination info
  const oldInfo = document.getElementById('cc-pagination-info');
  if (oldInfo) oldInfo.remove();

  // Render new batch of rows
  const fragment = document.createDocumentFragment();
  const batchHtml = currentFilteredRows
    .slice(prevCount, nextCount)
    .map((row, idx) => renderInvoiceTableRow(row, cachedAccountsMap, currentFilteredRows, prevCount + idx))
    .join('');

  const temp = document.createElement('tbody');
  temp.innerHTML = batchHtml;
  while (temp.firstChild) {
    fragment.appendChild(temp.firstChild);
  }

  // Add sentinel if there are still more rows
  if (nextCount < totalRows) {
    const sentinelRow = document.createElement('tr');
    sentinelRow.id = 'cc-load-more-sentinel';
    sentinelRow.innerHTML = `
      <td colspan="7" style="border: none; padding: 0;">
        <div class="cc-load-more-sentinel">
          <div class="cc-load-spinner"></div>
          <span class="cc-load-text">Carregando mais transações...</span>
        </div>
      </td>
    `;
    fragment.appendChild(sentinelRow);
  }

  // Add pagination info
  const infoRow = document.createElement('tr');
  infoRow.id = 'cc-pagination-info';
  infoRow.innerHTML = `
    <td colspan="7" style="border: none; padding: 0;">
      <div class="cc-pagination-info">
        Exibindo ${nextCount} de ${totalRows} transações
      </div>
    </td>
  `;
  fragment.appendChild(infoRow);

  tbody.appendChild(fragment);

  // Attach listeners for new rows
  attachRowListeners(currentFilteredRows, prevCount, nextCount);

  // Lottie loop for new rows
  const newPlayers = tbody.querySelectorAll('.lottie-action-icon');
  newPlayers.forEach((player: any) => {
    if (player._lottieScheduled) return;
    player._lottieScheduled = true;
    player.removeAttribute('loop');
    const schedulePlay = () => {
      if (!player.isConnected) return;
      if (typeof player.stop === 'function') player.stop();
      if (typeof player.play === 'function') player.play();
      setTimeout(schedulePlay, 4000);
    };
    setTimeout(schedulePlay, 500 + Math.random() * 500);
  });

  // Re-observe new sentinel
  if (nextCount < totalRows) {
    const newSentinel = document.getElementById('cc-load-more-sentinel');
    if (newSentinel && infiniteScrollObserver) {
      infiniteScrollObserver.observe(newSentinel);
    }
  }

  isLoadingMore = false;
}

function setupInfiniteScroll() {
  cleanupInfiniteScroll();

  const sentinel = document.getElementById('cc-load-more-sentinel');
  if (!sentinel) return;

  infiniteScrollObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        loadMoreRows();
      }
    });
  }, {
    root: null,
    rootMargin: '200px',
    threshold: 0
  });

  infiniteScrollObserver.observe(sentinel);
}

function renderFilteredTransactions(filter: string) {
  const container = document.getElementById('credit-cards-container');
  if (!container) return;

  // Clean up previous observer
  cleanupInfiniteScroll();

  currentFilter = filter;
  const selectedAccount = getSelectedAccount();
  const selectedInvoices = getSelectedInvoices();
  const selectedRows = getSelectedInvoiceRows();

  let filteredRows = selectedRows;
  if (filter === 'current') {
    filteredRows = selectedRows.filter((row) => row.invoiceType === 'current');
  } else if (filter === 'last') {
    filteredRows = selectedRows.filter((row) => row.invoiceType === 'last');
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filteredRows = filteredRows.filter(row => {
      if (row.kind === 'transaction') {
        return row.transaction.description?.toLowerCase().includes(q) ||
          row.transaction.category?.toLowerCase().includes(q);
      }
      return false;
    });
  }

  // Store for infinite scroll
  currentFilteredRows = filteredRows;
  currentVisibleCount = Math.min(PAGE_SIZE, filteredRows.length);

  const resultsFound = filteredRows.length > 0;
  const visibleRows = filteredRows.slice(0, currentVisibleCount);
  const hasMore = currentVisibleCount < filteredRows.length;

  const currentInvoice = selectedInvoices.find((invoice) => invoice.typeKey === 'current');
  const lastInvoice = selectedInvoices.find((invoice) => invoice.typeKey === 'last');

  const total = filter === 'current'
    ? Number(currentInvoice?.total ?? 0)
    : filter === 'last'
      ? Number(lastInvoice?.total ?? 0)
      : sumInvoiceTableRows(filteredRows);
  const totalHtml = fmtBRL(total);

  let closeDate: string | null = null;
  let dueDate: string | null = null;

  if (filter === 'current') {
    if (currentInvoice?.closeDate) closeDate = formatShortDate(currentInvoice.closeDate);
    if (currentInvoice?.dueDate) dueDate = formatShortDate(currentInvoice.dueDate);
  } else if (filter === 'last') {
    if (lastInvoice?.closeDate) closeDate = formatShortDate(lastInvoice.closeDate);
    if (lastInvoice?.dueDate) dueDate = formatShortDate(lastInvoice.dueDate);
  }

  if (!closeDate && !dueDate) {
    const staticDates = getCardDates(selectedAccount);
    closeDate = staticDates.closeDate;
    dueDate = staticDates.dueDate;
  }

  const filterLabel =
    filter === 'history' ? 'Histórico' :
      filter === 'current' ? 'Fatura Atual' :
        'Última Fatura';

  const datesHtml = (closeDate || dueDate) ? `
    <div class="cc-header-dates">
      ${dueDate ? `
        <div class="cc-header-date-item">
          <span class="cc-header-date-label">Vencimento</span>
          <span class="cc-header-date-value">${dueDate}</span>
        </div>
      ` : ''}
      ${closeDate && dueDate ? `<div class="cc-header-sep"></div>` : ''}
      ${closeDate ? `
        <div class="cc-header-date-item">
          <span class="cc-header-date-label">Fechamento</span>
          <span class="cc-header-date-value">${closeDate}</span>
        </div>
      ` : ''}
    </div>
  ` : '';

  const sentinelHtml = hasMore ? `
    <tr id="cc-load-more-sentinel">
      <td colspan="7" style="border: none; padding: 0;">
        <div class="cc-load-more-sentinel">
          <div class="cc-load-spinner"></div>
          <span class="cc-load-text">Carregando mais transações...</span>
        </div>
      </td>
    </tr>
  ` : '';

  const paginationInfoHtml = resultsFound ? `
    <tr id="cc-pagination-info">
      <td colspan="7" style="border: none; padding: 0;">
        <div class="cc-pagination-info">
          Exibindo ${currentVisibleCount} de ${filteredRows.length} transações
        </div>
      </td>
    </tr>
  ` : '';

  container.innerHTML = `
      <div class="cc-table-wrapper">
          <div class="cc-table-header">
              <div class="cc-table-header-left">
                <span class="cc-table-header-title">${filterLabel}</span>
                <div class="cc-search-wrapper">
                  ${Input({
    id: 'cc-transaction-search',
    type: 'text',
    label: '',
    placeholder: 'Buscar transação...',
    value: searchQuery
  })}
                </div>
              </div>
              <div class="cc-table-header-right">
                ${datesHtml}
                ${datesHtml ? `<div class="cc-header-sep"></div>` : ''}
                <div class="cc-header-total">${totalHtml}</div>
              </div>
          </div>
          <div class="cc-table-scroll">
              <table class="cc-table">
                  <thead>
                      <tr>
                          <th style="width:130px;">Data</th>
                          <th style="width:130px;">Lançamento</th>
                          <th>Descrição / Estabelecimento</th>
                          <th>Categoria</th>
                          <th>Valor</th>
                          <th>Fatura</th>
                          <th style="text-align:right;">Ações</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${resultsFound ? visibleRows.map((row, idx) => renderInvoiceTableRow(row, cachedAccountsMap, currentFilteredRows, idx)).join('') : `
                        <tr>
                          <td colspan="7" style="padding: 60px 0; border: none;">
                            ${EmptyState({
    title: 'Nenhum resultado encontrado',
    description: searchQuery.trim()
      ? `Não encontramos nada para "${searchQuery}" neste período.`
      : 'As transações do cartão aparecerão aqui.',
    icon: ''
  })}
                          </td>
                        </tr>
                      `}
                      ${sentinelHtml}
                      ${paginationInfoHtml}
                  </tbody>
              </table>
          </div>
      </div>
  `;

  // Attach listeners for visible rows
  attachRowListeners(currentFilteredRows, 0, currentVisibleCount);

  // Search input listener
  const searchInput = document.getElementById('cc-transaction-search') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.focus();
    const val = searchInput.value;
    searchInput.value = '';
    searchInput.value = val;

    searchInput.addEventListener('input', (e) => {
      searchQuery = (e.target as HTMLInputElement).value;
      renderFilteredTransactions(currentFilter);
    });
  }

  // Lottie loop
  const players = container.querySelectorAll('.lottie-action-icon, .cc-card-lottie');
  players.forEach((player: any) => {
    player.removeAttribute('loop');
    const schedulePlay = () => {
      if (!player.isConnected) return;
      if (typeof player.stop === 'function') player.stop();
      if (typeof player.play === 'function') player.play();
      setTimeout(schedulePlay, 4000);
    };
    setTimeout(schedulePlay, 1000 + Math.random() * 1000);
  });
  if (!resultsFound) {
    initEmptyStateLotties();
  }

  // Setup infinite scroll if there are more rows
  if (hasMore) {
    setupInfiniteScroll();
  }
}

function renderInvoiceTableRow(row: InvoiceTableRow, accountsMap: Map<string, any>, allRows?: InvoiceTableRow[], currentIndex?: number): string {
  if (row.kind === 'finance-charge') {
    return renderFinanceChargeRow(row, accountsMap);
  }

  return renderTransactionRow(row.transaction, accountsMap, allRows, currentIndex);
}

function renderTransactionRow(tx: any, accountsMap: Map<string, any>, allRows?: InvoiceTableRow[], currentIndex?: number): string {
  const acc = accountsMap.get(tx.accountId) || {};

  const purchaseDateStr = (tx.date?.toDate ? tx.date.toDate() : new Date(tx.date))
    .toLocaleDateString('pt-BR');
  const releaseDate = getReleaseDate(tx).toLocaleDateString('pt-BR');

  const { instNumber, instTotal, purchaseAmount, isInstallment } = getInstallmentInfo(tx);

  const parcelValue = fmtBRL(tx.amount || 0);
  const totalValue = purchaseAmount != null
    ? fmtBRL(purchaseAmount)
    : (isInstallment && instTotal
      ? fmtBRL((tx.amount || 0) * instTotal)
      : '—');

  const billName = tx.computedBillName
    ? tx.computedBillName
    : billConstructor.getBillByDate(acc, tx.date).name;

  const logoUrl = acc.institution?.imageUrl || '/assets/logo/logo.png';

  let hasRefundFollowing = false;
  let refundAmount = 0;
  let refundTxId = '';
  if (allRows && currentIndex !== undefined) {
    const nextRow = allRows[currentIndex + 1];
    if (nextRow && nextRow.kind === 'transaction' && nextRow.transaction.isRefund && nextRow.transaction.originalTransactionId === tx.id) {
      hasRefundFollowing = true;
      refundAmount = Math.abs(nextRow.transaction.amount || 0);
      refundTxId = nextRow.transaction.id;
    }
  }

  if (tx.isRefund && allRows && currentIndex !== undefined && currentIndex > 0) {
    const prevRow = allRows[currentIndex - 1];
    if (prevRow && prevRow.kind === 'transaction' && prevRow.transaction.id === tx.originalTransactionId) {
      return '';
    }
  }

  const invoiceMoveAction = (() => {
    if (tx.isRefund) return '';
    const type = tx.computedInvoiceType;
    if (type !== 'current' && type !== 'last') return '';

    const theme = useTheme().current;
    const swipeSrc = theme === 'dark' ? '/assets/lottie/swipe.json' : '/assets/lottie/swipepreto.json';
    const arrowSrc = theme === 'dark' ? '/assets/lottie/setabranca.json' : '/assets/lottie/setapreta.json';
    const moveLabel = type === 'current' ? 'Enviar para Ultima' : 'Enviar para Atual';
    const directionStyle = type === 'current' ? 'transform: scaleX(-1);' : '';

    return `
      <div class="relative inline-block text-left">
        <button id="tx-move-trigger-${tx.id}" class="cc-action-btn" title="Mover Fatura">
          <lottie-player
            src="${swipeSrc}"
            background="transparent"
            speed="1"
            style="width: 18px; height: 18px;"
            class="lottie-action-icon"
            autoplay
          ></lottie-player>
        </button>
        ${GenericDropdown({
      id: `tx-move-dropdown-${tx.id}`,
      width: '180px',
      items: [
        {
          id: `tx-move-item-${tx.id}`,
          label: moveLabel,
          icon: `<lottie-player src="${arrowSrc}" background="transparent" speed="1" style="width: 18px; height: 18px; ${directionStyle}" class="lottie-action-icon" autoplay></lottie-player>`
        }
      ]
    })}
      </div>
    `;
  })();

  const isPayment = billConstructor.isInvoicePayment(tx);

  const rowClasses = [];
  if (tx.isRefund) rowClasses.push('cc-row-refund');
  if (hasRefundFollowing) rowClasses.push('cc-row-has-refund');
  if (isPayment) rowClasses.push('cc-row-payment');

  const actionItems = [];

  if (tx.isRefund) {
    actionItems.push({ id: `tx-action-delete-${tx.id}`, label: 'Excluir Reembolso', icon: '<svg width="14" height="14" class="text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' });
  } else {
    actionItems.push({ id: `tx-action-refund-total-${tx.id}`, label: 'Reembolsar Valor Total', icon: '<svg width="14" height="14" class="text-[#10b981]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' });
    actionItems.push({ id: `tx-action-refund-custom-${tx.id}`, label: 'Reembolsar Personalizado', icon: '<svg width="14" height="14" class="text-[#f59e0b]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' });
  }

  // Banner "Estornado" — aparece acima da transação original quando há reembolso logo abaixo
  const estornadoBanner = hasRefundFollowing ? `
    <tr class="cc-row-estornado-banner">
      <td colspan="7" style="position: relative;">
        <div class="cc-estornado-badge relative" data-refund-id="${refundTxId}">
          <div class="cc-estornado-label">
            <lottie-player
              src="/assets/lottie/sincronizar.json"
              background="transparent"
              speed="1"
              autoplay
              style="width: 18px; height: 18px; flex-shrink: 0;"
            ></lottie-player>
            <span>Transação reembolsada no valor de</span>
          </div>
          <div class="cc-estornado-value">
            <div class="cc-amount">${fmtBRL(refundAmount)}</div>
          </div>
          
          <div class="ml-auto relative">
            <button id="trigger-refund-${refundTxId}" class="cc-action-btn" title="Acoes">
              ${(() => {
      const theme = useTheme().current;
      const lottieSrc = theme === 'dark' ? '/assets/lottie/acoesbranco.json' : '/assets/lottie/acoespreto.json';
      return `<lottie-player src="${lottieSrc}" background="transparent" speed="1" style="width: 18px; height: 18px;" class="lottie-action-icon" autoplay></lottie-player>`;
    })()}
            </button>
            ${GenericDropdown({
      id: `dropdown-refund-${refundTxId}`,
      items: [
        { id: `tx-action-delete-${refundTxId}`, label: 'Excluir Reembolso', icon: '<svg width="14" height="14" class="text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' }
      ]
    })}
          </div>

          <!-- Loader overlay para exclusão no banner -->
          <div class="card-loader-overlay absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center opacity-0 pointer-events-none transition-all duration-300">
            <div class="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin mb-1"></div>
            <p class="text-[10px] font-medium text-white tracking-tight">Excluindo...</p>
          </div>
        </div>
      </td>
    </tr>
  ` : '';

  return `
    ${estornadoBanner}
    <tr class="${rowClasses.join(' ')}" data-tx-id="${tx.id}">
      <td style="color:var(--color-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap; position: static;">
        <!-- Loader overlay para a linha toda -->
        <div class="cc-row-loader-overlay" style="position: absolute; top: 0; left: 0; height: 100%; pointer-events: none; z-index: 50; border-radius: 0;">
           <div class="flex flex-col items-center justify-center w-full h-full">
             <div class="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
             <p class="text-[10px] font-medium text-white tracking-tight mt-1">Movendo...</p>
           </div>
        </div>
        ${purchaseDateStr}
      </td>
      <td style="color:var(--color-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;">
        ${releaseDate}
      </td>
      <td>
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;">
            <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;" title="${tx.description || ''}">
              ${tx.description || '—'}
            </span>
            ${isInstallment ? `<span class="cc-installment-pill">${instNumber}/${instTotal}</span>` : ''}
            ${isPayment ? `<span class="cc-payment-pill">Pagamento</span>` : ''}
          </div>
        </div>
      </td>
      <td>
        <span class="cc-category">${isPayment ? 'Pagamento' : getCcCategoryName(tx.category)}</span>
      </td>
      <td style="white-space:nowrap;">
        <span class="cc-amount">${parcelValue}</span>
        ${isInstallment && totalValue !== '—' ? `<div class="cc-total-sub">total ${totalValue}</div>` : ''}
      </td>
      <td>
        <span style="font-weight:500;">${billName}</span>
      </td>
      <td style="text-align:right; position: relative;">
        <div class="flex items-center justify-end gap-2">
          ${invoiceMoveAction}

          <div class="relative inline-block text-left">
            <button id="tx-action-trigger-${tx.id}" class="cc-action-btn" title="Ações">
              ${(() => {
      const theme = useTheme().current;
      const lottieSrc = theme === 'dark' ? '/assets/lottie/acoesbranco.json' : '/assets/lottie/acoespreto.json';
      return `<lottie-player src="${lottieSrc}" background="transparent" speed="1" style="width: 18px; height: 18px;" class="lottie-action-icon" autoplay></lottie-player>`;
    })()}
            </button>
            ${GenericDropdown({
      id: `tx-action-dropdown-${tx.id}`,
      items: actionItems
    })}
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderFinanceChargeRow(row: FinanceChargeTableRow, accountsMap: Map<string, any>): string {
  const acc = accountsMap.get(row.accountId) || {};
  const invoice = row.invoice;
  const charge = row.charge;
  const chargeLabel = getFinanceChargeLabel(charge);
  const referenceDate = getFinanceChargeReferenceDate(invoice);
  const releaseDate = referenceDate ? referenceDate.toLocaleDateString('pt-BR') : '—';
  const billName = invoice.name || getAccountDisplayName(acc);
  const logoUrl = acc.institution?.imageUrl || '/assets/logo/logo.png';
  const chargeIdStr = row.id.replace(/[^a-zA-Z0-9]/g, '_');

  return `
    <tr class="cc-row-charge">
      <td style="color:var(--color-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;">
        —
      </td>
      <td style="color:var(--color-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;">
        ${releaseDate}
      </td>
      <td>
        <div class="flex items-center gap-2">
          <div class="w-5 h-5 rounded-full bg-white p-0.5 shrink-0 border border-[var(--color-border)]">
            <img src="${logoUrl}" onerror="this.src='/assets/logo/logo.png'" class="w-full h-full object-contain" />
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;min-width:0;">
              <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;" title="${chargeLabel}">
                ${chargeLabel}
              </span>
              <span class="cc-installment-pill cc-installment-pill-charge">Encargo</span>
            </div>
            <span style="font-size:11px;color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;">
              ${charge.additionalInfo || `Cobrado na fatura ${billName}`}
            </span>
          </div>
        </div>
      </td>
      <td>
        <span class="cc-category cc-category-charge">Encargo</span>
      </td>
      <td style="white-space:nowrap;">
        <span class="cc-amount">${fmtBRL(Number(charge.amount || 0))}</span>
      </td>
      <td>
        <span style="font-weight:500;">${billName}</span>
      </td>
      <td style="text-align:right;">
        <div class="relative inline-block text-left">
          <button id="charge-action-trigger-${chargeIdStr}" class="cc-action-btn" title="Ações">
            ${(() => {
      const theme = useTheme().current;
      const lottieSrc = theme === 'dark' ? '/assets/lottie/acoesbranco.json' : '/assets/lottie/acoespreto.json';
      return `<lottie-player src="${lottieSrc}" background="transparent" speed="1" style="width: 18px; height: 18px;" class="lottie-action-icon" autoplay></lottie-player>`;
    })()}
          </button>
          ${GenericDropdown({
      id: `charge-action-dropdown-${chargeIdStr}`,
      items: []
    })}
        </div>
      </td>
    </tr>
  `;
}

function updateSummaryCards() {
  const cards = document.querySelectorAll('.cc-card');
  cards.forEach(card => {
    const loader = card.querySelector('.card-loader-overlay');
    if (loader) loader.remove();
  });

  const selectedAccount = getSelectedAccount();
  const transactions = getSelectedTransactions();
  const invoices = getSelectedInvoices();
  const rows = getSelectedInvoiceRows();
  const sum = (arr: any[]) => arr.reduce((acc, t) => {
    if (billConstructor.isInvoicePayment(t)) return acc;
    return acc + (t.amount || 0);
  }, 0);

  const currentBillTxs = transactions.filter(tx => tx.computedInvoiceType === 'current');
  const lastBillTxs = transactions.filter(tx => tx.computedInvoiceType === 'last');
  const currentRows = rows.filter((row) => row.invoiceType === 'current');
  const lastRows = rows.filter((row) => row.invoiceType === 'last');

  const resolvedCurrentInvoice = invoices.find((invoice) => invoice.typeKey === 'current');
  const resolvedLastInvoice = invoices.find((invoice) => invoice.typeKey === 'last');

  const currentNames = Array.from(new Set(currentBillTxs.map(t => t.computedBillName))).filter(Boolean);
  const dispCurrentName = currentNames.length === 1 ? currentNames[0] : (currentNames.length > 1 ? 'Várias Faturas' : billConstructor.getCurrentBill().name);

  const lastNames = Array.from(new Set(lastBillTxs.map(t => t.computedBillName))).filter(Boolean);
  const dispLastName = lastNames.length === 1 ? lastNames[0] : (lastNames.length > 1 ? 'Várias Faturas' : billConstructor.getPreviousBill().name);

  const fmt = (v: number) => fmtBRL(v);
  const plural = (n: number) => `${n} transaç${n === 1 ? 'ão' : 'ões'} `;

  const elCurrent = document.getElementById('card-current');
  const elCurrentSub = document.getElementById('card-current-sub');
  if (elCurrent) elCurrent.innerHTML = fmt(sum(currentBillTxs));
  if (elCurrentSub) elCurrentSub.textContent = `Fatura de ${dispCurrentName} • ${plural(currentRows.length)} `;

  const elLast = document.getElementById('card-last');
  const elLastSub = document.getElementById('card-last-sub');

  const lottieLastPlayer = document.getElementById('lottie-last-player') as any;
  if (lottieLastPlayer) {
    let isLastPaid = false;
    if (resolvedLastInvoice && resolvedLastInvoice.closeDate) {
      const closeDateObj = new Date(resolvedLastInvoice.closeDate);
      const minPaymentTime = new Date(closeDateObj.getFullYear(), closeDateObj.getMonth(), closeDateObj.getDate() - 7).getTime();

      const hasPayment = transactions.some(tx => {
        if (!billConstructor.isInvoicePayment(tx)) return false;
        const txTime = (tx.date?.toDate ? tx.date.toDate() : new Date(tx.date)).getTime();
        return txTime >= minPaymentTime;
      });
      isLastPaid = hasPayment || Number(resolvedLastInvoice.total || 0) <= 0;
    }

    const targetLottie = isLastPaid ? '/assets/lottie/faturapaga.json' : '/assets/lottie/faturafechada.json';
    if (lottieLastPlayer.getAttribute('src') !== targetLottie) {
      lottieLastPlayer.setAttribute('src', targetLottie);
    }
  }


  if (elLast) elLast.innerHTML = fmt(sum(lastBillTxs));
  if (elLastSub) elLastSub.textContent = `Fatura de ${dispLastName} • ${plural(lastRows.length)} `;

  const elHistory = document.getElementById('card-history');
  const elHistorySub = document.getElementById('card-history-sub');

  const lottieHistoryPlayer = document.getElementById('lottie-history-player') as any;
  if (lottieHistoryPlayer) {
    const theme = useTheme().current;
    const targetHistoryLottie = theme === 'dark' ? '/assets/lottie/faturahistorico.json' : '/assets/lottie/faturahistoricopreto.json';
    if (lottieHistoryPlayer.getAttribute('src') !== targetHistoryLottie) {
      lottieHistoryPlayer.setAttribute('src', targetHistoryLottie);
    }
  }

  if (elHistory) elHistory.innerHTML = fmt(sumInvoiceTableRows(rows));
  if (elHistorySub) elHistorySub.textContent = `${plural(rows.length)} no total`;

  const selectedAccountLabel = selectedAccount ? getAccountDisplayName(selectedAccount) : 'Cartao';

  if (elCurrent) elCurrent.innerHTML = fmt(Number(resolvedCurrentInvoice?.total ?? sum(currentBillTxs)));
  if (elCurrentSub) elCurrentSub.textContent = `Fatura de ${resolvedCurrentInvoice?.name ?? selectedAccountLabel} - ${getInvoiceCountLabel(currentRows.length)}`;

  if (elLast) elLast.innerHTML = fmt(Number(resolvedLastInvoice?.total ?? sum(lastBillTxs)));
  if (elLastSub) elLastSub.textContent = `Fatura de ${resolvedLastInvoice?.name ?? selectedAccountLabel} - ${getInvoiceCountLabel(lastRows.length)}`;

  if (elHistorySub) elHistorySub.textContent = `${getInvoiceCountLabel(rows.length)} no cartao`;
}

async function applyFirestorePaymentConfirmation(userId: string): Promise<void> {
  const account = getSelectedAccount();
  const invoices = getSelectedInvoices();
  const lastInvoice = invoices.find(inv => inv.typeKey === 'last');
  if (!account || !lastInvoice) return;

  const bannerKey = `${account.id}_${lastInvoice.referenceMonth}`;
  try {
    const confirmRef = doc(db, 'users', userId, 'invoicePaymentConfirmations', bannerKey);
    const confirmSnap = await getDoc(confirmRef);
    if (confirmSnap.exists() && confirmSnap.data()?.isPaid === true) {
      const paidBadge = document.getElementById('card-last-paid-badge');
      if (paidBadge) paidBadge.style.display = 'inline-flex';
      const lottieLastPlayer = document.getElementById('lottie-last-player') as any;
      if (lottieLastPlayer && lottieLastPlayer.getAttribute('src') !== '/assets/lottie/faturapaga.json') {
        lottieLastPlayer.setAttribute('src', '/assets/lottie/faturapaga.json');
      }
    }
  } catch {
    // silent fail
  }
}

// ====================== CLOSING DATE LOGIC ======================

async function showClosingDateReminderCard(userId: string, accountData: any, invoices: ComputedBill[]) {
  const container = document.getElementById('closing-date-reminder-container');
  if (!container) return;

  let closingDay = BillConstructor.getSuggestedClosingDay(accountData);
  if (closingDay === 0) closingDay = 10;

  await saveClosingDates(userId, accountData.id, closingDay, invoices, accountData.closingDateSettings);
  container.innerHTML = '';
}

async function showClosingDateReminder(userId: string, accountData: any, invoices: ComputedBill[]) {
  return showClosingDateReminderCard(userId, accountData, invoices);
}


function startPeriodicLotties() {
  const players = [
    document.getElementById('lottie-current-player'),
    document.getElementById('lottie-last-player'),
    document.getElementById('lottie-history-player')
  ];

  const playAnimations = () => {
    players.forEach(player => {
      if (player && (player as any).play) {
        (player as any).seek(0);
        (player as any).play();
      }
    });
  };

  setTimeout(playAnimations, 1000);
  const interval = setInterval(playAnimations, 4000);

  window.addEventListener('app-navigate', () => {
    clearInterval(interval);
  }, { once: true });
}

// ====================== MODAL JSON / ACTIONS ======================

async function executeRefund(tx: any, refundAmount: number) {
  try {
    const row = document.querySelector(`tr[data-tx-id="${tx.id}"]`);
    if (row) {
      const loader = row.querySelector('.card-loader-overlay');
      if (loader) {
        const text = loader.querySelector('p');
        if (text) text.textContent = 'Reembolsando...';
        loader.classList.remove('opacity-0', 'pointer-events-none');
        loader.classList.add('opacity-100');
      }
    } else {
      showPageOverlay('Registrando reembolso...');
    }

    const refundId = tx.id + '_refund_' + Date.now();
    const refundTx = {
      ...tx,
      id: refundId,
      amount: -refundAmount,
      description: 'Reembolso: ' + (tx.description || ''),
      status: 'CONFIRMED',
      isRefund: true,
      originalTransactionId: tx.id
    };

    delete refundTx.computedBillName;
    delete refundTx.computedInvoiceType;
    delete refundTx.computedInvoiceMonthKey;

    const refundUserId = tx.userId || auth.currentUser?.uid;
    if (!refundUserId) {
      throw new Error('Usuário não autenticado.');
    }

    const refundDoc = getPluggyCanonicalDocRef(refundUserId, 'creditCardTransactions', refundId);
    await setDoc(refundDoc, refundTx);

    toaster.create({ title: "Reembolso Efetuado", description: "O reembolso foi registrado com sucesso.", type: "success" });

    if (tx.userId) {
      await loadCreditCardTransactions(tx.userId);
    }
  } catch (err) {
    console.error(err);
    toaster.create({ title: "Erro", description: "Ocorreu um erro ao registrar o reembolso.", type: "error" });
  } finally {
    hidePageOverlay();
  }
}

async function updateTransactionInvoice(
  tx: any,
  options: { targetMonthKey?: string; isRemoveOverride?: boolean }
) {
  const userId = auth.currentUser?.uid;
  if (!userId) return;

  try {
    const row = document.querySelector(`tr[data-tx-id="${tx.id}"]`);
    if (row) {
      const loader = row.querySelector('.cc-row-loader-overlay') as HTMLElement | null;
      if (loader) {
        loader.classList.add('active');
      }
    }

    const result = await moveTransactionToInvoice({
      userId,
      transactionId: tx.id,
      targetMonthKey: options.targetMonthKey,
      sourceMonthKey: getTransactionDisplayInvoiceMonthKey(tx, invoicesByAccountId.get(tx.accountId) || []) || undefined,
      isRemoveOverride: options.isRemoveOverride === true,
      collectionHint: 'creditCardTransactions',
      transactionData: tx
    });

    if (!result.success) {
      throw new Error(result.error || 'Erro ao atualizar fatura');
    }

    toaster.create({
      title: options.isRemoveOverride ? 'Ajuste removido' : 'Transacao movida',
      description: options.isRemoveOverride
        ? 'A transacao voltou para a classificacao automatica.'
        : 'A transacao foi movida com sucesso.',
      type: 'success'
    });

    await loadCreditCardTransactions(userId);
  } catch (error) {
    console.error('Erro ao mover transacao:', error);
    toaster.create({ title: 'Erro', description: 'Ocorreu um problema ao atualizar a fatura.', type: 'error' });
  } finally {
    hidePageOverlay();
  }
}


(window as any).openTransactionActions = (tx: any) => {
  const modal = Modal({
    title: 'Ações da Transação',
    maxWidth: 'max-w-md',
    fieldsPadding: 'p-6',
    showCancel: false,
    showConfirm: false,
    content: `
      <div class="flex flex-col gap-3">
        <button id="btn-action-detail" class="w-full text-left px-5 py-3.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-all duration-200 text-[13px] font-semibold text-[var(--color-text)] flex items-center justify-between group">
           <span>Visualizar Detalhes</span>
           <svg class="w-4 h-4 text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
        </button>
        <button id="btn-action-refund-total" class="w-full text-left px-5 py-3.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-all duration-200 text-[13px] font-semibold text-[var(--color-text)] flex items-center justify-between group">
           <span>Reembolsar Valor Total</span>
           <svg class="w-4 h-4 text-[#10b981] opacity-70 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </button>
        <button id="btn-action-refund-custom" class="w-full text-left px-5 py-3.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-all duration-200 text-[13px] font-semibold text-[var(--color-text)] flex items-center justify-between group">
           <span>Reembolsar Valor Personalizado</span>
           <svg class="w-4 h-4 text-[#f59e0b] opacity-70 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </button>
      </div>
    `
  });

  document.getElementById('btn-action-detail')?.addEventListener('click', () => {
    modal.closeModal();
    (window as any).openTransactionDetail(tx);
  });

  document.getElementById('btn-action-refund-total')?.addEventListener('click', () => {
    modal.closeModal();
    (window as any).openRefundTotal(tx);
  });

  document.getElementById('btn-action-refund-custom')?.addEventListener('click', () => {
    modal.closeModal();
    (window as any).openRefundCustom(tx);
  });
};

(window as any).openRefundTotal = (tx: any) => {
  const formattedAmount = Math.abs(tx.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  Modal({
    title: 'Confirmar Reembolso Total',
    content: `
       <p class="text-[14px] text-[var(--color-text-secondary)] mb-4">
         Tem certeza que deseja reembolsar o valor total de <strong>R$ ${formattedAmount}</strong> da transação "${tx.description}"?
       </p>
       <p class="text-[13px] text-[var(--color-text-secondary)] mb-2">Uma nova transação de reembolso será criada para anular este valor na fatura correspondente.</p>
    `,
    confirmText: 'Confirmar Reembolso',
    onConfirm: async () => {
      await executeRefund(tx, tx.amount || 0);
    }
  });
};

(window as any).openRefundCustom = (tx: any) => {
  Modal({
    title: 'Reembolso Personalizado',
    content: `
       <p class="text-[14px] text-[var(--color-text-secondary)] mb-4">
         Insira o valor que deseja reembolsar para a transação "${tx.description}".
       </p>
       <div class="mb-4">
         <label class="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1">Valor do Reembolso (R$)</label>
         <input type="number" step="0.01" name="refundAmount" required min="0.01" max="${Math.abs(tx.amount || 0)}" class="w-full px-4 py-3 rounded-xl bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[#D97757] transition-colors font-medium" placeholder="Ex: 50.00" />
       </div>
    `,
    confirmText: 'Confirmar Reembolso',
    onConfirm: async (data) => {
      const amount = parseFloat(data.refundAmount);
      if (isNaN(amount) || amount <= 0) {
        toaster.create({ title: "Valor inválido", description: "Insira um valor maior que zero.", type: "error" });
        throw new Error('PREVENT_CLOSE');
      }
      const signal = (tx.amount || 0) < 0 ? -1 : 1;
      await executeRefund(tx, amount * signal);
    }
  });
};

(window as any).openTransactionDetail = (tx: any) => {
  const jsonStr = JSON.stringify(tx, null, 2);
  const formatted = tx.amount?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0,00';

  Modal({
    title: 'Detalhes da Transação',
    maxWidth: 'max-w-2xl',
    fieldsPadding: 'p-6',
    showConfirm: false,
    showCancel: false,
    content: `
  <div class="w-full">
    <div class="mb-4 flex items-baseline gap-1">
      <span class="text-[14px] font-medium text-[var(--color-text-secondary)]">R$</span>
      <span class="text-[28px] font-bold text-[var(--color-text)] tracking-tight">${formatted}</span>
    </div>
    <pre class="cc-json">${jsonStr}</pre>
  </div>
    `
  });
};

(window as any).openFinanceChargeDetail = (charge: any) => {
  const jsonStr = JSON.stringify(charge, null, 2);
  const formatted = Number(charge?.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  Modal({
    title: 'Detalhes do Encargo',
    maxWidth: 'max-w-2xl',
    fieldsPadding: 'p-6',
    showConfirm: false,
    showCancel: false,
    content: `
  <div class="w-full">
    <div class="mb-4 flex items-baseline gap-1">
      <span class="text-[14px] font-medium text-[var(--color-text-secondary)]">R$</span>
      <span class="text-[28px] font-bold text-[var(--color-text)] tracking-tight">${formatted}</span>
    </div>
    <pre class="cc-json">${jsonStr}</pre>
  </div>
    `
  });
};

