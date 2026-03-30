import express from 'express';
import fetch from 'node-fetch';
import { z } from 'zod';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';

dotenv.config();

const router = express.Router();
const sseClients = new Set();

// ====================== SSE ======================
function broadcastSyncEvent(userId, data) {
    const payload = `data: ${JSON.stringify({ ...data, userId })}\n\n`;
    sseClients.forEach(client => {
        if (client.userId === userId) {
            client.res.write(payload);
        }
    });
}

// ====================== VALIDAÇÃO DE AMBIENTE ======================
const envSchema = z.object({
    PLUGGY_CLIENT_ID: z.string().min(1, 'PLUGGY_CLIENT_ID obrigatório'),
    PLUGGY_CLIENT_SECRET: z.string().min(1, 'PLUGGY_CLIENT_SECRET obrigatório'),
    PLUGGY_SANDBOX: z.enum(['true', 'false']).optional().default('false'),
});

const env = envSchema.parse({
    PLUGGY_CLIENT_ID: process.env.PLUGGY_CLIENT_ID || 'a40b793c-b59e-4566-bc60-4f69e2b680fd',
    PLUGGY_CLIENT_SECRET: process.env.PLUGGY_CLIENT_SECRET || '699f1607-cc12-4991-a5ee-78661321e539',
    PLUGGY_SANDBOX: process.env.PLUGGY_SANDBOX || 'true'
});

const PLUGGY_API_URL = 'https://api.pluggy.ai';
const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const DEFAULT_APP_REDIRECT_URI = 'controlarapp://open-finance/callback';
const PLUGGY_WEBHOOK_IPS = ['177.71.238.212'];
const PUBLIC_ROUTES = ['/webhook', '/ping', '/connectors', '/oauth-callback', '/events'];
const TRANSACTIONS_PAGE_SIZE = 500;
const FULL_HISTORY_FROM_DATE = '1970-01-01';
const FETCH_TIMEOUT_MS = 25000;
const FIRESTORE_BATCH_LIMIT = 450;
const ITEM_REFRESH_WAIT_TIMEOUT_MS = 45000;
const ITEM_REFRESH_POLL_INTERVAL_MS = 2000;
const MANUAL_SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_DAILY_SYNC_CREDITS = 3;
const SYNC_CREDIT_TIME_ZONE = 'America/Sao_Paulo';
const AUTO_SUBSCRIPTION_SOURCE = 'pluggy-auto';
const MANAGED_SUBSCRIPTION_SOURCES = new Set([
    AUTO_SUBSCRIPTION_SOURCE,
]);

// Concorrência: páginas de transações buscadas em paralelo por conta
const CONCURRENT_TX_PAGES = 6;
// Concorrência: contas processadas em paralelo
const CONCURRENT_ACCOUNTS = 8;

const KNOWN_SUBSCRIPTION_SERVICES = Object.freeze([
    { key: 'spotify', name: 'Spotify', category: 'music streaming', aliases: ['spotify', 'ebw spotify', 'ebw*spotify', 'spotify premium', 'spotify pr', 'spotify*'] },
    { key: 'youtube-premium', name: 'YouTube Premium', category: 'video streaming', aliases: ['youtube premium', 'youtube prem', 'youtube music premium', 'youtube music'] },
    { key: 'netflix', name: 'Netflix', category: 'video streaming', aliases: ['netflix'] },
    { key: 'amazon-prime', name: 'Amazon Prime', category: 'video streaming', aliases: ['amazon prime', 'amazonprime', 'prime video', 'primevideo'] },
    { key: 'disney-plus', name: 'Disney+', category: 'video streaming', aliases: ['disney plus', 'disney+', 'disneyplus'] },
    { key: 'max', name: 'Max', category: 'video streaming', aliases: ['hbo max', 'hbomax', 'max streaming'] },
    { key: 'globoplay', name: 'Globoplay', category: 'video streaming', aliases: ['globoplay'] },
    { key: 'deezer', name: 'Deezer', category: 'music streaming', aliases: ['deezer'] },
    { key: 'apple-music', name: 'Apple Music', category: 'music streaming', aliases: ['apple music'] },
    { key: 'icloud', name: 'iCloud', category: 'digital services', aliases: ['icloud', 'apple icloud'] },
    { key: 'google-one', name: 'Google One', category: 'digital services', aliases: ['google one'] },
    { key: 'microsoft-365', name: 'Microsoft 365', category: 'digital services', aliases: ['microsoft 365', 'office 365'] },
    { key: 'adobe', name: 'Adobe', category: 'digital services', aliases: ['adobe'] },
    { key: 'canva', name: 'Canva', category: 'digital services', aliases: ['canva'] },
    { key: 'dropbox', name: 'Dropbox', category: 'digital services', aliases: ['dropbox'] },
    { key: 'notion', name: 'Notion', category: 'digital services', aliases: ['notion'] },
    { key: 'figma', name: 'Figma', category: 'digital services', aliases: ['figma'] },
    { key: 'openai-chatgpt', name: 'ChatGPT', category: 'digital services', aliases: ['chatgpt'] },
    { key: 'paramount-plus', name: 'Paramount+', category: 'video streaming', aliases: ['paramount plus', 'paramount+'] },
    { key: 'crunchyroll', name: 'Crunchyroll', category: 'video streaming', aliases: ['crunchyroll'] },
    { key: 'wellhub', name: 'Wellhub', category: 'health', aliases: ['wellhub', 'gympass'] },
    { key: 'smart-fit', name: 'Smart Fit', category: 'health', aliases: ['smart fit', 'smartfit'] },
    { key: 'meli-plus', name: 'Meli+', category: 'digital services', aliases: ['meli plus', 'meli+', 'assinatura meli'] },
    { key: 'sem-parar', name: 'Sem Parar', category: 'digital services', aliases: ['sem parar', 'semparar'] },
    { key: 'veloe', name: 'Veloe', category: 'digital services', aliases: ['veloe'] },
    { key: 'taggy', name: 'Taggy', category: 'digital services', aliases: ['taggy'] },
    { key: 'unimed', name: 'Unimed', category: 'health', aliases: ['unimed'] },
    { key: 'bradesco-seguros', name: 'Bradesco Seguros', category: 'insurance', aliases: ['bradesco seguros', 'bradesco seg'] },
    { key: 'itau-seguros', name: 'Itaú Seguros', category: 'insurance', aliases: ['itau seguros', 'itau seg'] },
    { key: 'sulamerica', name: 'SulAmérica', category: 'insurance', aliases: ['sulamerica', 'sul america'] },
    { key: 'porto-seguro', name: 'Porto Seguro', category: 'insurance', aliases: ['porto seguro', 'porto seg'] },
    { key: 'clube-ifood', name: 'Clube iFood', category: 'digital services', aliases: ['clube ifood', 'ifood clube'] },
]);

const STRONG_SUBSCRIPTION_CATEGORY_KEYS = new Set([
    'subscription',
    'subscriptions',
    'music streaming',
    'video streaming',
]);

const POSSIBLE_SUBSCRIPTION_CATEGORY_KEYS = new Set([
    ...STRONG_SUBSCRIPTION_CATEGORY_KEYS,
    'digital services',
    'gym',
    'health insurance',
    'insurance',
    'internet',
    'telephone',
    'phone',
    'courses',
    'education',
    'school',
    'university',
]);

const BLOCKED_SUBSCRIPTION_CATEGORY_KEYS = new Set([
    'bank slip',
    'cashback',
    'credit card payment',
    'income',
    'pix',
    'refund',
    'transfer',
    'wire transfer',
]);

const SUBSCRIPTION_TEXT_HINTS = Object.freeze([
    'assinatura',
    'subscription',
    'mensalidade',
    'membership',
    'premium',
    'streaming',
    'clube',
    'member',
    'ebw',
    'ebanx',
    'ifood',
]);

// ====================== HELPERS ======================

const normalizeUrlBase = (value) => String(value || '').trim().replace(/\/+$/, '');

const getQueryValue = (value) => {
    if (Array.isArray(value)) return value[0];
    if (typeof value === 'string') return value;
    return undefined;
};

const getRequestBaseUrl = (req) => {
    const configured = normalizeUrlBase(process.env.PUBLIC_BASE_URL || process.env.RAILWAY_STATIC_URL);
    if (configured) {
        return configured.startsWith('http://') || configured.startsWith('https://')
            ? configured
            : `https://${configured}`;
    }

    const forwardedProto = getQueryValue(req.headers['x-forwarded-proto']) || 'http';
    const forwardedHost = getQueryValue(req.headers['x-forwarded-host']) || req.headers.host;
    if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

    return DEFAULT_BACKEND_URL;
};

const toValidAppRedirectUri = (candidate) => {
    if (!candidate) return DEFAULT_APP_REDIRECT_URI;
    try {
        const parsed = new URL(candidate);
        return parsed.toString();
    } catch {
        return DEFAULT_APP_REDIRECT_URI;
    }
};

const buildBackendOAuthCallbackUrl = (req, appRedirectUri) => {
    const callbackUrl = new URL('/api/pluggy/oauth-callback', getRequestBaseUrl(req));
    callbackUrl.searchParams.set('appRedirectUri', toValidAppRedirectUri(appRedirectUri));
    return callbackUrl.toString();
};

const escapeHtml = (unsafe = '') => String(unsafe).replace(/[&<>"']/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
}[match]));

