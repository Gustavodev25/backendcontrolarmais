import express from 'express';
import Stripe from 'stripe';
import admin from 'firebase-admin';
import { sendUtmifySale } from './utmify.js';
import { sendWelcomeEmail } from './emails.js';


const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2023-10-16',
    })
    : null;

const SYNC_CREDIT_COMBOS = Object.freeze([
    {
        id: 'combo_light',
        name: 'Light',
        amount: 4.90,
        credits: 7,
        description: '7 atualizacoes',
    },
    {
        id: 'combo_performance',
        name: 'Performance',
        amount: 14.90,
        credits: 28,
        description: '28 atualizacoes',
    },
    {
        id: 'combo_full',
        name: 'Full',
        amount: 49.90,
        credits: 9999,
        description: 'Ilimitado',
    },
]);

const STRIPE_ACTIVE_SUBSCRIPTION_STATUSES = new Set([
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'paused',
    'incomplete',
]);

function createError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function getDb() {
    return admin.apps.length ? admin.firestore() : null;
}

function requireDb() {
    const db = getDb();
    if (!db) {
        throw createError(500, 'Firebase Admin nao configurado no servidor.');
    }
    return db;
}

function requireStripe() {
    if (!stripe) {
        throw createError(500, 'Stripe nao configurado no servidor.');
    }
    return stripe;
}

function requireStripePriceId() {
    const priceId = String(process.env.STRIPE_PRO_MONTHLY_PRICE_ID || '').trim();
    if (!priceId) {
        throw createError(500, 'STRIPE_PRO_MONTHLY_PRICE_ID nao configurado.');
    }
    return priceId;
}

function getUserRef(uid) {
    return requireDb().collection('users').doc(uid);
}

function getInvoiceRef(uid, invoiceId) {
    return getUserRef(uid).collection('invoices').doc(invoiceId);
}

function getSyncCreditPaymentRef(uid, paymentId) {
    return getUserRef(uid).collection('syncCreditPayments').doc(paymentId);
}

function roundCurrencyToCents(value) {
    return Math.round(Number(value || 0) * 100);
}

function findSyncCreditComboById(comboId) {
    return SYNC_CREDIT_COMBOS.find((combo) => combo.id === comboId) || null;
}

function normalizeExtraSyncCredits(value) {
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function expandDottedObject(flatObject = {}) {
    const result = {};

    for (const [key, value] of Object.entries(flatObject)) {
        if (value === undefined) continue;

        if (!key.includes('.')) {
            result[key] = value;
            continue;
        }

        const parts = key.split('.');
        let cursor = result;

        while (parts.length > 1) {
            const part = parts.shift();
            if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
                cursor[part] = {};
            }
            cursor = cursor[part];
        }

        cursor[parts[0]] = value;
    }

    return result;
}

async function mergeUserData(uid, flatPayload = {}) {
    const payload = expandDottedObject(flatPayload);
    await getUserRef(uid).set(payload, { merge: true });
}

async function getUserData(uid) {
    const userSnap = await getUserRef(uid).get();
    return userSnap.exists ? (userSnap.data() || {}) : null;
}

async function verifyFirebaseRequest(req) {
    if (!admin.apps.length) {
        return { ok: false, status: 500, error: 'Firebase Admin nao configurado no servidor.' };
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { ok: false, status: 401, error: 'Token de autenticacao ausente.' };
    }

    try {
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        return { ok: true, uid: decodedToken.uid, user: decodedToken };
    } catch (_error) {
        return { ok: false, status: 401, error: 'Token invalido ou expirado.' };
    }
}

function normalizeOrigin(origin) {
    try {
        const parsed = new URL(String(origin || '').trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('invalid_protocol');
        }
        return `${parsed.protocol}//${parsed.host}`;
    } catch (_error) {
        throw createError(400, 'Origin invalida para retorno do Checkout.');
    }
}

function buildReturnUrl(origin, query = {}) {
    const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null);
    if (!entries.length) return origin;

    const queryString = entries
        .map(([key, value]) => {
            const normalizedValue = String(value);
            const encodedValue = normalizedValue === '{CHECKOUT_SESSION_ID}'
                ? normalizedValue
                : encodeURIComponent(normalizedValue);

            return `${encodeURIComponent(key)}=${encodedValue}`;
        })
        .join('&');

    return `${origin}${origin.includes('?') ? '&' : '?'}${queryString}`;
}

function formatDateIso(value) {
    if (!value) return null;

    const date = value instanceof Date
        ? value
        : new Date(typeof value === 'number' ? value * 1000 : value);

    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function formatDateOnly(value) {
    const isoDate = formatDateIso(value);
    return isoDate ? isoDate.split('T')[0] : null;
}

function formatAmountDisplayFromCents(amountInCents) {
    if (!Number.isFinite(amountInCents)) return null;
    return (amountInCents / 100).toFixed(2).replace('.', ',');
}

function normalizeInvoiceStatus(status) {
    return String(status || '').trim().toUpperCase().replace(/-/g, '_') || 'OPEN';
}

function formatCardExpiry(card) {
    if (!card?.exp_month || !card?.exp_year) return null;
    return `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}`;
}

function extractCardSnapshot({ paymentMethod, subscription }) {
    const pm = paymentMethod
        || (subscription?.default_payment_method && typeof subscription.default_payment_method === 'object'
            ? subscription.default_payment_method
            : null);

    const card = pm?.card || null;
    if (!card) return null;

    return {
        brand: card.brand ? String(card.brand).toUpperCase() : null,
        last4: card.last4 || null,
        expiry: formatCardExpiry(card),
    };
}

function mapStripeSubscriptionStatusToUserStatus(status) {
    const normalized = String(status || '').toLowerCase();
    if (['active', 'trialing'].includes(normalized)) return 'active';
    if (['past_due', 'unpaid', 'incomplete'].includes(normalized)) return 'overdue';
    if (['canceled', 'incomplete_expired', 'paused'].includes(normalized)) return 'inactive';
    return 'pending';
}

async function getUidFromStripeCustomerId(customerId) {
    if (!customerId) return null;

    const stripeClient = requireStripe();
    try {
        const customer = await stripeClient.customers.retrieve(customerId);
        if (!customer.deleted && customer.metadata?.firebaseUID) {
            return customer.metadata.firebaseUID;
        }
    } catch (_error) {
        // fallback to Firestore lookup below
    }

    const db = requireDb();
    const snap = await db
        .collection('users')
        .where('subscription.stripeCustomerId', '==', customerId)
        .limit(1)
        .get();

    if (!snap.empty) {
        return snap.docs[0].id;
    }

    return null;
}

function extractRealStripeCustomerId(value) {
    if (!value || typeof value !== 'string') return null;
    // If it's already a valid Stripe customer ID, return as-is
    if (/^cus_[A-Za-z0-9]+$/.test(value.trim())) return value.trim();
    // Old Ruby backend may have stored the full customer object as a Ruby hash string
    // e.g. "{:id=>\"cus_xxx\", :email=>\"...\"}"
    const match = value.match(/:id=>"(cus_[A-Za-z0-9]+)"/);
    return match ? match[1] : null;
}

async function ensureStripeCustomerForUser({ uid, userData }) {
    const stripeClient = requireStripe();
    const rawCustomerId = userData?.subscription?.stripeCustomerId || null;
    const existingCustomerId = extractRealStripeCustomerId(rawCustomerId);
    const name = userData?.name || userData?.profile?.name || null;
    const email = userData?.email || userData?.profile?.email || null;
    // Strip phone to E.164 or drop it — Stripe accepts free-form but some configs reject invalid formats
    const rawPhone = userData?.profile?.phone || userData?.phone || null;
    const phone = rawPhone || null;

    let customer = null;

    if (existingCustomerId) {
        try {
            const retrieved = await stripeClient.customers.retrieve(existingCustomerId);
            if (!retrieved.deleted) {
                customer = retrieved;
            }
        } catch (_error) {
            customer = null;
        }
    }

    if (!customer) {
        customer = await stripeClient.customers.create({
            name: name || undefined,
            email: email || undefined,
            phone: phone || undefined,
            metadata: {
                firebaseUID: uid,
            },
        });
    } else {
        customer = await stripeClient.customers.update(customer.id, {
            name: name || undefined,
            email: email || undefined,
            phone: phone || undefined,
            metadata: {
                ...(customer.metadata || {}),
                firebaseUID: uid,
            },
        });
    }

    await mergeUserData(uid, {
        'subscription.provider': 'stripe',
        'subscription.stripeCustomerId': customer.id,
        updatedAt: new Date().toISOString(),
    });

    return customer;
}

async function findManagedStripeSubscription(customerId) {
    const stripeClient = requireStripe();
    const subscriptions = await stripeClient.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20,
    });

    return subscriptions.data.find((subscription) => {
        if (!subscription) return false;
        if (subscription.cancel_at_period_end && ['active', 'trialing', 'past_due'].includes(subscription.status)) {
            return true;
        }
        return STRIPE_ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status);
    }) || null;
}

