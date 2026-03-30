import 'dotenv/config';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Controlar+ <onboarding@resend.dev>';

export async function sendEmail({ to, subject, html, text }) {
    if (!RESEND_API_KEY) {
        console.warn('⚠️  [EMAILS] RESEND_API_KEY não configurado no servidor. O e-mail não será enviado.');
        return null; // Retornar null para que o chamador saiba que não enviou
    }
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: EMAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html, text }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend error ${res.status}: ${body}`);
    }
    const data = await res.json();
    console.log(`✅ E-mail enviado via Resend! ID: ${data.id}`);
    return data;
}

export async function sendWelcomeEmail({ email, name }) {
    if (!email) throw new Error('Email obrigatório.');

    const firstName = (name || 'usuário').split(' ')[0];

    const mailOptions = {
        to: email,
        subject: `Bem-vindo à Controlar+, ${firstName}!`,
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="pt-br">
  <head>
    <meta content="width=device-width" name="viewport" />
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta content="IE=edge" http-equiv="X-UA-Compatible" />
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
  </head>
  <body>
    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
      <tbody>
        <tr>
          <td>
            <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tbody>
                <tr>
                  <td>
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                      <tbody>
                        <tr>
                          <td>
                            <div style="margin:0 auto;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;text-align:center">

                              <!-- Ícone -->
                              <div style="margin-bottom:24px">
                                <div style="margin:0 auto;width:56px;height:56px;background-color:#F5F5F5;border-radius:16px;display:inline-block;line-height:56px;text-align:center">
                                  <span style="font-size:24px">🎉</span>
                                </div>
                              </div>

                              <!-- Título -->
                              <h1 style="margin:0 0 12px;color:#000000;font-size:24px;font-weight:600">
                                Bem-vindo à Controlar+, ${firstName}!
                              </h1>

                              <!-- Descrição -->
                              <p style="margin:0 0 32px;color:#1F2937;font-size:14px;line-height:1.5">
                                Estamos muito felizes em ter você aqui. Sua jornada para um controle financeiro de verdade começa agora.
                              </p>

                              <!-- Guilherme card -->
                              <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;background-color:#F5F5F5;border-radius:12px;overflow:hidden">
                                <tbody>
                                  <tr>
                                    <!-- Foto retangular preenchendo toda a altura -->
                                    <td width="110" style="padding:0;line-height:0;font-size:0" valign="top">
                                      <img
                                        src="https://firebasestorage.googleapis.com/v0/b/financeiro-609e1.firebasestorage.app/o/Icones%2FGuilherme.jpeg?alt=media&token=cccdea8f-a042-4570-88ca-c2f8bce8425d"
                                        alt="Guilherme Rocha Luz"
                                        width="110"
                                        height="120"
                                        style="display:block;width:110px;height:120px;object-fit:cover;object-position:center top;border-radius:12px 0 0 12px"
                                      />
                                    </td>
                                    <!-- Nome + mensagem -->
                                    <td valign="middle" style="padding:12px 20px;text-align:left">
                                      <p style="margin:0 0 1px;font-size:15px;font-weight:700;color:#000000">Guilherme Rocha Luz</p>
                                      <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#D97757;text-transform:uppercase;letter-spacing:0.08em">CEO da Controlar+</p>
                                      <p style="margin:0;font-size:13px;color:#4B5563;line-height:1.4">
                                        Criei a Controlar+ para que qualquer pessoa possa entender e controlar seu dinheiro de verdade. Fico muito feliz que você está dando esse passo. Conto com você!
                                      </p>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>

                              <!-- Funcionalidades -->
                              <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#000000;text-align:left">O que você pode fazer na Controlar+</p>

                              <!-- Feature 1 -->
                              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#000000;text-align:left">Dashboard financeiro completo</p>
                              <p style="margin:0 0 14px;font-size:12px;color:#6B7280;line-height:1.5;text-align:left">Veja receitas, despesas e saldo em tempo real em um único painel.</p>
                              <!-- Feature 2 -->
                              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#000000;text-align:left">Gestão de cartões de crédito</p>
                              <p style="margin:0 0 14px;font-size:12px;color:#6B7280;line-height:1.5;text-align:left">Acompanhe faturas, gastos e limites de todos os seus cartões em um só lugar.</p>
                              <!-- Feature 3 -->
                              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#000000;text-align:left">Categorias inteligentes</p>
                              <p style="margin:0 0 14px;font-size:12px;color:#6B7280;line-height:1.5;text-align:left">Organize seus gastos e descubra para onde vai seu dinheiro todo mês.</p>
                              <!-- Feature 4 -->
                              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#000000;text-align:left">Lembretes de contas</p>
                              <p style="margin:0 0 14px;font-size:12px;color:#6B7280;line-height:1.5;text-align:left">Nunca mais esqueça uma conta. Receba alertas antes do vencimento.</p>
                              <!-- Feature 5 -->
                              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#000000;text-align:left">Conexão com seu banco</p>
                              <p style="margin:0 0 32px;font-size:12px;color:#6B7280;line-height:1.5;text-align:left">Sincronize transações automaticamente com mais de 200 instituições financeiras.</p>
                              <!-- Rodapé -->
                              <p style="margin:24px 0 0;color:#9CA3AF;font-size:11px">
                                E-mail automático — Controlar+
                              </p>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`,
        text: `Olá ${firstName}, bem-vindo à Controlar+! Acesse sua conta em controlarmais.com.br`
    };

    return sendEmail(mailOptions);
}