const renderOAuthRedirectPage = (redirectUrl) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Retornando ao aplicativo</title>
  <meta http-equiv="refresh" content="0;url=${escapeHtml(redirectUrl)}" />
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f0f10; color: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { width: min(92vw, 460px); background: #19191b; border: 1px solid #2a2a2f; border-radius: 16px; padding: 24px; text-align: center; }
    .spinner { width: 34px; height: 34px; border-radius: 999px; border: 3px solid #3a3a40; border-top-color: #d97757; margin: 0 auto 16px; animation: spin 0.9s linear infinite; }
    a { color: #f29f7d; word-break: break-all; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Autorização recebida</h2>
    <p>Estamos retornando você para o app.</p>
    <p>Se não abrir automaticamente, toque no link:</p>
    <p><a href="${escapeHtml(redirectUrl)}">${escapeHtml(redirectUrl)}</a></p>
  </div>
  <script>
    setTimeout(function() { window.location.href = ${JSON.stringify(redirectUrl)}; }, 400);
  </script>
</body>
</html>`;

const normalizeIp = (value) => String(value || '').trim().replace(/^::ffff:/, '');

const getClientIp = (req) => {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
        return normalizeIp(xForwardedFor.split(',')[0].trim());
    }
    if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
        return normalizeIp(String(xForwardedFor[0]).split(',')[0].trim());
    }
    return normalizeIp(req.ip || req.connection?.remoteAddress || '');
};

const isLocalIp = (ip) => ['127.0.0.1', '::1', 'localhost'].includes(ip);

// ====================== FIRESTORE BATCH HELPERS ======================

/**
 * Salva (set/merge) documentos em batches paralelos respeitando o limite do Firestore.
 */
async function commitInBatches(db, operations) {
    // Deduplica por ref.path — última versão vence
    const dedupedMap = new Map();
    for (const op of operations) {
        dedupedMap.set(op.ref.path, op);
    }
    const deduped = [...dedupedMap.values()];

    const chunks = [];
    for (let i = 0; i < deduped.length; i += FIRESTORE_BATCH_LIMIT) {
        chunks.push(deduped.slice(i, i + FIRESTORE_BATCH_LIMIT));
    }

    // Commita todos os chunks em paralelo para máxima velocidade
    await Promise.all(chunks.map(async (chunk) => {
        const batch = db.batch();
        for (const { ref, data, merge = true } of chunk) {
            batch.set(ref, data, { merge });
        }
        await batch.commit();
    }));

    return deduped.length;
}

/**
 * Deleta documentos em batches paralelos respeitando o limite do Firestore.
 */
async function deleteInBatches(db, refs) {
    // Deduplica por path
    const uniqueRefs = [...new Map(refs.map(r => [r.path, r])).values()];

    const chunks = [];
    for (let i = 0; i < uniqueRefs.length; i += FIRESTORE_BATCH_LIMIT) {
        chunks.push(uniqueRefs.slice(i, i + FIRESTORE_BATCH_LIMIT));
    }

    await Promise.all(chunks.map(async (chunk) => {
        const batch = db.batch();
        for (const ref of chunk) batch.delete(ref);
        await batch.commit();
    }));

    return uniqueRefs.length;
}

const getCanonicalPluggyCollection = (db, userId, collectionName) =>
    db.collection('users').doc(userId).collection(collectionName);

const getLegacyPluggyCollection = (db, collectionName) =>
    db.collection(collectionName);

const getCanonicalPluggyDoc = (db, userId, collectionName, docId) =>
    getCanonicalPluggyCollection(db, userId, collectionName).doc(docId);

const applyAdminFilters = (queryRef, filters = []) =>
    filters.reduce((currentQuery, filter) => currentQuery.where(filter.field, filter.op, filter.value), queryRef);

async function loadPluggyDocsByQuery({ db, userId, collectionName, filters = [] }) {
    const [canonicalSnapshot, legacySnapshot] = await Promise.all([
        applyAdminFilters(getCanonicalPluggyCollection(db, userId, collectionName), filters).get(),
        applyAdminFilters(getLegacyPluggyCollection(db, collectionName).where('userId', '==', userId), filters).get(),
    ]);

    return {
        canonicalDocs: canonicalSnapshot.docs,
        legacyDocs: legacySnapshot.docs,
        allDocs: [...canonicalSnapshot.docs, ...legacySnapshot.docs],
    };
}

async function loadPluggyDocsByIds({ db, userId, collectionName, docIds }) {
    const uniqueIds = [...new Set((docIds || []).filter(Boolean))];
    const canonicalMap = new Map();
    const legacyMap = new Map();

    if (uniqueIds.length === 0) {
        return { canonicalMap, legacyMap };
    }

    const [canonicalDocs, legacyDocs] = await Promise.all([
        Promise.all(uniqueIds.map((docId) => getCanonicalPluggyDoc(db, userId, collectionName, docId).get())),
        Promise.all(uniqueIds.map((docId) => getLegacyPluggyCollection(db, collectionName).doc(docId).get())),
    ]);

    canonicalDocs.forEach((snapshot) => {
        if (snapshot.exists) {
            canonicalMap.set(snapshot.id, snapshot);
        }
    });

    legacyDocs.forEach((snapshot) => {
        if (snapshot.exists && snapshot.data()?.userId === userId) {
            legacyMap.set(snapshot.id, snapshot);
        }
    });

    return { canonicalMap, legacyMap };
}

async function loadAccountDocsByItemId({ db, userId, itemId }) {
    const dedupedDocs = new Map();
    const pushDocs = (docs = []) => {
        docs.forEach((doc) => dedupedDocs.set(doc.ref.path, doc));
    };

    const [canonicalByItemId, canonicalByLegacyItemId, legacyByItemId, legacyByLegacyItemId] = await Promise.all([
        getCanonicalPluggyCollection(db, userId, 'accounts').where('itemId', '==', itemId).get(),
        getCanonicalPluggyCollection(db, userId, 'accounts').where('pluggyItemId', '==', itemId).get(),
        getLegacyPluggyCollection(db, 'accounts').where('userId', '==', userId).where('itemId', '==', itemId).get(),
        getLegacyPluggyCollection(db, 'accounts').where('userId', '==', userId).where('pluggyItemId', '==', itemId).get(),
    ]);

    pushDocs(canonicalByItemId.docs);
    pushDocs(canonicalByLegacyItemId.docs);
    pushDocs(legacyByItemId.docs);
    pushDocs(legacyByLegacyItemId.docs);

    return {
        allDocs: [...dedupedDocs.values()],
    };
}

function dedupeAdminDocsById({ canonicalDocs = [], legacyDocs = [] }) {
    const docsById = new Map();
    legacyDocs.forEach((doc) => docsById.set(doc.id, doc));
    canonicalDocs.forEach((doc) => docsById.set(doc.id, doc));
    return [...docsById.values()];
}

const getPreferredString = (...values) => {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }
    return null;
};

function buildPersistedInstitution(connector, canonicalAccountData, legacyAccountData) {
    const institution = {
        ...(legacyAccountData?.institution || {}),
        ...(canonicalAccountData?.institution || {}),
        ...(connector || {}),
    };
    const preservedName = getPreferredString(
        canonicalAccountData?.institution?.name,
        legacyAccountData?.institution?.name,
        connector?.name
    );

    if (preservedName) {
        institution.name = preservedName;
    }

    return Object.keys(institution).length > 0 ? institution : null;
}

function normalizeSubscriptionText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function humanizeSubscriptionName(value) {
    const sanitized = String(value || '')
        .replace(/[|/\\_*#]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!sanitized) return null;

    return sanitized
        .split(' ')
        .filter(Boolean)
        .slice(0, 3)
        .map((word) => {
            if (word.length <= 3 && /^[a-z0-9]+$/i.test(word)) {
                return word.toUpperCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
}

function getCreditCardTransactionDate(tx = {}) {
    const rawDate =
        tx.creditCardMetadata?.releaseDate ||
        tx.date ||
        tx.purchaseDate ||
        tx.competencyDate ||
        null;

    if (!rawDate) return null;

    const parsed = typeof rawDate?.toDate === 'function' ? rawDate.toDate() : new Date(rawDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCreditCardTransactionAmount(tx = {}) {
    const amount = Number(tx.amount || 0);
    return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

function hasInstallmentPlan(tx = {}) {
    const installmentNumber = Number(tx.creditCardMetadata?.installmentNumber ?? tx.installmentNumber ?? 0);
    const totalInstallments = Number(tx.creditCardMetadata?.totalInstallments ?? tx.totalInstallments ?? 0);

    if (Number.isFinite(totalInstallments) && totalInstallments > 1) {
        return true;
    }

    return Number.isFinite(installmentNumber) && installmentNumber > 1;
}

function getNormalizedTransactionCategory(tx = {}) {
    const keys = [
        tx.category,
        tx.categoryId,
        tx.detailedCategory,
        tx.subcategory,
    ]
        .map((value) => normalizeSubscriptionText(value))
        .filter(Boolean);

    for (const key of keys) {
        if (!/^\d+$/.test(key) && !/^[a-f0-9-]{24,}$/i.test(key)) {
            return key;
        }
    }

    return keys[0] || '';
}

function getTransactionTextCandidates(tx = {}) {
    return [
        tx.description,
        tx.originalDescription,
        tx.merchant?.name,
        tx.merchant?.businessName,
        tx.counterparty?.name,
        tx.payee,
        tx.paymentData?.receiverName,
        tx.creditCardMetadata?.merchantName,
    ].filter((value) => typeof value === 'string' && value.trim());
}

function collectNestedStringValues(value, bucket = new Set(), depth = 0) {
    if (depth > 4 || value == null) return bucket;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) bucket.add(trimmed);
        return bucket;
    }

    if (Array.isArray(value)) {
        value.forEach((entry) => collectNestedStringValues(entry, bucket, depth + 1));
        return bucket;
    }

    if (typeof value === 'object') {
        Object.values(value).forEach((entry) => collectNestedStringValues(entry, bucket, depth + 1));
    }

    return bucket;
}

function getAllTransactionTextCandidates(tx = {}) {
    const values = collectNestedStringValues(tx);
    getTransactionTextCandidates(tx).forEach((value) => values.add(value));
    return [...values];
}

function getNormalizedTransactionSearchText(tx = {}) {
    return getAllTransactionTextCandidates(tx)
        .map((value) => normalizeSubscriptionText(value))
        .filter(Boolean)
        .join(' | ');
}

function findKnownSubscriptionService(tx = {}) {
    const haystack = getNormalizedTransactionSearchText(tx);

    if (!haystack) return null;

    for (const service of KNOWN_SUBSCRIPTION_SERVICES) {
        const matchedAlias = service.aliases.find((alias) => {
            const normalizedAlias = normalizeSubscriptionText(alias);
            return normalizedAlias && haystack.includes(normalizedAlias);
        });

        if (matchedAlias) {
            return service;
        }
    }

    return null;
}

function hasSubscriptionTextSignal(tx = {}) {
    const haystack = getNormalizedTransactionSearchText(tx);
    if (!haystack) return false;

    return SUBSCRIPTION_TEXT_HINTS.some((hint) => {
        const normalizedHint = normalizeSubscriptionText(hint);
        return normalizedHint && haystack.includes(normalizedHint);
    });
}

function extractGenericSubscriptionName(tx = {}) {
    const rawValue = getPreferredString(
        tx.merchant?.name,
        tx.merchant?.businessName,
        tx.counterparty?.name,
        tx.payee,
        tx.paymentData?.receiverName,
        tx.description,
        tx.originalDescription
    );

    if (!rawValue) return null;

    const cleaned = String(rawValue)
        .replace(/\b\d{2,}\b/g, ' ')
        .replace(/\b(parc(?:ela)?|parcelado|installment|compra|purchase|pagamento|payment|credito|debito|credit|debit|visa|mastercard|master|elo|maestro|www|com|br|ltda|sa|eireli|me|ebw|ebanx)\b/gi, ' ')
        .replace(/[|/\\_*#-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const normalized = normalizeSubscriptionText(cleaned);
    if (!normalized) return null;

    return humanizeSubscriptionName(cleaned);
}

function getDebugTransactionLabel(tx = {}) {
    return getPreferredString(
        tx.description,
        tx.originalDescription,
        tx.merchant?.name,
        tx.merchant?.businessName,
        tx.counterparty?.name,
        tx.payee,
        tx.paymentData?.receiverName,
        tx.creditCardMetadata?.merchantName
    ) || 'Sem descricao';
}

function inferSubscriptionCategoryLabel(categoryKey = '') {
    if (!categoryKey) return 'other';
    if (STRONG_SUBSCRIPTION_CATEGORY_KEYS.has(categoryKey) || categoryKey === 'entertainment') return 'entertainment';
    if (['digital services', 'internet', 'telephone', 'phone'].includes(categoryKey)) return 'digital services';
    if (['gym', 'health', 'health insurance'].includes(categoryKey)) return 'health';
    if (['courses', 'education', 'school', 'university'].includes(categoryKey)) return 'education';
    if (['software', 'productivity', 'cloud', 'hosting'].includes(categoryKey)) return 'productivity';
    if (categoryKey.includes('insurance')) return 'insurance';
    return categoryKey || 'other';
}

function inferSubscriptionCategoryLabelSafe(categoryKey = '') {
    if (!categoryKey) return 'other';
    if (STRONG_SUBSCRIPTION_CATEGORY_KEYS.has(categoryKey) || categoryKey === 'entertainment') return 'entertainment';
    if (['digital services', 'internet', 'telephone', 'phone'].includes(categoryKey)) return 'digital services';
    if (['gym', 'health', 'health insurance'].includes(categoryKey)) return 'health';
    if (['courses', 'education', 'school', 'university'].includes(categoryKey)) return 'education';
    if (['software', 'productivity', 'cloud', 'hosting'].includes(categoryKey)) return 'productivity';
    if (categoryKey.includes('insurance')) return 'insurance';
    return categoryKey || 'other';
}

function getIgnoredSubscriptionReason(tx = {}) {
    const status = String(tx.status || '').trim().toUpperCase();
    const type = String(tx.type || '').trim().toUpperCase();
    const categoryKey = getNormalizedTransactionCategory(tx);
    const normalizedDescription = normalizeSubscriptionText(tx.description || tx.originalDescription || '');

    if (!getCreditCardTransactionDate(tx)) return 'sem-data';
    if (getCreditCardTransactionAmount(tx) <= 0) return 'valor-invalido';
    if (type === 'CREDIT') return 'transacao-de-credito';
    if (hasInstallmentPlan(tx)) return 'compra-parcelada';
    if (['PENDING', 'CANCELED', 'CANCELLED', 'FAILED'].includes(status)) return `status-${status.toLowerCase()}`;
    if (BLOCKED_SUBSCRIPTION_CATEGORY_KEYS.has(categoryKey)) return `categoria-bloqueada:${categoryKey}`;
    if (
        normalizedDescription.includes('estorno') ||
        normalizedDescription.includes('reembolso') ||
        normalizedDescription.includes('refund') ||
        normalizedDescription.includes('pagamento fatura')
    ) {
        return 'estorno-ou-pagamento';
    }

    return null;
}

function shouldIgnoreSubscriptionTransaction(tx = {}) {
    return Boolean(getIgnoredSubscriptionReason(tx));
}

function inspectSubscriptionTransaction(tx = {}) {
    const txDate = getCreditCardTransactionDate(tx);
    const amount = getCreditCardTransactionAmount(tx);
    const categoryKey = getNormalizedTransactionCategory(tx);
    const knownService = findKnownSubscriptionService(tx);
    const hasTextSubscriptionSignal = hasSubscriptionTextSignal(tx);
    const serviceName = knownService?.name || extractGenericSubscriptionName(tx);
    const serviceKey = normalizeSubscriptionText(knownService?.key || serviceName || '');
    const ignoredReason = getIgnoredSubscriptionReason(tx);

    return {
        label: getDebugTransactionLabel(tx),
        searchText: getNormalizedTransactionSearchText(tx),
        txDate,
        amount,
        categoryKey,
        knownService,
        hasTextSubscriptionSignal,
        serviceName,
        serviceKey,
        isStrongCategory: STRONG_SUBSCRIPTION_CATEGORY_KEYS.has(categoryKey),
        isPossibleCategory: POSSIBLE_SUBSCRIPTION_CATEGORY_KEYS.has(categoryKey),
        ignoredReason,
    };
}

function diffInDays(leftDate, rightDate) {
    const diffMs = Math.abs(rightDate.getTime() - leftDate.getTime());
    return diffMs / (24 * 60 * 60 * 1000);
}

function inferRecurringFrequency(entries = []) {
    if (entries.length < 2) return null;

    const counters = {
        weekly: 0,
        monthly: 0,
        yearly: 0,
    };

    for (let index = 1; index < entries.length; index += 1) {
        const days = diffInDays(entries[index - 1].date, entries[index].date);
        if (days >= 6 && days <= 8) counters.weekly += 1;
        if (days >= 20 && days <= 40) counters.monthly += 1;
        if (days >= 330 && days <= 390) counters.yearly += 1;
    }

    let bestFrequency = null;
    let bestCount = 0;

    for (const [frequency, count] of Object.entries(counters)) {
        if (count > bestCount) {
            bestFrequency = frequency;
            bestCount = count;
        }
    }

    return bestCount > 0 ? bestFrequency : null;
}

function hasStableSubscriptionAmounts(entries = []) {
    if (entries.length <= 1) return true;

    const recentAmounts = entries
        .slice(-3)
        .map((entry) => entry.amount)
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((left, right) => left - right);

    if (recentAmounts.length <= 1) return true;

    const median = recentAmounts[Math.floor(recentAmounts.length / 2)];
    const tolerance = Math.max(5, median * 0.15);
    return recentAmounts.every((value) => Math.abs(value - median) <= tolerance);
}

function createClampedUtcDate(year, month, day) {
    const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0, 12, 0, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTargetMonth), 12, 0, 0));
}

function addFrequencyToDate(date, frequency) {
    const baseDate = new Date(date);
    if (frequency === 'weekly') {
        const nextDate = new Date(baseDate);
        nextDate.setUTCDate(nextDate.getUTCDate() + 7);
        return nextDate;
    }

    const day = baseDate.getUTCDate();
    if (frequency === 'yearly') {
        return createClampedUtcDate(baseDate.getUTCFullYear() + 1, baseDate.getUTCMonth(), day);
    }

    return createClampedUtcDate(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + 1, day);
}

function buildAutoSubscriptionDocId(serviceKey) {
    const hash = createHash('sha1').update(String(serviceKey || '')).digest('hex').slice(0, 20);
    return `auto_${hash}`;
}

function isLikelySameSubscriptionName(leftName, rightName) {
    if (!leftName || !rightName) return false;
    if (leftName === rightName) return true;
    if (leftName.length >= 5 && rightName.includes(leftName)) return true;
    if (rightName.length >= 5 && leftName.includes(rightName)) return true;
    return false;
}

async function loadExistingUserSubscriptions({ db, userId }) {
    const snapshot = await db.collection('users').doc(userId).collection('subscriptions').get();
    return snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        return {
            ref: doc.ref,
            id: doc.id,
            data,
            normalizedName: normalizeSubscriptionText(data.name || ''),
            serviceKey: normalizeSubscriptionText(data.autoDetection?.serviceKey || ''),
        };
    });
}

function findExistingSubscription(existingSubscriptions = [], { serviceKey, name }) {
    const normalizedServiceKey = normalizeSubscriptionText(serviceKey || '');
    const normalizedName = normalizeSubscriptionText(name || '');

    return existingSubscriptions.find((subscription) => {
        if (normalizedServiceKey && subscription.serviceKey === normalizedServiceKey) {
            return true;
        }
        return isLikelySameSubscriptionName(subscription.normalizedName, normalizedName);
    }) || null;
}

async function buildAutoSubscriptionOperations({ db, userId, enrichedAccounts, syncCompletedAt }) {
    const existingSubscriptions = await loadExistingUserSubscriptions({ db, userId });
    const groupedCandidates = new Map();

    for (const account of enrichedAccounts) {
        if (!['CREDIT', 'BANK'].includes(account?.type)) continue;

        for (const tx of (account.transactions || [])) {
            if (!tx?.id) continue;

            const inspection = inspectSubscriptionTransaction(tx);
            
            // Se for um serviço conhecido (ex: Spotify), ignoramos a marcação de 'compra-parcelada' 
            // ou status 'PENDING' (comum em assinaturas recém processadas).
            const isKnownService = Boolean(inspection.knownService);
            const isIgnorableReason = 
                inspection.ignoredReason === 'compra-parcelada' || 
                inspection.ignoredReason === 'status-pending';
            
            if (inspection.ignoredReason && !(isKnownService && isIgnorableReason)) {
                continue;
            }

            const {
                knownService,
                categoryKey,
                isStrongCategory,
                isPossibleCategory,
                hasTextSubscriptionSignal,
                serviceName,
                serviceKey,
                txDate,
                amount,
            } = inspection;

            if (!serviceKey || !serviceName || !txDate || amount <= 0) continue;

            const existingGroup = groupedCandidates.get(serviceKey) || {
                serviceKey,
                serviceName,
                knownService,
                categoryKey,
                hasStrongCategory: false,
                hasPossibleCategory: false,
                entries: [],
            };

            existingGroup.serviceName = knownService?.name || existingGroup.serviceName || serviceName;
            existingGroup.knownService = existingGroup.knownService || knownService;
            existingGroup.categoryKey = existingGroup.categoryKey || categoryKey;
            existingGroup.hasStrongCategory = existingGroup.hasStrongCategory || isStrongCategory;
            existingGroup.hasPossibleCategory = existingGroup.hasPossibleCategory || isPossibleCategory;
            existingGroup.entries.push({
                tx,
                date: txDate,
                amount,
                account,
                categoryKey,
                hasTextSubscriptionSignal,
            });

            groupedCandidates.set(serviceKey, existingGroup);
        }
    }

    const operations = [];
    const createdOrUpdatedIds = new Set();
    const syncTimestamp = admin.firestore.Timestamp.fromDate(new Date(syncCompletedAt));
    const sourceName = AUTO_SUBSCRIPTION_SOURCE;

    for (const group of groupedCandidates.values()) {
        group.entries.sort((left, right) => left.date.getTime() - right.date.getTime());

        const recurringFrequency = inferRecurringFrequency(group.entries);
        const stableAmounts = hasStableSubscriptionAmounts(group.entries);
        const hasKnownServiceSignal = Boolean(group.knownService);
        const hasCategorySignal = Boolean(group.hasStrongCategory || group.hasPossibleCategory);
        const hasTextSubscriptionSignal = group.entries.some((entry) => entry.hasTextSubscriptionSignal);
        const hasRecurringPattern =
            group.entries.length >= 2 &&
            Boolean(recurringFrequency) &&
            stableAmounts;
        const qualifiesByRecurrence = (hasRecurringPattern && hasCategorySignal);

        if (!hasKnownServiceSignal && !qualifiesByRecurrence) {
            continue;
        }

        // Se for um serviço conhecido, a confiança é máxima
        const confidence = hasKnownServiceSignal ? 0.98 : 0.85;

        const frequency = recurringFrequency || 'monthly';
        const latestEntry = group.entries[group.entries.length - 1];
        const nextBillingDate = addFrequencyToDate(latestEntry.date, frequency);
        const existingSubscription = findExistingSubscription(existingSubscriptions, {
            serviceKey: group.serviceKey,
            name: group.serviceName,
        });

        if (existingSubscription && !MANAGED_SUBSCRIPTION_SOURCES.has(existingSubscription.data.source)) {
            continue;
        }

        const docRef = existingSubscription?.ref || db.collection('users').doc(userId).collection('subscriptions').doc(buildAutoSubscriptionDocId(group.serviceKey));
        const existingData = existingSubscription?.data || {};
        const matchedBy = group.knownService
            ? 'known-service'
            : 'recurrence';

        operations.push({
            ref: docRef,
            data: {
                name: group.knownService?.name || group.serviceName,
                value: Number(latestEntry.amount.toFixed(2)),
                frequency,
                date: admin.firestore.Timestamp.fromDate(nextBillingDate),
                category: latestEntry.categoryKey || group.categoryKey || group.knownService?.category || 'other',
                source: sourceName,
                createdAt: existingData.createdAt || syncTimestamp,
                updatedAt: syncTimestamp,
                autoDetection: {
                    serviceKey: group.serviceKey,
                    matchedBy,
                    confidence,
                    detectedAt: syncCompletedAt,
                    recurringChargesObserved: group.entries.length,
                    lastSeenTransactionId: latestEntry.tx.id || null,
                    lastSeenChargeDate: latestEntry.date.toISOString(),
                    lastSeenAmount: Number(latestEntry.amount.toFixed(2)),
                    categoryKey: latestEntry.categoryKey || group.categoryKey || null,
                    accountId: latestEntry.account?.id || null,
                    accountName: latestEntry.account?.name || null,
                    itemId: latestEntry.account?.itemId || null,
                },
            },
        });

        createdOrUpdatedIds.add(docRef.path);
    }

    return {
        operations,
        count: createdOrUpdatedIds.size,
    };
}

// ====================== CLIENT PLUGGY ======================
class PluggyClient {
    static instance;
    token = null;
    expiry = null;
    refreshing = null;

    static getInstance() {
        if (!PluggyClient.instance) PluggyClient.instance = new PluggyClient();
        return PluggyClient.instance;
    }

    async getToken() {
        if (this.token && this.expiry && Date.now() < this.expiry - 5 * 60 * 1000) return this.token;
        if (this.refreshing) return this.refreshing;

        this.refreshing = (async () => {
            const res = await this.safeFetch(`${PLUGGY_API_URL}/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: env.PLUGGY_CLIENT_ID,
                    clientSecret: env.PLUGGY_CLIENT_SECRET,
                }),
            });

            if (!res.ok) {
                const errorBody = await res.text();
                console.error(`[Pluggy Auth] Falha na autenticação. Status: ${res.status}, Body: ${errorBody}`);
                throw new Error('Falha na autenticação Pluggy');
            }
            const data = await res.json();

            this.token = data.apiKey;
            this.expiry = Date.now() + 2 * 60 * 60 * 1000;
            this.refreshing = null;
            return this.token;
        })();

        return this.refreshing;
    }

    async safeFetch(url, options = {}, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

            try {
                const token = url.includes('/auth') ? null : await this.getToken();
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                    headers: {
                        ...options.headers,
                        ...(token ? { 'X-API-KEY': token } : {}),
                    },
                });

                clearTimeout(timeout);

                if (response.status === 429 || response.status >= 500) {
                    if (attempt === retries) return response;
                    await this.delay(attempt * 1000 + Math.random() * 800);
                    continue;
                }
                return response;
            } catch (err) {
                clearTimeout(timeout);
                if (attempt === retries) throw err;
                await this.delay(attempt * 1000);
            }
        }
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

