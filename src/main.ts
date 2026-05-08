import './style.css'
import './styles/auth.css'
import { toaster } from './components/Toast'
import { renderLoading } from './components/LoadingScreen'
import { themeManager } from './components/ThemeManager'
import { auth, db } from './lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { authManager } from './pages/Auth'
import { renderDashboard } from './pages/Dashboard'
import { renderConnectedBanks } from './pages/ConnectedBanks'
import { renderCreditCards } from './pages/CreditCards'
import { renderSettings } from './pages/Settings'
import { renderCheckout } from './pages/Checkout'
import { handlePendingStripeSubscriptionReturn } from './pages/Checkout'
import { renderCategories } from './pages/Categories'
import { renderTransactions } from './pages/Transactions'
import { renderSubscriptions } from './pages/Subscriptions'
import { renderReminders } from './pages/Reminders'
import { renderPatrimony } from './pages/Patrimony'
import { renderAdmin } from './pages/Admin'
import { renderAdminSubscriptions } from './pages/AdminSubscriptions'
import { renderAdminAbandonedCarts } from './pages/AdminAbandonedCarts'
import { renderAdminUpdates } from './pages/AdminUpdates'
import { renderAdminAutomation } from './pages/AdminAutomation'
import { renderAdminAutomationChat } from './pages/AdminAutomationChat'
import { handlePendingSyncCreditsCheckoutReturn } from './components/SyncCreditsCheckout'
import { renderLanding, cleanupLanding } from './pages/Landing'
import { getPublicLegalPageFromPath, renderLegalPage } from './pages/Legal'
import { openTwoFactorPromoModal } from './components/TwoFactorPromoModal'
import { renderUpdates } from './pages/Updates'

import { trackSession } from './lib/sessions'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { startChangelogNotificationListener, stopChangelogNotificationListener } from './lib/changelogNotifications'

import { API_BASE } from './lib/apiConfig';

// Patch global do fetch: adiciona header ngrok-skip-browser-warning em chamadas à API
if (API_BASE.includes('ngrok')) {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith(API_BASE)) {
      const headers = new Headers((init.headers as HeadersInit) || {});
      headers.set('ngrok-skip-browser-warning', '1');
      init = { ...init, headers };
    }
    return _fetch(input, init);
  };
}

let currentUser: any = null;
let isInitialized = false;
const publicLegalPage = getPublicLegalPageFromPath();

const ASAAS_MIGRATION_FLAG = 'asaasMigrationRequired';

function getApiBaseUrl() {
  return API_BASE;
}

function hasAsaasFootprint(userData: any): boolean {
  if (!userData) return false;
  const sub = userData.subscription || {};
  return Boolean(
    sub.provider === 'asaas' ||
    sub.asaasSubscriptionId ||
    sub.asaasCustomerId ||
    userData.asaasSubscriptionId ||
    userData.asaasCustomerId
  );
}

export function isAsaasMigrationRequired(): boolean {
  return sessionStorage.getItem(ASAAS_MIGRATION_FLAG) === '1';
}

export function clearAsaasMigrationFlag() {
  sessionStorage.removeItem(ASAAS_MIGRATION_FLAG);
}

(window as any).setMeAsAdmin = async () => {
  if (auth.currentUser) {
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { isAdmin: true });
      alert('Pronto! Seu usuário agora é Administrador. Atualize a página e abra o menu para ver a opção.');
    } catch (e) {
      alert('Erro ao atualizar: ' + (e as any).message);
    }
  } else {
    alert('Ops! Nenhum usuário logado atualmente.');
  }
};

(window as any).testProfileModal = (mandatory: boolean = false) => {
  if (auth.currentUser) {
    import('./components/CompleteProfileModal').then(m => m.openCompleteProfileModal(auth.currentUser, mandatory));
  } else {
    alert('Ops! Nenhum usuário logado atualmente.');
  }
};

/**
 * Se o usuário tem asaasSubscriptionId mas não tem plan='pro' no Firestore,
 * sincroniza com a API do Asaas e retorna o plano real.
 */