async function createPortalSession(customerId, returnUrl) {
    const stripeClient = requireStripe();
    return stripeClient.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
    });
}

async function getSubscriptionWithExpansions(subscriptionId) {
    const stripeClient = requireStripe();
    return stripeClient.subscriptions.retrieve(subscriptionId, {
        expand: [
            'default_payment_method',
            'items.data.price',
            'latest_invoice.payment_intent.payment_method',
        ],
    });
}

async function getInvoiceWithExpansions(invoiceId) {
    const stripeClient = requireStripe();
    return stripeClient.invoices.retrieve(invoiceId, {
        expand: [
            'payment_intent.payment_method',
        ],
    });
}

function getInvoiceIdFromEventPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;

    if (payload.object === 'invoice' && payload.id) {
        return payload.id;
    }

    if (typeof payload.invoice === 'string') {
        return payload.invoice;
    }

    if (payload.invoice && typeof payload.invoice === 'object' && payload.invoice.id) {
        return payload.invoice.id;
    }

    return null;
}

async function resolveInvoiceContext(invoicePayload) {
    const invoiceId = getInvoiceIdFromEventPayload(invoicePayload);
    if (!invoiceId) {
        throw createError(400, 'Evento Stripe sem invoice vinculada.');
    }

    const invoice = await getInvoiceWithExpansions(invoiceId);
    const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id || null;
    const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id || null;
    const subscription = subscriptionId
        ? await getSubscriptionWithExpansions(subscriptionId)
        : null;

    return {
        invoice,
        customerId,
        subscriptionId,
        subscription,
    };
}

async function upsertInvoiceForUser(uid, invoiceEntry) {
    if (!invoiceEntry?.id) return;

    const db = requireDb();
    const userRef = getUserRef(uid);
    const invoiceRef = getInvoiceRef(uid, invoiceEntry.id);
    const now = new Date().toISOString();

    await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.exists ? (userSnap.data() || {}) : {};
        const invoices = Array.isArray(userData.invoices) ? userData.invoices : [];
        const filteredInvoices = invoices.filter((invoice) => {
            const invoiceId = invoice?.id || invoice?.stripeInvoiceId || null;
            return invoiceId !== invoiceEntry.id;
        });

        transaction.set(invoiceRef, invoiceEntry, { merge: true });
        transaction.set(userRef, {
            invoices: [invoiceEntry, ...filteredInvoices].slice(0, 24),
            updatedAt: now,
        }, { merge: true });
    });
}


function buildStripeInvoiceEntry({ invoice, subscription, paymentMethodSnapshot }) {
    const amount = Number.isFinite(invoice?.amount_paid) && invoice.amount_paid > 0
        ? invoice.amount_paid
        : invoice?.amount_due;
    const recurringInterval = subscription?.items?.data?.[0]?.price?.recurring?.interval || 'month';
    const cardLabel = paymentMethodSnapshot?.brand ? ` - ${paymentMethodSnapshot.brand}` : '';

    return {
        id: invoice.id,
        provider: 'stripe',
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: subscription?.id || invoice.subscription || null,
        status: normalizeInvoiceStatus(invoice.status),
        amount: formatAmountDisplayFromCents(amount),
        value: Number.isFinite(amount) ? amount / 100 : null,
        date: formatDateIso(invoice.created),
        dueDate: formatDateOnly(invoice.due_date || subscription?.current_period_end || invoice.created),
        description: invoice.description || `Plano Pro - Cobranca ${recurringInterval === 'year' ? 'anual' : 'mensal'}${cardLabel}`,
        hostedInvoiceUrl: invoice.hosted_invoice_url || null,
        invoicePdf: invoice.invoice_pdf || null,
        paymentMethodBrand: paymentMethodSnapshot?.brand || null,
        paymentMethodLast4: paymentMethodSnapshot?.last4 || null,
    };
}

