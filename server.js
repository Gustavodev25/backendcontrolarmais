import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import admin from 'firebase-admin';
import fs from 'fs';
import pluggyRouter from './api/pluggy.js';
import stripeRouter, { handleStripeWebhook, isStripeReady, createRemarketingCheckoutSession, createUniquePromoCode } from './api/stripe.js';
import aiRouter from './api/ai.js';
import { sendUtmifySale } from './api/utmify.js';
import { sendEmail, sendOtpEmail, sendWelcomeEmail, sendAbandonedCartEmail } from './api/emails.js';
import Stripe from 'stripe';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
}) : null;

// ─────────────────────────────────────────────
// FIREBASE ADMIN — Inicialização
// ─────────────────────────────────────────────
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('✅ Firebase Admin inicializado via .env.');
    } else if (fs.existsSync('./serviceAccountKey.json')) {
        const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('✅ Firebase Admin inicializado via serviceAccountKey.json.');
    } else {
        console.warn('⚠️  Nenhuma credencial Firebase encontrada. Firestore desabilitado.');
    }
} catch (error) {
    console.error('❌ Erro ao inicializar Firebase Admin:', error.message);
}

const db = admin.apps.length ? admin.firestore() : null;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Atualiza o plano do usuário no Firestore de forma segura.
 * @param {string} uid         - UID do Firebase
 * @param {'pro'|'free'} plan  - Plano a definir
 * @param {'active'|'inactive'|'overdue'} status
 * @param {object} extra       - Campos adicionais opcionais
 */
async function updateUserPlan(uid, plan, status, extra = {}) {
    if (!db) {
        console.warn('⚠️  Firestore não disponível. Atualização ignorada.');
        return;
    }
    await db.collection('users').doc(uid).update({
        'subscription.plan': plan,
        'subscription.status': status,
        ...extra,
        updatedAt: new Date().toISOString()
    });
    console.log(`✅ Usuário ${uid} → plano: ${plan}, status: ${status}`);
}

/**
 * Busca o UID do Firebase a partir do ID de um cliente no Asaas.
 * @param {string} customerId
 * @returns {string|null}
 */
async function getUidFromAsaasCustomer(customerId) {
    if (!customerId) return null;
    const res = await axios.get(`${ASAAS_URL}/customers/${customerId}`, { headers: asaasHeaders });
    return res.data?.externalReference || null;
}

const SYNC_CREDIT_PREFIX = 'sync_credits';
const SYNC_CREDIT_COMBOS = Object.freeze([
    {
        id: 'combo_light',
        name: 'Light',
        amount: 4.90,
        credits: 7,
        description: '7 atualizacoes'
    },
    {
        id: 'combo_performance',
        name: 'Performance',
        amount: 14.90,
        credits: 28,
        description: '28 atualizacoes'
    },
    {
        id: 'combo_full',
        name: 'Full',
        amount: 49.90,
        credits: 9999,
        description: 'Ilimitado'
    }
]);
const SYNC_CREDIT_SETTLED_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const SYNC_CREDIT_FAILED_STATUSES = new Set([
    'CANCELLED',
    'OVERDUE',
    'REFUNDED',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL',
]);

function roundCurrencyToCents(value) {
    return Math.round(Number(value || 0) * 100);
}

function findSyncCreditComboById(comboId) {
    return SYNC_CREDIT_COMBOS.find((combo) => combo.id === comboId) || null;
}

function findSyncCreditComboByCredits(credits) {
    return SYNC_CREDIT_COMBOS.find((combo) => combo.credits === credits) || null;
}

function buildSyncCreditExternalReference(uid, combo) {
    return `${SYNC_CREDIT_PREFIX}|${combo.id}|${combo.credits}|${uid}`;
}

function parseSyncCreditExternalReference(externalReference) {
    const parts = String(externalReference || '').split('|').filter(Boolean);
    if (parts[0] !== SYNC_CREDIT_PREFIX) return null;

    if (parts.length >= 4) {
        const combo = findSyncCreditComboById(parts[1]);
        const credits = Number(parts[2]);
        return {
            type: SYNC_CREDIT_PREFIX,
            comboId: parts[1],
            combo,
            credits,
            uid: parts[3] || null,
        };
    }

    if (parts.length >= 3) {
        const credits = Number(parts[1]);
        return {
            type: SYNC_CREDIT_PREFIX,
            comboId: null,
            combo: findSyncCreditComboByCredits(credits),
            credits,
            uid: parts[2] || null,
        };
    }

    return null;
}

function getSyncCreditPaymentRef(uid, paymentId) {
    return db.collection('users').doc(uid).collection('syncCreditPayments').doc(paymentId);
}

function getUserRef(uid) {
    return db.collection('users').doc(uid);
}

function normalizeExtraSyncCredits(value) {
    return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

const INVALID_CARD_TOKEN_PATTERNS = [
    'MANAGED_BY_ASAAS',
    'PLACEHOLDER',
    'NONE',
    'NULL',
    'UNDEFINED',
];

function isValidCreditCardToken(token) {
    if (!token || typeof token !== 'string') return false;
    const trimmed = token.trim();
    if (trimmed.length < 30) return false;
    const upper = trimmed.toUpperCase();
    return !INVALID_CARD_TOKEN_PATTERNS.some(p => upper.includes(p));
}

function getStoredCreditCardToken(userData = {}) {
    const raw = userData?.paymentMethodDetails?.token || userData?.subscription?.creditCardToken || null;
    return isValidCreditCardToken(raw) ? raw : null;
}

function isSettledSyncCreditStatus(status) {
    return SYNC_CREDIT_SETTLED_STATUSES.has(String(status || '').toUpperCase());
}

function isFailedSyncCreditStatus(status) {
    return SYNC_CREDIT_FAILED_STATUSES.has(String(status || '').toUpperCase());
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
    } catch (error) {
        return { ok: false, status: 401, error: 'Token invalido ou expirado.' };
    }
}

async function ensureAsaasCustomerForUser({ uid, userData }) {
    const storedCustomerId = userData?.subscription?.asaasCustomerId || null;
    if (storedCustomerId) {
        return storedCustomerId;
    }

    const name = userData?.name || userData?.profile?.name || null;
    const email = userData?.email || userData?.profile?.email || null;
    const cpfCnpj = String(userData?.profile?.cpf || userData?.cpf || '').replace(/\D/g, '');
    const phone = String(userData?.profile?.phone || userData?.phone || '').replace(/\D/g, '');

    if (!name || !cpfCnpj) {
        throw {
            status: 400,
            message: 'Seu cadastro precisa ter nome e CPF para gerar a cobranca.',
        };
    }

    const response = await axios.post(`${ASAAS_URL}/customers`, {
        name,
        email,
        cpfCnpj,
        phone,
        externalReference: uid,
    }, { headers: asaasHeaders });

    const customerId = response.data?.id || null;
    if (!customerId) {
        throw {
            status: 502,
            message: 'Nao foi possivel criar o cliente no gateway.',
        };
    }

    await getUserRef(uid).set({
        subscription: {
            ...(userData?.subscription || {}),
            asaasCustomerId: customerId,
        },
        updatedAt: new Date().toISOString(),
    }, { merge: true });

    return customerId;
}