async function resolveAsaasUserPlan(user: any, userData: any): Promise<string> {
  const plan = (userData.subscription?.plan || userData.plan || '').toLowerCase();
  if (plan === 'pro') return 'pro';

  // Se já é Stripe, não tenta Asaas
  const isStripeUser = Boolean(userData.subscription?.stripeCustomerId);
  if (isStripeUser) return plan;

  // Para qualquer usuário sem plan='pro' e sem Stripe, tenta sincronizar pelo Asaas
  // O backend busca por IDs salvos, e se não achar, busca pelo email
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${getApiBaseUrl()}/api/asaas/sync-subscription`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return (data.plan || plan).toLowerCase();
  } catch (err) {
    return plan;
  }
}

function renderAuth() {
  authManager.render();
}

// Rotas públicas legais usadas pela App Store não entram no fluxo de autenticação.
if (publicLegalPage) {
  renderLegalPage(publicLegalPage);
} else {
  // Splash inicial / Loading de Auth
  renderLoading();
}

// Listener para quando signup for completado
window.addEventListener('auth-complete', (e: any) => {
  const { signupData } = e.detail;
  renderCheckout(auth.currentUser || signupData);
});

// Monitor global
onAuthStateChanged(auth, async (user) => {
  if (publicLegalPage) {
    isInitialized = true;
    return;
  }

  if (user) {
    cleanupLanding();
    currentUser = user;
    const urlParams = new URLSearchParams(window.location.search);
    const hasStripeReturnParams = urlParams.has('checkout') || urlParams.has('syncCredits') || urlParams.has('session_id');
    const redirectPending = sessionStorage.getItem('stripeSignupRedirectInProgress') === '1';
    const setupPending = sessionStorage.getItem('stripeSignupSetupInProgress') === '1';
    const inlineRedirectPending = sessionStorage.getItem('stripeSignupInlineRedirectInProgress') === '1';
    const inlineSignupSubmitInFlight = Boolean(
      document.querySelector('#auth-form button[type="submit"][aria-busy="true"]')
    );

    if (inlineRedirectPending && redirectPending && setupPending && !hasStripeReturnParams) {
      if (inlineSignupSubmitInFlight) {
        return;
      }

      startChangelogNotificationListener({ uid: user.uid, isAdmin: false });
      renderCheckout(user);
      return;
    }

    // Buscar status do plano no Firestore
    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userData = userSnap.data();
        const isAdminUser = userData.isAdmin === true;
        currentUser = { ...user, ...userData }; // Persiste admin e plano para navegação
        const plan = (userData.subscription?.plan || userData.plan || "").toLowerCase();

        startChangelogNotificationListener({ uid: user.uid, isAdmin: isAdminUser });

        // 2FA Verification Check
        const is2FaVerifiedSession = sessionStorage.getItem(`2fa_verified_${user.uid}`) === 'true';
        const is2FaPromoShown = sessionStorage.getItem(`2fa_promo_shown_${user.uid}`) === 'true';

        if (userData.twoFactorEnabled && !is2FaVerifiedSession) {
          import('./pages/TwoFactorVerification').then(m => m.renderTwoFactorVerification(user));
          return;
        }

        // Para usuários sem plan='pro', tenta sincronizar pelo Asaas (busca por IDs ou email)
        const resolvedPlan = (userData.isAdmin === true || plan === 'pro')
          ? plan
          : await resolveAsaasUserPlan(user, userData);

        // Persiste flag de admin para que o Header saiba em todas as telas
        if (isAdminUser) {
          sessionStorage.setItem('isAdminUser', 'true');
        } else {
          sessionStorage.removeItem('isAdminUser');
        }

        if (redirectPending && setupPending && !hasStripeReturnParams) {
          renderLoading();
        } else if (userData.isAdmin === true || resolvedPlan === 'pro') {
          themeManager.releaseDark();
          clearAsaasMigrationFlag();
          // Restaurar última página visitada se houver
          sessionStorage.removeItem('stripeSignupRedirectInProgress');
          sessionStorage.removeItem('stripeSignupSetupInProgress');
          sessionStorage.removeItem('stripeSignupInlineRedirectInProgress');
          const savedPage = sessionStorage.getItem('currentPage');
          const savedTab = sessionStorage.getItem('currentTab');

          if (savedPage === 'settings') {
            renderSettings(currentUser, (savedTab as any) || undefined);
          } else if (savedPage === 'connected-banks') {
            renderConnectedBanks(currentUser);
          } else if (savedPage === 'credit-cards') {
            renderCreditCards(currentUser);
          } else if (savedPage === 'categories') {
            renderCategories(currentUser);
          } else if (savedPage === 'transactions') {
            renderTransactions(currentUser);
          } else if (savedPage === 'subscriptions') {
            renderSubscriptions(currentUser);
          } else if (savedPage === 'reminders') {
            renderReminders(currentUser);
          } else if (savedPage === 'patrimony') {
            renderPatrimony(currentUser);
          } else if (savedPage === 'admin') {
            renderAdmin(currentUser);
          } else if (savedPage === 'admin-subscriptions') {
            renderAdminSubscriptions(currentUser);
          } else if (savedPage === 'admin-abandoned-carts') {
            renderAdminAbandonedCarts(currentUser);
          } else if (savedPage === 'admin-updates') {
            renderAdminUpdates(currentUser);
          } else if (savedPage === 'admin-automation') {
            renderAdminAutomation(currentUser);
          } else if (savedPage === 'updates') {
            renderUpdates(currentUser);
          } else {
            renderDashboard(currentUser, savedTab || undefined);

            const isProfileComplete = !!(userData.phone && userData.profile?.address?.cep);
            const isProfilePromoShown = sessionStorage.getItem(`profile_promo_shown_${user.uid}`) === 'true';
            const welcomeModalShown = localStorage.getItem(`welcome_modal_shown_${user.uid}`) === 'true';

            if (!isProfileComplete && !isProfilePromoShown) {
              const openProfileForm = () => {
                import('./components/CompleteProfileModal').then(m => m.openCompleteProfileModal(user, true));
              };

              if (!welcomeModalShown) {
                sessionStorage.setItem(`profile_promo_shown_${user.uid}`, 'true');
                localStorage.setItem(`welcome_modal_shown_${user.uid}`, 'true');
                setTimeout(() => {
                  import('./components/WelcomeModal').then(m => {
                    m.openWelcomeModal(userData.name || user.displayName || '', openProfileForm);
                  });
                }, 1500);
              } else {
                sessionStorage.setItem(`profile_promo_shown_${user.uid}`, 'true');
                setTimeout(openProfileForm, 1200);
              }
            } else if (isProfileComplete && !userData.twoFactorEnabled && !is2FaPromoShown) {
              sessionStorage.setItem(`2fa_promo_shown_${user.uid}`, 'true');
              setTimeout(() => openTwoFactorPromoModal(), 800);
            }
          }
        } else if (hasAsaasFootprint(userData)) {
          // Usuario com rastro de Asaas mas sem plan='pro' resolvido: libera o sistema
          // forcando-o a Settings → Plano para migrar pro Stripe. Toda outra navegacao
          // sera interceptada e redirecionada de volta para ca enquanto o flag estiver ativo.
          themeManager.releaseDark();
          sessionStorage.setItem(ASAAS_MIGRATION_FLAG, '1');
          sessionStorage.setItem('currentPage', 'settings');
          sessionStorage.setItem('currentTab', 'plan');
          renderSettings(currentUser, 'plan');
          toaster.create({
            title: 'Migracao necessaria',
            description: 'Sua assinatura no Asaas precisa ser migrada para o Stripe para continuar usando o sistema.',
            type: 'warning',
          });
        } else {
          clearAsaasMigrationFlag();
          // Passa userData (Firestore) para que isLegacyAsaasManagedUser funcione corretamente
          renderCheckout({ ...userData, uid: user.uid, email: user.email });
        }
      } else {
        startChangelogNotificationListener({ uid: user.uid, isAdmin: false });
        if (redirectPending && setupPending && !hasStripeReturnParams) {
          renderLoading();
        } else {
          clearAsaasMigrationFlag();
          renderCheckout(user);
        }
      }
    } catch (error) {
      console.error("Erro ao verificar assinatura:", error);
      toaster.create({ title: "Status da Conta", description: "Houve um problema ao verificar sua assinatura. Tente novamente.", type: "error" });
      startChangelogNotificationListener({ uid: user.uid, isAdmin: false });
      if (redirectPending && setupPending && !hasStripeReturnParams) {
        renderLoading();
      } else {
        renderCheckout(user);
      }
    }

    void handlePendingSyncCreditsCheckoutReturn();
    void handlePendingStripeSubscriptionReturn();

    if (!isInitialized) {
      toaster.create({ title: "Bem-vindo", description: "Verificando sua conta...", type: "success" });
    }
    // Se logou com sucesso, limpa rastro de cadastro pendente
    authManager.clearState();
    // Rastrear sessão
    trackSession(user.uid);
  } else {
    currentUser = null;
    stopChangelogNotificationListener();
    // Se não há usuário logado, renderiza a landing page
    renderLanding();
  }
  isInitialized = true;
});

// Listener global de navegação
window.addEventListener('app-navigate', (e: any) => {
  if (!currentUser) return;
  let { page, tab } = e.detail;

  // Trava de migracao Asaas: enquanto o flag estiver ativo, so 'settings' e permitido.
  // Qualquer outra navegacao e desviada para Settings → Plano com aviso.
  if (isAsaasMigrationRequired() && currentUser?.isAdmin !== true && page !== 'settings') {
    page = 'settings';
    tab = 'plan';
    toaster.create({
      title: 'Acao bloqueada',
      description: 'Migre sua assinatura do Asaas para o Stripe para continuar usando o sistema.',
      type: 'warning',
    });
  }

  // Persistir navegação
  if (page) sessionStorage.setItem('currentPage', page);

  if (page === 'connected-banks' || page === 'credit-cards' || page === 'transactions' || page === 'subscriptions' || page === 'reminders' || page === 'patrimony' || page === 'admin' || page === 'admin-subscriptions' || page === 'admin-abandoned-carts' || page === 'admin-updates' || page === 'admin-automation' || page === 'admin-automation-chat' || page === 'updates') {

    sessionStorage.removeItem('currentTab');
  } else {
    if (tab) sessionStorage.setItem('currentTab', tab);
    else sessionStorage.setItem('currentTab', 'overview');
  }

  const navigate = () => {
    themeManager.releaseDark();
    if (page === 'settings') {
      renderSettings(currentUser, (tab as any) || undefined);
    } else if (page === 'connected-banks') {
      renderConnectedBanks(currentUser);
    } else if (page === 'credit-cards') {
      renderCreditCards(currentUser);
    } else if (page === 'categories') {
      renderCategories(currentUser);
    } else if (page === 'transactions') {
      renderTransactions(currentUser);
    } else if (page === 'subscriptions') {
      renderSubscriptions(currentUser);
    } else if (page === 'reminders') {
      renderReminders(currentUser);
    } else if (page === 'patrimony') {
      renderPatrimony(currentUser);
    } else if (page === 'admin') {
      renderAdmin(currentUser);
    } else if (page === 'admin-subscriptions') {
      renderAdminSubscriptions(currentUser);
    } else if (page === 'admin-abandoned-carts') {
      renderAdminAbandonedCarts(currentUser);
    } else if (page === 'admin-updates') {
      renderAdminUpdates(currentUser);
    } else if (page === 'admin-automation') {
      renderAdminAutomation(currentUser);
    } else if (page === 'admin-automation-chat') {
      renderAdminAutomationChat(currentUser);
    } else if (page === 'updates') {
      renderUpdates(currentUser);
    } else if (page === 'dashboard') {

      renderDashboard(currentUser, tab);
    }
  };

  if ((document as any).startViewTransition) {
    (document as any).startViewTransition(navigate);
  } else {
    navigate();
  }
});