async function applyActiveStripeSubscription({
    uid,
    customerId,
    subscription,
    invoice = null,
}) {
    const price = subscription?.items?.data?.[0]?.price || null;
    const amountInCents = price?.unit_amount ?? invoice?.amount_paid ?? invoice?.amount_due ?? null;
    const paymentMethod = invoice?.payment_intent?.payment_method && typeof invoice.payment_intent.payment_method === 'object'
        ? invoice.payment_intent.payment_method
        : null;
    const paymentMethodSnapshot = extractCardSnapshot({ paymentMethod, subscription });
    const now = new Date().toISOString();
    const nextBillingDate = formatDateOnly(subscription?.current_period_end);
    const currentPeriodEnd = formatDateIso(subscription?.current_period_end);
    const interval = price?.recurring?.interval || 'month';
    const priceDisplay = formatAmountDisplayFromCents(amountInCents);
    const userStatus = mapStripeSubscriptionStatusToUserStatus(subscription?.status || 'active');

    const updatePayload = {
        'subscription.provider': 'stripe',
        'subscription.plan': userStatus === 'inactive' ? 'free' : 'pro',
        'subscription.status': userStatus === 'pending' ? 'active' : userStatus,
        'subscription.stripeCustomerId': customerId,
        'subscription.stripeSubscriptionId': subscription?.id || null,
        'subscription.stripePriceId': price?.id || null,
        'subscription.currentPeriodEnd': currentPeriodEnd,
        'subscription.nextBillingDate': nextBillingDate,
        'subscription.cancelAtPeriodEnd': Boolean(subscription?.cancel_at_period_end),
        'subscription.autoRenew': !subscription?.cancel_at_period_end,
        'subscription.billingCycle': interval === 'year' ? 'annual' : 'mensal',
        'subscription.startDate': formatDateOnly(subscription?.start_date),
        updatedAt: now,
    };

    console.log('[applyActiveStripeSubscription] Salvando payload:', {
        currentPeriodEnd,
        nextBillingDate,
        'subscription.current_period_end': subscription?.current_period_end,
    });

    if (priceDisplay) {
        updatePayload['subscription.price'] = priceDisplay;
        updatePayload['subscription.nextAmount'] = priceDisplay;
    }

    if (paymentMethodSnapshot?.brand) {
        updatePayload['subscription.creditCardBrand'] = paymentMethodSnapshot.brand;
        updatePayload['paymentMethodDetails.brand'] = paymentMethodSnapshot.brand;
    }

    if (paymentMethodSnapshot?.last4) {
        updatePayload['subscription.creditCardLast4'] = paymentMethodSnapshot.last4;
        updatePayload['paymentMethodDetails.last4'] = paymentMethodSnapshot.last4;
    }

    if (paymentMethodSnapshot?.expiry) {
        updatePayload['paymentMethodDetails.expiry'] = paymentMethodSnapshot.expiry;
    }

    await mergeUserData(uid, updatePayload);

    if (invoice?.id) {
        const invoiceEntry = buildStripeInvoiceEntry({
            invoice,
            subscription,
            paymentMethodSnapshot,
        });
        await upsertInvoiceForUser(uid, invoiceEntry);
    }
}

async function syncStripeSubscriptionFromSession(session) {
    const customerId = typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id || null;
    const uid = session.client_reference_id || session.metadata?.firebaseUID || await getUidFromStripeCustomerId(customerId);
    const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id || null;

    if (!uid || !subscriptionId) {
        return { handled: false };
    }

    const subscription = await getSubscriptionWithExpansions(subscriptionId);
    const latestInvoice = subscription.latest_invoice && typeof subscription.latest_invoice === 'object'
        ? subscription.latest_invoice
        : null;

    await applyActiveStripeSubscription({
        uid,
        customerId,
        subscription,
        invoice: latestInvoice,
    });

    return {
        handled: true,
        uid,
        subscriptionId,
        customerId,
    };
}

async function applyStripeSyncCreditsFromSession(session, source = 'unknown') {
    const db = requireDb();
    const uid = session.client_reference_id || session.metadata?.firebaseUID || null;
    const comboId = session.metadata?.comboId || null;
    const combo = findSyncCreditComboById(comboId);

    if (!uid || !combo) {
        return { handled: false, credited: false };
    }

    if (roundCurrencyToCents(combo.amount) !== Number(session.amount_total || 0)) {
        throw createError(400, 'Valor da sessao Stripe divergente do pacote de creditos.');
    }

    const paymentRef = getSyncCreditPaymentRef(uid, session.id);
    const userRef = getUserRef(uid);
    const now = new Date().toISOString();

    let result = {
        handled: true,
        credited: false,
        creditsGranted: 0,
        extraSyncCredits: null,
    };

    await db.runTransaction(async (transaction) => {
        const [paymentSnap, userSnap] = await Promise.all([
            transaction.get(paymentRef),
            transaction.get(userRef),
        ]);

        const paymentData = paymentSnap.exists ? (paymentSnap.data() || {}) : {};
        const userData = userSnap.exists ? (userSnap.data() || {}) : {};
        const wasCredited = paymentData.credited === true;
        const shouldCredit = session.payment_status === 'paid';
        const currentExtraCredits = normalizeExtraSyncCredits(userData.extraSyncCredits);
        const nextExtraCredits = shouldCredit && !wasCredited
            ? currentExtraCredits + combo.credits
            : currentExtraCredits;
        const customerId = typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id || null;
        const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id || null;

        transaction.set(paymentRef, {
            userId: uid,
            provider: 'stripe',
            paymentId: session.id,
            checkoutSessionId: session.id,
            paymentIntentId,
            comboId: combo.id,
            comboName: combo.name,
            credits: combo.credits,
            amount: combo.amount,
            customerId,
            status: session.payment_status || session.status || 'open',
            lastStatusSource: source,
            credited: wasCredited || shouldCredit,
            creditsGranted: wasCredited ? (paymentData.creditsGranted || combo.credits) : (shouldCredit ? combo.credits : 0),
            extraSyncCreditsAfterCredit: shouldCredit ? nextExtraCredits : currentExtraCredits,
            createdAt: paymentData.createdAt || formatDateIso(session.created) || now,
            updatedAt: now,
            creditedAt: wasCredited
                ? paymentData.creditedAt || now
                : (shouldCredit ? now : paymentData.creditedAt || null),
        }, { merge: true });

        if (shouldCredit && !wasCredited) {
            transaction.set(userRef, {
                extraSyncCredits: nextExtraCredits,
                updatedAt: now,
                subscription: {
                    ...(userData.subscription || {}),
                    provider: userData?.subscription?.provider || 'stripe',
                    ...(customerId ? { stripeCustomerId: customerId } : {}),
                },
            }, { merge: true });

            // Postback Utmify
            const amount = Number(session.amount_total || 0) / 100;
            if (amount > 0) {
                sendUtmifySale({
                    orderId: session.id,
                    email: userData.email || userData.profile?.email,
                    name: userData.name || userData.profile?.name,
                    phone: userData.phone || userData.profile?.phone,
                    value: amount,
                    productName: `Créditos Extras | ${combo.name}`,
                    productId: combo.id,
                    document: userData.cpf || userData.profile?.cpf
                });
            }
        }

        result = {
            handled: true,
            credited: wasCredited || shouldCredit,
            creditsGranted: shouldCredit && !wasCredited ? combo.credits : (paymentData.creditsGranted || 0),
            extraSyncCredits: nextExtraCredits,
        };
    });

    return result;
}

