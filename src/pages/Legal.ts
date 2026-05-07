import { BrilhoHeader } from '../components/BrilhoHeader';
import { themeManager } from '../components/ThemeManager';

const BRILHO_ID = 'legal-brilho-root';
const LEGAL_HREF_ATTR = 'data-legal-preserve-href';

type LegalPageKind = 'privacy' | 'terms';

type LegalSection = {
  title: string;
  body: string;
};

const privacySections: LegalSection[] = [
  {
    title: '1. Dados que coletamos',
    body: 'Coletamos dados fornecidos por você, como nome, e-mail e informações da conta. Também podemos processar dados financeiros cadastrados no app, dados de uso, identificadores do dispositivo e informações técnicas necessárias para segurança e funcionamento.',
  },
  {
    title: '2. Como usamos os dados',
    body: 'Usamos os dados para criar e proteger sua conta, organizar informações financeiras, sincronizar serviços contratados, oferecer suporte, enviar avisos importantes, melhorar o app e cumprir obrigações legais.',
  },
  {
    title: '3. Assinaturas e pagamentos',
    body: 'Em compras feitas no iOS, o pagamento da assinatura é processado pela App Store. O app recebe apenas as informações necessárias para confirmar o status da assinatura, liberar recursos Pro e manter o histórico da conta.',
  },
  {
    title: '4. Compartilhamento',
    body: 'Não vendemos seus dados pessoais. Podemos compartilhar dados somente com provedores necessários para operar o app, como infraestrutura, autenticação, banco de dados, notificações, suporte, integrações autorizadas por você e processamento de assinaturas.',
  },
  {
    title: '5. Retenção e segurança',
    body: 'Mantemos os dados enquanto sua conta estiver ativa ou pelo período necessário para fins legais, operacionais e de segurança. Usamos medidas técnicas e organizacionais para proteger suas informações.',
  },
  {
    title: '6. Seus direitos',
    body: 'Você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados, quando aplicável. Também pode revogar permissões e encerrar integrações autorizadas no app.',
  },
  {
    title: '7. Contato',
    body: 'Para dúvidas sobre privacidade ou exercício de direitos, entre em contato pelo e-mail suporte@controlarmais.com.br.',
  },
];

const termsSections: LegalSection[] = [
  {
    title: '1. Licença do aplicativo',
    body: 'O uso do app Controlar+ distribuído pela App Store segue o Contrato de Licença Padrão da Apple para Aplicativos Licenciados (EULA), salvo se houver um EULA personalizado publicado no App Store Connect.',
  },
  {
    title: '2. Uso do serviço',
    body: 'Você deve usar o app de forma lícita, manter suas credenciais protegidas e fornecer informações corretas. O app oferece ferramentas de organização financeira e não substitui consultoria financeira, contábil, jurídica ou tributária.',
  },
  {
    title: '3. Plano Pro',
    body: 'O Plano Pro é uma assinatura com renovação automática mensal. A cobrança, renovação, cancelamento e reembolso das compras feitas no iOS são gerenciados pela App Store e pelas regras da Apple.',
  },
  {
    title: '4. Renovação e cancelamento',
    body: 'A assinatura renova automaticamente, salvo cancelamento pelo menos 24 horas antes do fim do período atual. Você pode gerenciar ou cancelar a assinatura nos Ajustes do dispositivo, na conta Apple ID, em Assinaturas.',
  },
  {
    title: '5. Disponibilidade',
    body: 'Podemos atualizar, alterar ou descontinuar funcionalidades para melhorar o app, cumprir requisitos técnicos, atender obrigações legais ou proteger usuários e serviços.',
  },
  {
    title: '6. Suporte',
    body: 'Para dúvidas sobre o app, sua conta ou assinatura, entre em contato pelo e-mail suporte@controlarmais.com.br.',
  },
];

const legalPages: Record<LegalPageKind, {
  title: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
}> = {
  privacy: {
    title: 'Política de Privacidade',
    updatedAt: '07/05/2026',
    intro: 'Esta Política de Privacidade explica como o Controlar+ coleta, usa, armazena e protege dados pessoais quando você utiliza o aplicativo e seus serviços.',
    sections: privacySections,
  },
  terms: {
    title: 'Termos de Uso (EULA)',
    updatedAt: '07/05/2026',
    intro: 'Estes termos resumem as condições de uso do Controlar+ e indicam o EULA aplicável para compras feitas pela App Store.',
    sections: termsSections,
  },
};

