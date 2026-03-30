import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { loadPluggyRecords, getPluggyCanonicalDocRef } from './pluggyFirestore';
import { BillConstructor, type ComputedBill } from './BillConstructor';
import {
  generateInvoiceOptions,
  getTransactionInvoiceMonthKey,
  moveTransactionToInvoice,
  normalizeMonthKey,
} from '../services/invoiceService';
import { CategoryService } from '../services/categoryService';
import { openReminderModal } from '../components/ReminderModal';
import { openSubscriptionModal } from '../components/SubscriptionModal';
import { DeleteConfirmationModal } from '../components/DeleteConfirmationModal';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';
import { Select, attachSelectListeners } from '../components/Select';
import { toaster } from '../components/Toast';
import { shiftMonth, toMonthKey } from '../components/MonthSelector';

type AssistantPush = (html: string) => void | Promise<void>;

export interface CoinChatAssistantConfig {
  userId: string;
  getCurrentMonthKey: () => string;
  setCurrentMonthKey: (monthKey: string) => void;
  pushAssistantMessage: AssistantPush;
  /** Retorna e consome o prefill capturado da última resposta da IA (bloco COIN_ACTION) */
  getPendingActionPrefill?: () => Record<string, string> | null;
}

export interface CoinChatAssistantApi {
  handlePrompt: (prompt: string) => Promise<string | null>;
  handleAction: (action: string, dataset: DOMStringMap) => Promise<string | null>;
}

type UserCategory = {
  id: string;
  name: string;
  originalKey?: string;
};

type SubscriptionRecord = Record<string, any> & { id: string };
type ReminderRecord = Record<string, any> & { id: string };
type SavingsRecord = Record<string, any> & { id: string };
type CreditTransactionRecord = Record<string, any> & { id: string };
type RegularTransactionRecord = Record<string, any> & { id: string };
type AssetRecord = Record<string, any> & { id: string };

type CreditChatContext = {
  creditTransactions: CreditTransactionRecord[];
  regularTransactions: RegularTransactionRecord[];
  accounts: any[];
  accountsById: Map<string, any>;
  invoicesByAccountId: Map<string, ComputedBill[]>;
};

type InlineButton = {
  label: string;
  action: string;
  variant?: 'danger' | 'ghost';
  attrs?: Record<string, string>;
};

const PT_MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Marco',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const MONTH_ALIASES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
};

const EXCLUDED_ACCOUNT_TYPES = new Set([
  'CREDIT',
  'CREDIT_CARD',
  'SAVINGS',
  'SAVINGS_ACCOUNT',
  'INVESTMENT',
  'INVESTMENT_ACCOUNT',
  'LOAN',
  'LOAN_ACCOUNT',
]);

const EXCLUDED_TRANSACTION_CATEGORY_TERMS = [
  'poupanca',
  'investimento',
  'investimentos',
  'investment income',
  'proceeds interests and dividends',
  'transf propria',
  'same person transfer',
];