async function handleInvoicePaid(invoicePayload) {
    const {
        invoice,
        customerId,
        subscription,
    } = await resolveInvoiceContext(invoicePayload);
    const uid = await getUidFromStripeCustomerId(customerId);
    if (!uid) {
        console.warn('[handleInvoicePaid] UID não encontrado para customerId:', customerId);
        return { handled: false };
    }

    console.log('[handleInvoicePaid] Processando fatura paga:', {
        invoiceId: invoice?.id,
        subscriptionId: subscription?.id,
        uid,
        invoiceAmount: invoice?.amount_paid,
        invoiceDate: invoice?.created,
        currentPeriodEnd: subscription?.current_period_end,
        currentPeriodStart: subscription?.current_period_start,
        nextBillingDate: formatDateOnly(subscription?.current_period_end),
    });
    console.log('[handleInvoicePaid] Subscription completa:', {
        status: subscription?.status,
        cancel_at_period_end: subscription?.cancel_at_period_end,
        current_period_end: subscription?.current_period_end,
        current_period_start: subscription?.current_period_start,
    });

    await applyActiveStripeSubscription({
        uid,
        customerId,
        subscription,
        invoice,
    });

    console.log('[handleInvoicePaid] Fatura processada com sucesso para UID:', uid);

    // Postback Utmify
    try {
        const userSnap = await requireDb().collection('users').doc(uid).get();
        const userData = userSnap.data() || {};
        const amount = (invoice?.amount_paid || 0) / 100;
        
        if (amount > 0) {
            sendUtmifySale({
                orderId: invoice.id,
                email: userData.email || userData.profile?.email,
                name: userData.name || userData.profile?.name,
                phone: userData.phone || userData.profile?.phone,
                value: amount,
                document: userData.cpf || userData.profile?.cpf
            });
        }
        
        // Enviar email de boas-vindas se for o primeiro pagamento
        await checkAndSendWelcomeEmail(uid, userData);
    } catch (err) {
        console.error('[Utmify] Erro ao buscar dados do usuario para postback:', err.message);
    }

    return { handled: true, uid };
}

/**
 * Envia o e-mail de boas-vindas se for o primeiro pagamento bem-sucedido.
 */
async function checkAndSendWelcomeEmail(uid, userData) {
    if (userData.welcomeEmailSent) return;

    try {
        await sendWelcomeEmail({
            email: userData.email || userData.profile?.email,
            name: userData.name || userData.profile?.name
        });
        
        await getUserRef(uid).set({
            welcomeEmailSent: true,
            welcomeEmailSentAt: new Date().toISOString()
        }, { merge: true });

        console.log(`[WelcomeEmail] Email enviado com sucesso para ${uid}`);
    } catch (err) {
        console.error(`[WelcomeEmail] Erro ao enviar para ${uid}:`, err.message);
    }
}


async function handleInvoicePaymentFailed(invoicePayload) {
    const {
        invoice,
        customerId,
        subscriptionId,
        subscription,
    } = await resolveInvoiceContext(invoicePayload);
    const uid = await getUidFromStripeCustomerId(customerId);
    if (!uid) return { handled: false };
    const paymentMethodSnapshot = extractCardSnapshot({
        paymentMethod: invoice?.payment_intent?.payment_method,
        subscription,
    });

    await mergeUserData(uid, {
        'subscription.provider': 'stripe',
        'subscription.plan': 'pro',
        'subscription.status': 'overdue',
        'subscription.stripeCustomerId': customerId,
        'subscription.stripeSubscriptionId': subscription?.id || subscriptionId || null,
        'subscription.stripePriceId': subscription?.items?.data?.[0]?.price?.id || null,
        'subscription.currentPeriodEnd': formatDateIso(subscription?.current_period_end),
        'subscription.nextBillingDate': formatDateOnly(subscription?.current_period_end),
        'subscription.cancelAtPeriodEnd': Boolean(subscription?.cancel_at_period_end),
        'subscription.autoRenew': !subscription?.cancel_at_period_end,
        updatedAt: new Date().toISOString(),
        ...(paymentMethodSnapshot?.brand ? {
            'subscription.creditCardBrand': paymentMethodSnapshot.brand,
            'paymentMethodDetails.brand': paymentMethodSnapshot.brand,
        } : {}),
        ...(paymentMethodSnapshot?.last4 ? {
            'subscription.creditCardLast4': paymentMethodSnapshot.last4,
            'paymentMethodDetails.last4': paymentMethodSnapshot.last4,
        } : {}),
        ...(paymentMethodSnapshot?.expiry ? {
            'paymentMethodDetails.expiry': paymentMethodSnapshot.expiry,
        } : {}),
    });

    const invoiceEntry = buildStripeInvoiceEntry({
        invoice,
        subscription,
        paymentMethodSnapshot,
    });
    await upsertInvoiceForUser(uid, invoiceEntry);

    return { handled: true, uid };
}

async function handleSubscriptionUpdated(subscriptionPayload) {
    const customerId = typeof subscriptionPayload.customer === 'string'
        ? subscriptionPayload.customer
        : subscriptionPayload.customer?.id || null;
    const uid = await getUidFromStripeCustomerId(customerId);
    if (!uid) {
        console.warn('[handleSubscriptionUpdated] UID não encontrado para customerId:', customerId);
        return { handled: false };
    }

    const subscription = await getSubscriptionWithExpansions(subscriptionPayload.id);
    const price = subscription?.items?.data?.[0]?.price || null;
    const paymentMethodSnapshot = extractCardSnapshot({
        paymentMethod: null,
        subscription,
    });
    const userStatus = mapStripeSubscriptionStatusToUserStatus(subscription.status);

    console.log('[handleSubscriptionUpdated] Assinatura atualizada:', {
        subscriptionId: subscription.id,
        uid,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        nextBillingDate: formatDateOnly(subscription.current_period_end),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });

    await mergeUserData(uid, {
        'subscription.provider': 'stripe',
        'subscription.plan': userStatus === 'inactive' ? 'free' : 'pro',
        'subscription.status': userStatus,
        'subscription.stripeCustomerId': customerId,
        'subscription.stripeSubscriptionId': subscription.id,
        'subscription.stripePriceId': price?.id || null,
        'subscription.currentPeriodEnd': formatDateIso(subscription.current_period_end),
        'subscription.nextBillingDate': formatDateOnly(subscription.current_period_end),
        'subscription.cancelAtPeriodEnd': Boolean(subscription.cancel_at_period_end),
        'subscription.autoRenew': !subscription.cancel_at_period_end,
        updatedAt: new Date().toISOString(),
        ...(paymentMethodSnapshot?.brand ? {
            'subscription.creditCardBrand': paymentMethodSnapshot.brand,
            'paymentMethodDetails.brand': paymentMethodSnapshot.brand,
        } : {}),
        ...(paymentMethodSnapshot?.last4 ? {
            'subscription.creditCardLast4': paymentMethodSnapshot.last4,
            'paymentMethodDetails.last4': paymentMethodSnapshot.last4,
        } : {}),
        ...(paymentMethodSnapshot?.expiry ? {
            'paymentMethodDetails.expiry': paymentMethodSnapshot.expiry,
        } : {}),
    });

    return { handled: true, uid };
}