const pluggy = PluggyClient.getInstance();

// ====================== FETCH HELPERS ======================

/**
 * Busca TODAS as transações de uma conta com paralelismo de páginas.
 *
 * Estratégia:
 *  1. Busca a página 1 para descobrir `totalPages`.
 *  2. Dispara todas as páginas restantes em paralelo (chunks de CONCURRENT_TX_PAGES).
 *  3. Deduplica por `tx.id` para garantir integridade.
 */
async function fetchAllTransactions(accountId, filters = {}) {
    const { fromDate, createdAtFrom } = filters;
    const buildUrl = (page) => {
        const p = new URLSearchParams({
            accountId,
            pageSize: TRANSACTIONS_PAGE_SIZE.toString(),
            page: String(page),
        });
        if (fromDate) p.set('from', fromDate);
        if (createdAtFrom) p.set('createdAtFrom', createdAtFrom);
        return `${PLUGGY_API_URL}/transactions?${p}`;
    };

    // Página 1 — necessária para descobrir o total
    const firstRes = await pluggy.safeFetch(buildUrl(1));
    if (!firstRes.ok) {
        console.warn(`[fetchAllTransactions] Conta ${accountId} retornou HTTP ${firstRes.status} na página 1`);
        return [];
    }

    const firstData = await firstRes.json();
    const totalPages = Math.max(1, Number(firstData.totalPages || 1));
    const allTx = [...(firstData.results || [])];

    if (totalPages <= 1) return dedupById(allTx);

    // Páginas 2..totalPages em paralelo com controle de concorrência
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

    for (let i = 0; i < remainingPages.length; i += CONCURRENT_TX_PAGES) {
        const chunk = remainingPages.slice(i, i + CONCURRENT_TX_PAGES);
        const results = await Promise.all(
            chunk.map(async (page) => {
                try {
                    const res = await pluggy.safeFetch(buildUrl(page));
                    if (!res.ok) {
                        console.warn(`[fetchAllTransactions] Conta ${accountId} página ${page} retornou HTTP ${res.status}`);
                        return [];
                    }
                    const data = await res.json();
                    return data.results || [];
                } catch (err) {
                    console.warn(`[fetchAllTransactions] Conta ${accountId} página ${page} erro: ${err?.message}`);
                    return [];
                }
            })
        );
        allTx.push(...results.flat());
    }

    return dedupById(allTx);
}