const EXCLUDED_TRANSACTION_DESCRIPTION_TERMS = [
  'resg pou',
  'resgate',
  'poupanca',
  'conta poupanca',
  'transferencia para conta poupanca',
  'transferencia de conta corrente',
  'aplicacao automatica',
  'remuneracao aplicacao',
  'remuneracao basica',
  'rentab invest',
  'juros taxa',
  'facilcred',
];

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMonthLabel(monthKey: string): string {
  const normalized = normalizeMonthKey(monthKey);
  if (!normalized) return monthKey;
  const [year, month] = normalized.split('-').map(Number);
  return `${PT_MONTHS[month - 1]} ${year}`;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatShortDate(value: unknown): string {
  const parsed = parseDate(value);
  if (!parsed) return '-';
  return parsed.toLocaleDateString('pt-BR');
}

function getCardAccountDisplayName(account: any): string {
  const name = String(account?.name || account?.creditData?.brand || account?.id || 'Cartao').trim();
  if (!name) return 'Cartao';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getComparableMonthKeyFromDate(value: unknown): string | null {
  const parsed = parseDate(value);
  return parsed ? toMonthKey(parsed) : null;
}

function isCurrentAccount(account?: any, tx?: RegularTransactionRecord): boolean {
  const typeKeys = [account?.type, account?.subtype, tx?.accountType]
    .map((typeValue) => normalizeText(typeValue).replace(/\s+/g, '_'))
    .filter(Boolean);

  if (typeKeys.some((typeKey) => EXCLUDED_ACCOUNT_TYPES.has(typeKey))) {
    return false;
  }

  const accountName = normalizeText(account?.name);
  return !(
    accountName.includes('poupanca') ||
    accountName.includes('investimento') ||
    accountName.includes('emprestimo')
  );
}

function shouldHideSavingsOrInvestmentMovement(tx: RegularTransactionRecord): boolean {
  const description = normalizeText(tx.description);
  const categoryText = normalizeText(tx.category);

  return (
    EXCLUDED_TRANSACTION_CATEGORY_TERMS.some((term) => categoryText.includes(term)) ||
    EXCLUDED_TRANSACTION_DESCRIPTION_TERMS.some((term) => description.includes(term))
  );
}

function shouldShowTransactionInMovements(tx: RegularTransactionRecord, accountsById: Map<string, any>): boolean {
  const account = accountsById.get(tx.accountId);
  return isCurrentAccount(account, tx) && !shouldHideSavingsOrInvestmentMovement(tx);
}

function getCreditTransactionMonthKey(tx: CreditTransactionRecord, invoices: ComputedBill[]): string | null {
  const storedMonthKey = getTransactionInvoiceMonthKey(tx);
  if (storedMonthKey) return storedMonthKey;

  const billId = tx?.creditCardMetadata?.billId;
  if (billId) {
    const matchedByBillId = invoices.find((invoice) => invoice._pluggyBillIds?.includes(billId));
    if (matchedByBillId?.referenceMonth) return matchedByBillId.referenceMonth;
  }

  const computedMonthKey = normalizeMonthKey(tx?.computedInvoiceMonthKey);
  if (computedMonthKey) return computedMonthKey;

  if (tx?.computedBillName) {
    const matchedByName = invoices.find((invoice) => invoice.name === tx.computedBillName);
    if (matchedByName?.referenceMonth) return matchedByName.referenceMonth;
  }

  if (tx?.computedInvoiceType && tx.computedInvoiceType !== 'unknown') {
    const matchedByType = invoices.find((invoice) => invoice.typeKey === tx.computedInvoiceType);
    if (matchedByType?.referenceMonth) return matchedByType.referenceMonth;
  }

  const parsed = parseDate(tx?.date);
  return parsed ? toMonthKey(parsed) : null;
}

function extractMonthReference(prompt: string, fallbackMonthKey: string): string | null {
  const normalized = normalizeText(prompt);

  if (normalized.includes('mes atual') || normalized.includes('este mes') || normalized.includes('desse mes')) {
    return fallbackMonthKey;
  }
  if (normalized.includes('proximo mes') || normalized.includes('mes seguinte')) {
    return shiftMonth(fallbackMonthKey, 1);
  }
  if (normalized.includes('mes passado') || normalized.includes('mes anterior')) {
    return shiftMonth(fallbackMonthKey, -1);
  }

  const yyyyMmMatch = normalized.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if (yyyyMmMatch) {
    return `${yyyyMmMatch[1]}-${yyyyMmMatch[2].padStart(2, '0')}`;
  }

  const mmYyyyMatch = normalized.match(/\b(0?[1-9]|1[0-2])[/-](20\d{2})\b/);
  if (mmYyyyMatch) {
    return `${mmYyyyMatch[2]}-${mmYyyyMatch[1].padStart(2, '0')}`;
  }

  for (const [monthName, monthNumber] of Object.entries(MONTH_ALIASES)) {
    if (!normalized.includes(monthName)) continue;
    const yearMatch = normalized.match(/20\d{2}/);
    const fallbackYear = fallbackMonthKey.split('-')[0];
    return `${yearMatch?.[0] || fallbackYear}-${String(monthNumber).padStart(2, '0')}`;
  }

  return null;
}

function renderButtons(buttons: InlineButton[]): string {
  if (!buttons.length) return '';
  return `
    <div class="coin-chat-actions">
      ${buttons
        .map((button) => {
          const attrs = Object.entries(button.attrs || {})
            .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
            .join(' ');
          const variantAttr = button.variant ? `data-variant="${button.variant}"` : '';
          return `<button class="coin-chat-action-btn" data-chat-action="${button.action}" ${variantAttr} ${attrs}>${escapeHtml(button.label)}</button>`;
        })
        .join('')}
    </div>
  `;
}

function renderCard(title: string, subtitle: string, body: string, buttons: InlineButton[] = []): string {
  return `
    <div class="coin-chat-card">
      <div class="coin-chat-card-header">
        <div>
          <div class="coin-chat-card-title">${escapeHtml(title)}</div>
          <div class="coin-chat-card-subtitle">${escapeHtml(subtitle)}</div>
        </div>
      </div>
      <div class="coin-chat-card-body">${body}</div>
      ${renderButtons(buttons)}
    </div>
  `;
}

function renderChip(label: string): string {
  return `<span class="coin-chat-chip">${escapeHtml(label)}</span>`;
}

function rankMatches<T extends Record<string, any>>(items: T[], query: string, fields: (keyof T | string)[]): T[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return items.slice(0, 8);

  const scored = items
    .map((item) => {
      let score = 0;
      fields.forEach((field) => {
        const value = String(item[field as keyof T] ?? '');
        const normalizedValue = normalizeText(value);
        if (!normalizedValue) return;
        if (normalizedValue === normalizedQuery) score += 6;
        else if (normalizedValue.startsWith(normalizedQuery)) score += 4;
        else if (normalizedValue.includes(normalizedQuery)) score += 2;
      });
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored.map((entry) => entry.item);
}

export function createCoinChatAssistant(config: CoinChatAssistantConfig): CoinChatAssistantApi {
  let cachedCategories: UserCategory[] | null = null;

  const loadCategories = async (): Promise<UserCategory[]> => {
    if (cachedCategories) return cachedCategories;
    try {
      const mappings = await CategoryService.ensureCategoryMappings(config.userId);
      cachedCategories = mappings.map((mapping) => ({
        id: mapping.id,
        name: mapping.displayName,
        originalKey: mapping.originalKey,
      }));
    } catch {
      cachedCategories = [];
    }
    return cachedCategories;
  };

  const loadCreditContext = async (): Promise<CreditChatContext> => {
    const [accounts, creditTransactions, creditBills, regularTransactions] = await Promise.all([
      loadPluggyRecords<any>(config.userId, 'accounts'),
      loadPluggyRecords<any>(config.userId, 'creditCardTransactions'),
      loadPluggyRecords<any>(config.userId, 'creditCardBills'),
      loadPluggyRecords<any>(config.userId, 'transactions', {
        orderBy: [{ field: 'date', direction: 'desc' }],
      }),
    ]);

    const accountsById = new Map<string, any>();
    accounts.forEach((account) => accountsById.set(account.id, account));

    const billConstructor = new BillConstructor();
    const invoicesByAccountId = new Map<string, ComputedBill[]>();

    const creditAccounts = accounts.filter((account) => account.type === 'CREDIT');
    const txs = [...creditTransactions].sort((left, right) => {
      const leftTime = parseDate(left.date)?.getTime() || 0;
      const rightTime = parseDate(right.date)?.getTime() || 0;
      return rightTime - leftTime;
    });

    txs.forEach((tx) => {
      tx.computedBillName = '';
      tx.computedInvoiceType = 'unknown';
      tx.computedInvoiceMonthKey = null;
    });

    creditAccounts.forEach((account) => {
      const accountTransactions = txs.filter((tx) => tx.accountId === account.id);
      const accountBills = creditBills.filter((bill) => bill.accountId === account.id);
      const invoices = billConstructor.buildInvoicesPluggyFirst(account, accountBills, accountTransactions);
      invoicesByAccountId.set(account.id, invoices);

      invoices.forEach((invoice) => {
        invoice.transactions.forEach((transaction) => {
          const target = accountTransactions.find((tx) => tx.id === transaction.id);
          if (!target) return;
          target.computedBillName = invoice.name;
          target.computedInvoiceType = invoice.typeKey;
          target.computedInvoiceMonthKey = invoice.referenceMonth;
        });
      });
    });

    return {
      creditTransactions: txs,
      regularTransactions,
      accounts,
      accountsById,
      invoicesByAccountId,
    };
  };

  const loadSubscriptions = async (): Promise<{
    subscriptions: SubscriptionRecord[];
    billingsBySubId: Map<string, any[]>;
  }> => {
    const [subscriptionsSnap, billingsSnap] = await Promise.all([
      getDocs(collection(db, `users/${config.userId}/subscriptions`)),
      getDocs(collection(db, `users/${config.userId}/billings`)),
    ]);

    const subscriptions = subscriptionsSnap.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() } as any))
      .filter((subscription) => subscription.deleted !== true) as SubscriptionRecord[];

    const billingsBySubId = new Map<string, any[]>();
    billingsSnap.docs.forEach((snapshotDoc) => {
      const billing = { id: snapshotDoc.id, ...snapshotDoc.data() } as any;
      const entries = billingsBySubId.get(String(billing.subscriptionId)) || [];
      entries.push(billing);
      billingsBySubId.set(String(billing.subscriptionId), entries);
    });

    return { subscriptions, billingsBySubId };
  };

  const loadReminders = async (): Promise<{
    reminders: ReminderRecord[];
    billingsByReminderId: Map<string, any[]>;
  }> => {
    const [remindersSnap, billingsSnap] = await Promise.all([
      getDocs(collection(db, `users/${config.userId}/reminders`)),
      getDocs(collection(db, `users/${config.userId}/reminder_billings`)),
    ]);

    const reminders = remindersSnap.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() } as any))
      .filter((reminder) => reminder.deleted !== true) as ReminderRecord[];

    const billingsByReminderId = new Map<string, any[]>();
    billingsSnap.docs.forEach((snapshotDoc) => {
      const billing = { id: snapshotDoc.id, ...snapshotDoc.data() } as any;
      const entries = billingsByReminderId.get(String(billing.reminderId)) || [];
      entries.push(billing);
      billingsByReminderId.set(String(billing.reminderId), entries);
    });

    return { reminders, billingsByReminderId };
  };

  const loadSavings = async (): Promise<SavingsRecord[]> => {
    const savingsSnap = await getDocs(collection(db, `users/${config.userId}/savings`));
    return savingsSnap.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() } as any))
      .filter((item) => item.deleted !== true && item.type === 'custom') as SavingsRecord[];
  };

  const loadAssets = async (): Promise<AssetRecord[]> => {
    const assetsSnap = await getDocs(collection(db, `users/${config.userId}/assets`));
    return assetsSnap.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() } as any))
      .filter((item) => item.deleted !== true) as AssetRecord[];
  };

  const loadCheckingAccounts = async (): Promise<any[]> => {
    const snap = await getDocs(collection(db, `users/${config.userId}/accounts`));
    return snap.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() } as any))
      .filter((acc) => acc.type === 'CHECKING' || acc.type === 'SAVINGS');
  };

  const buildTotalizationResponse = async (): Promise<string> => {
    const [accounts, assets] = await Promise.all([loadCheckingAccounts(), loadAssets()]);

    const accountBalance = accounts.reduce((sum, acc) => sum + Number(acc.balance || 0), 0);
    const patrimonyTotal = assets.reduce((sum, a) => sum + Number(a.value || 0), 0);
    const grandTotal = accountBalance + patrimonyTotal;

    const accountLines = accounts.length
      ? accounts.map((acc) => `• ${escapeHtml(acc.name || acc.institution?.name || 'Conta')}: R$ ${formatCurrency(Number(acc.balance || 0))}`).join('\n')
      : null;

    const assetLines = assets.length
      ? `R$ ${formatCurrency(patrimonyTotal)} em ${assets.length} ${assets.length === 1 ? 'bem' : 'bens'}`
      : null;

    const rows = [
      accounts.length
        ? `<div class="coin-chat-item"><div class="coin-chat-item-top"><div class="coin-chat-item-title">Saldo em contas</div><div class="coin-chat-item-amount is-positive">R$ ${formatCurrency(accountBalance)}</div></div>${accountLines ? `<div class="coin-chat-meta" style="font-size:11px;color:var(--color-text-secondary);flex-direction:column;gap:2px">${accounts.map((acc) => `<span>${escapeHtml(acc.name || acc.institution?.name || 'Conta')}: R$ ${formatCurrency(Number(acc.balance || 0))}</span>`).join('')}</div>` : ''}</div>`
        : `<div class="coin-chat-item"><div class="coin-chat-item-top"><div class="coin-chat-item-title">Saldo em contas</div><div class="coin-chat-item-amount" style="color:var(--color-text-secondary)">—</div></div><div class="coin-chat-meta"><span style="font-size:11px;color:var(--color-text-secondary)">Nenhuma conta conectada</span></div></div>`,
      assets.length
        ? `<div class="coin-chat-item"><div class="coin-chat-item-top"><div class="coin-chat-item-title">Patrimônio</div><div class="coin-chat-item-amount is-positive">R$ ${formatCurrency(patrimonyTotal)}</div></div><div class="coin-chat-meta"><span style="font-size:11px;color:var(--color-text-secondary)">${assets.length} ${assets.length === 1 ? 'bem cadastrado' : 'bens cadastrados'}</span></div></div>`
        : `<div class="coin-chat-item"><div class="coin-chat-item-top"><div class="coin-chat-item-title">Patrimônio</div><div class="coin-chat-item-amount" style="color:var(--color-text-secondary)">—</div></div><div class="coin-chat-meta"><span style="font-size:11px;color:var(--color-text-secondary)">Nenhum bem cadastrado</span></div></div>`,
      `<div class="coin-chat-item" style="border-bottom:none"><div class="coin-chat-item-top"><div class="coin-chat-item-title" style="font-weight:700">Total geral</div><div class="coin-chat-item-amount is-positive" style="font-size:15px">R$ ${formatCurrency(grandTotal)}</div></div></div>`,
    ].join('');

    const hasAnything = accounts.length || assets.length;
    const intro = hasAnything
      ? `Aqui esta o resumo do seu patrimônio total:`
      : `Voce ainda nao tem contas conectadas nem bens cadastrados.`;

    return renderIntro(intro) + renderCard('Resumo patrimonial', `Saldo + bens`, `<div class="coin-chat-list">${rows}</div>`);
  };

  const assetTypeLabel = (assetType: string): string => {
    const labels: Record<string, string> = {
      imovel: 'Imoveis',
      veiculo: 'Veiculos',
      investimento: 'Investimentos',
      outros: 'Outros bens',
    };
    return labels[assetType] || assetType;
  };

  const buildMonthChangedResponse = (monthKey: string): string =>
    renderCard(
      'Contexto atualizado',
      `Agora estou operando em ${formatMonthLabel(monthKey)}.`,
      `<div class="coin-chat-inline">Use o seletor acima ou me peça para listar transacoes, assinaturas, lembretes, caixinhas ou patrimônio.</div>`,
      [
        { label: 'Transacoes', action: 'show-transactions' },
        { label: 'Assinaturas', action: 'show-subscriptions' },
        { label: 'Lembretes', action: 'show-reminders' },
        { label: 'Caixinhas', action: 'show-savings' },
        { label: 'Patrimônio', action: 'show-assets' },
      ],
    );

  const renderIntro = (text: string): string => `<p style="margin:0 0 10px;font-size:13.5px;line-height:1.6;color:var(--color-text)">${escapeHtml(text)}</p>`;

  const buildEmptyResponse = (title: string, description: string, buttons: InlineButton[] = []): string =>
    renderCard(title, 'Nada para mostrar agora.', `<div class="coin-chat-empty">${escapeHtml(description)}</div>`, buttons);

  const buildTransactionsResponse = async (monthKey: string): Promise<string> => {
    const context = await loadCreditContext();

    const cardTransactions = context.creditTransactions.filter((transaction) => {
      const invoiceMonthKey = getCreditTransactionMonthKey(transaction, context.invoicesByAccountId.get(transaction.accountId) || []);
      return invoiceMonthKey === monthKey;
    });

    const regularTransactions = context.regularTransactions.filter((transaction) => {
      if (!shouldShowTransactionInMovements(transaction, context.accountsById)) return false;
      return getComparableMonthKeyFromDate(transaction.date) === monthKey;
    });

    if (!cardTransactions.length && !regularTransactions.length) {
      return buildEmptyResponse(
        `Transacoes de ${formatMonthLabel(monthKey)}`,
        'Nao encontrei transacoes ou movimentacoes nesse mes.',
        [
          { label: 'Mes anterior', action: 'set-month-prev' },
          { label: 'Proximo mes', action: 'set-month-next' },
        ],
      );
    }

    const renderRegularRow = (transaction: RegularTransactionRecord): string => {
      const amount = Number(transaction.amount || 0);
      const isIncome = transaction.type === 'CREDIT';
      const account = context.accountsById.get(transaction.accountId);
      return `
        <div class="coin-chat-item">
          <div class="coin-chat-item-top">
            <div class="coin-chat-item-title">${escapeHtml(transaction.description || 'Movimentacao')}</div>
            <div class="coin-chat-item-amount ${isIncome ? 'is-positive' : 'is-negative'}">${isIncome ? '+' : '-'} R$ ${formatCurrency(Math.abs(amount))}</div>
          </div>
          <div class="coin-chat-meta">
            ${renderChip('Conta corrente')}
            ${renderChip(account?.name || 'Conta')}
            ${renderChip(formatShortDate(transaction.date))}
          </div>
        </div>
      `;
    };

    const renderCardRow = (transaction: CreditTransactionRecord): string => {
      const amount = Number(transaction.amount || 0);
      const isRefund = transaction.isRefund === true;
      const account = context.accountsById.get(transaction.accountId);
      const invoiceMonth = getCreditTransactionMonthKey(transaction, context.invoicesByAccountId.get(transaction.accountId) || []) || monthKey;
      return `
        <div class="coin-chat-item">
          <div class="coin-chat-item-top">
            <div class="coin-chat-item-title">${escapeHtml(transaction.description || 'Transacao do cartao')}</div>
            <div class="coin-chat-item-amount ${isRefund ? 'is-positive' : 'is-negative'}">${isRefund ? '+' : '-'} R$ ${formatCurrency(Math.abs(amount))}</div>
          </div>
          <div class="coin-chat-meta">
            ${renderChip('Cartao')}
            ${renderChip(getCardAccountDisplayName(account))}
            ${renderChip(formatMonthLabel(invoiceMonth))}
            ${renderChip(formatShortDate(transaction.date))}
            ${transaction.isRefund ? renderChip('Reembolso') : ''}
          </div>
          <div class="coin-chat-actions">
            ${
              transaction.isRefund
                ? `<button class="coin-chat-action-btn" data-chat-action="delete-refund" data-id="${escapeHtml(transaction.id)}">Excluir reembolso</button>`
                : `
                    <button class="coin-chat-action-btn" data-chat-action="move-credit-transaction" data-id="${escapeHtml(transaction.id)}">Mover</button>
                    <button class="coin-chat-action-btn" data-chat-action="refund-credit-transaction" data-id="${escapeHtml(transaction.id)}">Reembolsar</button>
                  `
            }
          </div>
        </div>
      `;
    };

    const body = `
      ${
        cardTransactions.length
          ? `
              <div class="coin-chat-section">
                <div class="coin-chat-section-title">Cartoes de credito</div>
                <div class="coin-chat-list">
                  ${cardTransactions.slice(0, 8).map(renderCardRow).join('')}
                </div>
                ${cardTransactions.length > 8 ? `<div class="coin-chat-footnote">Mostrando 8 de ${cardTransactions.length} transacoes do cartao.</div>` : ''}
              </div>
            `
          : ''
      }
      ${
        regularTransactions.length
          ? `
              <div class="coin-chat-section">
                <div class="coin-chat-section-title">Contas correntes</div>
                <div class="coin-chat-list">
                  ${regularTransactions.slice(0, 6).map(renderRegularRow).join('')}
                </div>
                ${regularTransactions.length > 6 ? `<div class="coin-chat-footnote">Mostrando 6 de ${regularTransactions.length} movimentacoes.</div>` : ''}
              </div>
            `
          : ''
      }
    `;

    return renderIntro(`Aqui estao as transacoes de ${formatMonthLabel(monthKey)}:`) + renderCard(
      `Transacoes de ${formatMonthLabel(monthKey)}`,
      `${cardTransactions.length} do cartao e ${regularTransactions.length} de conta corrente.`,
      body,
      [
        { label: 'Mes anterior', action: 'set-month-prev' },
        { label: 'Proximo mes', action: 'set-month-next' },
      ],
    );
  };

  const buildSubscriptionsResponse = async (monthKey: string): Promise<string> => {
    const { subscriptions, billingsBySubId } = await loadSubscriptions();
    const items = subscriptions.filter((subscription) => {
      const createdMonth = subscription.createdAt?.toDate
        ? toMonthKey(subscription.createdAt.toDate())
        : subscription.createdAt
          ? toMonthKey(new Date(subscription.createdAt))
          : monthKey;

      if (monthKey < createdMonth) return false;
      if (subscription.frequency === 'yearly') {
        return createdMonth.slice(5, 7) === monthKey.slice(5, 7);
      }
      return true;
    });

    if (!items.length) {
      return renderIntro(`Nao encontrei assinaturas ativas em ${formatMonthLabel(monthKey)}.`) + buildEmptyResponse(
        `Assinaturas em ${formatMonthLabel(monthKey)}`,
        'Nao encontrei assinaturas ativas para esse mes.',
        [{ label: 'Criar assinatura', action: 'create-subscription' }],
      );
    }

    const body = items
      .map((subscription) => {
        const billing = (billingsBySubId.get(subscription.id) || []).find((entry) => entry.month === monthKey);
        const isPaid =
          billing?.status === 'paid' ||
          subscription.status === 'paid' ||
          subscription.paid === true ||
          (Array.isArray(subscription.paidMonths) && subscription.paidMonths.includes(monthKey));

        return `
          <div class="coin-chat-item">
            <div class="coin-chat-item-top">
              <div class="coin-chat-item-title">${escapeHtml(subscription.name || subscription.title || 'Assinatura')}</div>
              <div class="coin-chat-item-amount is-negative">R$ ${formatCurrency(Number(subscription.value ?? subscription.amount ?? 0) || 0)}</div>
            </div>
            <div class="coin-chat-meta">
              ${renderChip(subscription.frequency === 'yearly' ? 'Anual' : subscription.frequency === 'weekly' ? 'Semanal' : 'Mensal')}
              ${renderChip(isPaid ? 'Pago' : 'Em aberto')}
            </div>
            <div class="coin-chat-actions">
              <button class="coin-chat-action-btn" data-chat-action="toggle-subscription-paid" data-id="${escapeHtml(subscription.id)}">${isPaid ? 'Desmarcar' : 'Marcar pago'}</button>
              <button class="coin-chat-action-btn" data-chat-action="edit-subscription" data-id="${escapeHtml(subscription.id)}">Editar</button>
              <button class="coin-chat-action-btn" data-chat-action="delete-subscription" data-id="${escapeHtml(subscription.id)}" data-variant="danger">Excluir</button>
            </div>
          </div>
        `;
      })
      .join('');

    return renderIntro(`Encontrei ${items.length} assinatura${items.length === 1 ? '' : 's'} em ${formatMonthLabel(monthKey)}:`) + renderCard(
      `Assinaturas em ${formatMonthLabel(monthKey)}`,
      `${items.length} assinaturas encontradas.`,
      `<div class="coin-chat-list">${body}</div>`,
      [{ label: 'Nova assinatura', action: 'create-subscription' }],
    );
  };

  const buildRemindersResponse = async (monthKey: string): Promise<string> => {
    const { reminders, billingsByReminderId } = await loadReminders();

    const items = reminders.filter((reminder) => {
      if (reminder.dueDate) {
        const dueMonthKey = String(reminder.dueDate).slice(0, 7);
        if (reminder.frequency === 'yearly') {
          return String(reminder.dueDate).slice(5, 7) === monthKey.slice(5, 7);
        }
        if (reminder.frequency === 'once') {
          if (dueMonthKey === monthKey) return true;
          const isDocPaid =
            reminder.status === 'paid' ||
            reminder.paid === true ||
            (Array.isArray(reminder.paidMonths) && reminder.paidMonths.includes(dueMonthKey));
          return dueMonthKey < monthKey && !isDocPaid;
        }
        return monthKey >= dueMonthKey;
      }
      return true;
    });

    if (!items.length) {
      return renderIntro(`Nao encontrei lembretes para ${formatMonthLabel(monthKey)}.`) + buildEmptyResponse(
        `Lembretes em ${formatMonthLabel(monthKey)}`,
        'Nao encontrei lembretes para esse mes.',
        [{ label: 'Criar lembrete', action: 'create-reminder' }],
      );
    }

    const body = items
      .map((reminder) => {
        const billing = (billingsByReminderId.get(reminder.id) || []).find((entry) => entry.month === monthKey);
        const isPaid =
          billing?.status === 'paid' ||
          reminder.status === 'paid' ||
          reminder.paid === true ||
          (Array.isArray(reminder.paidMonths) && reminder.paidMonths.includes(monthKey));

        const amount = Number(reminder.value ?? reminder.amount ?? 0) || 0;
        const isIncome = reminder.type === 'income';
        return `
          <div class="coin-chat-item">
            <div class="coin-chat-item-top">
              <div class="coin-chat-item-title">${escapeHtml(reminder.name || reminder.title || 'Lembrete')}</div>
              <div class="coin-chat-item-amount ${isIncome ? 'is-positive' : 'is-negative'}">${isIncome ? '+' : '-'} R$ ${formatCurrency(amount)}</div>
            </div>
            <div class="coin-chat-meta">
              ${renderChip(reminder.frequency === 'once' ? 'Unica' : reminder.frequency === 'yearly' ? 'Anual' : reminder.frequency === 'weekly' ? 'Semanal' : 'Mensal')}
              ${renderChip(isIncome ? 'Receita' : 'Despesa')}
              ${renderChip(isPaid ? 'Pago' : 'Em aberto')}
              ${reminder.dueDate ? renderChip(formatShortDate(reminder.dueDate)) : ''}
            </div>
            <div class="coin-chat-actions">
              <button class="coin-chat-action-btn" data-chat-action="toggle-reminder-paid" data-id="${escapeHtml(reminder.id)}">${isPaid ? 'Desmarcar' : 'Marcar pago'}</button>
              <button class="coin-chat-action-btn" data-chat-action="edit-reminder" data-id="${escapeHtml(reminder.id)}">Editar</button>
              <button class="coin-chat-action-btn" data-chat-action="delete-reminder" data-id="${escapeHtml(reminder.id)}" data-variant="danger">Excluir</button>
            </div>
          </div>
        `;
      })
      .join('');

    return renderIntro(`Aqui estao os lembretes de ${formatMonthLabel(monthKey)}:`) + renderCard(
      `Lembretes em ${formatMonthLabel(monthKey)}`,
      `${items.length} lembretes encontrados.`,
      `<div class="coin-chat-list">${body}</div>`,
      [{ label: 'Novo lembrete', action: 'create-reminder' }],
    );
  };

  const buildSavingsResponse = async (): Promise<string> => {
    const savings = await loadSavings();
    if (!savings.length) {
      return renderIntro('Voce ainda nao tem nenhuma caixinha criada.') + buildEmptyResponse('Caixinhas', 'Voce ainda nao criou nenhuma caixinha.', [
        { label: 'Criar caixinha', action: 'create-savings' },
      ]);
    }

    const body = savings
      .map((savingsItem) => {
        const currentBalance = Number(savingsItem.currentBalance || 0);
        const target = Number(savingsItem.target || 0);
        const progress = target > 0 ? Math.min(100, Math.round((currentBalance / target) * 100)) : 0;
        return `
          <div class="coin-chat-item">
            <div class="coin-chat-item-top">
              <div class="coin-chat-item-title">${escapeHtml(savingsItem.name || 'Caixinha')}</div>
              <div class="coin-chat-item-amount is-positive">R$ ${formatCurrency(currentBalance)}</div>
            </div>
            <div class="coin-chat-meta">
              ${target > 0 ? renderChip(`Meta R$ ${formatCurrency(target)}`) : ''}
              ${renderChip(`${progress}%`)}
              ${savingsItem.deadline ? renderChip(formatShortDate(savingsItem.deadline)) : ''}
            </div>
            <div class="coin-chat-actions">
              <button class="coin-chat-action-btn" data-chat-action="move-savings" data-id="${escapeHtml(savingsItem.id)}">Movimentar</button>
              <button class="coin-chat-action-btn" data-chat-action="edit-savings" data-id="${escapeHtml(savingsItem.id)}">Editar</button>
              <button class="coin-chat-action-btn" data-chat-action="delete-savings" data-id="${escapeHtml(savingsItem.id)}" data-variant="danger">Excluir</button>
            </div>
          </div>
        `;
      })
      .join('');

    return renderIntro(`Voce tem ${savings.length} caixinha${savings.length === 1 ? '' : 's'} cadastrada${savings.length === 1 ? '' : 's'}:`) + renderCard(
      'Caixinhas',
      `${savings.length} reservas personalizadas encontradas.`,
      `<div class="coin-chat-list">${body}</div>`,
      [{ label: 'Nova caixinha', action: 'create-savings' }],
    );
  };

  const buildAssetsResponse = async (): Promise<string> => {
    const assets = await loadAssets();
    if (!assets.length) {
      return renderIntro('Voce ainda nao tem nenhum bem cadastrado no patrimônio.') + buildEmptyResponse('Patrimônio', 'Nenhum bem cadastrado ainda.');
    }

    const total = assets.reduce((sum, a) => sum + Number(a.value || 0), 0);

    const groups: Record<string, AssetRecord[]> = {};
    for (const asset of assets) {
      const key = asset.assetType || 'outros';
      if (!groups[key]) groups[key] = [];
      groups[key].push(asset);
    }

    const typeOrder = ['imovel', 'veiculo', 'investimento', 'outros'];
    const body = typeOrder
      .filter((type) => groups[type]?.length)
      .map((type) => {
        const rows = groups[type].map((asset) => {
          const chips: string[] = [];
          if (asset.assetType === 'veiculo' && (asset.modeloNome || asset.anoNome)) {
            chips.push(renderChip([asset.modeloNome, asset.anoNome].filter(Boolean).join(' ')));
          } else if (asset.assetType === 'imovel' && asset.tipoImovel) {
            chips.push(renderChip(asset.tipoImovel));
          } else if (asset.assetType === 'investimento' && asset.tipoInvestimento) {
            chips.push(renderChip(asset.tipoInvestimento));
          } else if (asset.assetType === 'outros' && asset.categoria) {
            chips.push(renderChip(asset.categoria));
          }
          return `
            <div class="coin-chat-item">
              <div class="coin-chat-item-top">
                <div class="coin-chat-item-title">${escapeHtml(asset.name || 'Bem')}</div>
                <div class="coin-chat-item-amount is-positive">R$ ${formatCurrency(Number(asset.value || 0))}</div>
              </div>
              ${chips.length ? `<div class="coin-chat-meta">${chips.join('')}</div>` : ''}
              <div class="coin-chat-actions">
                <button class="coin-chat-action-btn" data-chat-action="edit-asset-value" data-id="${escapeHtml(asset.id)}">Atualizar valor</button>
                <button class="coin-chat-action-btn" data-chat-action="delete-asset" data-id="${escapeHtml(asset.id)}" data-variant="danger">Excluir</button>
              </div>
            </div>
          `;
        }).join('');
        return `
          <div class="coin-chat-section">
            <div class="coin-chat-section-title">${assetTypeLabel(type)}</div>
            <div class="coin-chat-list">${rows}</div>
          </div>
        `;
      }).join('');

    return renderIntro(`Aqui esta o seu patrimônio cadastrado, totalizando R$ ${formatCurrency(total)}:`) + renderCard(
      'Patrimônio',
      `${assets.length} ${assets.length === 1 ? 'bem cadastrado' : 'bens cadastrados'} · Total R$ ${formatCurrency(total)}`,
      body,
    );
  };

  const findReminderById = async (id: string): Promise<ReminderRecord | null> => {
    const { reminders } = await loadReminders();
    return reminders.find((reminder) => reminder.id === id) || null;
  };

  const findSubscriptionById = async (id: string): Promise<SubscriptionRecord | null> => {
    const { subscriptions } = await loadSubscriptions();
    return subscriptions.find((subscription) => subscription.id === id) || null;
  };

  const findSavingsById = async (id: string): Promise<SavingsRecord | null> => {
    const savings = await loadSavings();
    return savings.find((item) => item.id === id) || null;
  };

  const findAssetById = async (id: string): Promise<AssetRecord | null> => {
    const assets = await loadAssets();
    return assets.find((item) => item.id === id) || null;
  };

  const openEditAssetValueModal = (asset: AssetRecord): void => {
    Modal({
      title: 'Atualizar valor',
      maxWidth: 'max-w-md',
      content: `
        <div class="space-y-4">
          <div class="coin-chat-inline">${escapeHtml(asset.name || 'Bem')}</div>
          ${Input({
            id: 'chat-asset-value',
            label: 'Valor atual (R$)',
            type: 'text',
            placeholder: 'Ex: 250.000,00',
            value: formatCurrency(Number(asset.value || 0)),
            required: true,
          })}
        </div>
      `,
      confirmText: 'Salvar',
      showCancel: false,
      onConfirm: async (formData: Record<string, FormDataEntryValue>) => {
        const value = Number(String(formData['chat-asset-value'] || '').replace(/\./g, '').replace(',', '.'));
        if (!Number.isFinite(value) || value <= 0) {
          toaster.create({ title: 'Erro', description: 'Informe um valor valido.', type: 'error' });
          throw new Error('PREVENT_CLOSE');
        }
        await updateDoc(doc(db, `users/${config.userId}/assets`, asset.id), {
          value,
          updatedAt: Timestamp.now(),
        });
        await config.pushAssistantMessage(
          renderCard(
            'Valor atualizado',
            String(asset.name || 'Bem'),
            `<div class="coin-chat-inline">Novo valor: R$ ${formatCurrency(value)}.</div>`,
            [{ label: 'Ver patrimônio', action: 'show-assets' }],
          ),
        );
      },
    });
  };

  const findCreditTransactionById = async (id: string): Promise<{
    transaction: CreditTransactionRecord | null;
    context: CreditChatContext;
  }> => {
    const context = await loadCreditContext();
    const transaction = context.creditTransactions.find((item) => item.id === id) || null;
    return { transaction, context };
  };

  const extractReminderPrefill = (text: string): Record<string, string> => {
    const norm = normalizeText(text);
    const prefill: Record<string, string> = {};

    // Frequência
    if (norm.includes('mensal') || norm.includes('todo mes') || norm.includes('todos os meses')) prefill.frequency = 'monthly';
    else if (norm.includes('semanal') || norm.includes('toda semana')) prefill.frequency = 'weekly';
    else if (norm.includes('anual') || norm.includes('todo ano') || norm.includes('por ano')) prefill.frequency = 'yearly';
    else if (norm.includes('unica vez') || norm.includes('uma vez') || norm.includes('so uma')) prefill.frequency = 'once';

    // Tipo
    if (norm.includes('receita') || norm.includes('salario') || norm.includes('receber') || norm.includes('cobrar') || norm.includes('cobranca') || norm.includes('entrada')) {
      prefill.type = 'income';
    } else {
      prefill.type = 'expense';
    }

    // Valor — suporta: "R$ 12", "12 reais", "os 12", "12,00", "os R$ 12,00"
    const valueMatch = norm.match(/r\$\s*([\d]+(?:[.,][\d]{1,2})?)|\bos\s+([\d]+(?:[.,][\d]{1,2})?)|\b([\d]+(?:[.,][\d]{1,2})?)\s*reais/);
    if (valueMatch) {
      const raw = (valueMatch[1] || valueMatch[2] || valueMatch[3]).replace(',', '.');
      prefill.value = raw;
    }

    // Nome: extrai de vários padrões de linguagem natural
    const namePatterns = [
      /lembrete\s+(?:de|para|do|da|sobre)?\s*(.+)/,
      /cobrar\s+(?:o|a|os|as)?\s*(.+?)(?:\s+tambem)?$/,
      /receber\s+(?:o|a|os|as)?\s*(?:r\$\s*[\d.,]+\s*)?(?:do|da|de)\s*(.+)/,
      /acompanhar\s+(.+)/,
      /monitorar\s+(.+)/,
    ];
    for (const pattern of namePatterns) {
      const match = norm.match(pattern);
      if (match) {
        // Limpa artigos e preposições iniciais
        let name = match[1]
          .replace(/^(o|a|os|as|um|uma|de|do|da|dos|das|para|com|no|na)\s+/g, '')
          .replace(/\s+(o|a|os|as|de|do|da)\s+/g, ' ')
          .trim();
        // Remove "sim" e outras confirmações
        name = name.replace(/^(sim|nao|ok|claro|pode)\s*/i, '').trim();
        if (name.length >= 3) {
          prefill.name = name.charAt(0).toUpperCase() + name.slice(1);
          break;
        }
      }
    }

    return prefill;
  };

  const handleCreateReminder = async (promptPrefill?: Record<string, string>): Promise<string> => {
    const categories = await loadCategories();

    // Prefill da IA tem prioridade máxima; depois o extraído do texto; depois vazio
    const aiPrefill = config.getPendingActionPrefill?.() ?? null;
    const prefill = aiPrefill
      ? { ...promptPrefill, ...aiPrefill } // IA sobrescreve extração local
      : promptPrefill;

    // Tenta mapear categoryKeyword para um ID real de categoria do usuário
    if (prefill?.categoryKeyword && categories.length > 0) {
      const keyword = normalizeText(prefill.categoryKeyword);
      const match = categories.find(
        (c: UserCategory) =>
          normalizeText(c.name).includes(keyword) ||
          keyword.includes(normalizeText(c.name)) ||
          normalizeText(c.id || '').includes(keyword),
      );
      if (match) prefill.category = match.id;
      delete prefill.categoryKeyword;
    }

    openReminderModal({
      userId: config.userId,
      prefill,
      userCategories: categories,
      onSaved: async () => {
        await config.pushAssistantMessage(
          renderCard(
            'Lembrete salvo',
            'O formulario foi concluido com sucesso.',
            '<div class="coin-chat-inline">Se quiser, posso listar os lembretes do mes atual para voce revisar.</div>',
            [{ label: 'Ver lembretes', action: 'show-reminders' }],
          ),
        );
      },
    });

    const prefilledName = prefill?.name ? `"${prefill.name}"` : null;
    const subtitle = prefilledName ? `Preenchi os dados com base na nossa conversa.` : 'Preencha os dados e confirme para salvar o lembrete.';

    return renderCard(
      'Criando lembrete',
      prefilledName ? `Abri o formulario com os dados ja preenchidos para ${prefilledName}.` : 'Abri o formulario direto no chat.',
      `<div class="coin-chat-inline">${subtitle}</div>`,
    );
  };

  const handleCreateSubscription = async (promptPrefill?: Record<string, string>): Promise<string> => {
    const categories = await loadCategories();

    // Prefill da IA tem prioridade
    const aiPrefill = config.getPendingActionPrefill?.() ?? null;
    const prefill = aiPrefill ? { ...promptPrefill, ...aiPrefill } : promptPrefill;

    // Mapeia categoryKeyword → ID real
    if (prefill?.categoryKeyword && categories.length > 0) {
      const keyword = normalizeText(prefill.categoryKeyword);
      const match = categories.find(
        (c: UserCategory) =>
          normalizeText(c.name).includes(keyword) ||
          keyword.includes(normalizeText(c.name)),
      );
      if (match) prefill.category = match.id;
      delete prefill.categoryKeyword;
    }

    openSubscriptionModal({
      userId: config.userId,
      prefill,
      userCategories: categories,
      onSaved: async () => {
        await config.pushAssistantMessage(
          renderCard(
            'Assinatura salva',
            'A assinatura foi criada ou atualizada.',
            '<div class="coin-chat-inline">Posso listar as assinaturas do mes para voce revisar agora.</div>',
            [{ label: 'Ver assinaturas', action: 'show-subscriptions' }],
          ),
        );
      },
    });

    const prefilledName = prefill?.name ? `"${prefill.name}"` : null;
    return renderCard(
      'Criando assinatura',
      prefilledName ? `Abri o formulario com os dados ja preenchidos para ${prefilledName}.` : 'Abri o formulario direto no chat.',
      `<div class="coin-chat-inline">${prefilledName ? 'Confira os dados e confirme para salvar.' : 'Preencha os dados e confirme para salvar a assinatura.'}</div>`,
    );
  };

  const openSavingsModal = (editingSavings?: SavingsRecord | null): void => {
    const isEditing = Boolean(editingSavings);
    Modal({
      title: isEditing ? 'Editar Caixinha' : 'Criar Nova Caixinha',
      maxWidth: 'max-w-md',
      content: `
        <div class="space-y-4">
          ${Input({
            id: 'chat-savings-name',
            label: 'Nome da Caixinha',
            type: 'text',
            placeholder: 'Ex: Ferias 2026',
            value: isEditing ? String(editingSavings?.name || '') : '',
            required: true,
          })}
          ${Input({
            id: 'chat-savings-target',
            label: 'Meta (R$)',
            type: 'text',
            placeholder: 'Ex: 5.000,00',
            value: isEditing ? formatCurrency(Number(editingSavings?.target || 0)) : '',
            required: true,
          })}
          ${Input({
            id: 'chat-savings-deadline',
            label: 'Prazo',
            type: 'date',
            value: editingSavings?.deadline ? parseDate(editingSavings.deadline)?.toISOString().split('T')[0] || '' : '',
            required: true,
          })}
        </div>
      `,
      confirmText: isEditing ? 'Salvar' : 'Criar',
      showCancel: false,
      onConfirm: async (formData: Record<string, FormDataEntryValue>) => {
        const name = String(formData['chat-savings-name'] || '').trim();
        const target = Number(String(formData['chat-savings-target'] || '').replace(/\./g, '').replace(',', '.'));
        const deadline = String(formData['chat-savings-deadline'] || '').trim();

        if (!name || !Number.isFinite(target) || target <= 0 || !deadline) {
          toaster.create({ title: 'Aviso', description: 'Preencha os campos corretamente.', type: 'error' });
          throw new Error('PREVENT_CLOSE');
        }

        if (isEditing && editingSavings) {
          await updateDoc(doc(db, `users/${config.userId}/savings`, editingSavings.id), {
            name,
            target,
            deadline: new Date(deadline),
            updatedAt: Timestamp.now(),
          });
        } else {
          await addDoc(collection(db, `users/${config.userId}/savings`), {
            name,
            target,
            deadline: new Date(deadline),
            currentBalance: 0,
            createdAt: Timestamp.now(),
            type: 'custom',
          });
        }

        await config.pushAssistantMessage(
          renderCard(
            isEditing ? 'Caixinha atualizada' : 'Caixinha criada',
            name,
            `<div class="coin-chat-inline">Meta configurada em R$ ${formatCurrency(target)}.</div>`,
            [{ label: 'Ver caixinhas', action: 'show-savings' }],
          ),
        );
      },
    });
  };

  const openSavingsMoveModal = (savingsItem: SavingsRecord): void => {
    Modal({
      title: `Movimentar - ${String(savingsItem.name || 'Caixinha')}`,
      maxWidth: 'max-w-md',
      content: `
        <div class="space-y-4">
          ${Select({
            id: 'chat-savings-move-type',
            label: 'Tipo',
            options: [
              { value: 'receita', label: 'Deposito' },
              { value: 'despesa', label: 'Retirada' },
            ],
            value: 'receita',
          })}
          ${Input({
            id: 'chat-savings-move-value',
            label: 'Valor',
            type: 'text',
            placeholder: 'Ex: 1.000,00',
            required: true,
          })}
          ${Input({
            id: 'chat-savings-move-description',
            label: 'Descricao',
            type: 'text',
            placeholder: 'Ex: Aporte mensal',
            required: false,
          })}
        </div>
      `,
      confirmText: 'Confirmar',
      showCancel: false,
      onConfirm: async (formData: Record<string, FormDataEntryValue>) => {
        const moveType = String(formData['chat-savings-move-type'] || 'receita');
        const value = Number(String(formData['chat-savings-move-value'] || '').replace(/\./g, '').replace(',', '.'));
        const description = String(formData['chat-savings-move-description'] || '').trim();

        if (!Number.isFinite(value) || value <= 0) {
          toaster.create({ title: 'Erro', description: 'Informe um valor valido.', type: 'error' });
          throw new Error('PREVENT_CLOSE');
        }

        const currentBalance = Number(savingsItem.currentBalance || 0);
        const newBalance = moveType === 'receita' ? currentBalance + value : currentBalance - value;

        if (newBalance < 0) {
          toaster.create({ title: 'Erro', description: 'Saldo insuficiente.', type: 'error' });
          throw new Error('PREVENT_CLOSE');
        }

        await addDoc(collection(db, 'users', config.userId, 'caixinhas', savingsItem.id, 'movements'), {
          type: moveType,
          value,
          description,
          date: Timestamp.now(),
          newBalance,
        });

        await updateDoc(doc(db, 'users', config.userId, 'savings', savingsItem.id), {
          currentBalance: newBalance,
          updatedAt: Timestamp.now(),
        });

        await config.pushAssistantMessage(
          renderCard(
            moveType === 'receita' ? 'Deposito registrado' : 'Retirada registrada',
            String(savingsItem.name || 'Caixinha'),
            `<div class="coin-chat-inline">Novo saldo: R$ ${formatCurrency(newBalance)}.</div>`,
            [{ label: 'Ver caixinhas', action: 'show-savings' }],
          ),
        );
      },
    });

    attachSelectListeners('chat-savings-move-type');
  };

  const openTransactionMoveModal = async (transaction: CreditTransactionRecord, context: CreditChatContext): Promise<void> => {
    const currentInvoiceMonth =
      getCreditTransactionMonthKey(transaction, context.invoicesByAccountId.get(transaction.accountId) || []) ||
      config.getCurrentMonthKey();
    const options = generateInvoiceOptions(currentInvoiceMonth, 2, 4);

    Modal({
      title: 'Mover transacao',
      maxWidth: 'max-w-md',
      content: `
        <div class="space-y-4">
          <div class="coin-chat-inline">${escapeHtml(transaction.description || 'Transacao do cartao')}</div>
          ${Select({
            id: 'chat-transaction-target-month',
            label: 'Fatura de destino',
            value: currentInvoiceMonth,
            options: options.map((option) => ({ value: option.monthKey, label: option.label })),
          })}
        </div>
      `,
      confirmText: 'Mover',
      showCancel: false,
      onConfirm: async (formData: Record<string, FormDataEntryValue>) => {
        const targetMonthKey = String(formData['chat-transaction-target-month'] || '');
        const result = await moveTransactionToInvoice({
          userId: config.userId,
          transactionId: transaction.id,
          targetMonthKey,
          sourceMonthKey: currentInvoiceMonth,
          collectionHint: 'creditCardTransactions',
          transactionData: transaction,
        });

        if (!result.success) {
          toaster.create({ title: 'Erro', description: result.error || 'Nao foi possivel mover a transacao.', type: 'error' });
          throw new Error('PREVENT_CLOSE');
        }

        await config.pushAssistantMessage(
          renderCard(
            'Transacao movida',
            String(transaction.description || 'Transacao do cartao'),
            `<div class="coin-chat-inline">A transacao foi enviada para ${formatMonthLabel(targetMonthKey)}.</div>`,
            [{ label: 'Ver transacoes', action: 'show-transactions' }],
          ),
        );
      },
    });

    attachSelectListeners('chat-transaction-target-month');
  };

  const executeRefund = async (transaction: CreditTransactionRecord, refundAmount: number): Promise<void> => {
    const refundId = `${transaction.id}_refund_${Date.now()}`;
    const refundTransaction: any = {
      ...transaction,
      id: refundId,
      amount: -refundAmount,
      description: `Reembolso: ${transaction.description || ''}`,
      status: 'CONFIRMED',
      isRefund: true,
      originalTransactionId: transaction.id,
    };

    delete refundTransaction.computedBillName;
    delete refundTransaction.computedInvoiceType;
    delete refundTransaction.computedInvoiceMonthKey;

    await setDoc(getPluggyCanonicalDocRef(config.userId, 'creditCardTransactions', refundId), refundTransaction);
  };

  const openRefundPickerModal = (transaction: CreditTransactionRecord): void => {
    Modal({
      title: 'Reembolsar transacao',
      maxWidth: 'max-w-md',
      content: `
        <div class="space-y-3">
          <div class="coin-chat-inline">${escapeHtml(transaction.description || 'Transacao do cartao')}</div>
          <button type="button" id="chat-refund-total" class="coin-chat-modal-btn">Reembolsar valor total</button>
          <button type="button" id="chat-refund-custom" class="coin-chat-modal-btn">Escolher outro valor</button>
        </div>
      `,
      showFooter: false,
      showConfirm: false,
      showCancel: false,
    });

    setTimeout(() => {
      document.getElementById('chat-refund-total')?.addEventListener('click', async () => {
        await executeRefund(transaction, Number(transaction.amount || 0));
        await config.pushAssistantMessage(
          renderCard(
            'Reembolso registrado',
            String(transaction.description || 'Transacao do cartao'),
            `<div class="coin-chat-inline">Valor reembolsado: R$ ${formatCurrency(Math.abs(Number(transaction.amount || 0)))}.</div>`,
            [{ label: 'Ver transacoes', action: 'show-transactions' }],
          ),
        );
      });

      document.getElementById('chat-refund-custom')?.addEventListener('click', () => {
        Modal({
          title: 'Reembolso personalizado',
          maxWidth: 'max-w-md',
          content: `
            <div class="space-y-4">
              ${Input({
                id: 'chat-refund-custom-amount',
                label: 'Valor do reembolso (R$)',
                type: 'text',
                placeholder: 'Ex: 50,00',
                required: true,
              })}
            </div>
          `,
          confirmText: 'Confirmar',
          showCancel: false,
          onConfirm: async (formData: Record<string, FormDataEntryValue>) => {
            const amount = Number(String(formData['chat-refund-custom-amount'] || '').replace(/\./g, '').replace(',', '.'));
            const maxAmount = Math.abs(Number(transaction.amount || 0));
            if (!Number.isFinite(amount) || amount <= 0 || amount > maxAmount) {
              toaster.create({ title: 'Erro', description: 'Informe um valor valido para o reembolso.', type: 'error' });
              throw new Error('PREVENT_CLOSE');
            }
            await executeRefund(transaction, amount);
            await config.pushAssistantMessage(
              renderCard(
                'Reembolso registrado',
                String(transaction.description || 'Transacao do cartao'),
                `<div class="coin-chat-inline">Valor reembolsado: R$ ${formatCurrency(amount)}.</div>`,
                [{ label: 'Ver transacoes', action: 'show-transactions' }],
              ),
            );
          },
        });
      });
    }, 50);
  };

  const buildCandidateList = (title: string, subtitle: string, bodyRows: string): string =>
    renderCard(title, subtitle, `<div class="coin-chat-list">${bodyRows}</div>`);

  const handleReminderSearch = async (query: string, mode: 'edit' | 'delete'): Promise<string> => {
    const { reminders } = await loadReminders();
    const matches = rankMatches(reminders, query, ['name', 'title', 'description']);

    if (!matches.length) {
      return buildEmptyResponse('Lembrete nao encontrado', `Nao achei nenhum lembrete para "${query}".`, [
        { label: 'Ver lembretes', action: 'show-reminders' },
      ]);
    }

    if (matches.length === 1) {
      return renderCard(
        mode === 'edit' ? 'Lembrete encontrado' : 'Confirmar exclusao',
        String(matches[0].name || matches[0].title || 'Lembrete'),
        '<div class="coin-chat-inline">Encontrei um lembrete compatível com o pedido.</div>',
        [{
          label: mode === 'edit' ? 'Editar agora' : 'Excluir agora',
          action: mode === 'edit' ? 'edit-reminder' : 'delete-reminder',
          attrs: { id: matches[0].id },
          variant: mode === 'delete' ? 'danger' : undefined,
        }],
      );
    }

    return buildCandidateList(
      'Escolha o lembrete',
      `${matches.length} resultados para "${query}".`,
      matches.slice(0, 5).map((reminder) => `
        <div class="coin-chat-item">
          <div class="coin-chat-item-top">
            <div class="coin-chat-item-title">${escapeHtml(reminder.name || reminder.title || 'Lembrete')}</div>
          </div>
          <div class="coin-chat-actions">
            <button class="coin-chat-action-btn" data-chat-action="${mode === 'edit' ? 'edit-reminder' : 'delete-reminder'}" data-id="${escapeHtml(reminder.id)}" ${mode === 'delete' ? 'data-variant="danger"' : ''}>${mode === 'edit' ? 'Editar' : 'Excluir'}</button>
          </div>
        </div>
      `).join(''),
    );
  };

  const handleSubscriptionSearch = async (query: string, mode: 'edit' | 'delete'): Promise<string> => {
    const { subscriptions } = await loadSubscriptions();
    const matches = rankMatches(subscriptions, query, ['name', 'title', 'description']);

    if (!matches.length) {
      return buildEmptyResponse('Assinatura nao encontrada', `Nao achei nenhuma assinatura para "${query}".`, [
        { label: 'Ver assinaturas', action: 'show-subscriptions' },
      ]);
    }

    if (matches.length === 1) {
      return renderCard(
        mode === 'edit' ? 'Assinatura encontrada' : 'Confirmar exclusao',
        String(matches[0].name || matches[0].title || 'Assinatura'),
        '<div class="coin-chat-inline">Encontrei uma assinatura compatível com o pedido.</div>',
        [{
          label: mode === 'edit' ? 'Editar agora' : 'Excluir agora',
          action: mode === 'edit' ? 'edit-subscription' : 'delete-subscription',
          attrs: { id: matches[0].id },
          variant: mode === 'delete' ? 'danger' : undefined,
        }],
      );
    }

    return buildCandidateList(
      'Escolha a assinatura',
      `${matches.length} resultados para "${query}".`,
      matches.slice(0, 5).map((subscription) => `
        <div class="coin-chat-item">
          <div class="coin-chat-item-top">
            <div class="coin-chat-item-title">${escapeHtml(subscription.name || subscription.title || 'Assinatura')}</div>
          </div>
          <div class="coin-chat-actions">
            <button class="coin-chat-action-btn" data-chat-action="${mode === 'edit' ? 'edit-subscription' : 'delete-subscription'}" data-id="${escapeHtml(subscription.id)}" ${mode === 'delete' ? 'data-variant="danger"' : ''}>${mode === 'edit' ? 'Editar' : 'Excluir'}</button>
          </div>
        </div>
      `).join(''),
    );
  };

  const handleSavingsSearch = async (query: string, mode: 'edit' | 'delete' | 'move'): Promise<string> => {
    const savings = await loadSavings();
    const matches = rankMatches(savings, query, ['name']);

    if (!matches.length) {
      return buildEmptyResponse('Caixinha nao encontrada', `Nao achei nenhuma caixinha para "${query}".`, [
        { label: 'Ver caixinhas', action: 'show-savings' },
      ]);
    }

    if (matches.length === 1) {
      return renderCard(
        mode === 'delete' ? 'Confirmar exclusao' : 'Caixinha encontrada',
        String(matches[0].name || 'Caixinha'),
        '<div class="coin-chat-inline">Encontrei uma caixinha compatível com o pedido.</div>',
        [{
          label: mode === 'edit' ? 'Editar agora' : mode === 'delete' ? 'Excluir agora' : 'Movimentar agora',
          action: mode === 'edit' ? 'edit-savings' : mode === 'delete' ? 'delete-savings' : 'move-savings',
          attrs: { id: matches[0].id },
          variant: mode === 'delete' ? 'danger' : undefined,
        }],
      );
    }

    return buildCandidateList(
      'Escolha a caixinha',
      `${matches.length} resultados para "${query}".`,
      matches.slice(0, 5).map((savingsItem) => `
        <div class="coin-chat-item">
          <div class="coin-chat-item-top">
            <div class="coin-chat-item-title">${escapeHtml(savingsItem.name || 'Caixinha')}</div>
          </div>
          <div class="coin-chat-actions">
            <button class="coin-chat-action-btn" data-chat-action="${mode === 'edit' ? 'edit-savings' : mode === 'delete' ? 'delete-savings' : 'move-savings'}" data-id="${escapeHtml(savingsItem.id)}" ${mode === 'delete' ? 'data-variant="danger"' : ''}>${mode === 'edit' ? 'Editar' : mode === 'delete' ? 'Excluir' : 'Movimentar'}</button>
          </div>
        </div>
      `).join(''),
    );
  };

  const handleTransactionSearch = async (query: string, mode: 'move' | 'refund'): Promise<string> => {
    const context = await loadCreditContext();
    const transactions = context.creditTransactions.filter((transaction) => transaction.isRefund !== true);
    const matches = rankMatches(transactions, query, ['description']);

    if (!matches.length) {
      return buildEmptyResponse('Transacao nao encontrada', `Nao achei nenhuma transacao do cartao para "${query}".`, [
        { label: 'Ver transacoes', action: 'show-transactions' },
      ]);
    }

    if (matches.length === 1) {
      return renderCard(
        'Transacao encontrada',
        String(matches[0].description || 'Transacao do cartao'),
        '<div class="coin-chat-inline">Encontrei uma transacao compatível com o pedido.</div>',
        [{ label: mode === 'move' ? 'Mover agora' : 'Reembolsar agora', action: mode === 'move' ? 'move-credit-transaction' : 'refund-credit-transaction', attrs: { id: matches[0].id } }],
      );
    }

    return buildCandidateList(
      'Escolha a transacao',
      `${matches.length} resultados para "${query}".`,
      matches.slice(0, 6).map((transaction) => `
        <div class="coin-chat-item">
          <div class="coin-chat-item-top">
            <div class="coin-chat-item-title">${escapeHtml(transaction.description || 'Transacao do cartao')}</div>
            <div class="coin-chat-item-amount is-negative">R$ ${formatCurrency(Math.abs(Number(transaction.amount || 0)))}</div>
          </div>
          <div class="coin-chat-actions">
            <button class="coin-chat-action-btn" data-chat-action="${mode === 'move' ? 'move-credit-transaction' : 'refund-credit-transaction'}" data-id="${escapeHtml(transaction.id)}">${mode === 'move' ? 'Mover' : 'Reembolsar'}</button>
          </div>
        </div>
      `).join(''),
    );
  };

  const handlePrompt = async (prompt: string): Promise<string | null> => {
    const normalized = normalizeText(prompt);
    const currentMonthKey = config.getCurrentMonthKey();
    const explicitMonth = extractMonthReference(prompt, currentMonthKey);

    const wantsMonthChange =
      normalized.startsWith('mes ') ||
      normalized.includes('mudar para') ||
      normalized.includes('trocar para') ||
      normalized.includes('ir para') ||
      normalized.includes('voltar um mes') ||
      normalized.includes('avancar um mes') ||
      normalized.includes('proximo mes') ||
      normalized.includes('mes anterior') ||
      normalized.includes('mes passado');

    if (wantsMonthChange && explicitMonth) {
      config.setCurrentMonthKey(explicitMonth);
      return buildMonthChangedResponse(explicitMonth);
    }

    // Se a pergunta tem intenção de análise, planejamento ou conselho, deixa o AI responder
    const wantsAiAnalysis =
      normalized.includes('planejamento') ||
      normalized.includes('planejar') ||
      normalized.includes('plano') ||
      normalized.includes('analise') ||
      normalized.includes('analisar') ||
      normalized.includes('investigar') ||
      normalized.includes('investiga') ||
      normalized.includes('verifica') ||
      normalized.includes('verificar') ||
      normalized.includes('pesquisar') ||
      normalized.includes('pesquisa') ||
      normalized.includes('identificar') ||
      normalized.includes('identifica') ||
      normalized.includes('encontrar') ||
      normalized.includes('encontra') ||
      normalized.includes('me fazer') ||
      normalized.includes('me ajude') ||
      normalized.includes('me ajuda') ||
      normalized.includes('me diga') ||
      normalized.includes('me explique') ||
      normalized.includes('como posso') ||
      normalized.includes('como fazer') ||
      normalized.includes('quanto preciso') ||
      normalized.includes('quanto falta') ||
      normalized.includes('quanto tempo') ||
      normalized.includes('economizar') ||
      normalized.includes('poupar') ||
      normalized.includes('juntar') ||
      normalized.includes('consigo') ||
      normalized.includes('conseguir') ||
      normalized.includes('dica') ||
      normalized.includes('sugestao') ||
      normalized.includes('recomend') ||
      normalized.includes('vale a pena') ||
      normalized.includes('impacto') ||
      normalized.includes('impacta') ||
      normalized.includes('meta ') ||
      normalized.includes('objetivo') ||
      normalized.includes('sonho') ||
      normalized.includes('upgrade') ||
      normalized.includes('trocar minha') ||
      normalized.includes('trocar meu') ||
      normalized.includes('virar uma') ||
      normalized.includes('virar um') ||
      normalized.includes('quanto custaria') ||
      normalized.includes('diferenca') ||
      normalized.includes('comparar');

    if (wantsAiAnalysis) return null;

    // Intenção de criar lembrete — com ou sem a palavra "lembrete"
    const wantsCreateReminder =
      ((normalized.includes('criar') || normalized.includes('novo') || normalized.includes('nova') || normalized.includes('sim') || normalized.includes('quero') || normalized.includes('adicionar') || normalized.includes('cadastrar') || normalized.includes('registrar')) &&
        normalized.includes('lembrete')) ||
      // Cobrança/recebimento sem a palavra lembrete
      ((normalized.includes('cobrar') || normalized.includes('cobranca') || normalized.includes('receber') || normalized.includes('recebimento')) &&
        (normalized.includes('criar') || normalized.includes('novo') || normalized.includes('adicionar') || normalized.includes('registrar') || normalized.includes('sim') || normalized.includes('tambem')));

    if (wantsCreateReminder) {
      const prefill = extractReminderPrefill(prompt);
      // Se vier da IA com COIN_ACTION, o getPendingActionPrefill já vai preencher na hora de abrir
      return handleCreateReminder(Object.keys(prefill).length > 0 ? prefill : undefined);
    }
    if ((normalized.includes('criar') || normalized.includes('novo') || normalized.includes('nova')) && normalized.includes('assinatura')) {
      return handleCreateSubscription();
    }
    if ((normalized.includes('criar') || normalized.includes('nova')) && (normalized.includes('caixinha') || normalized.includes('reserva'))) {
      openSavingsModal(null);
      return renderCard('Criando caixinha', 'Abri o formulario direto no chat.', '<div class="coin-chat-inline">Preencha os dados da nova reserva e confirme para salvar.</div>');
    }

    const reminderEditMatch = normalized.match(/(?:editar|alterar)\s+(?:o|a)?\s*lembrete\s+(.+)/);
    if (reminderEditMatch) return handleReminderSearch(reminderEditMatch[1], 'edit');

    const reminderDeleteMatch = normalized.match(/(?:excluir|remover|apagar)\s+(?:o|a)?\s*lembrete\s+(.+)/);
    if (reminderDeleteMatch) return handleReminderSearch(reminderDeleteMatch[1], 'delete');

    const subscriptionEditMatch = normalized.match(/(?:editar|alterar)\s+(?:a|o)?\s*assinatura\s+(.+)/);
    if (subscriptionEditMatch) return handleSubscriptionSearch(subscriptionEditMatch[1], 'edit');

    const subscriptionDeleteMatch = normalized.match(/(?:excluir|remover|apagar)\s+(?:a|o)?\s*assinatura\s+(.+)/);
    if (subscriptionDeleteMatch) return handleSubscriptionSearch(subscriptionDeleteMatch[1], 'delete');

    const savingsEditMatch = normalized.match(/(?:editar|alterar)\s+(?:a|o)?\s*(?:caixinha|reserva)\s+(.+)/);
    if (savingsEditMatch) return handleSavingsSearch(savingsEditMatch[1], 'edit');

    const savingsDeleteMatch = normalized.match(/(?:excluir|remover|apagar)\s+(?:a|o)?\s*(?:caixinha|reserva)\s+(.+)/);
    if (savingsDeleteMatch) return handleSavingsSearch(savingsDeleteMatch[1], 'delete');

    const savingsMoveMatch = normalized.match(/(?:movimentar|depositar|retirar)\s+(?:a|na|da)?\s*(?:caixinha|reserva)\s+(.+)/);
    if (savingsMoveMatch) return handleSavingsSearch(savingsMoveMatch[1], 'move');

    const transactionMoveMatch = normalized.match(/(?:mover|jogar)\s+(?:a\s+)?transacao\s+(.+?)(?:\s+para\s+(.+))?$/);
    if (transactionMoveMatch) return handleTransactionSearch(transactionMoveMatch[1], 'move');

    const transactionRefundMatch = normalized.match(/(?:reembolsar|reembolso|estornar)\s+(?:a\s+)?transacao\s+(.+)/);
    if (transactionRefundMatch) return handleTransactionSearch(transactionRefundMatch[1], 'refund');

    if (normalized.includes('transacao') || normalized.includes('movimentacao') || normalized.includes('fatura') || normalized.includes('cartao')) {
      return buildTransactionsResponse(explicitMonth || currentMonthKey);
    }
    if (normalized.includes('assinatura')) {
      return buildSubscriptionsResponse(explicitMonth || currentMonthKey);
    }
    if (normalized.includes('lembrete')) {
      return buildRemindersResponse(explicitMonth || currentMonthKey);
    }
    const wantsTotalization =
      (normalized.includes('total') || normalized.includes('quanto tenho') || normalized.includes('tudo')) &&
      (normalized.includes('saldo') || normalized.includes('patrimonio') || normalized.includes('conta')) &&
      (normalized.includes('patrimonio') || normalized.includes('total geral') || normalized.includes('somando') || normalized.includes('totaliz'));

    if (wantsTotalization) return buildTotalizationResponse();

    if (normalized.includes('caixinha') || normalized.includes('reserva')) {
      return buildSavingsResponse();
    }
    if (
      normalized.includes('patrimonio') ||
      normalized.includes('imovel') ||
      normalized.includes('veiculo') ||
      normalized.includes('carro') ||
      normalized.includes('moto') ||
      normalized.includes('investimento') ||
      normalized.includes('acao') ||
      normalized.includes('acoes') ||
      normalized.includes('bens') ||
      normalized.includes('bem material') ||
      normalized.includes('fii') ||
      normalized.includes('cdb') ||
      normalized.includes('tesouro')
    ) {
      return buildAssetsResponse();
    }

    return null;
  };

  const handleAction = async (action: string, dataset: DOMStringMap): Promise<string | null> => {
    const currentMonthKey = config.getCurrentMonthKey();

    if (action === 'set-month-prev') {
      const nextMonth = shiftMonth(currentMonthKey, -1);
      config.setCurrentMonthKey(nextMonth);
      return buildMonthChangedResponse(nextMonth);
    }
    if (action === 'set-month-next') {
      const nextMonth = shiftMonth(currentMonthKey, 1);
      config.setCurrentMonthKey(nextMonth);
      return buildMonthChangedResponse(nextMonth);
    }
    if (action === 'show-transactions') return buildTransactionsResponse(currentMonthKey);
    if (action === 'show-subscriptions') return buildSubscriptionsResponse(currentMonthKey);
    if (action === 'show-reminders') return buildRemindersResponse(currentMonthKey);
    if (action === 'show-savings') return buildSavingsResponse();
    if (action === 'show-assets') return buildAssetsResponse();
    if (action === 'show-totalization') return buildTotalizationResponse();
    if (action === 'create-reminder') {
      const prefill: Record<string, string> = {};
      if (dataset.name) prefill.name = dataset.name;
      if (dataset.value) prefill.value = dataset.value;
      if (dataset.type) prefill.type = dataset.type;
      if (dataset.frequency) prefill.frequency = dataset.frequency;
      if (dataset.category) prefill.category = dataset.category;
      if (dataset.date) prefill.date = dataset.date;
      return handleCreateReminder(Object.keys(prefill).length > 0 ? prefill : undefined);
    }
    if (action === 'create-subscription') {
      const subPrefill: Record<string, string> = {};
      if (dataset.name) subPrefill.name = dataset.name;
      if (dataset.value) subPrefill.value = dataset.value;
      if (dataset.frequency) subPrefill.frequency = dataset.frequency;
      if (dataset.category) subPrefill.category = dataset.category;
      return handleCreateSubscription(Object.keys(subPrefill).length > 0 ? subPrefill : undefined);
    }
    if (action === 'create-savings') {
      openSavingsModal(null);
      return renderCard('Criando caixinha', 'Abri o formulario direto no chat.', '<div class="coin-chat-inline">Preencha os dados e confirme para salvar.</div>');
    }

    if (action === 'edit-reminder' && dataset.id) {
      const reminder = await findReminderById(dataset.id);
      if (!reminder) return buildEmptyResponse('Lembrete nao encontrado', 'Esse lembrete nao esta mais disponivel.');
      const categories = await loadCategories();
      openReminderModal({
        userId: config.userId,
        editingReminder: reminder,
        userCategories: categories,
        onSaved: async () => {
          await config.pushAssistantMessage(renderCard(
            'Lembrete atualizado',
            String(reminder.name || reminder.title || 'Lembrete'),
            '<div class="coin-chat-inline">As alteracoes foram salvas com sucesso.</div>',
            [{ label: 'Ver lembretes', action: 'show-reminders' }],
          ));
        },
      });
      return renderCard('Editando lembrete', String(reminder.name || reminder.title || 'Lembrete'), '<div class="coin-chat-inline">Abri o formulario com os dados atuais para voce ajustar.</div>');
    }

    if (action === 'delete-reminder' && dataset.id) {
      const reminder = await findReminderById(dataset.id);
      if (!reminder) return buildEmptyResponse('Lembrete nao encontrado', 'Esse lembrete nao esta mais disponivel.');
      DeleteConfirmationModal({
        title: 'Excluir lembrete?',
        description: 'Esta acao nao pode ser desfeita.',
        onConfirm: async () => {
          await deleteDoc(doc(db, `users/${config.userId}/reminders`, reminder.id));
          await config.pushAssistantMessage(renderCard(
            'Lembrete excluido',
            String(reminder.name || reminder.title || 'Lembrete'),
            '<div class="coin-chat-inline">Removi o lembrete com sucesso.</div>',
            [{ label: 'Ver lembretes', action: 'show-reminders' }],
          ));
        },
      });
      return renderCard('Excluindo lembrete', String(reminder.name || reminder.title || 'Lembrete'), '<div class="coin-chat-inline">Abri a confirmacao de exclusao.</div>');
    }

    if (action === 'toggle-reminder-paid' && dataset.id) {
      const reminder = await findReminderById(dataset.id);
      if (!reminder) return buildEmptyResponse('Lembrete nao encontrado', 'Esse lembrete nao esta mais disponivel.');
      const { billingsByReminderId } = await loadReminders();
      const billing = (billingsByReminderId.get(reminder.id) || []).find((entry) => entry.month === currentMonthKey);
      const isPaid = billing?.status === 'paid' || reminder.status === 'paid' || reminder.paid === true || (Array.isArray(reminder.paidMonths) && reminder.paidMonths.includes(currentMonthKey));
      const billingId = `${reminder.id}_${currentMonthKey}`;
      if (!isPaid) {
        await Promise.all([
          setDoc(doc(db, `users/${config.userId}/reminder_billings/${billingId}`), {
            reminderId: reminder.id,
            month: currentMonthKey,
            status: 'paid',
            value: Number(reminder.value ?? reminder.amount ?? 0) || 0,
            paidAt: Timestamp.now(),
          }),
          updateDoc(doc(db, `users/${config.userId}/reminders/${reminder.id}`), {
            paidMonths: arrayUnion(currentMonthKey),
            updatedAt: Timestamp.now(),
          }),
        ]);
      } else {
        await Promise.all([
          deleteDoc(doc(db, `users/${config.userId}/reminder_billings/${billingId}`)),
          updateDoc(doc(db, `users/${config.userId}/reminders/${reminder.id}`), {
            paidMonths: arrayRemove(currentMonthKey),
            updatedAt: Timestamp.now(),
          }),
        ]);
      }
      return renderCard(
        isPaid ? 'Pagamento removido' : 'Lembrete marcado como pago',
        String(reminder.name || reminder.title || 'Lembrete'),
        `<div class="coin-chat-inline">${isPaid ? 'O lembrete voltou para em aberto.' : 'Pagamento registrado para o mes atual.'}</div>`,
        [{ label: 'Ver lembretes', action: 'show-reminders' }],
      );
    }

    if (action === 'edit-subscription' && dataset.id) {
      const subscription = await findSubscriptionById(dataset.id);
      if (!subscription) return buildEmptyResponse('Assinatura nao encontrada', 'Essa assinatura nao esta mais disponivel.');
      const categories = await loadCategories();
      openSubscriptionModal({
        userId: config.userId,
        editingSub: subscription,
        userCategories: categories,
        onSaved: async () => {
          await config.pushAssistantMessage(renderCard(
            'Assinatura atualizada',
            String(subscription.name || subscription.title || 'Assinatura'),
            '<div class="coin-chat-inline">As alteracoes foram salvas com sucesso.</div>',
            [{ label: 'Ver assinaturas', action: 'show-subscriptions' }],
          ));
        },
      });
      return renderCard('Editando assinatura', String(subscription.name || subscription.title || 'Assinatura'), '<div class="coin-chat-inline">Abri o formulario com os dados atuais para voce ajustar.</div>');
    }

    if (action === 'delete-subscription' && dataset.id) {
      const subscription = await findSubscriptionById(dataset.id);
      if (!subscription) return buildEmptyResponse('Assinatura nao encontrada', 'Essa assinatura nao esta mais disponivel.');
      DeleteConfirmationModal({
        title: 'Excluir assinatura?',
        description: 'Esta acao nao pode ser desfeita.',
        onConfirm: async () => {
          await deleteDoc(doc(db, `users/${config.userId}/subscriptions`, subscription.id));
          await config.pushAssistantMessage(renderCard(
            'Assinatura excluida',
            String(subscription.name || subscription.title || 'Assinatura'),
            '<div class="coin-chat-inline">Removi a assinatura com sucesso.</div>',
            [{ label: 'Ver assinaturas', action: 'show-subscriptions' }],
          ));
        },
      });
      return renderCard('Excluindo assinatura', String(subscription.name || subscription.title || 'Assinatura'), '<div class="coin-chat-inline">Abri a confirmacao de exclusao.</div>');
    }

    if (action === 'toggle-subscription-paid' && dataset.id) {
      const subscription = await findSubscriptionById(dataset.id);
      if (!subscription) return buildEmptyResponse('Assinatura nao encontrada', 'Essa assinatura nao esta mais disponivel.');
      const { billingsBySubId } = await loadSubscriptions();
      const billing = (billingsBySubId.get(subscription.id) || []).find((entry) => entry.month === currentMonthKey);
      const isPaid = billing?.status === 'paid' || subscription.status === 'paid' || subscription.paid === true || (Array.isArray(subscription.paidMonths) && subscription.paidMonths.includes(currentMonthKey));
      const billingId = `${subscription.id}_${currentMonthKey}`;

      if (!isPaid) {
        await setDoc(doc(db, `users/${config.userId}/billings`, billingId), {
          subscriptionId: subscription.id,
          month: currentMonthKey,
          status: 'paid',
          amount: Number(subscription.value ?? subscription.amount ?? 0),
          name: subscription.name ?? '',
          frequency: subscription.frequency ?? 'monthly',
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        await updateDoc(doc(db, `users/${config.userId}/subscriptions`, subscription.id), {
          paidMonths: arrayUnion(currentMonthKey),
          updatedAt: new Date().toISOString(),
        });
      } else {
        await setDoc(doc(db, `users/${config.userId}/billings`, billingId), {
          status: 'pending',
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        await updateDoc(doc(db, `users/${config.userId}/subscriptions`, subscription.id), {
          paidMonths: arrayRemove(currentMonthKey),
          updatedAt: new Date().toISOString(),
        });
      }

      return renderCard(
        isPaid ? 'Assinatura desmarcada' : 'Assinatura marcada como paga',
        String(subscription.name || subscription.title || 'Assinatura'),
        `<div class="coin-chat-inline">${isPaid ? 'A assinatura voltou para em aberto.' : 'Pagamento registrado para o mes atual.'}</div>`,
        [{ label: 'Ver assinaturas', action: 'show-subscriptions' }],
      );
    }

    if (action === 'edit-savings' && dataset.id) {
      const savingsItem = await findSavingsById(dataset.id);
      if (!savingsItem) return buildEmptyResponse('Caixinha nao encontrada', 'Essa caixinha nao esta mais disponivel.');
      openSavingsModal(savingsItem);
      return renderCard('Editando caixinha', String(savingsItem.name || 'Caixinha'), '<div class="coin-chat-inline">Abri o formulario com os dados atuais para voce ajustar.</div>');
    }

    if (action === 'delete-savings' && dataset.id) {
      const savingsItem = await findSavingsById(dataset.id);
      if (!savingsItem) return buildEmptyResponse('Caixinha nao encontrada', 'Essa caixinha nao esta mais disponivel.');
      DeleteConfirmationModal({
        title: 'Excluir caixinha?',
        description: 'Todas as movimentacoes dessa reserva serao perdidas.',
        onConfirm: async () => {
          await updateDoc(doc(db, `users/${config.userId}/savings`, savingsItem.id), {
            deleted: true,
            deletedAt: Timestamp.now(),
          });
          await config.pushAssistantMessage(renderCard(
            'Caixinha excluida',
            String(savingsItem.name || 'Caixinha'),
            '<div class="coin-chat-inline">Removi a reserva com sucesso.</div>',
            [{ label: 'Ver caixinhas', action: 'show-savings' }],
          ));
        },
      });
      return renderCard('Excluindo caixinha', String(savingsItem.name || 'Caixinha'), '<div class="coin-chat-inline">Abri a confirmacao de exclusao.</div>');
    }

    if (action === 'move-savings' && dataset.id) {
      const savingsItem = await findSavingsById(dataset.id);
      if (!savingsItem) return buildEmptyResponse('Caixinha nao encontrada', 'Essa caixinha nao esta mais disponivel.');
      openSavingsMoveModal(savingsItem);
      return renderCard('Movimentando caixinha', String(savingsItem.name || 'Caixinha'), '<div class="coin-chat-inline">Abri o formulario para registrar deposito ou retirada.</div>');
    }

    if (action === 'edit-asset-value' && dataset.id) {
      const asset = await findAssetById(dataset.id);
      if (!asset) return buildEmptyResponse('Bem nao encontrado', 'Esse bem nao esta mais disponivel.');
      openEditAssetValueModal(asset);
      return renderCard('Atualizando valor', String(asset.name || 'Bem'), '<div class="coin-chat-inline">Abri o formulario para atualizar o valor de mercado.</div>');
    }

    if (action === 'delete-asset' && dataset.id) {
      const asset = await findAssetById(dataset.id);
      if (!asset) return buildEmptyResponse('Bem nao encontrado', 'Esse bem nao esta mais disponivel.');
      DeleteConfirmationModal({
        title: 'Excluir bem?',
        description: 'Esta acao nao pode ser desfeita.',
        onConfirm: async () => {
          await updateDoc(doc(db, `users/${config.userId}/assets`, asset.id), {
            deleted: true,
            deletedAt: Timestamp.now(),
          });
          await config.pushAssistantMessage(renderCard(
            'Bem excluido',
            String(asset.name || 'Bem'),
            '<div class="coin-chat-inline">Removi o bem do patrimônio.</div>',
            [{ label: 'Ver patrimônio', action: 'show-assets' }],
          ));
        },
      });
      return renderCard('Excluindo bem', String(asset.name || 'Bem'), '<div class="coin-chat-inline">Abri a confirmacao de exclusao.</div>');
    }

    if (action === 'move-credit-transaction' && dataset.id) {
      const { transaction, context } = await findCreditTransactionById(dataset.id);
      if (!transaction) return buildEmptyResponse('Transacao nao encontrada', 'Essa transacao nao esta mais disponivel.');
      await openTransactionMoveModal(transaction, context);
      return renderCard('Mover transacao', String(transaction.description || 'Transacao do cartao'), '<div class="coin-chat-inline">Abri a selecao de fatura de destino.</div>');
    }

    if (action === 'refund-credit-transaction' && dataset.id) {
      const { transaction } = await findCreditTransactionById(dataset.id);
      if (!transaction) return buildEmptyResponse('Transacao nao encontrada', 'Essa transacao nao esta mais disponivel.');
      openRefundPickerModal(transaction);
      return renderCard('Reembolsar transacao', String(transaction.description || 'Transacao do cartao'), '<div class="coin-chat-inline">Abri as opcoes para reembolso total ou personalizado.</div>');
    }

    if (action === 'delete-refund' && dataset.id) {
      const { transaction } = await findCreditTransactionById(dataset.id);
      if (!transaction) return buildEmptyResponse('Reembolso nao encontrado', 'Esse reembolso nao esta mais disponivel.');
      DeleteConfirmationModal({
        title: 'Excluir reembolso?',
        description: 'A transacao original voltara ao valor normal na fatura.',
        onConfirm: async () => {
          await deleteDoc(getPluggyCanonicalDocRef(config.userId, 'creditCardTransactions', transaction.id));
          await config.pushAssistantMessage(renderCard(
            'Reembolso excluido',
            String(transaction.description || 'Reembolso'),
            '<div class="coin-chat-inline">O reembolso foi removido com sucesso.</div>',
            [{ label: 'Ver transacoes', action: 'show-transactions' }],
          ));
        },
      });
      return renderCard('Excluindo reembolso', String(transaction.description || 'Reembolso'), '<div class="coin-chat-inline">Abri a confirmacao de exclusao.</div>');
    }

    return null;
  };

  return {
    handlePrompt,
    handleAction,
  };
}