async function persistSyncCreditPayment({
    uid,
    combo,
    billingType,
    payment,
    customerId,
    eventName = null,
    credited = false,
    creditsGranted = 0,
    extraSyncCredits = null,
}) {
    if (!db || !uid || !payment?.id) return;

    const now = new Date().toISOString();
    await getSyncCreditPaymentRef(uid, payment.id).set({
        userId: uid,
        paymentId: payment.id,
        comboId: combo?.id || null,
        comboName: combo?.name || null,
        credits: combo?.credits ?? 0,
        amount: payment.value ?? combo?.amount ?? 0,
        billingType,
        customerId: customerId || payment.customer || null,
        externalReference: payment.externalReference || null,
        status: payment.status || 'PENDING',
        lastWebhookEvent: eventName,
        credited: Boolean(credited),
        creditsGranted: creditsGranted || 0,
        extraSyncCreditsAfterCredit: extraSyncCredits,
        createdAt: payment.dateCreated || now,
        updatedAt: now,
        creditedAt: credited ? now : null,
        confirmedDate: payment.confirmedDate || null,
        clientPaymentDate: payment.clientPaymentDate || null,
    }, { merge: true });
}

async function persistReusableCardSnapshot({ uid, userData, payment, submittedCard, submittedExpiry }) {
    if (!db || !uid || !submittedCard?.number) return;

    const cardLast4 = String(submittedCard.number).replace(/\D/g, '').slice(-4);
    const brand =
        payment?.creditCard?.creditCardBrand ||
        payment?.creditCardBrand ||
        userData?.paymentMethodDetails?.brand ||
        userData?.subscription?.creditCardBrand ||
        null;
    const token = payment?.creditCardToken || null;

    const payload = {
        paymentMethodDetails: {
            ...(userData?.paymentMethodDetails || {}),
            last4: cardLast4,
            expiry: submittedExpiry || userData?.paymentMethodDetails?.expiry || null,
            brand,
        },
        updatedAt: new Date().toISOString(),
    };

    if (token) {
        payload.paymentMethodDetails.token = token;
    }

    await getUserRef(uid).set(payload, { merge: true });
}

async function creditSyncCreditsFromPayment({ payment, eventName = null, source = 'unknown' }) {
    if (!db || !payment?.id) {
        return { handled: false, credited: false };
    }

    const parsedReference = parseSyncCreditExternalReference(payment.externalReference);
    if (!parsedReference?.uid) {
        return { handled: false, credited: false };
    }

    const combo =
        parsedReference.combo ||
        findSyncCreditComboByCredits(parsedReference.credits) ||
        null;
    const credits = combo?.credits ?? parsedReference.credits;
    if (!credits || !Number.isFinite(credits)) {
        return { handled: false, credited: false };
    }

    if (combo && roundCurrencyToCents(combo.amount) !== roundCurrencyToCents(payment.value)) {
        throw new Error('Valor da cobranca divergente para o pacote de creditos.');
    }

    const uid = parsedReference.uid;
    const paymentRef = getSyncCreditPaymentRef(uid, payment.id);
    const userRef = getUserRef(uid);
    const now = new Date().toISOString();
    let result = {
        handled: true,
        credited: false,
        creditsGranted: 0,
        extraSyncCredits: null,
        status: payment.status || null,
    };

    await db.runTransaction(async (transaction) => {
        const [paymentSnap, userSnap] = await Promise.all([
            transaction.get(paymentRef),
            transaction.get(userRef),
        ]);

        const paymentData = paymentSnap.exists ? (paymentSnap.data() || {}) : {};
        const userData = userSnap.exists ? (userSnap.data() || {}) : {};
        const wasCredited = paymentData.credited === true;
        const userExtraCredits = normalizeExtraSyncCredits(userData.extraSyncCredits);
        const shouldCredit = isSettledSyncCreditStatus(payment.status);
        const nextExtraCredits = shouldCredit && !wasCredited
            ? userExtraCredits + credits
            : userExtraCredits;

        transaction.set(paymentRef, {
            userId: uid,
            paymentId: payment.id,
            comboId: combo?.id || paymentData.comboId || null,
            comboName: combo?.name || paymentData.comboName || null,
            credits,
            amount: payment.value ?? paymentData.amount ?? 0,
            billingType: payment.billingType || paymentData.billingType || null,
            customerId: payment.customer || paymentData.customerId || null,
            externalReference: payment.externalReference || paymentData.externalReference || null,
            status: payment.status || paymentData.status || 'PENDING',
            lastWebhookEvent: eventName,
            lastStatusSource: source,
            updatedAt: now,
            confirmedDate: payment.confirmedDate || paymentData.confirmedDate || null,
            clientPaymentDate: payment.clientPaymentDate || paymentData.clientPaymentDate || null,
            credited: wasCredited || shouldCredit,
            creditsGranted: wasCredited ? (paymentData.creditsGranted || credits) : (shouldCredit ? credits : 0),
            creditedAt: wasCredited
                ? paymentData.creditedAt || now
                : (shouldCredit ? now : paymentData.creditedAt || null),
            extraSyncCreditsAfterCredit: shouldCredit ? nextExtraCredits : userExtraCredits,
            createdAt: paymentData.createdAt || payment.dateCreated || now,
        }, { merge: true });

        if (shouldCredit && !wasCredited) {
            transaction.set(userRef, {
                extraSyncCredits: nextExtraCredits,
                updatedAt: now,
                ...(payment.customer ? {
                    subscription: {
                        ...(userData.subscription || {}),
                        asaasCustomerId: payment.customer,
                    }
                } : {}),
            }, { merge: true });

            // Postback UTMify
            if (payment.value > 0) {
                sendUtmifySale({
                    orderId: payment.id,
                    email: userData.email || userData.profile?.email,
                    name: userData.name || userData.profile?.name,
                    phone: userData.phone || userData.profile?.phone,
                    value: payment.value,
                    productName: `Créditos Extras | ${combo?.name || 'Recarga'}`,
                    productId: combo?.id || 'sync_credits',
                    document: userData.cpf || userData.profile?.cpf
                });
            }
        }

        result = {
            handled: true,
            credited: shouldCredit,
            creditsGranted: shouldCredit && !wasCredited ? credits : 0,
            extraSyncCredits: nextExtraCredits,
            status: payment.status || paymentData.status || null,
        };
    });

    return result;
}

// ─────────────────────────────────────────────
// EXPRESS
// ─────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || process.env.BACKEND_PORT || 3000;

// Configuração robusta de CORS
const allowedOrigins = [
    'https://www.controlarmais.com.br',
    'https://controlarmais.com.br',
    'https://controlarmais.vercel.app',
    'https://burseraceous-adalynn-academically.ngrok-free.dev',
    'https://toney-nonreversing-cedrick.ngrok-free.dev',
    'https://angelina-unsalvageable-inconceivably.ngrok-free.dev',
    'http://localhost:5173',
    'http://localhost:3000',
];