/**
 * Busca faturas (bills) de cartão de crédito.
 */
async function fetchBills(accountId) {
    try {
        const res = await pluggy.safeFetch(`${PLUGGY_API_URL}/accounts/${accountId}/bills`);
        if (!res.ok) return [];
        const payload = await res.json();
        return payload.results || [];
    } catch (err) {
        console.warn(`[fetchBills] Conta ${accountId} erro: ${err?.message}`);
        return [];
    }
}

/**
 * Remove duplicatas de um array de objetos pelo campo `id`.
 */
function dedupById(items) {
    const seen = new Map();
    for (const item of items) {
        if (item?.id && !seen.has(item.id)) seen.set(item.id, item);
    }
    return [...seen.values()];
}

function normalizeIsoDateTime(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function getTimeZoneDateKey(date = new Date(), timeZone = SYNC_CREDIT_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
        return date.toISOString().split('T')[0];
    }

    return `${year}-${month}-${day}`;
}

function formatDateTimeInTimeZone(value, timeZone = SYNC_CREDIT_TIME_ZONE) {
    const normalized = normalizeIsoDateTime(value);
    if (!normalized) return null;

    return new Intl.DateTimeFormat('pt-BR', {
        timeZone,
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(normalized));
}

function getAvailableSyncCredits(userData = {}) {
    // A sincronização grátis agora é por conta (1x a cada 24h), 
    // então 'free' retorna sempre 1 para indicar disponibilidade base.
    const extraCredits = typeof userData?.extraSyncCredits === 'number'
        ? Math.max(0, userData.extraSyncCredits)
        : 0;

    return {
        free: 1,
        extra: extraCredits,
        total: 1 + extraCredits,
    };
}

function getDailyConnectorConnections(userData = {}) {
    return userData?.dailyConnectorConnections && typeof userData.dailyConnectorConnections === 'object'
        ? { ...userData.dailyConnectorConnections }
        : {};
}

function createConnectionAttemptId(connectorId) {
    return `${String(connectorId)}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function reserveDailyConnectorConnection({ db, userId, connectorId }) {
    const connectorKey = String(connectorId);
    const todayKey = getTimeZoneDateKey();
    const attemptId = createConnectionAttemptId(connectorKey);
    const userRef = db.collection('users').doc(userId);
    let previousItemId = null;

    await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.exists ? (userSnap.data() || {}) : {};
        const dailyConnectorConnections = getDailyConnectorConnections(userData);
        const connectorEntry = dailyConnectorConnections[connectorKey];

        if (connectorEntry?.dateKey === todayKey && connectorEntry?.status === 'pending') {
            throw {
                status: 429,
                message: 'Ja existe uma conexao em andamento para este banco. Aguarde ela finalizar.',
                connectorId: connectorKey,
            };
        }

        previousItemId = connectorEntry?.itemId || null;

        dailyConnectorConnections[connectorKey] = {
            connectorId: connectorKey,
            dateKey: todayKey,
            status: 'pending',
            attemptId,
            reservedAt: new Date().toISOString(),
        };

        transaction.set(userRef, { dailyConnectorConnections }, { merge: true });
    });

    return {
        connectorKey,
        attemptId,
        previousItemId,
    };
}

async function releaseDailyConnectorConnection({ db, userId, connectorKey, attemptId }) {
    const userRef = db.collection('users').doc(userId);

    await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.exists ? (userSnap.data() || {}) : {};
        const dailyConnectorConnections = getDailyConnectorConnections(userData);
        const connectorEntry = dailyConnectorConnections[connectorKey];

        if (!connectorEntry || connectorEntry.attemptId !== attemptId || connectorEntry.status !== 'pending') {
            return;
        }

        delete dailyConnectorConnections[connectorKey];
        transaction.set(userRef, { dailyConnectorConnections }, { merge: true });
    });
}

async function completeDailyConnectorConnection({ db, userId, connectorKey, attemptId, itemId }) {
    const userRef = db.collection('users').doc(userId);

    await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.exists ? (userSnap.data() || {}) : {};
        const dailyConnectorConnections = getDailyConnectorConnections(userData);
        const connectorEntry = dailyConnectorConnections[connectorKey];

        if (!connectorEntry || connectorEntry.attemptId !== attemptId) {
            return;
        }

        dailyConnectorConnections[connectorKey] = {
            ...connectorEntry,
            status: 'completed',
            itemId: itemId || connectorEntry.itemId || null,
            completedAt: new Date().toISOString(),
        };

        transaction.set(userRef, { dailyConnectorConnections }, { merge: true });
    });
}

function pickLatestAccountSync(snapshot) {
    let latestSync = null;

    for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const syncAt = normalizeIsoDateTime(
            data.lastSync ||
            data.updatedAt ||
            data.lastSyncStartedAt ||
            data.transactionsSyncCursorAt
        );

        if (!syncAt) continue;
        if (!latestSync || syncAt > latestSync) {
            latestSync = syncAt;
        }
    }

    return latestSync;
}

async function ensureManualSyncAllowed({ db, userId, itemId, requestedAt }) {
    const requestedDate = new Date(requestedAt);
    const todayKey = getTimeZoneDateKey(requestedDate);
    const userRef = db.collection('users').doc(userId);

    const [userSnap, accountDocs] = await Promise.all([
        userRef.get(),
        loadAccountDocsByItemId({ db, userId, itemId }),
    ]);

    const latestSyncAt = pickLatestAccountSync({ docs: accountDocs.allDocs });
    let isExtraSync = false;

    if (latestSyncAt) {
        const nextAllowedAt = new Date(new Date(latestSyncAt).getTime() + MANUAL_SYNC_COOLDOWN_MS).toISOString();
        if (requestedDate.getTime() < new Date(nextAllowedAt).getTime()) {
            // Se ainda está no cooldown, é uma sincronização EXTRA
            isExtraSync = true;
        }
    }

    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    const availableCredits = getAvailableSyncCredits(userData);

    if (isExtraSync && availableCredits.extra <= 0) {
        const nextAllowedAt = new Date(new Date(latestSyncAt).getTime() + MANUAL_SYNC_COOLDOWN_MS).toISOString();
        const formattedNextAllowedAt = formatDateTimeInTimeZone(nextAllowedAt);
        throw {
            status: 429,
            message: formattedNextAllowedAt
                ? `Esta conexao ja foi sincronizada recentemente. Para sincronizar agora, voce precisa de 1 crédito extra. Proxima sincronizacao gratuita em ${formattedNextAllowedAt}.`
                : 'Esta conexao ja foi sincronizada recentemente. Aguarde 24 horas ou use um crédito extra.',
            nextAllowedAt,
            lastSyncAt: latestSyncAt,
            needsExtraCredit: true,
        };
    }

    return {
        todayKey,
        isExtraSync,
    };
}

async function consumeManualSyncCredit({ db, userId, todayKey, isExtraSync }) {
    const userRef = db.collection('users').doc(userId);
    
    // Se NÃO é extra sync (ou seja, passou das 24h), não consome nada
    if (!isExtraSync) {
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? (userSnap.data() || {}) : {};
        const availableCredits = getAvailableSyncCredits(userData);
        return availableCredits.total;
    }

    let remainingSyncCredits = 0;

    await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.exists ? (userSnap.data() || {}) : {};
        const availableCredits = getAvailableSyncCredits(userData);

        if (availableCredits.extra <= 0) {
            throw {
                status: 429,
                message: 'Voce nao possui mais créditos extras de sincronizacao.',
                remainingSyncCredits: availableCredits.free,
            };
        }

        const nextExtraCredits = availableCredits.extra - 1;
        remainingSyncCredits = availableCredits.free + nextExtraCredits;
        
        transaction.set(userRef, {
            extraSyncCredits: nextExtraCredits,
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    });

    return remainingSyncCredits;
}

function pickOldestTransactionsSyncCursor(snapshot) {
    let oldestCursor = null;

    for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const cursor = normalizeIsoDateTime(
            data.transactionsSyncCursorAt ||
            data.lastSyncStartedAt ||
            data.lastSync ||
            data.updatedAt
        );

        if (!cursor) continue;
        if (!oldestCursor || cursor < oldestCursor) {
            oldestCursor = cursor;
        }
    }

    return oldestCursor;
}

async function resolveTransactionsSyncWindow({ db, userId, itemId, from, fullHistory }) {
    if (fullHistory) {
        return {
            mode: 'full-history',
            fromDate: FULL_HISTORY_FROM_DATE,
            createdAtFrom: null,
            cursorFrom: FULL_HISTORY_FROM_DATE,
        };
    }

    let persistedCursor = null;
    if (db) {
        try {
            const accountDocs = await loadAccountDocsByItemId({
                db,
                userId,
                itemId,
            });

            persistedCursor = pickOldestTransactionsSyncCursor({ docs: accountDocs.allDocs });
        } catch (error) {
            console.warn(`[Pluggy Sync] Nao foi possivel resolver o cursor salvo do item ${itemId}: ${error?.message || error}`);
        }
    }

    const requestedCursor = normalizeIsoDateTime(from);
    const effectiveCursor = persistedCursor || requestedCursor;

    if (effectiveCursor) {
        return {
            mode: persistedCursor ? 'incremental-saved-cursor' : 'incremental-request-cursor',
            fromDate: null,
            createdAtFrom: effectiveCursor,
            cursorFrom: effectiveCursor,
        };
    }

    const fallbackFromDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return {
        mode: 'incremental-fallback-date',
        fromDate: fallbackFromDate,
        createdAtFrom: null,
        cursorFrom: fallbackFromDate,
    };
}

function getItemRefreshErrorMessage(item) {
    const snapshot = extractItemErrorSnapshot(item);
    return (
        snapshot.providerMessage ||
        snapshot.errorMessage ||
        'Nao foi possivel atualizar os dados mais recentes do banco.'
    );
}

async function waitForItemToRefresh({ itemId, userId, initialUpdatedAt }) {
    const deadline = Date.now() + ITEM_REFRESH_WAIT_TIMEOUT_MS;
    let sawUpdating = false;

    while (Date.now() <= deadline) {
        await pluggy.delay(ITEM_REFRESH_POLL_INTERVAL_MS);
        const freshItem = await ensureItemOwnership(itemId, userId);
        const status = freshItem?.status;

        if (status === 'UPDATING' || status === 'OUTDATED') {
            sawUpdating = true;
            continue;
        }

        if (status === 'WAITING_USER_INPUT') {
            throw {
                status: 409,
                message: 'O banco pediu uma nova autorizacao para atualizar esta conexao.',
            };
        }

        if (status === 'LOGIN_ERROR' || status === 'ERROR') {
            throw {
                status: 409,
                message: getItemRefreshErrorMessage(freshItem),
            };
        }

        if (status === 'UPDATED') {
            if (sawUpdating || freshItem?.updatedAt !== initialUpdatedAt) {
                return freshItem;
            }
        }
    }

    throw {
        status: 504,
        message: 'A Pluggy demorou para disponibilizar os dados novos. Tente novamente em instantes.',
    };
}

// ====================== SCHEMAS ======================
const createItemSchema = z.object({
    connectorId: z.union([z.string(), z.number()]),
    credentials: z.record(z.string(), z.any()).optional(),
    oauthRedirectUri: z.string().optional(),
    appRedirectUri: z.string().optional(),
    products: z.array(z.string().toUpperCase()).optional(),
    webhookUrl: z.string().optional(),
});

const syncSchema = z.object({
    itemId: z.string().uuid(),
    from: z.string().datetime({ offset: true }).optional(),
    fullHistory: z.boolean().optional().default(true),
    autoRefresh: z.boolean().optional().default(false),
});

const paramIdSchema = z.object({ id: z.string().uuid() });

const mapItemOwnershipError = (err) => {
    if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
        return err;
    }
    return { status: 500, message: 'Erro ao validar item' };
};

const extractItemErrorSnapshot = (item) => {
    const error = item?.error && typeof item.error === 'object' ? item.error : {};
    return {
        status: item?.status || null,
        executionStatus: item?.executionStatus || null,
        errorCode: error?.code || null,
        errorMessage: error?.message || null,
        providerMessage: error?.providerMessage || null,
        connector: item?.connector?.name || null,
        updatedAt: item?.updatedAt || null,
    };
};

const logItemDiagnostics = async (source, event, itemId) => {
    if (!itemId) return;
    try {
        const itemRes = await pluggy.safeFetch(`${PLUGGY_API_URL}/items/${itemId}`);
        if (!itemRes.ok) {
            console.warn(`[${source}] Event: ${event} | Item: ${itemId} | Snapshot unavailable (HTTP ${itemRes.status})`);
            return;
        }

        const item = await itemRes.json();
        const snapshot = extractItemErrorSnapshot(item);

        console.warn(
            `[${source}] Event: ${event} | Item: ${itemId} | Status: ${snapshot.status || 'N/A'} | Exec: ${snapshot.executionStatus || 'N/A'} | ErrorCode: ${snapshot.errorCode || 'N/A'} | ErrorMessage: ${snapshot.errorMessage || 'N/A'}`
        );
        if (snapshot.providerMessage) {
            console.warn(`[${source}] Provider detail | Item: ${itemId} | ${snapshot.providerMessage}`);
        }
    } catch (error) {
        console.warn(`[${source}] Event: ${event} | Item: ${itemId} | Failed to fetch diagnostics: ${error?.message || error}`);
    }
};

const ensureItemOwnership = async (itemId, expectedUserId) => {
    const itemRes = await pluggy.safeFetch(`${PLUGGY_API_URL}/items/${itemId}?expand=connector`);
    if (!itemRes.ok) {
        const status = itemRes.status === 404 ? 404 : 502;
        throw { status, message: 'Item não encontrado' };
    }

    const item = await itemRes.json();
    if (!item?.clientUserId || item.clientUserId !== expectedUserId) {
        throw { status: 403, message: 'Acesso negado para este item' };
    }

    return item;
};

// ====================== MIDDLEWARE DE AUTENTICAÇÃO ======================
const enforceUser = async (req, res, next) => {
    if (PUBLIC_ROUTES.some((route) => req.path.startsWith(route))) {
        return next();
    }

    if (!admin.apps.length) {
        return res.status(500).json({
            success: false,
            error: 'Firebase Admin não configurado no servidor'
        });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Token de autenticação ausente' });
    }

    try {
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        req.currentUser = decodedToken.uid;
        return next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
    }
};

router.use(enforceUser);

// ====================== ROTAS PÚBLICAS ======================
router.get('/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/events', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write('retry: 10000\n\n');
    res.write(`: connected ${Date.now()}\n\n`);

    const heartbeatId = setInterval(() => {
        try {
            if (!res.writableEnded) {
                res.write(`: heartbeat ${Date.now()}\n\n`);
            }
        } catch (error) {
            clearInterval(heartbeatId);
        }
    }, 25000);

    const client = { userId, res, heartbeatId };
    sseClients.add(client);

    const cleanup = () => {
        clearInterval(heartbeatId);
        sseClients.delete(client);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
});

router.get('/connectors', async (req, res) => {
    try {
        console.log('[/connectors] Iniciando busca de connectors. PLUGGY_SANDBOX:', env.PLUGGY_SANDBOX);
        console.log('[/connectors] CLIENT_ID configurado:', env.PLUGGY_CLIENT_ID ? env.PLUGGY_CLIENT_ID.slice(0, 8) + '...' : 'NÃO DEFINIDO');

        const resp = await pluggy.safeFetch(`${PLUGGY_API_URL}/connectors?sandbox=${env.PLUGGY_SANDBOX}&types=PERSONAL_BANK,BUSINESS_BANK`);

        console.log('[/connectors] Resposta Pluggy:', resp.status, resp.statusText);

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`[/connectors] Erro da Pluggy API: HTTP ${resp.status} - ${errData}`);
            // Retorna 200 com lista vazia para não quebrar o CORS e o frontend
            return res.status(200).json({ results: [], total: 0, page: 1, totalPages: 0 });
        }
        res.json(await resp.json());
    } catch (err) {
        console.error('[/connectors] Exceção ao buscar connectors:', err?.message || err);
        // Retorna 200 com lista vazia para não quebrar o CORS e o frontend
        return res.status(200).json({ results: [], total: 0, page: 1, totalPages: 0 });
    }
});

router.get('/oauth-callback', async (req, res) => {
    try {
        const itemId = getQueryValue(req.query.itemId);
        const status = getQueryValue(req.query.status);
        const error = getQueryValue(req.query.error);
        const appRedirectUri = toValidAppRedirectUri(getQueryValue(req.query.appRedirectUri));

        const redirectUrl = new URL(appRedirectUri);
        if (itemId) redirectUrl.searchParams.set('itemId', itemId);
        if (status) redirectUrl.searchParams.set('status', status);
        if (error) redirectUrl.searchParams.set('error', error);

        res.status(200).send(renderOAuthRedirectPage(redirectUrl.toString()));
    } catch (err) {
        res.status(500).json({ success: false, error: 'Falha ao processar callback OAuth' });
    }
});

router.post('/oauth-callback', async (req, res) => {
    const body = req.body || {};
    const event = body.event || 'OAUTH_CALLBACK';
    const itemId = body.itemId || getQueryValue(req.query.itemId) || null;
    res.status(200).json({ received: true });

    if (event === 'item/error' && itemId) {
        logItemDiagnostics('Pluggy OAuth Callback', event, itemId).catch(() => null);
    }
});

router.post('/webhook', async (req, res) => {
    const clientIp = getClientIp(req);

    if (!PLUGGY_WEBHOOK_IPS.includes(clientIp) && !isLocalIp(clientIp)) {
        return res.status(403).send('Forbidden');
    }

    const body = req.body;
    if (!body || !body.event) return res.status(400).send('Bad Request');

    const bodyErrorCode = body?.error?.code || null;
    const bodyErrorMessage = body?.error?.message || null;
    console.info(`[WEBHOOK] Evento: ${body.event} | Item: ${body.itemId} | User: ${body.clientUserId} | ErrorCode: ${bodyErrorCode || 'N/A'} | ErrorMessage: ${bodyErrorMessage || 'N/A'}`);
    res.status(200).json({ received: true });

    if (body.clientUserId) {
        const userId = body.clientUserId;
        if (body.event === 'item/updated') {
            broadcastSyncEvent(userId, {
                step: 'CONEXÃO_BEM_SUCEDIDA',
                progress: 85,
                message: 'Conexão aprovada! Buscando contas...',
                imageUrl: body.item?.connector?.imageUrl
            });
        } else if (body.event === 'item/waiting_user_input') {
            broadcastSyncEvent(userId, {
                step: 'AGUARDANDO_ACÃO',
                progress: 30,
                message: 'Aguardando sua autorização...',
                imageUrl: body.item?.connector?.imageUrl
            });
        } else if (body.event === 'item/error') {
            broadcastSyncEvent(userId, {
                step: 'ERRO',
                progress: 0,
                message: bodyErrorMessage || 'Erro na conexão',
                imageUrl: body.item?.connector?.imageUrl
            });
            logItemDiagnostics('Pluggy Webhook', body.event, body.itemId).catch(() => null);
        }
    }
});

// ====================== ROTAS AUTENTICADAS ======================
router.post('/create-item', async (req, res) => {
    let reservedConnection = null;
    try {
        const body = createItemSchema.parse(req.body);
        const appRedirectUri = body.appRedirectUri || body.oauthRedirectUri || DEFAULT_APP_REDIRECT_URI;
        const callbackUrl = buildBackendOAuthCallbackUrl(req, appRedirectUri);
        const db = admin.apps.length > 0 ? admin.firestore() : null;

        if (!db) {
            throw {
                status: 500,
                message: 'Firebase Admin nao configurado no servidor',
            };
        }

        reservedConnection = await reserveDailyConnectorConnection({
            db,
            userId: req.currentUser,
            connectorId: body.connectorId,
        });

        const reqCredentials = body.credentials || {};
        const safeParameters = {};
        for (const [key, value] of Object.entries(reqCredentials)) {
            if (value !== null && value !== undefined && value !== '') {
                safeParameters[key] = value;
            }
        }

        const payload = {
            connectorId: body.connectorId,
            parameters: safeParameters,
            clientUserId: req.currentUser,
            clientUrl: callbackUrl,
            ...(body.products && { products: body.products }),
            ...(body.webhookUrl && { webhookUrl: body.webhookUrl }),
        };

        const resp = await pluggy.safeFetch(`${PLUGGY_API_URL}/items`, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await resp.json();

        if (!resp.ok) {
            const alreadyUpdating =
                data.codeDescription?.includes('ALREADY_UPDATING') ||
                data.message?.includes('ALREADY_UPDATING') ||
                data.message?.includes("active item") ||
                data.message?.includes("hasn't finished executing");

            let errorMessage = data.message || 'Falha ao conectar';

            if (data.details && Array.isArray(data.details) && data.details.length > 0) {
                const detailMsgs = data.details.map(d => d.message).filter(Boolean);
                if (detailMsgs.length > 0) errorMessage = detailMsgs.join(' | ');
            }

            console.warn(`[Pluggy Create Item] HTTP ${resp.status} | Connector: ${body.connectorId} | User: ${req.currentUser} | Message: ${data?.message || 'N/A'}`);

            await releaseDailyConnectorConnection({
                db,
                userId: req.currentUser,
                connectorKey: reservedConnection.connectorKey,
                attemptId: reservedConnection.attemptId,
            });

            // Se já existe um item ativo e temos o ID dele, retorna para o frontend continuar o polling
            if (alreadyUpdating && reservedConnection.previousItemId) {
                console.log(`[Pluggy Create Item] Retomando item existente: ${reservedConnection.previousItemId}`);
                return res.json({
                    success: true,
                    item: { id: reservedConnection.previousItemId },
                    oauthUrl: null,
                    callbackUrl,
                    resumedExisting: true,
                });
            }

            return res.status(resp.status).json({
                success: false,
                error: alreadyUpdating ? 'Conexão já em andamento. Aguarde alguns instantes e tente novamente.' : errorMessage,
            });
        }

        const oauthUrl =
            data.oauthUrl ||
            data.parameter?.oauthUrl ||
            data.parameter?.data ||
            data.userAction?.url ||
            data.userAction?.attributes?.url ||
            null;

        completeDailyConnectorConnection({
            db,
            userId: req.currentUser,
            connectorKey: reservedConnection.connectorKey,
            attemptId: reservedConnection.attemptId,
            itemId: data?.id || null,
        }).catch((error) => {
            console.warn(`[Pluggy Create Item] Nao foi possivel concluir a trava diaria do connector ${body.connectorId}: ${error?.message || error}`);
        });

        return res.json({ success: true, item: data, oauthUrl, callbackUrl });
    } catch (err) {
        if (reservedConnection && admin.apps.length > 0) {
            try {
                await releaseDailyConnectorConnection({
                    db: admin.firestore(),
                    userId: req.currentUser,
                    connectorKey: reservedConnection.connectorKey,
                    attemptId: reservedConnection.attemptId,
                });
            } catch (releaseError) {
                console.warn(`[Pluggy Create Item] Nao foi possivel liberar a reserva diaria: ${releaseError?.message || releaseError}`);
            }
        }

        const status = err?.status || 400;
        return res.status(status).json({ success: false, error: err.message || 'Falha ao conectar' });
    }
});

router.post('/force-refresh/:id', async (req, res) => {
    try {
        const { id } = paramIdSchema.parse({ id: req.params.id });
        await ensureItemOwnership(id, req.currentUser);

        const refreshRes = await pluggy.safeFetch(`${PLUGGY_API_URL}/items/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        if (!refreshRes.ok) {
            return res.status(502).json({ success: false, error: 'Falha ao iniciar atualização do item' });
        }

        return res.status(202).json({ success: true, message: 'Sincronização iniciada!', itemId: id });
    } catch (err) {
        const mapped = mapItemOwnershipError(err);
        return res.status(mapped.status).json({ success: false, error: mapped.message });
    }
});