async function handleSubscriptionDeleted(subscriptionPayload) {
    const customerId = typeof subscriptionPayload.customer === 'string'
        ? subscriptionPayload.customer
        : subscriptionPayload.customer?.id || null;
    const uid = await getUidFromStripeCustomerId(customerId);
    if (!uid) return { handled: false };

    await mergeUserData(uid, {
        'subscription.provider': 'stripe',
        'subscription.plan': 'free',
        'subscription.status': 'inactive',
        'subscription.stripeCustomerId': customerId,
        'subscription.stripeSubscriptionId': null,
        'subscription.cancelAtPeriodEnd': false,
        'subscription.autoRenew': false,
        updatedAt: new Date().toISOString(),
    });

    return { handled: true, uid };
}

function getSessionUid(session) {
    return session.client_reference_id || session.metadata?.firebaseUID || null;
}

async function retrieveCheckoutSession(sessionId) {
    const stripeClient = requireStripe();
    return stripeClient.checkout.sessions.retrieve(sessionId, {
        expand: [
            'customer',
            'payment_intent',
            'subscription',
        ],
    });
}

router.post('/checkout/subscription-session', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    try {
        const stripeClient = requireStripe();
        const origin = normalizeOrigin(req.body?.origin);
        const priceId = requireStripePriceId();
        const userData = await getUserData(authResult.uid);
        if (!userData) {
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }

        const customer = await ensureStripeCustomerForUser({
            uid: authResult.uid,
            userData,
        });

        const activeSubscription = await findManagedStripeSubscription(customer.id);
        if (activeSubscription) {
            const portalSession = await createPortalSession(customer.id, origin);
            return res.status(200).json({
                alreadySubscribed: true,
                portalUrl: portalSession.url,
                url: portalSession.url,
            });
        }

        const sessionParams = {
            mode: 'subscription',
            customer: customer.id,
            client_reference_id: authResult.uid,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: buildReturnUrl(origin, {
                checkout: 'stripe-success',
                session_id: '{CHECKOUT_SESSION_ID}',
            }),
            cancel_url: buildReturnUrl(origin, {
                checkout: 'stripe-cancelled',
            }),
            metadata: {
                kind: 'subscription',
                firebaseUID: authResult.uid,
                plan: 'pro',
            },
            subscription_data: {
                metadata: {
                    kind: 'subscription',
                    firebaseUID: authResult.uid,
                    plan: 'pro',
                },
            },
            billing_address_collection: 'auto',
            phone_number_collection: {
                enabled: true,
            },
        };

        // Apply promotion code if provided (e.g. LANCAMENTO50)
        const promoCodeInput = (req.body?.promotionCode || '').trim().toUpperCase();
        if (promoCodeInput) {
            if (promoCodeInput === 'LANCAMENTO50') {
                // Use hardcoded ID provided for launch discount for stability
                sessionParams.discounts = [{ promotion_code: 'promo_1TEtkM3Gkobo4H4N68odCMxs' }];
            } else {
                try {
                    const promoCodes = await stripeClient.promotionCodes.list({
                        code: promoCodeInput,
                        active: true,
                        limit: 1,
                    });
                    if (promoCodes.data.length > 0) {
                        sessionParams.discounts = [{ promotion_code: promoCodes.data[0].id }];
                    } else {
                        // Promo code not found, allow manual entry
                        sessionParams.allow_promotion_codes = true;
                    }
                } catch (promoErr) {
                    console.warn('[Stripe] Erro ao buscar promotion code:', promoErr.message);
                    sessionParams.allow_promotion_codes = true;
                }
            }
        } else {
            sessionParams.allow_promotion_codes = true;
        }

        const session = await stripeClient.checkout.sessions.create(sessionParams);

        await mergeUserData(authResult.uid, {
            'subscription.provider': 'stripe',
            'subscription.status': 'pending',
            'subscription.plan': userData?.subscription?.plan || 'free',
            'subscription.stripeCustomerId': customer.id,
            'subscription.stripePriceId': priceId,
            'subscription.pendingCheckoutSessionId': session.id,
            updatedAt: new Date().toISOString(),
        });

        return res.status(200).json({
            success: true,
            url: session.url,
            sessionId: session.id,
            alreadySubscribed: false,
        });
    } catch (error) {
        console.error('Stripe subscription-session error:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Erro ao criar Checkout de assinatura.' });
    }
});

router.post('/checkout/sync-credits-session', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    try {
        const stripeClient = requireStripe();
        const origin = normalizeOrigin(req.body?.origin);
        const combo = findSyncCreditComboById(req.body?.comboId);
        if (!combo) {
            return res.status(400).json({ error: 'Pacote de creditos invalido.' });
        }

        const userData = await getUserData(authResult.uid);
        if (!userData) {
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }

        const customer = await ensureStripeCustomerForUser({
            uid: authResult.uid,
            userData,
        });

        const session = await stripeClient.checkout.sessions.create({
            mode: 'payment',
            customer: customer.id,
            client_reference_id: authResult.uid,
            line_items: [
                {
                    price_data: {
                        currency: 'brl',
                        product_data: {
                            name: `Controlar+ Coins - ${combo.name}`,
                            description: combo.description,
                        },
                        unit_amount: roundCurrencyToCents(combo.amount),
                    },
                    quantity: 1,
                },
            ],
            success_url: buildReturnUrl(origin, {
                syncCredits: 'success',
                session_id: '{CHECKOUT_SESSION_ID}',
            }),
            cancel_url: buildReturnUrl(origin, {
                syncCredits: 'cancelled',
            }),
            metadata: {
                kind: 'sync_credits',
                firebaseUID: authResult.uid,
                comboId: combo.id,
                credits: String(combo.credits),
            },
            billing_address_collection: 'auto',
            phone_number_collection: {
                enabled: true,
            },
        });

        await getSyncCreditPaymentRef(authResult.uid, session.id).set({
            userId: authResult.uid,
            provider: 'stripe',
            paymentId: session.id,
            checkoutSessionId: session.id,
            comboId: combo.id,
            comboName: combo.name,
            credits: combo.credits,
            amount: combo.amount,
            customerId: customer.id,
            status: session.status || 'open',
            credited: false,
            creditsGranted: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }, { merge: true });

        return res.status(200).json({
            success: true,
            url: session.url,
            sessionId: session.id,
        });
    } catch (error) {
        console.error('Stripe sync-credits-session error:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Erro ao criar Checkout de creditos.' });
    }
});