export async function sendOtpEmail({ email, otp, type }) {
    if (!email || !otp) throw new Error('Email e OTP são obrigatórios.');

    const isPasswordChange = type === 'change-password';
    const is2FASetup = type === '2fa-setup';
    const subject = isPasswordChange
        ? 'Código para Alterar Senha'
        : is2FASetup
            ? 'Código para Ativar Autenticação em Dois Fatores'
            : 'Seu Código de Verificação';
    const description = isPasswordChange
        ? 'Você solicitou a alteração de sua senha. Use o código abaixo para validar sua identidade:'
        : is2FASetup
            ? 'Você solicitou a ativação da autenticação em dois fatores. Use o código abaixo para confirmar:'
            : 'Use o código abaixo para concluir sua verificação:';

    const mailOptions = {
        to: email,
        subject,
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="pt-br">
  <head>
    <meta content="width=device-width" name="viewport" />
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta content="IE=edge" http-equiv="X-UA-Compatible" />
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
  </head>
  <body>
    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
      <tbody>
        <tr>
          <td>
            <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tbody>
                <tr>
                  <td>
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                      <tbody>
                        <tr>
                          <td>
                            <div style="margin:0 auto;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;text-align:center">

                              <!-- Ícone -->
                              <div style="margin-bottom:24px">
                                <div style="margin:0 auto;width:56px;height:56px;background-color:#F5F5F5;border-radius:16px;display:inline-block;line-height:56px;text-align:center">
                                  <span style="font-size:24px">🔐</span>
                                </div>
                              </div>

                              <!-- Título -->
                              <h1 style="margin:0 0 12px;color:#000000;font-size:24px;font-weight:600">
                                ${subject}
                              </h1>

                              <!-- Descrição -->
                              <p style="margin:0 0 28px;color:#1F2937;font-size:14px;line-height:1.5">
                                ${description}
                              </p>

                              <!-- Código OTP -->
                              <div style="display:inline-block;background-color:#F5F5F5;border-radius:12px;padding:20px 40px;margin-bottom:28px">
                                <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#000000">${otp}</span>
                              </div>

                              <!-- Validade -->
                              <p style="margin:0 0 8px;color:#6B7280;font-size:13px">
                                Este código expira em <strong style="color:#000000">10 minutos</strong>.
                              </p>
                              <p style="margin:0;color:#9CA3AF;font-size:12px">
                                Se você não solicitou esta ação, ignore este e-mail.
                              </p>

                              <!-- Rodapé -->
                              <p style="margin:40px 0 0;color:#9CA3AF;font-size:11px">
                                E-mail automático — Controlar+
                              </p>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`,
        text: `Seu código de verificação é: ${otp}`
    };

    return sendEmail(mailOptions);
}

export async function sendPasswordResetEmail({ email, otp }) {
    if (!email || !otp) throw new Error('Email e OTP são obrigatórios.');

    const mailOptions = {
        to: email,
        subject: 'Código para Recuperar Senha',
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="pt-br">
  <head>
    <meta content="width=device-width" name="viewport" />
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta content="IE=edge" http-equiv="X-UA-Compatible" />
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
  </head>
  <body>
    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
      <tbody>
        <tr>
          <td>
            <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tbody>
                <tr>
                  <td>
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                      <tbody>
                        <tr>
                          <td>
                            <div style="margin:0 auto;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;text-align:center">

                              <!-- Ícone -->
                              <div style="margin-bottom:24px">
                                <div style="margin:0 auto;width:56px;height:56px;background-color:#F5F5F5;border-radius:16px;display:inline-block;line-height:56px;text-align:center">
                                  <span style="font-size:24px">🔑</span>
                                </div>
                              </div>

                              <!-- Título -->
                              <h1 style="margin:0 0 12px;color:#000000;font-size:24px;font-weight:600">
                                Recuperação de Senha
                              </h1>

                              <!-- Descrição -->
                              <p style="margin:0 0 28px;color:#1F2937;font-size:14px;line-height:1.5">
                                Você solicitou a recuperação de sua senha. Use o código abaixo para validar sua identidade e criar uma nova senha:
                              </p>

                              <!-- Código OTP -->
                              <div style="display:inline-block;background-color:#F5F5F5;border-radius:12px;padding:20px 40px;margin-bottom:28px">
                                <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#000000">${otp}</span>
                              </div>

                              <!-- Validade -->
                              <p style="margin:0 0 8px;color:#6B7280;font-size:13px">
                                Este código expira em <strong style="color:#000000">10 minutos</strong>.
                              </p>
                              <p style="margin:0;color:#9CA3AF;font-size:12px">
                                Se você não solicitou esta ação, ignore este e-mail.
                              </p>

                              <!-- Rodapé -->
                              <p style="margin:40px 0 0;color:#9CA3AF;font-size:11px">
                                E-mail automático — Controlar+
                              </p>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`,
        text: `Seu código de recuperação é: ${otp}`
    };

    return sendEmail(mailOptions);
}