function mountBrilho() {
  document.getElementById(BRILHO_ID)?.remove();
  const host = document.createElement('div');
  host.id = BRILHO_ID;
  host.innerHTML = BrilhoHeader();
  document.body.appendChild(host);
}

function formatBodyText(text: string): string {
  return text.replace(
    'suporte@controlarmais.com.br',
    '<a href="mailto:suporte@controlarmais.com.br" data-legal-preserve-href="mailto:suporte@controlarmais.com.br">suporte@controlarmais.com.br</a>'
  );
}

function preserveLegalHrefs(root: HTMLElement) {
  const restoreHrefs = () => {
    root.querySelectorAll<HTMLAnchorElement>(`a[${LEGAL_HREF_ATTR}]`).forEach((link) => {
      const preservedHref = link.getAttribute(LEGAL_HREF_ATTR);
      if (preservedHref && link.getAttribute('href') !== preservedHref) {
        link.setAttribute('href', preservedHref);
      }
    });
  };

  restoreHrefs();
  root.addEventListener('click', restoreHrefs, { capture: true });

  const observer = new MutationObserver(restoreHrefs);
  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });

  window.setTimeout(() => observer.disconnect(), 8000);
}

function getLegalStyles(): string {
  return `
    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      html,
      body {
        overflow-x: hidden;
        background: #0C0C0C;
      }

      #legal-page {
        min-height: 100vh;
        width: 100%;
        background:
          radial-gradient(circle at 50% -20%, rgba(217, 119, 87, 0.12), transparent 42%),
          #0C0C0C;
        color: #ffffff;
        position: relative;
        overflow-x: hidden;
      }

      #legal-shell {
        width: min(920px, calc(100% - 40px));
        margin: 0 auto;
        padding: 118px 0 56px;
        position: relative;
        z-index: 1;
      }

      #legal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 54px;
      }

      #legal-logo {
        display: inline-flex;
        align-items: center;
        text-decoration: none;
      }

      #legal-logo img {
        height: 34px;
        width: auto;
        display: block;
      }

      #legal-nav {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .legal-nav-link {
        color: rgba(255, 255, 255, 0.52);
        text-decoration: none;
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        padding: 10px 14px;
        border-radius: 999px;
        transition: color 0.2s ease, background 0.2s ease;
      }

      .legal-nav-link:hover,
      .legal-nav-link[aria-current="page"] {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.06);
      }

      #legal-card {
        background: rgba(17, 17, 17, 0.86);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 20px;
        box-shadow: 0 32px 72px rgba(0, 0, 0, 0.42);
        padding: clamp(28px, 5vw, 56px);
      }

      #legal-eyebrow {
        margin: 0 0 14px;
        color: #D97757;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      #legal-title {
        margin: 0;
        color: #ffffff;
        font-size: clamp(32px, 5.6vw, 56px);
        font-weight: 760;
        line-height: 1.08;
        letter-spacing: 0;
      }

      #legal-updated {
        margin: 14px 0 0;
        color: rgba(255, 255, 255, 0.42);
        font-size: 14px;
        line-height: 1.5;
      }

      #legal-intro {
        margin: 34px 0 0;
        color: rgba(255, 255, 255, 0.72);
        font-size: 17px;
        line-height: 1.75;
        max-width: 760px;
      }

      #legal-content {
        margin-top: 42px;
        display: flex;
        flex-direction: column;
        gap: 30px;
      }

      .legal-section {
        padding-top: 28px;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
      }

      .legal-section h2 {
        margin: 0 0 10px;
        color: #ffffff;
        font-size: 18px;
        font-weight: 680;
        line-height: 1.35;
        letter-spacing: 0;
      }

      .legal-section p,
      #legal-apple-eula p {
        margin: 0;
        color: rgba(255, 255, 255, 0.64);
        font-size: 15px;
        line-height: 1.76;
      }

      .legal-section a,
      #legal-apple-eula a {
        color: #F0A37D;
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      #legal-apple-eula {
        margin-top: 34px;
        padding: 18px 20px;
        border-radius: 14px;
        border: 1px solid rgba(217, 119, 87, 0.22);
        background: rgba(217, 119, 87, 0.08);
      }

      #legal-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-top: 24px;
        color: rgba(255, 255, 255, 0.36);
        font-size: 12px;
      }

      #legal-footer-links {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      #legal-footer a {
        color: rgba(255, 255, 255, 0.52);
        text-decoration: none;
      }

      #legal-footer a:hover {
        color: #ffffff;
      }

      @media (max-width: 640px) {
        #legal-shell {
          width: min(100% - 28px, 920px);
          padding: 88px 0 34px;
        }

        #legal-header {
          align-items: flex-start;
          flex-direction: column;
          margin-bottom: 34px;
        }

        #legal-nav {
          justify-content: flex-start;
        }

        .legal-nav-link {
          padding: 9px 12px;
          font-size: 12px;
        }

        #legal-card {
          border-radius: 16px;
        }

        #legal-intro {
          font-size: 15.5px;
          line-height: 1.7;
        }

        #legal-content {
          gap: 24px;
          margin-top: 34px;
        }

        .legal-section {
          padding-top: 24px;
        }

        #legal-footer {
          align-items: flex-start;
          flex-direction: column;
        }

        #legal-footer-links {
          justify-content: flex-start;
        }
      }
    </style>
  `;
}