router.post('/customer-portal/session', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    try {
        const origin = normalizeOrigin(req.body?.origin);
        const userData = await getUserData(authResult.uid);
        if (!userData) {
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }

        if (userData?.subscription?.provider !== 'stripe') {
            return res.status(400).json({ error: 'Portal disponivel apenas para assinaturas Stripe.' });
        }

        const customerId = userData?.subscription?.stripeCustomerId || null;
        if (!customerId) {
            return res.status(400).json({ error: 'Cliente Stripe nao encontrado para este usuario.' });
        }

        const portalSession = await createPortalSession(customerId, origin);
        return res.status(200).json({
            success: true,
            url: portalSession.url,
        });
    } catch (error) {
        console.error('Stripe customer-portal error:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Erro ao abrir portal de cobranca.' });
    }
});

router.get('/checkout/session-status/:sessionId', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    try {
        const sessionId = String(req.params.sessionId || '').trim();
        if (!sessionId || sessionId === '{CHECKOUT_SESSION_ID}') {
            return res.status(400).json({ error: 'session_id invalido no retorno do Stripe.' });
        }

        const session = await retrieveCheckoutSession(sessionId);
        const sessionUid = getSessionUid(session)
            || await getUidFromStripeCustomerId(typeof session.customer === 'string' ? session.customer : session.customer?.id || null);

        if (!sessionUid || sessionUid !== authResult.uid) {
            return res.status(403).json({ error: 'Sessao nao pertence ao usuario autenticado.' });
        }

        const kind = session.metadata?.kind || session.mode || 'unknown';

        if (kind === 'subscription' && session.payment_status === 'paid') {
            await syncStripeSubscriptionFromSession(session);
        }

        if (kind === 'sync_credits' && session.payment_status === 'paid') {
            await applyStripeSyncCreditsFromSession(session, 'status_check');
        }

        const userData = await getUserData(authResult.uid);
        const syncPaymentSnap = kind === 'sync_credits'
            ? await getSyncCreditPaymentRef(authResult.uid, session.id).get()
            : null;
        const syncPayment = syncPaymentSnap?.exists ? (syncPaymentSnap.data() || {}) : null;
        const sessionAmount = Number(session.amount_total || 0);
        const sessionCurrency = typeof session.currency === 'string'
            ? session.currency.toUpperCase()
            : 'BRL';

        return res.status(200).json({
            success: true,
            sessionId: session.id,
            kind,
            amount: Number.isFinite(sessionAmount) ? sessionAmount / 100 : null,
            currency: sessionCurrency,
            paymentStatus: session.payment_status || null,
            checkoutStatus: session.status || null,
            subscriptionStatus: userData?.subscription?.status || null,
            plan: userData?.subscription?.plan || null,
            credited: Boolean(syncPayment?.credited),
            creditsAdded: syncPayment?.creditsGranted || 0,
            extraSyncCredits: syncPayment?.extraSyncCreditsAfterCredit ?? userData?.extraSyncCredits ?? null,
        });
    } catch (error) {
        console.error('Stripe session-status error:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Erro ao consultar sessao Stripe.' });
    }
});

router.post('/sync-subscription', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    try {
        const stripeClient = requireStripe();
        const userData = await getUserData(authResult.uid);
        if (!userData) {
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }

        const customerId = userData?.subscription?.stripeCustomerId || null;
        if (!customerId) {
            return res.status(400).json({ error: 'Nenhuma assinatura Stripe vinculada.' });
        }

        // 1. Find the active subscription from Stripe
        const subscription = await findManagedStripeSubscription(customerId);
        if (!subscription) {
            // No active subscription — mark as inactive in Firestore
            await mergeUserData(authResult.uid, {
                'subscription.provider': 'stripe',
                'subscription.plan': 'free',
                'subscription.status': 'inactive',
                updatedAt: new Date().toISOString(),
            });
            return res.status(200).json({ success: true, status: 'inactive', invoicesSynced: 0 });
        }

        // 2. Get full subscription with expansions
        const fullSubscription = await getSubscriptionWithExpansions(subscription.id);

        // 3. Fetch ALL invoices for this subscription from Stripe
        const allInvoices = [];
        let hasMore = true;
        let startingAfter = undefined;

        while (hasMore) {
            const listParams = {
                subscription: subscription.id,
                limit: 100,
            };
            if (startingAfter) listParams.starting_after = startingAfter;

            const batch = await stripeClient.invoices.list(listParams);
            allInvoices.push(...batch.data);
            hasMore = batch.has_more;
            if (batch.data.length > 0) {
                startingAfter = batch.data[batch.data.length - 1].id;
            }
        }

        // 4. Update subscription state in Firestore
        const price = fullSubscription?.items?.data?.[0]?.price || null;
        const amountInCents = price?.unit_amount ?? null;
        const paymentMethodSnapshot = extractCardSnapshot({ paymentMethod: null, subscription: fullSubscription });
        const now = new Date().toISOString();
        const nextBillingDate = formatDateOnly(fullSubscription.current_period_end);
        const currentPeriodEnd = formatDateIso(fullSubscription.current_period_end);
        const interval = price?.recurring?.interval || 'month';
        const priceDisplay = formatAmountDisplayFromCents(amountInCents);
        const userStatus = mapStripeSubscriptionStatusToUserStatus(fullSubscription.status);

        const updatePayload = {
            'subscription.provider': 'stripe',
            'subscription.plan': userStatus === 'inactive' ? 'free' : 'pro',
            'subscription.status': userStatus === 'pending' ? 'active' : userStatus,
            'subscription.stripeCustomerId': customerId,
            'subscription.stripeSubscriptionId': fullSubscription.id,
            'subscription.stripePriceId': price?.id || null,
            'subscription.currentPeriodEnd': currentPeriodEnd,
            'subscription.nextBillingDate': nextBillingDate,
            'subscription.cancelAtPeriodEnd': Boolean(fullSubscription.cancel_at_period_end),
            'subscription.autoRenew': !fullSubscription.cancel_at_period_end,
            'subscription.billingCycle': interval === 'year' ? 'annual' : 'mensal',
            'subscription.startDate': formatDateOnly(fullSubscription.start_date),
            updatedAt: now,
        };

        if (priceDisplay) {
            updatePayload['subscription.price'] = priceDisplay;
            updatePayload['subscription.nextAmount'] = priceDisplay;
        }

        if (paymentMethodSnapshot?.brand) {
            updatePayload['subscription.creditCardBrand'] = paymentMethodSnapshot.brand;
            updatePayload['paymentMethodDetails.brand'] = paymentMethodSnapshot.brand;
        }
        if (paymentMethodSnapshot?.last4) {
            updatePayload['subscription.creditCardLast4'] = paymentMethodSnapshot.last4;
            updatePayload['paymentMethodDetails.last4'] = paymentMethodSnapshot.last4;
        }
        if (paymentMethodSnapshot?.expiry) {
            updatePayload['paymentMethodDetails.expiry'] = paymentMethodSnapshot.expiry;
        }

        await mergeUserData(authResult.uid, updatePayload);

        // 5. Build all invoice entries and bulk-write to Firestore
        const db = requireDb();
        const batch = db.batch();
        const invoiceEntries = [];

        for (const inv of allInvoices) {
            const pmSnapshot = extractCardSnapshot({ paymentMethod: null, subscription: fullSubscription });
            const entry = buildStripeInvoiceEntry({
                invoice: inv,
                subscription: fullSubscription,
                paymentMethodSnapshot: pmSnapshot || paymentMethodSnapshot,
            });
            invoiceEntries.push(entry);
            // Write each invoice to its own subcollection doc
            const invoiceDocRef = getInvoiceRef(authResult.uid, entry.id);
            batch.set(invoiceDocRef, entry, { merge: true });
        }

        // Sort newest-first for the embedded array
        invoiceEntries.sort((a, b) => {
            const da = a.date ? new Date(a.date).getTime() : 0;
            const db2 = b.date ? new Date(b.date).getTime() : 0;
            return db2 - da;
        });

        // Update user doc with the full invoices array
        batch.set(getUserRef(authResult.uid), {
            invoices: invoiceEntries.slice(0, 24),
            updatedAt: now,
        }, { merge: true });

        await batch.commit();

        return res.status(200).json({
            success: true,
            status: userStatus,
            nextBillingDate,
            invoicesSynced: invoiceEntries.length,
        });
    } catch (error) {
        console.error('Stripe sync-subscription error:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Erro ao sincronizar assinatura.' });
    }
});