export async function sendAbandonedCartEmail({ uid, email, name, day = 1, couponCode, checkoutUrl, expiresAt }) {
    const defaultCheckoutUrl = 'https://www.controlarmais.com.br/'; 
    let finalCheckoutUrl = checkoutUrl || defaultCheckoutUrl;
    
    // Rastreamento de cliques (encaminha para o Checkout real)
    if (uid) {
        finalCheckoutUrl = `https://www.controlarmais.com.br/api/rkt/c/${uid}/${day}?url=${encodeURIComponent(finalCheckoutUrl)}`;
    }

    const finalCoupon = couponCode || 'RECOMECO10';
    if (!email) throw new Error('Email obrigatório.');

    const firstName = (name || 'usuário').split(' ')[0];
    let subject = '';
    let bodyText = '';
    let mainHeadline = '';
    let descriptionText = '';
    let buttonText = 'Concluir Assinatura Agora';
    let extraOffer = '';
    let icon = 'https://img.icons8.com/fluency/96/line-chart.png';

    if (day === 1) {
        subject = `Poxa, sentimos sua falta na Controlar+, ${firstName}!`;
        mainHeadline = `Sua trilha para o controle financeiro parou, ${firstName}?`;
        descriptionText = `Vimos que você iniciou o processo de assinatura, mas o pagamento ainda não foi concluído. Entender para onde vai seu dinheiro é o primeiro passo para a sua liberdade. Não deixe para depois!`;
        extraOffer = `Sabemos que recomeçar exige foco, por isso estamos aqui para te ajudar. Complete sua assinatura e comece hoje mesmo a transformar sua relação com o dinheiro.`;
        bodyText = `Olá ${firstName}, vimos que você não concluiu sua assinatura. Recupere seu acesso em ${finalCheckoutUrl}`;
        icon = 'https://img.icons8.com/fluency/96/line-chart.png';
    } else if (day === 2) {
        subject = `Presente: Seu primeiro mês de Controlar+ por R$ 9,90!`;
        icon = 'https://img.icons8.com/fluency/96/gift.png';
        mainHeadline = `Uma oferta imperdível para você recomeçar, ${firstName}!`;
        descriptionText = `Não queremos que o preço seja um obstáculo para você dominar suas finanças. Por isso, preparamos uma oferta exclusiva para você: seu primeiro mês por apenas **R$ 9,90**.`;
        extraOffer = `Use o cupom <strong>${finalCoupon}</strong> no checkout para ativar seu desconto de R$ 9,90.`;
        buttonText = 'Garantir meu desconto de R$ 9,90';
        bodyText = `Olá ${firstName}, garanta seu primeiro mês por apenas R$ 9,90 com o cupom ${finalCoupon} em ${finalCheckoutUrl}`;
    } else {
        subject = `Última Chance: O seu desconto expira hoje!`;
        icon = 'https://img.icons8.com/fluency/96/alarm-clock.png';
        mainHeadline = `É agora ou nunca, ${firstName}!`;
        descriptionText = `Suas finanças merecem esse cuidado. Hoje é o último dia para utilizar o desconto especial e começar sua jornada de controle real por apenas R$ 9,90 no primeiro mês.`;
        extraOffer = `Não perca a chance! Use o cupom <strong>${finalCoupon}</strong> antes que ele expire.`;
        buttonText = 'Última Chance: Assinar por R$ 9,90';
        bodyText = `Olá ${firstName}, é sua última chance de garantir o desconto de R$ 9,90 na Controlar+. Acesse ${finalCheckoutUrl} e use o cupom ${finalCoupon}`;
    }

    let expirationNotice = '';
    if (expiresAt) {
        const expDate = new Date(expiresAt * 1000);
        const dateStr = expDate.toLocaleDateString('pt-BR');
        const timeStr = expDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const text = day === 3 
            ? `⚠️ Este cupom será excluído amanhã, dia ${dateStr}, às ${timeStr}.`
            : `⏳ Oferta por tempo limitado! Expira hoje.`;

        expirationNotice = `
            <div style="margin-bottom:32px; text-align:center;">
                <p style="margin:0; color:#6B7280; font-size:12px; letter-spacing:0.025em; display:inline-block;">
                    ${text}
                </p>
            </div>
        `;
    }

    const mailOptions = {
        to: email,
        subject: subject,
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="pt-br">
  <head>
    <meta content="width=device-width" name="viewport" />
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  </head>
  <body>
    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
      <tbody>
        <tr>
          <td>
            <div style="margin:0 auto;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;text-align:center">
              
              ${expirationNotice}

              <div style="margin-bottom:24px">
                <div style="margin:0 auto;width:56px;height:56px;background-color:#F5F5F5;border-radius:16px;display:flex;align-items:center;justify-content:center;line-height:56px;">
                  <img src="${icon}" width="40" height="40" style="display:block; margin: 8px auto;" />
                </div>
              </div>
              <h1 style="margin:0 0 12px;color:#000000;font-size:24px;font-weight:600">
                ${mainHeadline}
              </h1>
              <p style="margin:0 0 32px;color:#1F2937;font-size:14px;line-height:1.5">
                ${descriptionText}
              </p>
              
              <div style="margin-bottom:32px">
                <a href="${finalCheckoutUrl}" style="background-color:#000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
                  ${buttonText}
                </a>
              </div>
 
               <p style="margin:0 0 24px;color:#6B7280;font-size:13px;line-height:1.5">
                ${extraOffer}
              </p>
 
              <p style="margin:40px 0 0;color:#9CA3AF;font-size:11px">
                E-mail automático — Remarketing Controlar+
              </p>

              <!-- Pixel de Rastreamento de Abertura -->
              ${uid ? `<img src="https://www.controlarmais.com.br/api/rkt/o/${uid}/${day}" width="1" height="1" style="display:none;" />` : ''}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`,
        text: bodyText
    };

    return sendEmail(mailOptions);
}
