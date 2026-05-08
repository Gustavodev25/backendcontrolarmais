import { signOut } from 'firebase/auth';
import { API_BASE } from '../lib/apiConfig';
import { toaster } from '../components/Toast';
import { renderLoading } from '../components/LoadingScreen';
import { auth } from '../lib/firebase';
import { clearStripeCheckoutQueryParams, createStripeSubscriptionSession, getStripeCheckoutSessionStatus } from '../lib/stripe';
import { authManager } from './Auth';
import { renderDashboard } from './Dashboard';
import { renderLegacyAsaasCheckout } from './LegacyAsaasCheckout';

function isLegacyAsaasManagedUser(userData: any) {
  return Boolean(
    userData?.subscription?.provider === 'asaas' ||
    userData?.subscription?.asaasSubscriptionId ||
    userData?.subscription?.asaasCustomerId ||
    userData?.asaasSubscriptionId ||
    userData?.asaasCustomerId
  );
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

let subscriptionReturnInFlight = false;
let subscriptionRedirectInFlight = false;

function isInvalidStripeSessionId(sessionId: string | null) {
  return !sessionId || sessionId === '{CHECKOUT_SESSION_ID}';
}

function clearStripeSignupProgressFlags() {
  sessionStorage.removeItem('stripeSignupRedirectInProgress');
  sessionStorage.removeItem('stripeSignupSetupInProgress');
  sessionStorage.removeItem('stripeSignupInlineRedirectInProgress');
}

function shouldPreserveInlineSignupUi() {
  return (
    sessionStorage.getItem('stripeSignupInlineRedirectInProgress') === '1' &&
    Boolean(document.querySelector('#auth-form button[type="submit"][aria-busy="true"]'))
  );
}

async function resolveSubscriptionReturn(sessionId: string) {
  let lastResult: Awaited<ReturnType<typeof getStripeCheckoutSessionStatus>> | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    lastResult = await getStripeCheckoutSessionStatus(sessionId);
    if (lastResult.subscriptionStatus === 'active' || lastResult.plan === 'pro') {
      return lastResult;
    }
    await delay(1500);
  }

  return lastResult;
}

async function startStripeSubscriptionRedirect() {
  if (subscriptionRedirectInFlight) return;

  const params = new URLSearchParams(window.location.search);
  if (params.has('checkout') || params.has('session_id')) {
    return;
  }

  try {
    subscriptionRedirectInFlight = true;
    sessionStorage.setItem('stripeSignupRedirectInProgress', '1');
    
    // Read and consume the promotion code (set by landing page)
    const promotionCode = sessionStorage.getItem('landingPromotionCode') || undefined;
    sessionStorage.removeItem('landingPromotionCode');
    
    const result = await createStripeSubscriptionSession(window.location.origin, promotionCode);
    const targetUrl = result.portalUrl || result.url;

    if (!targetUrl) {
      throw new Error('Nao foi possivel abrir o pagamento no Stripe.');
    }

    window.location.assign(targetUrl);
  } catch (error: any) {
    console.error('Stripe auto-redirect error:', error);
    clearStripeSignupProgressFlags();
    subscriptionRedirectInFlight = false;
    toaster.create({
      title: 'Erro no pagamento',
      description: error.message || 'Nao foi possivel abrir o Stripe.',
      type: 'error',
    });

    try {
      if (auth.currentUser) {
        await signOut(auth);
      } else {
        authManager.clearState();
        window.location.reload();
      }
    } catch (_signOutError) {
      window.location.reload();
    }
  }
}

