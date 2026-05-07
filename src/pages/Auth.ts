import gsap from 'gsap';
import { Input } from '../components/Input';
import { Button, setButtonLoading } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { toaster } from '../components/Toast';
import { BrilhoHeader } from '../components/BrilhoHeader';
import { themeManager } from '../components/ThemeManager';
import { auth, db } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { renderPasswordRecovery } from './PasswordRecovery';
import { API_BASE } from '../lib/apiConfig';

interface AuthState {
  isLogin: boolean;
  signupData: {
    name: string;
    email: string;
    password: string;
    [key: string]: any;
  };
}

class AuthManager {
  private state: AuthState = {
    isLogin: true,
    signupData: { name: '', email: '', password: '' }
  };

  private animation: gsap.core.Timeline | null = null;

  constructor() {
    this.loadState();
  }

  private loadState() {
    const isLogin = sessionStorage.getItem('isLogin') !== 'false';
    const signupData = JSON.parse(sessionStorage.getItem('signupData') || '{"name":"","email":"","password":""}');

    this.state = { isLogin, signupData };
  }

  private saveState() {
    sessionStorage.setItem('isLogin', String(this.state.isLogin));
    sessionStorage.setItem('signupData', JSON.stringify(this.state.signupData));
  }

  showLogin() {
    this.state.isLogin = true;
    this.render();
  }

  showSignup() {
    this.state.isLogin = false;
    this.render();
  }

  clearState() {
    sessionStorage.removeItem('signupData');
  }

  getAuthHTML() {
    if (this.state.isLogin) {
      return this.getLoginHTML();
    } else {
      return this.getSignupHTML();
    }
  }

  private getLoginHTML() {
    return `
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-white mb-2">Acesse sua conta</h2>
        <p class="text-gray-400 text-xs leading-relaxed">Gerencie seu negócio com inteligência e precisão. Entre para continuar.</p>
      </div>
      <form id="auth-form" class="space-y-4">
        ${Input({ id: 'email', type: 'email', label: 'Email', required: true })}
        ${Input({ id: 'password', type: 'password', label: 'Senha', required: true })}

        <div class="flex items-center mt-6 mb-6">
          ${Checkbox({ id: 'remember', label: 'Lembrar de mim', checked: true })}
        </div>

        <div class="mt-2">
          ${Button({ text: 'Entrar', type: 'submit' })}
        </div>

        <div class="flex justify-between items-center mt-8 px-1">
          <a href="#" id="forgot-password" class="text-white/40 text-[10px] font-normal hover:text-[#D97757] transition-colors">Esqueceu a senha?</a>
          <a href="#" id="toggle-auth" class="text-white/60 text-[10px] font-normal hover:text-[#D97757] transition-colors text-right">Ainda não tem conta? <b>Criar uma conta</b></a>
        </div>
      </form>
    `;
  }

  private getSignupHTML() {
    return `
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-white mb-2">Crie sua conta</h2>
        <p class="text-gray-400 text-xs leading-relaxed">Antes, crie sua conta</p>
      </div>
      <form id="auth-form" class="space-y-4">
        ${Input({ id: 'name', type: 'text', label: 'Nome Completo', required: true, value: this.state.signupData.name })}
        ${Input({ id: 'email', type: 'email', label: 'Email', required: true, value: this.state.signupData.email })}
        ${Input({ id: 'password', type: 'password', label: 'Senha', required: true, value: this.state.signupData.password })}

        <div class="mt-2">
          ${Button({ text: 'Criar minha conta', type: 'submit' })}
        </div>
        <div class="flex justify-between items-center mt-6 gap-4">
          <div class="max-w-[200px]">
            ${Checkbox({ id: 'terms', label: 'Ao clicar em cadastrar, você concorda com nossos <a href="/termos-de-uso" target="_blank" rel="noopener noreferrer" class="text-white/60 underline hover:text-[#D97757]">termos de uso</a>.', required: true })}
          </div>
          <a href="#" id="toggle-auth" class="text-white/60 text-xs font-normal hover:text-[#D97757] transition-colors text-right shrink-0">Já tenho conta</a>
        </div>
      </form>
    `;
  }