// ====================== SYNC (SALVA NO FIRESTORE) ======================
router.post('/sync', async (req, res) => {
    try {
        const { itemId, from, fullHistory = false, autoRefresh = false } = syncSchema.parse(req.body);
        let itemData = await ensureItemOwnership(itemId, req.currentUser);
        const syncRequestedAt = new Date().toISOString();
        const db = admin.apps.length > 0 ? admin.firestore() : null;
        const isManualIncrementalSync = autoRefresh && !fullHistory;
        let manualSyncContext = null;

        if (isManualIncrementalSync) {
            if (!db) {
                throw {
                    status: 500,
                    message: 'Firebase Admin nao configurado no servidor',
                };
            }

            manualSyncContext = await ensureManualSyncAllowed({
                db,
                userId: req.currentUser,
                itemId,
                requestedAt: syncRequestedAt,
            });
        }

        const syncWindow = await resolveTransactionsSyncWindow({
            db,
            userId: req.currentUser,
            itemId,
            from,
            fullHistory,
        });

        // No sync manual, primeiro solicita uma atualizacao nova do item na Pluggy
        // e espera o status estabilizar em UPDATED antes de buscar as transacoes.
        if (autoRefresh) {
            broadcastSyncEvent(req.currentUser, {
                step: 'ATUALIZANDO',
                progress: 8,
                message: 'Solicitando dados novos ao banco...',
                imageUrl: itemData.connector?.imageUrl
            });

            if (itemData.status !== 'UPDATING') {
                const refreshRes = await pluggy.safeFetch(`${PLUGGY_API_URL}/items/${itemId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });

                if (!refreshRes.ok && refreshRes.status !== 409) {
                    return res.status(502).json({ success: false, error: 'Falha ao iniciar atualizacao do item no banco.' });
                }
            }

            broadcastSyncEvent(req.currentUser, {
                step: 'SINCRONIZANDO',
                progress: 12,
                message: 'Aguardando a Pluggy atualizar os dados do banco...',
                imageUrl: itemData.connector?.imageUrl
            });

            itemData = await waitForItemToRefresh({
                itemId,
                userId: req.currentUser,
                initialUpdatedAt: itemData.updatedAt,
            });
        }

        broadcastSyncEvent(req.currentUser, {
            step: 'INICIANDO',
            progress: 5,
            message: 'Buscando contas...',
            imageUrl: itemData.connector?.imageUrl
        });

        // --- Busca contas do item ---
        const accountsRes = await pluggy.safeFetch(`${PLUGGY_API_URL}/accounts?itemId=${itemId}`);
        if (!accountsRes.ok) {
            return res.status(502).json({ success: false, error: 'Erro ao buscar contas do item' });
        }

        const { results: accountsList = [] } = await accountsRes.json();

        broadcastSyncEvent(req.currentUser, {
            step: 'CONTAS',
            progress: 15,
            message: `${accountsList.length} conta(s) encontrada(s). Buscando transações em paralelo...`,
            imageUrl: itemData.connector?.imageUrl
        });

        // --- Processa TODAS as contas em paralelo com Promise.allSettled ---
        // Promise.allSettled garante que uma conta com erro não cancela as outras
        const accountSettledResults = await Promise.allSettled(
            accountsList.map(async (account, idx) => {
                // Controle de concorrência: evita disparar todas de uma vez se houver muitas contas
                // (stagger leve apenas para não saturar no caso extremo de 20+ contas)
                if (idx > 0 && idx % CONCURRENT_ACCOUNTS === 0) {
                    await new Promise(r => setTimeout(r, 150));
                }

                // Transações e bills em paralelo por conta
                const [transactions, bills] = await Promise.all([
                    fetchAllTransactions(account.id, syncWindow),
                    account.type === 'CREDIT' ? fetchBills(account.id) : Promise.resolve([]),
                ]);

                if (account.type === 'CREDIT') {
                    console.log(
                        `[Pluggy Sync] CREDIT | Conta: ${account.name || account.id} | ` +
                        `Transações: ${transactions.length} | Bills: ${bills.length} | ` +
                        `closeDate: ${account.creditData?.balanceCloseDate || 'N/A'} | ` +
                        `dueDate: ${account.creditData?.balanceDueDate || 'N/A'}`
                    );
                }

                return { ...account, transactions, bills };
            })
        );

        // Separa sucessos e falhas
        const enrichedAccounts = [];
        const failedAccounts = [];

        for (let i = 0; i < accountSettledResults.length; i++) {
            const result = accountSettledResults[i];
            if (result.status === 'fulfilled') {
                enrichedAccounts.push(result.value);
            } else {
                failedAccounts.push({ account: accountsList[i], reason: result.reason?.message || String(result.reason) });
                console.error(`[Pluggy Sync] Falha na conta ${accountsList[i]?.id}: ${result.reason?.message || result.reason}`);
            }
        }

        broadcastSyncEvent(req.currentUser, {
            step: 'TRANSAÇÕES',
            progress: 70,
            message: `Transações carregadas. Salvando no banco...`,
            imageUrl: itemData.connector?.imageUrl
        });

        // ====================== SALVAR NO FIRESTORE ======================
        const syncCompletedAt = new Date().toISOString();
        const cursorToPersist = failedAccounts.length > 0 ? syncWindow.cursorFrom : syncRequestedAt;

        if (db) {
            const operations = [];
            const existingAccountDocs = await loadPluggyDocsByIds({
                db,
                userId: req.currentUser,
                collectionName: 'accounts',
                docIds: enrichedAccounts.map((account) => account.id),
            });

            for (const acc of enrichedAccounts) {
                const canonicalAccountData = existingAccountDocs.canonicalMap.get(acc.id)?.data() || null;
                const legacyAccountData = existingAccountDocs.legacyMap.get(acc.id)?.data() || null;
                const persistedInstitution = buildPersistedInstitution(itemData.connector, canonicalAccountData, legacyAccountData);
                const preservedClosingDateSettings =
                    canonicalAccountData?.closingDateSettings ||
                    legacyAccountData?.closingDateSettings ||
                    undefined;

                // --- Documento da conta ---
                const accountRef = getCanonicalPluggyDoc(db, req.currentUser, 'accounts', acc.id);
                const cleanAccount = JSON.parse(JSON.stringify({
                    id: acc.id,
                    itemId: acc.itemId,
                    type: acc.type,
                    subtype: acc.subtype || null,
                    name: acc.name,
                    number: acc.number,
                    balance: acc.balance,
                    currencyCode: acc.currencyCode,
                    bankData: acc.bankData || null,
                    creditData: acc.creditData || null,
                    institution: persistedInstitution,
                    userId: req.currentUser,
                    lastSync: syncCompletedAt,
                    updatedAt: syncCompletedAt,
                    lastSyncStartedAt: syncRequestedAt,
                    transactionsSyncCursorAt: cursorToPersist,
                    ...(preservedClosingDateSettings ? { closingDateSettings: preservedClosingDateSettings } : {}),
                    lastSyncWindow: {
                        from: syncWindow.cursorFrom,
                        requestedAt: syncRequestedAt,
                        completedAt: syncCompletedAt,
                        fullHistory,
                        mode: syncWindow.mode,
                        cursorPersistedAt: cursorToPersist,
                    },
                }));
                operations.push({ ref: accountRef, data: cleanAccount });

                // --- Transações ---
                const txCollection = acc.type === 'CREDIT' ? 'creditCardTransactions' : 'transactions';
                for (const tx of (acc.transactions || [])) {
                    if (!tx?.id) continue;
                    const txRef = getCanonicalPluggyDoc(db, req.currentUser, txCollection, tx.id);
                    const cleanTx = JSON.parse(JSON.stringify({
                        ...tx,
                        accountId: acc.id,
                        accountType: acc.type,
                        userId: req.currentUser,
                        syncedAt: syncCompletedAt,
                    }));
                    operations.push({ ref: txRef, data: cleanTx });
                }

                // --- Bills (faturas de cartão) ---
                if (acc.type === 'CREDIT' && acc.bills?.length > 0) {
                    for (const bill of acc.bills) {
                        if (!bill?.id) continue;
                        const billRef = getCanonicalPluggyDoc(db, req.currentUser, 'creditCardBills', bill.id);
                        const cleanBill = JSON.parse(JSON.stringify({
                            ...bill,
                            accountId: acc.id,
                            userId: req.currentUser,
                            syncedAt: syncCompletedAt,
                        }));
                        operations.push({ ref: billRef, data: cleanBill });
                    }
                }
            }

            let autoSubscriptionResult = { operations: [], count: 0 };
            try {
                autoSubscriptionResult = await buildAutoSubscriptionOperations({
                    db,
                    userId: req.currentUser,
                    enrichedAccounts,
                    syncCompletedAt,
                });
                operations.push(...autoSubscriptionResult.operations);
            } catch (subscriptionDetectionError) {
                console.error('[Pluggy Backend] Falha ao detectar assinaturas automaticamente:', subscriptionDetectionError?.message || subscriptionDetectionError);
            }

            broadcastSyncEvent(req.currentUser, {
                step: 'SALVANDO',
                progress: 85,
                message: `Salvando ${operations.length} registros...`,
                imageUrl: itemData.connector?.imageUrl
            });

            const totalSaved = await commitInBatches(db, operations);
            console.log(
                `[Pluggy Backend] ${totalSaved} documentos salvos no Firestore ` +
                `(${enrichedAccounts.length} conta(s), ${failedAccounts.length} falha(s), ` +
                `${autoSubscriptionResult.count} assinatura(s) detectada(s)).`
            );
        } else {
            console.warn('[Pluggy Backend] Firebase Admin não inicializado — dados NÃO foram salvos no Firestore.');
        }

        let remainingSyncCredits = null;
        if (isManualIncrementalSync && db && manualSyncContext) {
            remainingSyncCredits = await consumeManualSyncCredit({
                db,
                userId: req.currentUser,
                todayKey: manualSyncContext.todayKey,
                isExtraSync: manualSyncContext.isExtraSync,
            });
        }

        broadcastSyncEvent(req.currentUser, {
            step: 'FINALIZADO',
            progress: 100,
            message: failedAccounts.length > 0
                ? `Sincronizado com avisos: ${failedAccounts.length} conta(s) com erro`
                : 'Sincronização concluída!',
            imageUrl: itemData.connector?.imageUrl
        });

        const totalTransactions = enrichedAccounts.reduce((sum, acc) => sum + (acc.transactions?.length || 0), 0);
        const totalBills = enrichedAccounts.reduce((sum, acc) => sum + (acc.bills?.length || 0), 0);

        return res.json({
            success: true,
            itemStatus: itemData.status,
            lastUpdatedAt: itemData.updatedAt,
            isRefreshing: itemData.status === 'UPDATING' || autoRefresh,
            connector: itemData.connector || null,
            accounts: enrichedAccounts.map(acc => ({
                id: acc.id,
                name: acc.name,
                type: acc.type,
                balance: acc.balance,
                currencyCode: acc.currencyCode,
                transactionCount: acc.transactions?.length || 0,
                billCount: acc.bills?.length || 0,
            })),
            failedAccounts: failedAccounts.length > 0 ? failedAccounts : undefined,
            totalTransactions,
            totalBills,
            syncWindow: {
                from: syncWindow.cursorFrom,
                fullHistory,
                mode: syncWindow.mode,
                requestedAt: syncRequestedAt,
                completedAt: syncCompletedAt,
                cursorPersistedAt: cursorToPersist,
            },
            syncedAt: syncCompletedAt,
            remainingSyncCredits,
        });

    } catch (err) {
        broadcastSyncEvent(req.currentUser, { step: 'ERRO', progress: 0, message: err.message });
        const mapped = mapItemOwnershipError(err);
        const payload = {
            success: false,
            error: mapped.message || 'Erro ao buscar dados sincronizados.',
        };

        if (mapped.nextAllowedAt) payload.nextAllowedAt = mapped.nextAllowedAt;
        if (mapped.lastSyncAt) payload.lastSyncAt = mapped.lastSyncAt;
        if (mapped.needsExtraCredit) payload.needsExtraCredit = true;
        if (typeof mapped.remainingSyncCredits === 'number') {
            payload.remainingSyncCredits = mapped.remainingSyncCredits;
        }

        return res.status(mapped.status).json(payload);
    }
});



// ====================== ITEMS ======================
router.get('/items', async (req, res) => {
    try {
        const resp = await pluggy.safeFetch(`${PLUGGY_API_URL}/items?clientUserId=${req.currentUser}`);
        if (!resp.ok) return res.status(502).json({ success: false, error: 'Erro ao listar items' });
        return res.json(await resp.json());
    } catch (err) {
        return res.status(502).json({ success: false, error: 'Erro ao listar items' });
    }
});

router.get('/items/:id', async (req, res) => {
    try {
        const { id } = paramIdSchema.parse({ id: req.params.id });
        const item = await ensureItemOwnership(id, req.currentUser);

        if (req.currentUser) {
            if (item.status === 'UPDATED') {
                broadcastSyncEvent(req.currentUser, {
                    step: 'CONEXÃO_BEM_SUCEDIDA',
                    progress: 85,
                    message: 'Conexão aprovada!',
                    imageUrl: item.connector?.imageUrl
                });
            } else if (item.status === 'UPDATING') {
                broadcastSyncEvent(req.currentUser, {
                    step: 'SINCRONIZANDO',
                    progress: 40,
                    message: 'Sincronizando com o banco...',
                    imageUrl: item.connector?.imageUrl
                });
            } else if (item.status === 'WAITING_USER_INPUT') {
                broadcastSyncEvent(req.currentUser, {
                    step: 'AGUARDANDO_ACÃO',
                    progress: 30,
                    message: 'Aguardando autorização...',
                    imageUrl: item.connector?.imageUrl
                });
            }
        }

        return res.json({ success: true, item });
    } catch (err) {
        const mapped = mapItemOwnershipError(err);
        return res.status(mapped.status).json({ success: false, error: mapped.message });
    }
});

router.delete('/items/:id', async (req, res) => {
    try {
        const { id } = paramIdSchema.parse({ id: req.params.id });
        const userId = req.currentUser;

        console.log(`[Pluggy Delete] Solicitando exclusão do item ${id} para o usuário ${userId}`);

        // 1. Tenta validar e remover do Pluggy (gracefully se já não existir)
        try {
            const item = await ensureItemOwnership(id, userId);
            if (item) {
                const deleteRes = await pluggy.safeFetch(`${PLUGGY_API_URL}/items/${id}`, { method: 'DELETE' });
                if (!deleteRes.ok && deleteRes.status !== 404) {
                    console.error(`[Pluggy Delete] Falha ao remover do Pluggy: ${deleteRes.status}`);
                    return res.status(502).json({ success: false, error: 'Falha ao desconectar item no Pluggy' });
                }
            }
        } catch (err) {
            if (err.status !== 404) {
                console.error(`[Pluggy Delete] Erro na validação do item:`, err);
                throw err;
            }
            console.log(`[Pluggy Delete] Item ${id} já não existe no Pluggy. Procedendo com limpeza local.`);
        }

        // 2. Limpeza no Firestore em paralelo por coleção
        if (admin.apps.length > 0) {
            const db = admin.firestore();
            const accountDocs = await loadAccountDocsByItemId({
                db,
                userId,
                itemId: id,
            });

            console.log(`[Pluggy Delete] Removendo ${accountDocs.allDocs.length} conta(s) e seus dados associados.`);

            // Busca todos os docs filhos em paralelo
            const refsToDelete = accountDocs.allDocs.map((accountDoc) => accountDoc.ref);
            const accountIds = [...new Set(accountDocs.allDocs.map((accountDoc) => accountDoc.id))];

            await Promise.all(accountIds.map(async (accountId) => {
                const [bankTransactions, creditTransactions, creditBills] = await Promise.all([
                    loadPluggyDocsByQuery({
                        db,
                        userId,
                        collectionName: 'transactions',
                        filters: [{ field: 'accountId', op: '==', value: accountId }],
                    }),
                    loadPluggyDocsByQuery({
                        db,
                        userId,
                        collectionName: 'creditCardTransactions',
                        filters: [{ field: 'accountId', op: '==', value: accountId }],
                    }),
                    loadPluggyDocsByQuery({
                        db,
                        userId,
                        collectionName: 'creditCardBills',
                        filters: [{ field: 'accountId', op: '==', value: accountId }],
                    }),
                ]);

                bankTransactions.allDocs.forEach((doc) => refsToDelete.push(doc.ref));
                creditTransactions.allDocs.forEach((doc) => refsToDelete.push(doc.ref));
                creditBills.allDocs.forEach((doc) => refsToDelete.push(doc.ref));
            }));

            const totalDeleted = await deleteInBatches(db, refsToDelete);
            console.log(`[Pluggy Delete] ${totalDeleted} documento(s) removidos do Firestore para o item ${id}.`);
        } else {
            console.warn('[Pluggy Delete] Firebase Admin não inicializado. Limpeza local ignorada.');
        }

        return res.json({ success: true, message: 'Item e dados associados removidos com sucesso' });
    } catch (err) {
        console.error('[Pluggy Delete] Erro fatal:', err);
        const mapped = mapItemOwnershipError(err);
        return res.status(mapped.status || 500).json({ success: false, error: mapped.message });
    }
});

export default router;
