import { Input } from '../components/Input';
import { API_BASE } from '../lib/apiConfig';
import { toaster } from '../components/Toast';
import { BrilhoHeader } from '../components/BrilhoHeader';
import { db, auth } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { renderDashboard } from './Dashboard';
import { signOut, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { authManager } from './Auth';

export function renderLegacyAsaasCheckout(userData: any) {
  // Se já tem assinatura ativa no Asaas, vai direto pro dashboard
  const alreadyActive = userData?.subscription?.status === 'active' && (
    userData?.subscription?.asaasSubscriptionId || userData?.asaasSubscriptionId
  );
  if (alreadyActive) {
    import('./Dashboard').then(m => m.renderDashboard(userData));
    return;
  }

  const app = document.querySelector<HTMLDivElement>('#app')!;

  app.innerHTML = `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Sora:wght@300;400;500;600&display=swap" rel="stylesheet">

    <style>
      *, *::before, *::after { box-sizing: border-box; }

      :root {
        --accent: #D97757;
        --accent-dim: rgba(217,119,87,0.12);
        --accent-mid: rgba(217,119,87,0.4);
        --r: 1.25rem;
        --mono: 'IBM Plex Mono', monospace;
        --sans: 'Sora', sans-serif;
      }

      .ck-root {
        font-family: var(--sans);
        min-height: 100vh;
        background: var(--color-bg);
        color: var(--color-text);
        display: flex;
        flex-direction: column;
      }

      @keyframes fadein {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .animate-fadein { animation: fadein 0.3s ease both; }

      /* ── LAYOUT ── */
      .ck-container {
        flex: 1;
        width: 100%;
        max-width: 1000px;
        margin: 0 auto;
        padding: 40px 24px 60px;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .ck-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .ck-page-eyebrow {
        text-transform: uppercase;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.15em;
        color: var(--accent);
        opacity: 0.7;
        margin-bottom: 4px;
      }

      .ck-page-title {
        font-size: 24px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--color-text);
      }

      .ck-grid {
        display: grid;
        grid-template-columns: 1fr 380px;
        gap: 24px;
        align-items: start;
      }

      @media (max-width: 900px) {
        .ck-grid { grid-template-columns: 1fr; }
        .ck-container { padding: 40px 20px; }
      }

      /* ── CARD STYLE (SETTINGS STYLE) ── */
      .ck-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--r);
        overflow: hidden;
        position: relative;
        isolation: isolate;
      }

      .ck-card-header {
        padding: 16px 24px;
        border-bottom: 1px solid var(--color-border-light);
      }

      .ck-card-eyebrow {
        text-transform: uppercase;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.12em;
        color: var(--color-text-secondary);
      }

      .ck-card-body {
        padding: 24px;
      }

      /* ── FORM ── */
      .ck-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .ck-row-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .ck-card-brands {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 4px;
        opacity: 0.4;
      }
      .brand-icon { font-family: var(--mono); font-size: 10px; letter-spacing: 0.05em; border: 1px solid var(--color-border); padding: 2px 6px; border-radius: 4px; }

      /* ── SUMMARY ── */
      .ck-price-box {
        margin-bottom: 20px;
      }

      .ck-plan-name {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--color-text);
        font-family: var(--sans);
        font-size: 32px;
        font-weight: 600;
        letter-spacing: -0.04em;
        margin-bottom: 12px;
        line-height: 1;
      }

      .ck-price-val {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .ck-currency { font-family: var(--mono); font-size: 14px; color: var(--color-text-secondary); }
      .ck-amount { font-family: var(--mono); font-size: 48px; font-weight: 300; letter-spacing: -0.04em; color: var(--color-text); line-height: 1; }
      .ck-period { font-family: var(--mono); font-size: 12px; color: var(--color-text-secondary); opacity: 0.5; }

      .ck-benefits-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 20px 24px;
        margin-left: -24px;
        margin-right: -24px;
        border-top: 1px solid var(--color-border-light);
        border-bottom: 1px solid var(--color-border-light);
        margin-bottom: 20px;
      }

      .ck-summary-details {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 20px;
      }

      .ck-benefit-item {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }

      .ck-check-circle {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .ck-summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        margin-bottom: 10px;
      }
      .ck-sum-label { color: var(--color-text-secondary); }
      .ck-sum-val { font-family: var(--mono); font-weight: 500; }

      .ck-total-row {
        padding: 20px 24px 0;
        margin-left: -24px;
        margin-right: -24px;
        border-top: 1px solid var(--color-border-light);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .ck-total-label { font-weight: 600; font-size: 14px; }
      .ck-total-val { font-family: var(--mono); font-size: 18px; font-weight: 600; color: var(--accent); }

      /* ── SWIPE BUTTON MINIMALISTA ── */
      .ck-swipe-container {
        position: relative;
        width: 100%;
        height: 50px;
        background: rgba(255,255,255,0.03);
        border: 1px solid var(--color-border-light);
        border-radius: 25px; /* Full rounded */
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        user-select: none;
        transition: all 0.3s ease;
        margin-top: 32px;
      }
      .ck-swipe-container:active { cursor: grabbing; border-color: var(--accent-mid); background: rgba(255,255,255,0.05); }

      .ck-swipe-text {
        position: absolute;
        font-family: var(--mono);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.15em;
        color: var(--color-text-secondary);
        opacity: 0.3;
        pointer-events: none;
        transition: opacity 0.3s;
      }

      .ck-swipe-handle {
        position: absolute;
        left: 4px;
        top: 4px;
        bottom: 4px;
        width: 42px;
        background: var(--accent);
        border-radius: 21px; /* Circular */
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
        box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        transition: transform 0.05s linear, background 0.3s;
      }

      .ck-swipe-handle svg { width: 14px; height: 14px; stroke: white; transition: all 0.3s; }

      .ck-swipe-progress {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 0;
        background: rgba(217,119,87,0.08); /* Muito sutil */
        z-index: 5;
      }

      .ck-swipe-container.completed {
        border-color: rgba(74,222,128,0.3);
        background: rgba(74,222,128,0.05);
      }
      .ck-swipe-container.completed .ck-swipe-handle { 
        background: #4ade80; 
        box-shadow: 0 0 15px rgba(74,222,128,0.4);
      }
      .ck-swipe-container.completed .ck-swipe-text { opacity: 0; }

      /* Security badge */
      .ck-secure-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-top: 24px;
        font-family: var(--mono);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--color-text-secondary);
        opacity: 0.4;
      }

      .ck-back-link {
        display: flex;
        align-items: center;
        gap: 8px;
        background: none;
        border: none;
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: color 0.2s;
        padding: 0;
      }
      .ck-back-link:hover { color: var(--color-text); }

      .ck-footer-text {
        text-align: center;
        margin: 60px 0 20px;
        font-family: var(--mono);
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--color-text-secondary);
        opacity: 0.25;
        pointer-events: none;
      }
    </style>

    <div class="ck-root">
      ${BrilhoHeader()}

      <div class="ck-container animate-fadein">
        
        <!-- Action bar -->
        <div class="ck-header-row">
          <div>
            <p class="ck-page-eyebrow">Finalizar Pedido</p>
            <h1 class="ck-page-title">Escolha do Plano</h1>
          </div>
          <button id="btn-back-checkout" class="ck-back-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"></path><polyline points="12 19 5 12 12 5"></polyline></svg>
            Sair e voltar
          </button>
        </div>

        <div class="ck-grid">
          
          <!-- LADO ESQUERDO: PAGAMENTO -->
          <div class="ck-card">
            <div class="ck-card-header">
              <p class="ck-card-eyebrow">Informações de Pagamento</p>
            </div>
            <div class="ck-card-body">
              <form id="checkout-form" class="ck-form">
                
                ${Input({ id: 'cardName', type: 'text', label: 'Nome no cartão', placeholder: 'Como impresso no cartão', required: true })}
                ${Input({ id: 'cpfCnpj', type: 'text', label: 'CPF do titular', placeholder: '000.000.000-00', required: true, value: userData?.cpf || '' })}
                
                <div class="flex flex-col gap-2">
                  ${Input({ id: 'cardNumber', type: 'text', label: 'Número do cartão', placeholder: '0000 0000 0000 0000', required: true })}
                  <div class="ck-card-brands">
                    <span class="brand-icon">VISA</span>
                    <span class="brand-icon">MASTER</span>
                    <span class="brand-icon">AMEX</span>
                    <span class="brand-icon">ELO</span>
                  </div>
                </div>

                <div class="ck-row-2">
                  ${Input({ id: 'expiry', type: 'text', label: 'Expiração', placeholder: 'MM/AA', required: true })}
                  ${Input({ id: 'cvv', type: 'password', label: 'CVV', placeholder: '•••', required: true })}
                </div>

                <div class="ck-secure-badge">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  Ambiente Seguro · Certificado SSL · Asaas v3
                </div>
              </form>
            </div>
          </div>

          <!-- LADO DIREITO: RESUMO -->
          <div class="ck-card">
            <div class="ck-card-header">
              <p class="ck-card-eyebrow">Resumo do Pedido</p>
            </div>
            <div class="ck-card-body">
              
              <div class="ck-price-box">
                <div class="ck-plan-name">
                  Plano Pro
                </div>
                <div class="ck-price-val">
                  <span class="ck-currency">R$</span>
                  <span class="ck-amount">35,90</span>
                  <span class="ck-period">/mês</span>
                </div>
                <p style="font-size: 11px; color: var(--color-text-secondary); opacity: 0.6; margin-top: 8px;">Cobrança recorrente mensal.</p>
              </div>

              <div class="ck-benefits-list">
                ${[
      'IA Integrada ilimitada',
      'Lançamentos por texto',
      'Consultor financeiro IA',
      'Metas e lembretes inteligentes',
      'Contas bancárias ilimitadas'
    ].map(item => `
                  <div class="ck-benefit-item">
                    <div class="ck-check-circle">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <span>${item}</span>
                  </div>
                `).join('')}
              </div>

              <div class="ck-summary-details">
                <div class="ck-summary-row">
                  <span class="ck-sum-label">Assinatura mensal</span>
                  <span class="ck-sum-val">R$ 35,90</span>
                </div>
                <div class="ck-summary-row">
                  <span class="ck-sum-label">Taxas de ativação</span>
                  <span class="ck-sum-val" style="color: #4ade80;">Grátis</span>
                </div>
              </div>

              <div class="ck-total-row">
                <span class="ck-total-label">Total hoje</span>
                <span class="ck-total-val">R$ 35,90</span>
              </div>

              <!-- Novo Botão de Swipe -->
              <div id="swipe-to-pay" class="ck-swipe-container">
                <div class="ck-swipe-text">Deslize para ativar</div>
                <div class="ck-swipe-progress"></div>
                <div class="ck-swipe-handle">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </div>
              </div>

            </div>
          </div>

        </div>

        <p class="ck-footer-text">Controlar+ © 2026 — Inteligência Financeira Automática</p>
      </div>
    </div>
  `;

  attachCheckoutListeners(userData);
}

function attachCheckoutListeners(userData: any) {
  const form = document.getElementById('checkout-form') as HTMLFormElement;

  // Password Toggles (CVV)
  const passwordToggles = document.querySelectorAll('.password-toggle');
  passwordToggles.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (targetId) {
        const input = document.getElementById(targetId) as HTMLInputElement;
        if (input) {
          const lottiePlayer = btn.querySelector('.eye-lottie') as any;
          if (input.type === 'password') {
            input.type = 'text';
            if (lottiePlayer) {
              lottiePlayer.setDirection(1);
              lottiePlayer.play();
            }
          } else {
            input.type = 'password';
            if (lottiePlayer) {
              lottiePlayer.setDirection(-1);
              lottiePlayer.play();
            }
          }
        }
      }
    });
  });

  // Botão Voltar (Sair)
  const backBtn = document.getElementById('btn-back-checkout');
  backBtn?.addEventListener('click', async () => {
    try {
      if (auth.currentUser) {
        await signOut(auth);
      } else {
        authManager.clearState();
        window.location.reload();
      }
    } catch (e: any) {
      console.error("Erro ao sair:", e);
      toaster.create({ title: "Erro ao sair", description: "Ocorreu um problema ao encerrar sua sessão.", type: "error" });
    }
  });

  // Masks
  const cardNumberInput = document.getElementById('cardNumber') as HTMLInputElement;
  cardNumberInput?.addEventListener('input', (e: any) => {
    let value = e.target.value.replace(/\D/g, '').substring(0, 16);
    e.target.value = value.replace(/(\d{4})/g, '$1 ').trim();
  });

  const expiryInput = document.getElementById('expiry') as HTMLInputElement;
  expiryInput?.addEventListener('input', (e: any) => {
    let value = e.target.value.replace(/\D/g, '').substring(0, 4);
    if (value.length > 2) value = value.substring(0, 2) + '/' + value.substring(2);
    e.target.value = value;
  });

  const cpfInput = document.getElementById('cpfCnpj') as HTMLInputElement;
  cpfInput?.addEventListener('input', (e: any) => {
    let value = e.target.value.replace(/\D/g, '').substring(0, 11);
    if (value.length > 9) value = value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    else if (value.length > 6) value = value.replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3");
    else if (value.length > 3) value = value.replace(/(\d{3})(\d{3})/, "$1.$2");
    e.target.value = value;
  });

  // ── SWIPE LOGIC ───────────────────────────────────────────────────────────
  const swipeContainer = document.getElementById('swipe-to-pay');
  const swipeHandle = swipeContainer?.querySelector('.ck-swipe-handle') as HTMLElement;
  const swipeProgress = swipeContainer?.querySelector('.ck-swipe-progress') as HTMLElement;
  const swipeText = swipeContainer?.querySelector('.ck-swipe-text') as HTMLElement;

  let isDragging = false;
  let startX = 0;
  let currentX = 0;
  let maxDrag = 0;

  const initSwipeWidth = () => {
    maxDrag = (swipeContainer?.clientWidth || 0) - (swipeHandle?.clientWidth || 0) - 8;
  };

  const onStart = (e: any) => {
    if (swipeContainer?.classList.contains('completed')) return;
    isDragging = true;
    startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    currentX = 0;
    swipeHandle.style.transition = 'none';
  };

  const onMove = (e: any) => {
    if (!isDragging) return;
    const x = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    currentX = Math.max(0, Math.min(x - startX, maxDrag));

    swipeHandle.style.transform = `translateX(${currentX}px)`;
    swipeProgress.style.width = `${currentX + 50}px`;
    swipeText.style.opacity = String(0.4 * (1 - currentX / maxDrag));

    if (currentX >= maxDrag - 2) {
      onComplete();
    }
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    if (currentX < maxDrag) {
      swipeHandle.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      swipeHandle.style.transform = `translateX(0px)`;
      swipeProgress.style.transition = 'width 0.3s ease';
      swipeProgress.style.width = '0px';
      swipeText.style.opacity = '0.4';
      setTimeout(() => {
        swipeProgress.style.transition = '';
      }, 300);
    }
  };

  const resetSwipe = () => {
    swipeContainer?.classList.remove('completed');
    swipeHandle.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    swipeHandle.style.transform = `translateX(0px)`;
    swipeHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
    swipeProgress.style.transition = 'width 0.4s ease';
    swipeProgress.style.width = '0px';
    swipeText.style.opacity = '0.4';
  };

  const onComplete = () => {
    isDragging = false;

    // VALIDAR ANTES DE COMPLETAR VISUALMENTE
    if (!form?.checkValidity()) {
      toaster.create({
        title: "Dados incompletos",
        description: "Preencha as informações do cartão antes de ativar.",
        type: "warning"
      });
      resetSwipe();
      return;
    }

    swipeContainer?.classList.add('completed');
    swipeHandle.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    swipeHandle.style.transform = `translateX(${maxDrag}px)`;
    swipeProgress.style.transition = 'width 0.3s ease';
    swipeProgress.style.width = '100%';
    swipeHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    // Pequeno delay para animação de sucesso antes de disparar o form
    setTimeout(() => {
      form?.requestSubmit();
    }, 400);
  };

  swipeHandle?.addEventListener('mousedown', onStart);
  swipeHandle?.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);
  window.resizeBy = initSwipeWidth; // Simples re-calc no resize
  initSwipeWidth();

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Verificação dupla por segurança
    if (!form.checkValidity()) {
      resetSwipe();
      return;
    }

    // Feedback visual de carregamento no swipe
    swipeHandle.innerHTML = `<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>`;

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
      // 1. Criar Cliente no Asaas
      const customerRes = await fetch(`${API_BASE}/api/asaas/create-customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: userData.name,
          email: userData.email,
          cpfCnpj: String(userData.cpf).replace(/\D/g, ''),
          phone: userData.phone.replace(/\D/g, ''),
          uid: 'temp_' + Date.now()
        })
      });

      const customer = await customerRes.json();
      if (!customerRes.ok) throw new Error(customer.errors?.[0]?.description || 'Erro ao criar cliente');

      // 2. Criar Assinatura Cartão
      const expiryParts = String(data.expiry).split('/');
      const subscriptionRes = await fetch(`${API_BASE}/api/asaas/create-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: customer.id,
          creditCard: {
            holderName: data.cardName,
            number: String(data.cardNumber).replace(/\D/g, ''),
            expiryMonth: expiryParts[0],
            expiryYear: '20' + expiryParts[1],
            ccv: data.cvv
          },
          creditCardHolderInfo: {
            name: data.cardName,
            email: userData.email,
            cpfCnpj: String(userData.cpf).replace(/\D/g, ''),
            postalCode: userData.cep.replace(/\D/g, ''),
            addressNumber: userData.number,
            phone: userData.phone.replace(/\D/g, '')
          },
          remoteIp: '127.0.0.1'
        })
      });

      const subscription = await subscriptionRes.json();
      if (!subscriptionRes.ok) throw new Error(subscription.errors?.[0]?.description || 'Erro na transação');

      // 3. APÓS SUCESSO NO PAGAMENTO: Criar conta no Firebase
      const userCredential = await createUserWithEmailAndPassword(auth, userData.email, userData.password);
      await updateProfile(userCredential.user, { displayName: userData.name });

      const cardNumberRaw = String(data.cardNumber).replace(/\D/g, '');
      const cardLast4 = cardNumberRaw.slice(-4);
      const cardExpiry = data.expiry;
      const cardBrand = subscription.creditCard?.creditCardBrand || "VISA";
      const cardToken = subscription.creditCardToken || null;

      console.log("[Checkout] Asaas creditCardToken recebido:", cardToken ? `${cardToken.substring(0, 8)}...` : 'NENHUM');

      const now = new Date().toISOString();
      const baseDoc = {
        id: userCredential.user.uid,
        uid: userCredential.user.uid,
        name: userData.name,
        email: userData.email,
        createdAt: now,
        updatedAt: now,
        isAdmin: false,
        profile: {
          id: userCredential.user.uid,
          name: userData.name,
          email: userData.email,
          phone: userData.phone,
          cpf: userData.cpf,
          birthDate: userData.birthDate,
          address: {
            street: userData.street,
            number: userData.number,
            neighborhood: userData.neighborhood,
            city: userData.city,
            state: userData.state,
            cep: userData.cep
          }
        },
        subscription: {
          plan: "pro",
          status: "active",
          asaasCustomerId: customer.id,
          asaasSubscriptionId: subscription.id,
          startDate: now.split('T')[0],
          billingCycle: "mensal",
          price: "35,90",
          creditCardLast4: cardLast4,
          creditCardBrand: cardBrand,
          creditCardToken: cardToken,
          nextBillingDate: subscription.nextDueDate || "",
        },
        paymentMethodDetails: {
          last4: cardLast4,
          expiry: cardExpiry,
          brand: cardBrand,
          token: cardToken
        },
        invoices: [
          {
            id: 'inv_' + Date.now(),
            date: now,
            dueDate: now.split('T')[0],
            value: 35.90,
            status: "CONFIRMED",
            description: "Plano Pro - Ativação"
          }
        ]
      };

      console.log("[Checkout] Salvando baseDoc no Firestore:", baseDoc);
      await setDoc(doc(db, "users", userCredential.user.uid), baseDoc);

      // 4. ATUALIZAR UID NO ASAAS — vincula externalReference ao UID real do Firebase
      // (sem isso, webhooks de renovacao/cancelamento nao acham o usuario)
      try {
        await fetch(`${API_BASE}/api/asaas/update-customer/${customer.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: userCredential.user.uid
          })
        });
      } catch (err) {
        console.warn("Erro ao atualizar UID no Asaas:", err);
        // Não bloqueia o fluxo, mas avisa no console
      }

      // Limpar estado de persistência pois o cadastro finalizou
      authManager.clearState();

      toaster.create({ title: "Bem-vindo!", description: "Conta ativada com sucesso! Dados salvos!", type: "success" });

      setTimeout(() => {
        renderDashboard(userCredential.user);
      }, 1500);

    } catch (error: any) {
      console.error(error);
      toaster.create({ title: "Erro na transação", description: error.message, type: "error" });
      resetSwipe();
    }
  });
}