app.use(cors({
    origin: function (origin, callback) {
        // Permite requisições sem origin (como mobile apps ou curl)
        if (!origin) return callback(null, true);
        // Permite qualquer URL ngrok automaticamente
        if (origin.includes('ngrok')) {
            return callback(null, true);
        }
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Origem bloqueada: ${origin}`);
            callback(new Error('Não permitido pelo CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));

// Responder a preflight requests globalmente (Express 5 compatível)
app.options('/{*splat}', cors());
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
app.use(express.json());

// Logger de requisições
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use('/api/pluggy', pluggyRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api/ai', aiRouter);

// ─────────────────────────────────────────────
// EMAILS — Configuração (Importados de ./api/emails.js)
// ─────────────────────────────────────────────


/**
 * POST /api/send-otp
 * Envia código OTP por e-mail.
 */
app.post('/api/send-otp', async (req, res) => {
    const { email, otp, type } = req.body;
    try {
        const info = await sendOtpEmail({ email, otp, type });
        console.log('📧 OTP email enviado:', info?.id);
        return res.status(200).json({ success: true, messageId: info?.id });
    } catch (error) {
        console.error('❌ Erro ao enviar OTP:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Falha ao enviar e-mail.' });
    }
});

// Removido endpoint local de boas-vindas. Disparado via Webhook Stripe.

/**
 * POST /api/request-password-reset
 * Inicia recuperação de senha gerando OTP no admin server e disparando e-mail.
 */
app.post('/api/request-password-reset', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obrigatório.' });

    try {
        let userRecord;
        try {
            userRecord = await admin.auth().getUserByEmail(email);
        } catch (err) {
            // Se nao existe, finge que deu certo para segurança (evitar enumeracao de contas)
            return res.status(200).json({ success: true });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await db.collection('users').doc(userRecord.uid).set({
            passwordResetCode: otp,
            passwordResetExpiry: expiresAt
        }, { merge: true });

        await sendPasswordResetEmail({ email, otp });


        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ Erro request-password-reset:', error.message);
        // Mesmo no erro, devolve 200 pra n vazar info.
        return res.status(200).json({ success: true });
    }
});

/**
 * POST /api/confirm-password-reset
 * Valida o código OTP e altera a senha no Firebase Auth.
 */
app.post('/api/confirm-password-reset', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ error: 'Dados insuficientes.' });

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        const userDoc = await db.collection('users').doc(userRecord.uid).get();
        const data = userDoc.data();

        if (!data?.passwordResetCode || data.passwordResetCode !== otp) {
            return res.status(400).json({ error: 'Código inválido ou incorreto.' });
        }
        if (new Date() > new Date(data.passwordResetExpiry)) {
            return res.status(400).json({ error: 'O código espirou. Solicite um novo.' });
        }

        await admin.auth().updateUser(userRecord.uid, { password: newPassword });
        await db.collection('users').doc(userRecord.uid).update({
            passwordResetCode: admin.firestore.FieldValue.delete(),
            passwordResetExpiry: admin.firestore.FieldValue.delete()
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ Erro confirm-password-reset:', error.message);
        return res.status(400).json({ error: 'Erro ao redefinir a senha ou usuário não existe.' });
    }
});

// ─────────────────────────────────────────────
// ASAAS — Configuração
// ─────────────────────────────────────────────
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = process.env.ASAAS_MODE === 'production'
    ? 'https://www.asaas.com/api/v3'
    : 'https://sandbox.asaas.com/api/v3';

const asaasHeaders = {
    'access_token': ASAAS_API_KEY,
    'Content-Type': 'application/json'
};

// ─────────────────────────────────────────────
// ASAAS — Clientes
// ─────────────────────────────────────────────

/**
 * POST /api/asaas/create-customer
 * Cria um novo cliente no Asaas.
 */
app.post('/api/asaas/create-customer', async (req, res) => {
    const { name, email, cpfCnpj, phone, uid } = req.body;

    if (!name || !cpfCnpj) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes: name e cpfCnpj.' });
    }

    try {
        const response = await axios.post(`${ASAAS_URL}/customers`, {
            name,
            email,
            cpfCnpj,
            phone,
            externalReference: uid
        }, { headers: asaasHeaders });

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('❌ Erro ao criar cliente:', error.response?.data || error.message);
        return res.status(400).json(error.response?.data || { error: 'Erro ao criar cliente.' });
    }
});

/**
 * PUT /api/asaas/update-customer/:customerId
 * Atualiza o externalReference (UID Firebase) de um cliente existente.
 * CORREÇÃO: método PUT (era POST incorretamente).
 */
app.put('/api/asaas/update-customer/:customerId', async (req, res) => {
    const { customerId } = req.params;
    const { uid, ...fieldsToUpdate } = req.body;

    if (!customerId) {
        return res.status(400).json({ error: 'customerId é obrigatório.' });
    }

    try {
        const response = await axios.put(
            `${ASAAS_URL}/customers/${customerId}`,
            { externalReference: uid, ...fieldsToUpdate },
            { headers: asaasHeaders }
        );

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('❌ Erro ao atualizar cliente:', error.response?.data || error.message);
        return res.status(400).json(error.response?.data || { error: 'Erro ao atualizar cliente.' });
    }
});

// ─────────────────────────────────────────────
// ASAAS — Assinaturas
// ─────────────────────────────────────────────

/**
 * POST /api/asaas/create-subscription
 * Cria uma assinatura recorrente com cartão de crédito.
 */
app.post('/api/asaas/create-subscription', async (req, res) => {
    const {
        customer,
        value,
        cycle,
        description,
        creditCard,
        creditCardHolderInfo,
        remoteIp
    } = req.body;

    if (!customer || !creditCard || !creditCardHolderInfo || !remoteIp) {
        return res.status(400).json({
            error: 'Campos obrigatórios ausentes: customer, creditCard, creditCardHolderInfo, remoteIp.'
        });
    }

    // Data de início: amanhã
    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + 1);
    const nextDueDateStr = nextDueDate.toISOString().split('T')[0];

    try {
        const response = await axios.post(`${ASAAS_URL}/subscriptions`, {
            customer,
            billingType: 'CREDIT_CARD',
            value: value || 35.90, // Usa valor do body; fallback para o padrão do Plano Pro
            nextDueDate: nextDueDateStr,
            cycle: cycle || 'MONTHLY',
            description: description || 'Assinatura Plano Pro - Controlar+',
            creditCard,
            creditCardHolderInfo,
            remoteIp
        }, { headers: asaasHeaders });

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('❌ Erro ao criar assinatura:', error.response?.data || error.message);
        return res.status(400).json(error.response?.data || { error: 'Erro ao criar assinatura.' });
    }
});

/**
 * POST /api/asaas/update-subscription-card/:subscriptionId
 * Atualiza o cartão de crédito de uma assinatura existente.
 */
app.post('/api/asaas/update-subscription-card/:subscriptionId', async (req, res) => {
    const { subscriptionId } = req.params;
    const { creditCard, creditCardHolderInfo, remoteIp } = req.body;

    if (!subscriptionId || !creditCard || !creditCardHolderInfo || !remoteIp) {
        return res.status(400).json({
            error: 'Campos obrigatórios ausentes: subscriptionId, creditCard, creditCardHolderInfo, remoteIp.'
        });
    }

    try {
        const response = await axios.post(`${ASAAS_URL}/subscriptions/${subscriptionId}`, {
            creditCard,
            creditCardHolderInfo,
            remoteIp
        }, { headers: asaasHeaders });

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('❌ Erro ao atualizar cartão da assinatura:', error.response?.data || error.message);
        return res.status(400).json(error.response?.data || { error: 'Erro ao atualizar cartão.' });
    }
});

/**
 * DELETE /api/asaas/cancel-subscription/:subscriptionId
 * Cancela uma assinatura ativa.
 */
app.delete('/api/asaas/cancel-subscription/:subscriptionId', async (req, res) => {
    const { subscriptionId } = req.params;

    if (!subscriptionId) {
        return res.status(400).json({ error: 'subscriptionId é obrigatório.' });
    }

    try {
        const response = await axios.delete(
            `${ASAAS_URL}/subscriptions/${subscriptionId}`,
            { headers: asaasHeaders }
        );

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('❌ Erro ao cancelar assinatura:', error.response?.data || error.message);
        return res.status(400).json(error.response?.data || { error: 'Erro ao cancelar assinatura.' });
    }
});

// ─────────────────────────────────────────────
// ASAAS — Cobranças Avulsas
// ─────────────────────────────────────────────

/**
 * POST /api/asaas/create-charge
 * Cria uma cobrança avulsa (Cartão ou PIX).
 * Se não houver customerId, tenta criar um novo cliente.
 */
app.post('/api/asaas/create-charge', async (req, res) => {
    const {
        customer,
        value,
        billingType,
        description,
        externalReference,
        creditCard,
        creditCardHolderInfo,
        remoteIp,
        customerName,
        customerCpfCnpj,
        customerEmail
    } = req.body;

    try {
        let finalCustomerId = customer;

        // 1. Se não temos customerId, criamos um
        if (!finalCustomerId && customerName && customerCpfCnpj) {
            console.log('[Asaas] Criando cliente sob demanda...');
            const custRes = await axios.post(`${ASAAS_URL}/customers`, {
                name: customerName,
                email: customerEmail,
                cpfCnpj: customerCpfCnpj,
                externalReference: externalReference?.split('|')?.[2] || null
            }, { headers: asaasHeaders });
            finalCustomerId = custRes.data.id;
        }

        if (!finalCustomerId) {
            throw new Error('Identificação do cliente é necessária.');
        }

        // 2. Criar Pagamento
        const paymentPayload = {
            customer: finalCustomerId,
            billingType,
            value,
            dueDate: new Date().toISOString().split('T')[0],
            description,
            externalReference
        };

        if (billingType === 'CREDIT_CARD') {
            paymentPayload.creditCard = creditCard;
            paymentPayload.creditCardHolderInfo = creditCardHolderInfo;
            paymentPayload.remoteIp = remoteIp;
        }

        const payRes = await axios.post(`${ASAAS_URL}/payments`, paymentPayload, { headers: asaasHeaders });
        const payment = payRes.data;

        // 3. Se for PIX, buscar QR Code
        if (billingType === 'PIX') {
            const qrRes = await axios.get(`${ASAAS_URL}/payments/${payment.id}/pixQrCode`, { headers: asaasHeaders });
            return res.status(200).json({ ...payment, pixQrCode: qrRes.data });
        }

        return res.status(200).json(payment);

    } catch (error) {
        console.error('❌ Erro create-charge:', error.response?.data || error.message);
        const errorData = error.response?.data || { error: error.message };
        return res.status(400).json(errorData);
    }
});

// ─────────────────────────────────────────────
// ASAAS — Webhook
// ─────────────────────────────────────────────

/**
 * POST /api/asaas/webhook
 * Recebe e processa eventos do Asaas para manter o Firestore sincronizado.
 *
 * Eventos tratados:
 *   ATIVAÇÃO:    PAYMENT_CONFIRMED | PAYMENT_RECEIVED | SUBSCRIPTION_CREATED
 *   RENOVAÇÃO:   SUBSCRIPTION_RENEWED
 *   SUSPENSÃO:   PAYMENT_OVERDUE
 *   CANCELAMENTO: SUBSCRIPTION_DELETED | PAYMENT_DELETED | PAYMENT_REFUNDED
 */
/**
 * POST /api/asaas/sync-credits/checkout
 * Cria uma cobranca validada no servidor para compra de creditos extras.
 */
app.post('/api/asaas/sync-credits/checkout', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    if (!db) {
        return res.status(500).json({ error: 'Firestore nao configurado no servidor.' });
    }

    const {
        comboId,
        billingType,
        cardMode = 'NEW',
        creditCard,
        creditCardHolderInfo,
        creditCardExpiry,
        remoteIp,
    } = req.body || {};
    const requestIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1')
        .split(',')[0]
        .trim()
        .replace(/^::ffff:/, '') || '127.0.0.1';

    const combo = findSyncCreditComboById(comboId);
    if (!combo) {
        return res.status(400).json({ error: 'Pacote de creditos invalido.' });
    }

    if (!['PIX', 'CREDIT_CARD'].includes(billingType)) {
        return res.status(400).json({ error: 'Metodo de pagamento invalido.' });
    }

    try {
        const userRef = getUserRef(authResult.uid);
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }

        const userData = userSnap.data() || {};
        const customerId = await ensureAsaasCustomerForUser({
            uid: authResult.uid,
            userData,
        });

        const paymentPayload = {
            customer: customerId,
            billingType,
            value: combo.amount,
            dueDate: new Date().toISOString().split('T')[0],
            description: `Controlar+ | ${combo.name}`,
            externalReference: buildSyncCreditExternalReference(authResult.uid, combo),
        };

        if (billingType === 'CREDIT_CARD') {
            if (cardMode === 'SAVED') {
                const storedToken = getStoredCreditCardToken(userData);
                if (!storedToken) {
                    return res.status(400).json({
                        error: 'Nenhum cartao reutilizavel foi encontrado. Informe os dados completos do cartao.',
                    });
                }

                paymentPayload.creditCardToken = storedToken;
            } else {
                if (!creditCard || !creditCardHolderInfo) {
                    return res.status(400).json({
                        error: 'Dados obrigatorios ausentes para pagamento com cartao.',
                    });
                }

                paymentPayload.creditCard = creditCard;
                paymentPayload.creditCardHolderInfo = creditCardHolderInfo;
                paymentPayload.remoteIp = remoteIp || requestIp;
            }
        }

        const payRes = await axios.post(`${ASAAS_URL}/payments`, paymentPayload, { headers: asaasHeaders });
        const payment = payRes.data;

        if (billingType === 'CREDIT_CARD' && cardMode !== 'SAVED') {
            await persistReusableCardSnapshot({
                uid: authResult.uid,
                userData,
                payment,
                submittedCard: creditCard,
                submittedExpiry: creditCardExpiry,
            });
        }

        await persistSyncCreditPayment({
            uid: authResult.uid,
            combo,
            billingType,
            payment,
            customerId,
        });

        let pixQrCode = null;
        if (billingType === 'PIX') {
            try {
                const qrRes = await axios.get(`${ASAAS_URL}/payments/${payment.id}/pixQrCode`, { headers: asaasHeaders });
                pixQrCode = qrRes.data;
            } catch (qrError) {
                const qrErrorPayload = qrError.response?.data || {};
                const sandboxPixHint =
                    process.env.ASAAS_MODE !== 'production' &&
                    (qrError.response?.status === 404 || qrErrorPayload?.status === 404);

                console.error('❌ Erro ao buscar QR PIX:', qrErrorPayload || qrError.message);

                return res.status(sandboxPixHint ? 422 : 400).json({
                    error: sandboxPixHint
                        ? 'No sandbox do Asaas, o QR Code PIX pode nao ser gerado sem uma chave PIX cadastrada. Cadastre uma chave PIX no sandbox e gere uma nova cobranca.'
                        : (qrErrorPayload.errors?.[0]?.description || qrErrorPayload.error || 'Nao foi possivel gerar o QR Code PIX.'),
                    paymentId: payment.id,
                    payment,
                });
            }
        }

        let creditResult = {
            handled: true,
            credited: false,
            creditsGranted: 0,
            extraSyncCredits: null,
            status: payment.status || null,
        };

        if (isSettledSyncCreditStatus(payment.status)) {
            creditResult = await creditSyncCreditsFromPayment({
                payment,
                source: 'checkout',
            });
        }

        return res.status(200).json({
            success: true,
            paymentId: payment.id,
            payment,
            status: payment.status || null,
            credited: Boolean(creditResult.credited),
            creditsAdded: creditResult.creditsGranted || 0,
            extraSyncCredits: creditResult.extraSyncCredits,
            pixQrCode,
        });
    } catch (error) {
        console.error('❌ Erro sync-credits/checkout:', error.response?.data || error.message);
        return res.status(error.status || 400).json(error.response?.data || { error: error.message || 'Erro ao gerar cobranca.' });
    }
});

/**
 * GET /api/asaas/sync-credits/payments/:paymentId
 * Consulta o status da cobranca de creditos e aplica o credito, se liquidado.
 */
app.get('/api/asaas/sync-credits/payments/:paymentId', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    const { paymentId } = req.params;
    if (!paymentId) {
        return res.status(400).json({ error: 'paymentId e obrigatorio.' });
    }

    try {
        const paymentRes = await axios.get(`${ASAAS_URL}/payments/${paymentId}`, { headers: asaasHeaders });
        const payment = paymentRes.data;
        const parsedReference = parseSyncCreditExternalReference(payment.externalReference);

        if (!parsedReference || parsedReference.uid !== authResult.uid) {
            return res.status(403).json({ error: 'Pagamento nao pertence ao usuario autenticado.' });
        }

        const creditResult = await creditSyncCreditsFromPayment({
            payment,
            source: 'status_check',
        });

        if (!creditResult.handled) {
            return res.status(404).json({ error: 'Pagamento nao encontrado para creditos sincronizados.' });
        }

        return res.status(200).json({
            success: true,
            paymentId,
            status: payment.status || null,
            credited: Boolean(creditResult.credited),
            creditsAdded: creditResult.creditsGranted || 0,
            extraSyncCredits: creditResult.extraSyncCredits,
            isFailed: isFailedSyncCreditStatus(payment.status),
            isSettled: isSettledSyncCreditStatus(payment.status),
            payment,
        });
    } catch (error) {
        console.error('❌ Erro sync-credits/payment-status:', error.response?.data || error.message);
        return res.status(400).json(error.response?.data || { error: error.message || 'Erro ao consultar pagamento.' });
    }
});

app.post('/api/asaas/webhook', async (req, res) => {
    // Validação do token de segurança
    const incomingToken = req.headers['asaas-access-token'];
    if (process.env.ASAAS_WEBHOOK_TOKEN && incomingToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
        console.warn(`[Webhook] Token inválido recebido: ${incomingToken}`);
        return res.status(401).send('Unauthorized');
    }

    const { event, payment, subscription } = req.body;
    console.log(`[Webhook] Evento: ${event}`);

    const syncCreditReference = parseSyncCreditExternalReference(payment?.externalReference);

    // Mapeia eventos para ações
    const ACTIVATION_EVENTS = [
        'PAYMENT_CONFIRMED',
        'PAYMENT_RECEIVED',
        'SUBSCRIPTION_CREATED',
        'SUBSCRIPTION_RENEWED' // ← ADICIONADO: cobre renovações mensais
    ];

    const SUSPENSION_EVENTS = [
        'PAYMENT_OVERDUE' // ← ADICIONADO: suspende acesso em inadimplência
    ];

    const CANCELLATION_EVENTS = [
        'SUBSCRIPTION_DELETED', // ← ADICIONADO: cancelamento de assinatura
        'PAYMENT_DELETED',      // ← ADICIONADO: cobrança removida
        'PAYMENT_REFUNDED'      // ← ADICIONADO: estorno
    ];

    try {
        if (payment?.id && syncCreditReference?.uid) {
            try {
                const creditResult = await creditSyncCreditsFromPayment({
                    payment,
                    eventName: event,
                    source: 'webhook',
                });

                console.log(
                    `[Webhook] Sync credits | payment=${payment.id} | status=${payment.status} | ` +
                    `credited=${creditResult.credited} | added=${creditResult.creditsGranted || 0}`
                );
            } catch (creditError) {
                console.error('❌ Erro ao creditar sync credits:', creditError.message);
            }

            return res.status(200).send('OK');
        }

        const customerId = payment?.customer || subscription?.customer;

        if (!customerId) {
            console.warn('[Webhook] customerId não encontrado no payload.');
            return res.status(200).send('OK'); // Retorna 200 para evitar reenvios do Asaas
        }

        const uid = await getUidFromAsaasCustomer(customerId);

        if (!uid) {
            console.warn(`[Webhook] UID não encontrado para customerId: ${customerId}`);
            return res.status(200).send('OK');
        }

        const subscriptionId = payment?.subscription || subscription?.id;
        const isSubscriptionEvent = Boolean(subscriptionId || String(event || '').startsWith('SUBSCRIPTION_'));
        if (!isSubscriptionEvent) {
            console.log(`[Webhook] Evento ${event} ignorado por nao estar vinculado a assinatura.`);
            return res.status(200).send('OK');
        }

        const baseExtra = {
            'subscription.asaasCustomerId': customerId,
            'subscription.asaasSubscriptionId': subscriptionId
        };

        if (ACTIVATION_EVENTS.includes(event)) {
            await updateUserPlan(uid, 'pro', 'active', baseExtra);

            // Postback Utmify para novas vendas/ativações
            if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED' || event === 'SUBSCRIPTION_CREATED') {
                const userSnap = await db.collection('users').doc(uid).get();
                const userData = userSnap.data() || {};
                const requestIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

                sendUtmifySale({
                    orderId: payment?.id || subscriptionId,
                    email: userData.email || userData.profile?.email,
                    name: userData.name || userData.profile?.name,
                    phone: userData.phone || userData.profile?.phone,
                    value: payment?.value || subscription?.value || 35.90,
                    ip: requestIp,
                    document: userData.cpf || userData.profile?.cpf
                });
            }

        } else if (SUSPENSION_EVENTS.includes(event)) {
            await updateUserPlan(uid, 'pro', 'overdue', baseExtra);

        } else if (CANCELLATION_EVENTS.includes(event)) {
            await updateUserPlan(uid, 'free', 'inactive', {
                'subscription.asaasCustomerId': customerId,
                'subscription.asaasSubscriptionId': null
            });

        } else {
            console.log(`[Webhook] Evento "${event}" não tratado — ignorado.`);
        }

        return res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Erro ao processar webhook:', error.message);
        // Retorna 200 mesmo em erro interno para evitar reenvios em loop do Asaas
        return res.status(200).send('OK');
    }
});

// ─────────────────────────────────────────────
// ASAAS — Sincronizar Assinatura (Usuários Legados)
// ─────────────────────────────────────────────

/**
 * POST /api/asaas/sync-subscription
 * Consulta o Asaas diretamente e atualiza o status da assinatura no Firestore.
 * Usado para usuários legados que assinaram pelo Asaas no sistema antigo.
 */
app.post('/api/asaas/sync-subscription', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    const uid = authResult.uid;

    if (!db) {
        return res.status(500).json({ error: 'Firestore nao disponivel.' });
    }

    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }

        const userData = userDoc.data();

        // Lê campos em todos os lugares possíveis onde o sistema antigo pode ter salvo
        const subscriptionId = userData?.subscription?.asaasSubscriptionId
            || userData?.asaasSubscriptionId;
        let customerId = userData?.subscription?.asaasCustomerId
            || userData?.asaasCustomerId;

        const userEmail = userData?.email || userData?.profile?.email
            || authResult.user?.email || null;

        console.log(`[AsaasSync] uid=${uid} | subscriptionId=${subscriptionId} | customerId=${customerId} | email=${userEmail} | subscription:`, JSON.stringify(userData?.subscription || {}));

        let asaasSubscription = null;

        // 1. Busca direto pelo subscriptionId
        if (subscriptionId) {
            try {
                const subRes = await axios.get(`${ASAAS_URL}/subscriptions/${subscriptionId}`, { headers: asaasHeaders });
                asaasSubscription = subRes.data;
            } catch (err) {
                console.warn(`[AsaasSync] subscriptionId ${subscriptionId} nao encontrado.`);
            }
        }

        // 2. Fallback: busca pelo customerId
        if (!asaasSubscription && customerId) {
            try {
                const listRes = await axios.get(`${ASAAS_URL}/subscriptions`, {
                    headers: asaasHeaders,
                    params: { customer: customerId, limit: 10 }
                });
                const items = listRes.data?.data || [];
                asaasSubscription = items.find(s => s.status === 'ACTIVE') || items[0] || null;
            } catch (err) {
                console.warn(`[AsaasSync] Erro ao buscar por customerId ${customerId}.`);
            }
        }

        // 3. Fallback: busca cliente pelo email e depois assinatura
        if (!asaasSubscription && userEmail) {
            try {
                const custRes = await axios.get(`${ASAAS_URL}/customers`, {
                    headers: asaasHeaders,
                    params: { email: userEmail, limit: 5 }
                });
                const customers = custRes.data?.data || [];
                for (const cust of customers) {
                    const subRes = await axios.get(`${ASAAS_URL}/subscriptions`, {
                        headers: asaasHeaders,
                        params: { customer: cust.id, limit: 10 }
                    });
                    const items = subRes.data?.data || [];
                    const found = items.find(s => s.status === 'ACTIVE') || items[0] || null;
                    if (found) {
                        asaasSubscription = found;
                        customerId = cust.id; // salva para gravar no Firestore
                        console.log(`[AsaasSync] Cliente encontrado por email: customerId=${cust.id}`);
                        break;
                    }
                }
            } catch (err) {
                console.warn(`[AsaasSync] Erro ao buscar por email ${userEmail}.`);
            }
        }

        if (!asaasSubscription) {
            console.log(`[AsaasSync] uid=${uid} — nenhuma assinatura encontrada no Asaas.`);
            // Nenhuma assinatura encontrada — marca como inativo
            await updateUserPlan(uid, 'free', 'inactive', {
                'subscription.provider': 'asaas',
            });
            return res.status(200).json({
                success: true,
                synced: false,
                status: 'inactive',
                plan: 'free',
                message: 'Nenhuma assinatura ativa encontrada no Asaas.',
            });
        }

        // Mapeia status do Asaas para status interno
        const asaasStatus = String(asaasSubscription.status || '').toUpperCase();
        let internalStatus;
        let internalPlan;

        if (asaasStatus === 'ACTIVE') {
            internalStatus = 'active';
            internalPlan = 'pro';
        } else if (asaasStatus === 'OVERDUE') {
            internalStatus = 'overdue';
            internalPlan = 'pro';
        } else {
            // INACTIVE, EXPIRED, etc.
            internalStatus = 'inactive';
            internalPlan = 'free';
        }

        const extraFields = {
            'subscription.provider': 'asaas',
            'subscription.asaasSubscriptionId': asaasSubscription.id,
        };

        if (customerId) extraFields['subscription.asaasCustomerId'] = customerId;
        if (asaasSubscription.nextDueDate) extraFields['subscription.nextBillingDate'] = asaasSubscription.nextDueDate;
        if (asaasSubscription.value) extraFields['subscription.price'] = String(asaasSubscription.value).replace('.', ',');
        if (asaasSubscription.creditCard?.creditCardBrand) {
            extraFields['subscription.creditCardBrand'] = asaasSubscription.creditCard.creditCardBrand;
        }
        if (asaasSubscription.creditCard?.creditCardNumber) {
            // Asaas retorna os últimos 4 dígitos
            extraFields['subscription.creditCardLast4'] = asaasSubscription.creditCard.creditCardNumber;
        }

        await updateUserPlan(uid, internalPlan, internalStatus, extraFields);

        console.log(`[AsaasSync] uid=${uid} | asaasStatus=${asaasStatus} → interno: plano=${internalPlan}, status=${internalStatus}`);

        return res.status(200).json({
            success: true,
            synced: true,
            asaasStatus,
            status: internalStatus,
            plan: internalPlan,
            nextBillingDate: asaasSubscription.nextDueDate || null,
            subscriptionId: asaasSubscription.id,
        });

    } catch (error) {
        console.error('❌ Erro ao sincronizar assinatura Asaas:', error.response?.data || error.message);
        return res.status(500).json({ error: error.message || 'Erro ao sincronizar assinatura.' });
    }
});

// ADMIN — Visão Geral de Assinaturas
// ─────────────────────────────────────────────

/**
 * GET /api/admin/subscriptions
 * Lista todos os usuários com assinatura (pro/overdue) e verifica status no Asaas e Stripe.
 * Requer autenticação e isAdmin === true no Firestore.
 */
app.get('/api/admin/users', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ error: authResult.error });
    }

    if (!db) {
        return res.status(500).json({ error: 'Firestore nao disponivel.' });
    }

    // Verifica se o usuário logado é admin
    const callerDoc = await db.collection('users').doc(authResult.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.isAdmin !== true) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    try {
        // Busca todos os usuários no Auth para pegar data de criação real e emails
        let authUsers = new Map();
        try {
            let listUsersResult = await admin.auth().listUsers(1000);
            listUsersResult.users.forEach(u => authUsers.set(u.uid, u));
            while (listUsersResult.pageToken) {
                listUsersResult = await admin.auth().listUsers(1000, listUsersResult.pageToken);
                listUsersResult.users.forEach(u => authUsers.set(u.uid, u));
            }
        } catch (e) {
            console.warn('Nao foi possivel buscar auth users:', e.message);
        }

        // Busca todos os usuários do Firestore
        const snap = await db.collection('users').get();
        const results = [];

        // Adiciona usuários do Firestore (e mescla com Auth)
        const processedUids = new Set();

        for (const doc of snap.docs) {
            const uid = doc.id;
            processedUids.add(uid);

            const data = doc.data();
            const sub = data.subscription || {};
            const profile = data.profile || {};
            const authUser = authUsers.get(uid);

            const email = data.email || profile.email || authUser?.email || 'N/A';
            const name = data.name || profile.name || authUser?.displayName || email || uid;

            const provider = sub.provider || (sub.asaasCustomerId ? 'asaas' : sub.stripeCustomerId ? 'stripe' : 'unknown');
            const plan = sub.plan || data.plan || 'free';
            const status = sub.status || 'unknown';

            let createdAt = data.createdAt || authUser?.metadata?.creationTime || null;
            if (createdAt && typeof createdAt.toDate === 'function') {
                createdAt = createdAt.toDate().toISOString();
            } else if (createdAt && createdAt instanceof Date) {
                createdAt = createdAt.toISOString();
            } else if (createdAt && typeof createdAt === 'number') {
                createdAt = new Date(createdAt).toISOString();
            }

            let lastLogin = data.lastLogin || authUser?.metadata?.lastSignInTime || null;
            if (lastLogin && typeof lastLogin.toDate === 'function') {
                lastLogin = lastLogin.toDate().toISOString();
            } else if (lastLogin instanceof Date) {
                lastLogin = lastLogin.toISOString();
            }

            results.push({
                uid,
                name,
                email,
                provider,
                plan,
                status,
                isAdmin: data.isAdmin || false,
                abandonedHandled: data.abandonedHandled || false,
                remarketingStage: data.remarketingStage || 0,
                remarketingOpenD1: data.remarketingOpenD1 || null,
                remarketingOpenD2: data.remarketingOpenD2 || null,
                remarketingOpenD3: data.remarketingOpenD3 || null,
                remarketingClickD1: data.remarketingClickD1 || null,
                remarketingClickD2: data.remarketingClickD2 || null,
                remarketingClickD3: data.remarketingClickD3 || null,
                createdAt,
                lastLogin,
                activeDaysCount: data.activeDaysCount || 0
            });
        }

        // Opcional: Adicionar usuários que só existem no Auth (e não no Firestore)
        for (const [uid, authUser] of authUsers.entries()) {
            if (!processedUids.has(uid)) {
                results.push({
                    uid,
                    name: authUser.displayName || authUser.email || uid,
                    email: authUser.email || 'N/A',
                    provider: 'unknown',
                    plan: 'free',
                    status: 'unknown',
                    isAdmin: false,
                    createdAt: authUser.metadata?.creationTime || null,
                    lastLogin: authUser.metadata?.lastSignInTime || null,
                    activeDaysCount: 0
                });
            }
        }

        // Ordena por data de criacao (mais novos primeiro)
        results.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });
        return res.status(200).json({ total: results.length, users: results });
    } catch (error) {
        console.error('❌ Erro ao listar assinaturas admin:', error.message);
        return res.status(500).json({ error: error.message || 'Erro interno.' });
    }
});

/**
 * [ADMIN] Envia e-mail de teste de remarketing
 */
app.post('/api/admin/test-remarketing', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) return res.status(authResult.status).json({ error: authResult.error });

    const { email, name, day } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

    try {
        const d = parseInt(day) || 1;
        let couponCode = null;
        let expiresAt = null;
        let checkoutUrl = 'https://www.controlarmais.com.br/';

        // Tentar encontrar usuário para criar sessão real no Stripe
        const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
        const userData = userSnap.empty ? null : userSnap.docs[0].data();
        const uid = userSnap.empty ? null : userSnap.docs[0].id;

        if (uid && (d === 2 || d === 3)) {
            // Gerar cupom único NAME1234
            const promoData = await createUniquePromoCode(name || userData?.name || 'AMIGO');
            couponCode = promoData.code;
            expiresAt = promoData.expiresAt;

            // Criar sessão de checkout já com o cupom aplicado
            const session = await createRemarketingCheckoutSession({
                uid,
                promoCode: couponCode
            });
            checkoutUrl = session.url;
        }

        await sendAbandonedCartEmail({
            uid,
            email,
            name: name || userData?.name || 'Gustavo',
            day: d,
            couponCode,
            checkoutUrl,
            expiresAt
        });

        // Registrar o estágio no banco mesmo no teste para aparecer na tabela
        await db.collection('users').doc(uid).update({
            remarketingStage: d,
            lastRemarketingSentAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({
            success: true,
            message: `E-mail D+${d} enviado para ${email}. ${couponCode ? `Cupom: ${couponCode}` : ''}`
        });
    } catch (error) {
        console.error('❌ Erro ao enviar remarketing teste:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * [ADMIN] Marca carrinho como finalizado/ignorado (remove da lista)
 */
app.post('/api/admin/users/:uid/abandoned-handled', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) return res.status(authResult.status).json({ error: authResult.error });

    const callerDoc = await db.collection('users').doc(authResult.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.isAdmin !== true) {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    const { uid } = req.params;
    try {
        await db.collection('users').doc(uid).set({
            abandonedHandled: true
        }, { merge: true });
        return res.status(200).json({ success: true, message: 'Carrinho marcado como tratado.' });
    } catch (error) {
        console.error('❌ Erro ao tratar carrinho:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * [ADMIN] Verifica pagamento ativo no provedor
 */
app.get('/api/admin/users/:uid/verify-payment', async (req, res) => {
    try {
        const decodedToken = await admin.auth().verifyIdToken(req.headers.authorization?.split('Bearer ')[1]);
        if (!decodedToken) return res.status(401).json({ error: 'Não autorizado.' });

        const adminDoc = await db.collection('users').doc(decodedToken.uid).get();
        if (!adminDoc.exists || !adminDoc.data().isAdmin) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }

        const targetUid = req.params.uid;
        const targetDoc = await db.collection('users').doc(targetUid).get();
        if (!targetDoc.exists) return res.status(404).json({ error: 'Usuário não encontrado.' });

        const data = targetDoc.data();
        const sub = data.subscription || {};
        let verified = false;

        if ((sub.provider === 'stripe' || sub.stripeCustomerId) && stripe) {
            const stripeSubs = await stripe.subscriptions.list({ customer: sub.stripeCustomerId });
            verified = stripeSubs.data.some(s => ['active', 'trialing'].includes(s.status));
        } else if ((sub.provider === 'asaas' || sub.asaasCustomerId) && process.env.ASAAS_API_KEY) {
            const asaasUrl = process.env.ASAAS_MODE === 'sandbox' ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3';
            const response = await axios.get(`${asaasUrl}/subscriptions?customer=${sub.asaasCustomerId}`, {
                headers: { 'access_token': process.env.ASAAS_API_KEY }
            });
            verified = response.data.data.some(s => s.status === 'ACTIVE');
        }

        return res.status(200).json({ verified });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Erro ao verificar pagamento.' });
    }
});

/**
 * POST /api/admin/users/:uid/toggle-admin
 * Alterna o status de administrador de um usuário.
 */
app.post('/api/admin/users/:uid/toggle-admin', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) return res.status(authResult.status).json({ error: authResult.error });

    if (!db) return res.status(500).json({ error: 'Firestore nao disponivel.' });

    const callerDoc = await db.collection('users').doc(authResult.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.isAdmin !== true) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    const targetUid = req.params.uid;
    const { isAdmin } = req.body;

    try {
        await db.collection('users').doc(targetUid).set({ isAdmin: Boolean(isAdmin) }, { merge: true });
        return res.status(200).json({ success: true, isAdmin: Boolean(isAdmin) });
    } catch (error) {
        console.error(`❌ Erro ao alterar admin para ${targetUid}:`, error.message);
        return res.status(500).json({ error: 'Erro ao atualizar status de administrador.' });
    }
});

/**
 * DELETE /api/admin/users/:uid
 * Exclui um usuário do Authentication e do Firestore.
 */
app.delete('/api/admin/users/:uid', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) return res.status(authResult.status).json({ error: authResult.error });

    if (!db) return res.status(500).json({ error: 'Firestore nao disponivel.' });

    const callerDoc = await db.collection('users').doc(authResult.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.isAdmin !== true) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    const targetUid = req.params.uid;
    if (targetUid === authResult.uid) {
        return res.status(400).json({ error: 'Voce nao pode excluir a si mesmo.' });
    }

    try {
        // Exclui do Firebase Auth
        try {
            await admin.auth().deleteUser(targetUid);
        } catch (authErr) {
            console.warn(`[admin/users] delete fallback: (uid=${targetUid}) não achado no auth. ${authErr.message}`);
        }

        // Exclui do Firestore
        await db.collection('users').doc(targetUid).delete();

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(`❌ Erro ao excluir usuário ${targetUid}:`, error.message);
        return res.status(500).json({ error: 'Erro ao excluir usuário.' });
    }
});

/**
 * POST /api/admin/stripe/sync-users
 * Puxa todos os clientes/assinaturas do Stripe e sincroniza com o Firestore.
 */
app.post('/api/admin/stripe/sync-users', async (req, res) => {
    const authResult = await verifyFirebaseRequest(req);
    if (!authResult.ok) return res.status(authResult.status).json({ error: authResult.error });

    if (!db) return res.status(500).json({ error: 'Firestore nao disponivel.' });
    if (!stripe) return res.status(500).json({ error: 'Stripe nao configurado.' });

    const callerDoc = await db.collection('users').doc(authResult.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.isAdmin !== true) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    let synced = 0;
    let notFound = 0;
    let errors = 0;

    try {
        // Busca todas as assinaturas do Stripe (com dados do cliente expandidos)
        let hasMore = true;
        let startingAfter = undefined;

        while (hasMore) {
            const params = { limit: 100, expand: ['data.customer'] };
            if (startingAfter) params.starting_after = startingAfter;

            const stripeSubs = await stripe.subscriptions.list(params);

            for (const sub of stripeSubs.data) {
                try {
                    const customer = sub.customer;
                    const customerId = typeof customer === 'string' ? customer : customer?.id;

                    // Tenta obter o UID pelo metadata do cliente
                    let uid = null;
                    if (typeof customer === 'object' && customer?.metadata?.firebaseUID) {
                        uid = customer.metadata.firebaseUID;
                    }

                    // Fallback: busca no Firestore pelo stripeCustomerId
                    if (!uid && customerId) {
                        const snap = await db.collection('users')
                            .where('subscription.stripeCustomerId', '==', customerId)
                            .limit(1)
                            .get();
                        if (!snap.empty) uid = snap.docs[0].id;
                    }

                    if (!uid) {
                        notFound++;
                        continue;
                    }

                    const plan = (sub.status === 'active' || sub.status === 'trialing') ? 'pro' : 'free';
                    const status = sub.status; // active, trialing, canceled, past_due, etc.

                    await db.collection('users').doc(uid).set({
                        subscription: {
                            plan,
                            status,
                            provider: 'stripe',
                            stripeCustomerId: customerId,
                            stripeSubscriptionId: sub.id,
                        },
                        updatedAt: new Date().toISOString(),
                    }, { merge: true });

                    synced++;
                } catch (subErr) {
                    console.error('[stripe/sync-users] erro em sub:', subErr.message);
                    errors++;
                }
            }

            hasMore = stripeSubs.has_more;
            if (hasMore && stripeSubs.data.length > 0) {
                startingAfter = stripeSubs.data[stripeSubs.data.length - 1].id;
            }
        }

        console.log(`✅ [stripe/sync-users] synced=${synced} notFound=${notFound} errors=${errors}`);
        return res.status(200).json({ success: true, synced, notFound, errors });
    } catch (error) {
        console.error('❌ [stripe/sync-users]', error.message);
        return res.status(500).json({ error: error.message || 'Erro ao sincronizar do Stripe.' });
    }
});

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        asaasMode: process.env.ASAAS_MODE || 'sandbox',
        stripe: isStripeReady() ? 'configured' : 'disabled',
        firebase: admin.apps.length > 0 ? 'connected' : 'disabled',
        timestamp: new Date().toISOString()
    });
});


// ─────────────────────────────────────────────────────────────────────────────
// TRACKING REMARKETING (Abertura e Cliques)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pixel de abertura: /api/rkt/o/:uid/:day
 */
app.get('/api/rkt/o/:uid/:day', async (req, res) => {
    const { uid, day } = req.params;
    try {
        await db.collection('users').doc(uid).update({
            [`remarketingOpenD${day}`]: admin.firestore.FieldValue.serverTimestamp(),
            lastActivity: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        // Silencioso se o user não existir
    }
    const pngHex = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789ccb6060600000000500010d652d0a00000000454e44ae426082";
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from(pngHex, 'hex'));
});

/**
 * Rastreamento de cliques: /api/rkt/c/:uid/:day?url=...
 */
app.get('/api/rkt/c/:uid/:day', async (req, res) => {
    const { uid, day } = req.params;
    const targetUrl = req.query.url || 'https://www.controlarmais.com.br/';

    try {
        await db.collection('users').doc(uid).update({
            [`remarketingClickD${day}`]: admin.firestore.FieldValue.serverTimestamp(),
            lastActivity: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        // Silencioso
    }
    res.redirect(targetUrl);
});

/**
 * Dispara o e-mail de remarketing e atualiza o estágio no banco
 */
async function triggerRemarketing(uid, userData, day) {
    try {
        if (!userData.email) return;

        let couponCode = null;
        let checkoutUrl = 'https://www.controlarmais.com.br/';
        let expiresAt = null;

        // D+2 e D+3 ganham cupons únicos e checkout direto
        if (day === 2 || day === 3) {
            const promoData = await createUniquePromoCode(userData.name || 'AMIGO');
            couponCode = promoData.code;
            expiresAt = promoData.expiresAt;

            // Criar sessão de checkout já com o cupom aplicado
            const session = await createRemarketingCheckoutSession({
                uid,
                promoCode: couponCode
            });
            checkoutUrl = session.url;
        }

        const sentInfo = await sendAbandonedCartEmail({
            uid,
            email: userData.email,
            name: userData.name || 'Cliente',
            day,
            couponCode,
            checkoutUrl,
            expiresAt
        });

        // Se sendEmail retornou null (chave faltando), não marcar como enviado
        if (sentInfo === null) {
            console.warn(`⚠️ [AUTO-REMARKETING] E-mail D+${day} para ${uid} abortado: RESEND_API_KEY ausente.`);
            return;
        }

        // Salvar que enviamos este estágio
        await db.collection('users').doc(uid).update({
            remarketingStage: day,
            lastRemarketingSentAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`📡 [AUTO-REMARKETING] D+${day} enviado com sucesso para: ${userData.email} (ID: ${sentInfo?.id})`);
    } catch (e) {
        console.error(`❌ [AUTO-REMARKETING] Erro ao disparar remarketing para ${uid} (D+${day}):`, e.message);
    }
}

/**
 * Escaneia o banco em busca de carrinhos abandonados prontos para remarketing
 */
async function processRemarketingQueue() {
    console.log('🔍 [AUTO-REMARKETING] Escaneando carrinhos abandonados...');
    try {
        const usersSnap = await db.collection('users').get();
        const now = Date.now();
        let scannedCount = 0;
        let matchedCount = 0;

        for (const doc of usersSnap.docs) {
            const data = doc.data();
            scannedCount++;

            // Verificação de plano aprimorada
            const userPlan = data.subscription?.plan || data.plan || 'free';
            const userEmail = data.email || data.profile?.email || 'sem-email';

            // Ignorar se já for Pro, se for Admin ou se marcado como tratado/ignorado
            if (userPlan === 'active' || userPlan === 'pro' || data.isAdmin || data.abandonedHandled) continue;
            if (!data.createdAt) continue;

            const createdAtDate = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
            const hoursPassed = Math.floor((now - createdAtDate.getTime()) / (1000 * 60 * 60));
            const currentStage = data.remarketingStage || 0;

            // D+3: Mais de 72 horas
            if (hoursPassed >= 72 && currentStage < 3) {
                matchedCount++;
                await triggerRemarketing(doc.id, data, 3);
            }
            // D+2: Mais de 48 horas
            else if (hoursPassed >= 48 && currentStage < 2) {
                matchedCount++;
                await triggerRemarketing(doc.id, data, 2);
            }
            // D+1: Mais de 24 horas
            else if (hoursPassed >= 24 && currentStage < 1) {
                matchedCount++;
                await triggerRemarketing(doc.id, data, 1);
            }
        }
        console.log(`✅ [AUTO-REMARKETING] Escaneamento finalizado: ${scannedCount} usuários lidos, ${matchedCount} remarketings disparados.`);
    } catch (e) {
        console.error('❌ Erro ao processar fila de remarketing:', e.message);
    }
}

// Iniciar o cron se estivermos em modo produção ou se desejado
function startRemarketingCron() {
    console.log('🚀 Sistema de Remarketing Automático Ativado.');
    // Executa uma vez ao iniciar (com delay de 10s para estabilizar servidor)
    setTimeout(processRemarketingQueue, 10000);
    // E depois a cada 1 hora
    setInterval(processRemarketingQueue, 60 * 60 * 1000);
}

// Ligar o robô
startRemarketingCron();

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`🌐 Asaas: ${ASAAS_URL}`);
});