  async changeAuthView() {
    const containerDiv = document.getElementById('dynamic-container');
    const contentDiv = document.getElementById('dynamic-content');
    if (!containerDiv || !contentDiv) return;

    // Kill previous animation
    if (this.animation) {
      this.animation.kill();
      this.animation = null;
    }

    const oldHeight = containerDiv.offsetHeight;
    containerDiv.style.height = `${oldHeight}px`;

    // ─── CLOSE PHASE ─────────────────────────────────────────────────────────
    const closeAnim = gsap.timeline();

    // Content dissolve with blur
    closeAnim.to(contentDiv, {
      opacity: 0,
      filter: 'blur(8px)',
      transform: 'scale(0.92) translateY(-12px)',
      duration: 0.2,
      ease: 'power2.in'
    }, 0);

    // Container collapse
    closeAnim.to(containerDiv, {
      borderRadius: '100px',
      duration: 0.25,
      ease: 'power2.in'
    }, 0.05);

    await new Promise(r => setTimeout(r, 250));

    // Update content
    contentDiv.innerHTML = this.getAuthHTML();

    // ─── OPEN PHASE ──────────────────────────────────────────────────────────
    const openAnim = gsap.timeline();

    // Get new height - force layout recalculation
    containerDiv.style.height = 'auto';
    containerDiv.style.overflow = 'visible';
    containerDiv.style.display = 'block';
    // Force reflow to get accurate height
    void containerDiv.offsetHeight;
    const newHeight = containerDiv.scrollHeight;

    // Reset to old height without animation
    containerDiv.style.transition = 'none';
    containerDiv.style.height = `${oldHeight}px`;
    containerDiv.style.overflow = 'hidden';

    // Trigger reflow
    void containerDiv.offsetHeight;

    // Container expand - 3 phase liquid expansion
    // Phase A: Horizontal stretch (blob shape)
    openAnim.to(containerDiv, {
      height: `${newHeight * 1.12}px`,
      borderRadius: '28px',
      duration: 0.15,
      ease: 'power3.out'
    }, 0);

    // Phase B: Vertical adjust with overshoot
    openAnim.to(containerDiv, {
      height: `${newHeight * 1.04}px`,
      borderRadius: '20px',
      duration: 0.22,
      ease: 'power3.out'
    });

    // Phase C: Elastic settle
    openAnim.to(containerDiv, {
      height: `${newHeight}px`,
      borderRadius: '12px',
      duration: 0.6,
      ease: 'elastic.out(1.15, 0.42)',
      onComplete: () => {
        containerDiv.style.overflow = 'hidden';
      }
    });

    // Content materialize
    openAnim.to(contentDiv, {
      opacity: 1,
      filter: 'blur(0px)',
      transform: 'scale(1) translateY(0px)',
      duration: 0.35,
      ease: 'power3.out',
      clearProps: 'all'
    }, 0.18);

    // Cascade items
    const formItems = contentDiv.querySelectorAll('form > *');
    if (formItems.length > 0) {
      openAnim.to(formItems, {
        opacity: 1,
        filter: 'blur(0px)',
        transform: 'translateY(0px)',
        duration: 0.28,
        stagger: { each: 0.04, ease: 'power1.in' },
        ease: 'power3.out',
        clearProps: 'all'
      }, 0.24);
    }

    this.saveState();
    this.attachAuthListeners();
  }

  toggleAuth(e: Event) {
    e.preventDefault();
    this.state.isLogin = !this.state.isLogin;
    if (this.state.isLogin) {
      this.clearState();
    }
    this.changeAuthView();
  }