function renderSections(sections: LegalSection[]): string {
  return sections.map((section) => `
    <section class="legal-section">
      <h2>${section.title}</h2>
      <p>${formatBodyText(section.body)}</p>
    </section>
  `).join('');
}

function renderAppleEula(kind: LegalPageKind): string {
  if (kind !== 'terms') return '';

  return `
    <div id="legal-apple-eula">
      <p>
        EULA padrão da Apple:
        <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" data-legal-preserve-href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener noreferrer">
          https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
        </a>
      </p>
    </div>
  `;
}

export function getPublicLegalPageFromPath(pathname = window.location.pathname): LegalPageKind | null {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';

  if (normalizedPath === '/privacidade') return 'privacy';
  if (normalizedPath === '/termos-de-uso') return 'terms';

  return null;
}

export function renderLegalPage(kind: LegalPageKind) {
  themeManager.forceDark();
  document.getElementById('landing-brilho-root')?.remove();
  document.getElementById('landing-styles')?.remove();
  mountBrilho();

  const app = document.getElementById('app')!;
  const page = legalPages[kind];
  const currentYear = new Date().getFullYear();

  document.title = `${page.title} | Controlar+`;
  document.documentElement.lang = 'pt-BR';
  document.documentElement.style.overflowX = 'hidden';
  document.documentElement.style.overflowY = 'auto';
  document.body.style.overflowX = 'hidden';
  document.body.style.overflowY = 'visible';
  document.body.style.width = '100%';
  document.body.style.height = 'auto';
  app.style.height = 'auto';
  app.style.overflow = 'visible';
  app.style.width = '100%';

  app.innerHTML = `
    <div id="legal-page">
      ${getLegalStyles()}
      <div id="legal-shell">
        <header id="legal-header">
          <a id="legal-logo" href="/" data-legal-preserve-href="/" aria-label="Controlar+">
            <img src="/assets/logo/logo.png" alt="Controlar+" />
          </a>
          <nav id="legal-nav" aria-label="Páginas legais">
            <a class="legal-nav-link" href="/privacidade" data-legal-preserve-href="/privacidade" ${kind === 'privacy' ? 'aria-current="page"' : ''}>Privacidade</a>
            <a class="legal-nav-link" href="/termos-de-uso" data-legal-preserve-href="/termos-de-uso" ${kind === 'terms' ? 'aria-current="page"' : ''}>Termos de Uso</a>
          </nav>
        </header>

        <main id="legal-card">
          <p id="legal-eyebrow">Controlar+</p>
          <h1 id="legal-title">${page.title}</h1>
          <p id="legal-updated">Última atualização: ${page.updatedAt}</p>
          <p id="legal-intro">${page.intro}</p>

          <div id="legal-content">
            ${renderSections(page.sections)}
          </div>

          ${renderAppleEula(kind)}
        </main>

        <footer id="legal-footer">
          <span>© ${currentYear} Controlar+</span>
          <div id="legal-footer-links">
            <a href="/" data-legal-preserve-href="/">Início</a>
            <a href="/privacidade" data-legal-preserve-href="/privacidade">Política de Privacidade</a>
            <a href="/termos-de-uso" data-legal-preserve-href="/termos-de-uso">Termos de Uso</a>
          </div>
        </footer>
      </div>
    </div>
  `;

  preserveLegalHrefs(app);
}