export async function handleStripeWebhook(req, res) {
    let event;

    try {
        const stripeClient = requireStripe();
        const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
        if (!webhookSecret) {
            throw createError(500, 'STRIPE_WEBHOOK_SECRET nao configurado.');
        }

        const signature = req.headers['stripe-signature'];
        event = stripeClient.webhooks.constructEvent(req.body, signature, webhookSecret);
        console.log(`Stripe webhook recebido: ${event.type}`);
    } catch (error) {
        console.error('Stripe webhook signature error:', error.message);
        return res.status(error.status || 400).send(error.message || 'Webhook invalido.');
    }

    try {
        console.log(`[Stripe Webhook] Processando evento: ${event.type} | ID: ${event.id}`);

        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                console.log('[Webhook] checkout.session.completed:', session.id);
                if (session.metadata?.kind === 'sync_credits') {
                    await applyStripeSyncCreditsFromSession(session, 'webhook');
                } else if (session.mode === 'subscription') {
                    await syncStripeSubscriptionFromSession(session);
                }
                break;
            }

            case 'invoice.paid':
            case 'invoice_payment.paid': {
                const invoice = event.data.object;
                console.log('[Webhook] Fatura paga:', {
                    invoiceId: invoice.id,
                    amount: invoice.amount_paid,
                    subscription: invoice.subscription,
                    status: invoice.status,
                });
                await handleInvoicePaid(invoice);
                break;
            }

            case 'invoice.payment_failed':
            case 'invoice_payment.failed': {
                const invoice = event.data.object;
                console.log('[Webhook] Falha no pagamento da fatura:', invoice.id);
                await handleInvoicePaymentFailed(invoice);
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                console.log('[Webhook] Assinatura atualizada:', subscription.id);
                await handleSubscriptionUpdated(subscription);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                console.log('[Webhook] Assinatura deletada:', subscription.id);
                await handleSubscriptionDeleted(subscription);
                break;
            }

            default:
                console.log(`[Webhook] Evento não tratado: ${event.type}`);
                break;
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error(`[Stripe Webhook Error] ${event.type}:`, error.message);
        console.error('[Stripe Webhook Error] Stack:', error.stack);
        return res.status(error.status || 500).json({ error: error.message || 'Erro ao processar webhook Stripe.' });
    }
}

// ─────────────────────────────────────────────
// MIGRAÇÃO ASAAS → STRIPE
// Cria checkout Stripe com trial_end = próxima cobrança do Asaas
// Usuário não é cobrado agora — começa a pagar na data que pagaria no Asaas
// ─────────────────────────────────────────────