export async function handlePendingStripeSubscriptionReturn() {
  if (subscriptionReturnInFlight) return;

  const params = new URLSearchParams(window.location.search);
  const checkoutState = params.get('checkout');
  const sessionId = params.get('session_id');

  if (checkoutState === 'stripe-cancelled') {
    subscriptionReturnInFlight = true;
    clearStripeSignupProgressFlags();
    clearStripeCheckoutQueryParams();
    toaster.create({
      title: 'Pagamento cancelado',
      description: 'Voce cancelou o checkout do Stripe.',
      type: 'warning',
    });

    try {
      if (auth.currentUser) {
        await signOut(auth);
      } else {
        authManager.clearState();
        window.location.reload();
      }
    } catch (_error) {
      window.location.reload();
    }
    return;
  }

  if (checkoutState !== 'stripe-success') {
    return;
  }

  if (isInvalidStripeSessionId(sessionId)) {
    subscriptionReturnInFlight = true;
    clearStripeSignupProgressFlags();
    clearStripeCheckoutQueryParams();
    toaster.create({
      title: 'Retorno invalido do Stripe',
      description: 'O session_id do checkout nao foi preenchido corretamente. Tente iniciar o pagamento novamente.',
      type: 'error',
    });
    return;
  }

  try {
    subscriptionReturnInFlight = true;
    clearStripeSignupProgressFlags();
    if (!sessionId) return;
    const result = await resolveSubscriptionReturn(sessionId);

    if (result?.subscriptionStatus === 'active' || result?.plan === 'pro') {
      clearStripeCheckoutQueryParams();
      toaster.create({
        title: 'Plano ativado',
        description: 'Sua assinatura foi confirmada com sucesso.',
        type: 'success',
      });

      await delay(600);
      if (auth.currentUser) {
        sessionStorage.setItem('stripeSignupWelcomePendingUid', auth.currentUser.uid);
        sessionStorage.setItem('currentPage', 'dashboard');
        sessionStorage.setItem('currentTab', 'overview');
        renderDashboard(auth.currentUser, 'overview');
      }
      return;
    }

    toaster.create({
      title: 'Sincronizando assinatura',
      description: 'O pagamento foi aprovado e a ativacao ainda esta sendo sincronizada.',
      type: 'message',
    });
  } catch (error: any) {
    console.error('Stripe return error:', error);
    toaster.create({
      title: 'Falha ao confirmar pagamento',
      description: error.message || 'Nao foi possivel confirmar a assinatura no retorno do Stripe.',
      type: 'error',
    });
  }
}

function renderStripeRedirectState() {
  if (!shouldPreserveInlineSignupUi()) {
    renderLoading();
  }
  void startStripeSubscriptionRedirect();
}

export function renderCheckout(userData: any) {
  if (isLegacyAsaasManagedUser(userData)) {
    renderLegacyAsaasCheckout(userData);
    return;
  }

  // Se não é Stripe, tenta verificar no Asaas antes de redirecionar
  const isStripeUser = Boolean(userData?.subscription?.stripeCustomerId);
  if (!isStripeUser) {
    tryAsaasSyncBeforeStripe(userData);
    return;
  }

  renderStripeRedirectState();
}

function tryAsaasSyncBeforeStripe(userData: any) {
  renderLoading();

  const currentUser = auth.currentUser;
  if (!currentUser) {
    renderStripeRedirectState();
    return;
  }

  const baseUrl = API_BASE;

  currentUser.getIdToken()
    .then((token) => fetch(`${baseUrl}/api/asaas/sync-subscription`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => res.json()))
    .then((data: any) => {
      if (data.plan === 'pro') {
        renderDashboard(currentUser, 'overview');
        return;
      }

      // Se o sync localizou um cliente Asaas (mesmo sem assinatura ativa),
      // o usuario deve renovar via Asaas — nao redireciona pro Stripe.
      if (data.hasAsaasCustomer || data.asaasCustomerId) {
        const merged = {
          ...userData,
          uid: currentUser.uid,
          email: currentUser.email,
          subscription: {
            ...(userData?.subscription || {}),
            provider: 'asaas',
            asaasCustomerId: data.asaasCustomerId || userData?.subscription?.asaasCustomerId,
          },
        };
        renderLegacyAsaasCheckout(merged);
        return;
      }

      renderStripeRedirectState();
    })
    .catch(() => {
      renderStripeRedirectState();
    });
}