  private attachAuthListeners() {
    const toggleBtn = document.getElementById('toggle-auth');
    toggleBtn?.addEventListener('click', (e) => this.toggleAuth(e));

    const forgotPasswordBtn = document.getElementById('forgot-password');
    forgotPasswordBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      renderPasswordRecovery();
    });

    // Password toggles
    const passwordToggles = document.querySelectorAll('.password-toggle');
    passwordToggles.forEach(btn => {
      const newBtn = btn.cloneNode(true) as HTMLButtonElement;
      btn.parentNode?.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', () => {
        const targetId = newBtn.getAttribute('data-target');
        if (targetId) {
          const input = document.getElementById(targetId) as HTMLInputElement;
          if (input) {
            const lottiePlayer = newBtn.querySelector('.eye-lottie') as any;
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

    // Form submission
    const form = document.getElementById('auth-form') as HTMLFormElement;
    form?.addEventListener('submit', (e) => this.handleFormSubmit(e));
  }

  private async handleFormSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    let keepSubmitButtonLoading = false;
    if (submitBtn) setButtonLoading(submitBtn, true);

    try {
      if (this.state.isLogin) {
        const emailInput = document.getElementById('email') as HTMLInputElement;
        const passwordInput = document.getElementById('password') as HTMLInputElement;
        const rememberInput = document.getElementById('remember') as HTMLInputElement;

        const email = emailInput?.value;
        const password = passwordInput?.value;
        const remember = rememberInput?.checked ?? false;

        const persistenceType = remember ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, persistenceType);

        await signInWithEmailAndPassword(auth, email, password);
        toaster.create({ title: "Bem-vindo!", description: "Acesso autorizado.", type: "success" });
      } else {
        // Signup
        const nameInput = document.getElementById('name') as HTMLInputElement;
        const emailInput = document.getElementById('email') as HTMLInputElement;
        const passwordInput = document.getElementById('password') as HTMLInputElement;
        const termsInput = document.getElementById('terms') as HTMLInputElement;

        if (!termsInput?.checked) throw new Error("Concorde com os termos.");

        const signupData = {
          name: nameInput.value,
          email: emailInput.value,
          password: passwordInput.value
        };

        sessionStorage.setItem('stripeSignupRedirectInProgress', '1');
        sessionStorage.setItem('stripeSignupSetupInProgress', '1');
        sessionStorage.setItem('stripeSignupInlineRedirectInProgress', '1');

        const userCredential = await createUserWithEmailAndPassword(auth, signupData.email, signupData.password);
        await updateProfile(userCredential.user, { displayName: signupData.name });

        const now = new Date().toISOString();
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          id: userCredential.user.uid,
          uid: userCredential.user.uid,
          name: signupData.name,
          email: signupData.email,
          phone: null,
          createdAt: now,
          updatedAt: now,
          isAdmin: false,
          extraSyncCredits: 0,
          profile: {
            id: userCredential.user.uid,
            name: signupData.name,
            email: signupData.email,
            phone: null,
            address: {
              cep: null,
              street: null,
              neighborhood: null,
              city: null,
              state: null,
            }
          },
          subscription: {
            provider: 'stripe',
            plan: 'free',
            status: 'pending',
            billingCycle: 'mensal',
            price: '35,90',
            autoRenew: true,
            cancelAtPeriodEnd: false,
          },
          invoices: [],
        }, { merge: true });



        keepSubmitButtonLoading = true;
        window.dispatchEvent(new CustomEvent('auth-complete', {
          detail: { signupData }
        }));
      }
    } catch (error: any) {
      sessionStorage.removeItem('stripeSignupRedirectInProgress');
      sessionStorage.removeItem('stripeSignupSetupInProgress');
      sessionStorage.removeItem('stripeSignupInlineRedirectInProgress');
      let errorMsg = error.message || "Erro na tentativa de acesso.";
      if (error.code === 'auth/invalid-credential') errorMsg = "Email ou senha incorretos.";
      else if (error.code === 'auth/email-already-in-use') errorMsg = "Email já cadastrado.";
      else if (error.code === 'auth/weak-password') errorMsg = "A senha deve ter pelo menos 6 caracteres.";

      toaster.create({ title: "Atenção", description: errorMsg, type: "error" });
    } finally {
      if (submitBtn && !keepSubmitButtonLoading) setButtonLoading(submitBtn, false);
    }
  }

  render() {
    themeManager.forceDark();
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = `
      <div class="min-h-screen w-full flex flex-col items-center justify-center text-white p-4 relative overflow-x-hidden">
        ${BrilhoHeader()}
        <div class="w-16 h-16 rounded-[22px] bg-[#141414] border border-[#2B2B2B] shadow-2xl flex items-center justify-center absolute top-8 z-10 overflow-hidden">
          <img src="/assets/logo/logocomfundo.png" alt="Logo" class="w-full h-full object-cover transition-transform duration-500 hover:scale-110 filter brightness-[1.15]" style="will-change: transform;">
        </div>

        <div class="w-full flex flex-col justify-center items-center shrink-0 p-4">
          <div id="dynamic-container" class="rounded-[24px] shadow-lg w-full max-w-md overflow-hidden relative" style="background: #181818; border: 1px solid #2B2B2B; will-change: height; transition: height 0.6s cubic-bezier(0.32, 0.72, 0, 1), transform 0.6s cubic-bezier(0.32, 0.72, 0, 1);">
            <div id="dynamic-content" class="p-7 w-full transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]">
              ${this.getAuthHTML()}
            </div>
          </div>
        </div>

        <p class="absolute bottom-8 text-white/20 text-[10px] uppercase tracking-widest pointer-events-none">
          © 2026 Controlar+ — Todos os direitos reservados
        </p>
      </div>
    `;

    this.attachAuthListeners();
  }
}

export const authManager = new AuthManager();