router.post('/asaas-migrate', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    const stripeClient = stripe;
    if (!stripeClient) {
        return res.status(500).json({ error: 'Stripe nao configurado.' });
    }

    const uid = authResult.uid;
    const origin = req.body.origin || 'http://localhost:5173';

    const userData = await getUserData(uid);
    if (!userData) {
        return res.status(404).json({ error: 'Usuario nao encontrado.' });
    }

    // ── Buscar assinatura no Asaas ──────────────────────────────────────
    const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
    const ASAAS_BASE = process.env.ASAAS_MODE === 'production'
        ? 'https://www.asaas.com/api/v3'
        : 'https://sandbox.asaas.com/api/v3';

    if (!ASAAS_API_KEY) {
        return res.status(500).json({ error: 'Asaas nao configurado.' });
    }

    const asaasGet = async (path) => {
        const r = await fetch(`${ASAAS_BASE}${path}`, {
            headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
        });
        return r.json();
    };

    let asaasSubscription = null;
    const subscriptionId = userData?.subscription?.asaasSubscriptionId;
    const customerId = userData?.subscription?.asaasCustomerId || userData?.asaasCustomerId;
    const email = userData?.email || userData?.profile?.email;

    if (subscriptionId) {
        try {
            const data = await asaasGet(`/subscriptions/${subscriptionId}`);
            if (data?.id) asaasSubscription = data;
        } catch (_) {}
    }

    if (!asaasSubscription && customerId) {
        try {
            const data = await asaasGet(`/subscriptions?customer=${customerId}&limit=10`);
            const items = data?.data || [];
            asaasSubscription = items.find(s => s.status === 'ACTIVE') || items[0] || null;
        } catch (_) {}
    }

    if (!asaasSubscription && email) {
        try {
            const custData = await asaasGet(`/customers?email=${encodeURIComponent(email)}&limit=5`);
            for (const cust of (custData?.data || [])) {
                const subData = await asaasGet(`/subscriptions?customer=${cust.id}&limit=10`);
                const found = (subData?.data || []).find(s => s.status === 'ACTIVE') || (subData?.data || [])[0];
                if (found) { asaasSubscription = found; break; }
            }
        } catch (_) {}
    }

    if (!asaasSubscription) {
        return res.status(404).json({ error: 'Nenhuma assinatura Asaas ativa encontrada.' });
    }

    // ── Calcular trial_end = próximo ciclo de 30 dias a partir do último pagamento ──
    // Usamos o último pagamento + 30 dias (ciclado até data futura) em vez do nextDueDate
    // do Asaas, que pode estar errado (especialmente em assinaturas CC que o Asaas bloqueia atualizar).
    let trialEnd = null;
    {
        // Buscar último pagamento confirmado desta assinatura
        let lastPaidDate = null;
        for (const status of ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']) {
            try {
                const pmtData = await asaasGet(`/payments?subscription=${asaasSubscription.id}&status=${status}&limit=100`);
                const items = pmtData?.data || [];
                if (items.length > 0) {
                    items.sort((a, b) => (b.paymentDate || b.confirmedDate || b.dueDate || '').localeCompare(a.paymentDate || a.confirmedDate || a.dueDate || ''));
                    lastPaidDate = items[0].paymentDate || items[0].confirmedDate || items[0].dueDate;
                    break;
                }
            } catch (_) {}
        }

        let billingDate = null;
        if (lastPaidDate) {
            // Avançar em ciclos de 30 dias até encontrar data futura (mínimo 2 dias à frente)
            const minDate = new Date(Date.now() + 2 * 24 * 3600 * 1000);
            const d = new Date(`${lastPaidDate}T12:00:00Z`);
            while (d <= minDate) d.setUTCDate(d.getUTCDate() + 30);
            billingDate = d;
        } else if (asaasSubscription.nextDueDate) {
            // Fallback: usar nextDueDate do Asaas se não houver histórico de pagamento
            billingDate = new Date(`${asaasSubscription.nextDueDate}T12:00:00Z`);
            const minDate = new Date(Date.now() + 2 * 24 * 3600 * 1000);
            if (billingDate < minDate) billingDate = minDate;
        }

        if (billingDate) {
            trialEnd = Math.floor(billingDate.getTime() / 1000);
            const daysUntil = Math.round((billingDate.getTime() - Date.now()) / (1000 * 3600 * 24));
            console.log(`[AsaasMigrate] lastPaid=${lastPaidDate || 'N/A'} | nextDueDate=${asaasSubscription.nextDueDate} | correctBilling=${billingDate.toISOString().slice(0,10)} | daysUntil=${daysUntil}`);
        }
    }

    // ── Criar/encontrar cliente no Stripe ──────────────────────────────
    let stripeCustomer;
    try {
        stripeCustomer = await ensureStripeCustomerForUser({ uid, userData });
    } catch (err) {
        console.error('[AsaasMigrate] ensureStripeCustomer error:', err.message);
        return res.status(500).json({ error: 'Nao foi possivel criar/encontrar o cliente no Stripe.' });
    }

    // ── Criar Checkout Session com trial ───────────────────────────────
    const priceId = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
    const safeOrigin = (() => {
        try { return normalizeOrigin(origin); } catch (_) { return 'http://localhost:5173'; }
    })();

    const sessionParams = {
        mode: 'subscription',
        customer: stripeCustomer.id,
        client_reference_id: uid,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: buildReturnUrl(safeOrigin, {
            checkout: 'stripe-success',
            session_id: '{CHECKOUT_SESSION_ID}',
        }),
        cancel_url: buildReturnUrl(safeOrigin, { checkout: 'stripe-cancelled' }),
        metadata: {
            kind: 'subscription',
            firebaseUID: uid,
            plan: 'pro',
            migratedFromAsaas: 'true',
        },
        billing_address_collection: 'auto',
        phone_number_collection: {
            enabled: true,
        },
    };

    if (trialEnd) {
        sessionParams.subscription_data = {
            trial_end: trialEnd,
            metadata: { firebaseUID: uid, migratedFromAsaas: 'true' },
        };
    }

    let session;
    try {
        session = await stripeClient.checkout.sessions.create(sessionParams);
    } catch (err) {
        console.error('[AsaasMigrate] checkout.sessions.create error:', err.message);
        return res.status(500).json({ error: 'Nao foi possivel criar a sessao de checkout no Stripe.' });
    }

    // ── Atualizar Firestore: marca migração pendente ────────────────────
    await mergeUserData(uid, {
        'subscription.stripeCustomerId': stripeCustomer.id,
        'subscription.pendingCheckoutSessionId': session.id,
        'subscription.migratingToStripe': true,
        updatedAt: new Date().toISOString(),
    });

    console.log(`[AsaasMigrate] uid=${uid} | nextDueDate=${asaasSubscription.nextDueDate} | trialEnd=${trialEnd} | session=${session.id}`);

    return res.status(200).json({ success: true, url: session.url, sessionId: session.id });
});

export async function createRemarketingCheckoutSession({ uid, promoCode }) {
    const stripeClient = requireStripe();
    const priceId = requireStripePriceId();
    const userData = await getUserData(uid);
    if (!userData) throw new Error('Usuário não encontrado');

    const customer = await ensureStripeCustomerForUser({ uid, userData });
    const origin = 'https://www.controlarmais.com.br';

    const sessionParams = {
        mode: 'subscription',
        customer: customer.id,
        client_reference_id: uid,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/?checkout=stripe-success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?checkout=stripe-cancelled`,
        metadata: { kind: 'subscription', firebaseUID: uid, plan: 'pro', remarketing: 'true' },
        billing_address_collection: 'auto',
        phone_number_collection: {
            enabled: true,
        },
    };

    if (promoCode) {
        // Find promotion code ID
        const list = await stripeClient.promotionCodes.list({ code: promoCode, limit: 1 });
        if (list.data.length > 0) {
            sessionParams.discounts = [{ promotion_code: list.data[0].id }];
        }
    } else {
        // Só permite códigos manuais se não houver um pré-aplicado (Stripe não aceita ambos via API)
        sessionParams.allow_promotion_codes = true;
    }

    return stripeClient.checkout.sessions.create(sessionParams);
}

export async function createUniquePromoCode(name, couponId = 'REMARKETING_9_90', expiresInHours = 24) {
    const stripeClient = requireStripe();
    
    // Certificar que o cupom base existe
    try {
        await stripeClient.coupons.retrieve(couponId);
    } catch (e) {
        // Criar cupom para chegar em 9,90 (base 35,90 -> OFF 26,00)
        await stripeClient.coupons.create({
            id: couponId,
            amount_off: 2600,
            currency: 'brl',
            duration: 'once', 
            name: 'Remarketing D2/D3 - R$ 9,90'
        });
    }

    const sanitized = (name || 'AMIGO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const code = `${sanitized}${Math.floor(1000 + Math.random() * 9000)}`;
    const expiresAt = Math.floor(Date.now() / 1000) + (expiresInHours * 3600);

    const promo = await stripeClient.promotionCodes.create({
        coupon: couponId,
        code: code,
        max_redemptions: 1,
        expires_at: expiresAt
    });

    return { 
        code: promo.code, 
        expiresAt: expiresAt 
    };
}

export function isStripeReady() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
}

export { ensureStripeCustomerForUser };
export default router;
