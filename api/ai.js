import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import admin from 'firebase-admin';

const router = express.Router();

// ─── Dev mode: true = não chama a API do Claude (sem gastar tokens) ────────────
const DEV_MODE = !process.env.ANTHROPIC_API_KEY;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Auth helper ───────────────────────────────────────────────────────────────
async function verifyUser(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    try {
        const token = authHeader.split('Bearer ')[1];
        return await admin.auth().verifyIdToken(token);
    } catch {
        return null;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtBRL(value) {
    const n = Number(value ?? 0);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDateStr(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function monthKeyFromDate(value) {
    const d = typeof value?.toDate === 'function' ? value.toDate() : (value instanceof Date ? value : new Date(String(value)));
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Busca dados financeiros do usuário no Firestore ──────────────────────────
async function getUserFinancialContext(uid, monthKey) {
    const db = admin.firestore();
    const ctx = {};

    // Executa todas as buscas em paralelo para performance
    const [
        txSnap, subSnap, remSnap, savingsSnap, assetsSnap,
        accountsSnap, creditTxSnap, creditBillsSnap,
        categorySnap, billingsSnap, remBillingsSnap, userSnap,
    ] = await Promise.allSettled([
        db.collection(`users/${uid}/transactions`).orderBy('date', 'desc').limit(200).get(),
        db.collection(`users/${uid}/subscriptions`).get(),
        db.collection(`users/${uid}/reminders`).get(),
        db.collection(`users/${uid}/savings`).get(),
        db.collection(`users/${uid}/assets`).get(),
        db.collection(`users/${uid}/accounts`).get(),
        db.collection(`users/${uid}/creditCardTransactions`).orderBy('date', 'desc').limit(100).get(),
        db.collection(`users/${uid}/creditCardBills`).get(),
        db.collection(`users/${uid}/categoryMappings`).get(),
        db.collection(`users/${uid}/billings`).get(),
        db.collection(`users/${uid}/reminder_billings`).get(),
        db.collection('users').doc(uid).get(),
    ]);

    // ── Perfil do usuário ──────────────────────────────────────────────────────
    try {
        const userData = userSnap.value?.data() || {};
        const financial = userData.financial || {};
        const salary = financial.salary || {};
        const salarioBase = Number(salary.base ?? userData.salarioBase ?? userData.salario ?? 0);
        ctx.perfil = {
            nome: userData.displayName || userData.name || null,
            email: userData.email || null,
            salarioBase: salarioBase > 0 ? salarioBase : null,
            diaPagamento: salary.payday ?? userData.diaPagamento ?? null,
            plano: userData.plan || userData.subscription?.plan || 'free',
        };
        console.log(`[AI] salário lido para ${uid}:`, ctx.perfil.salarioBase);
    } catch (e) { console.error('[AI] erro ao ler perfil:', e.message); ctx.perfil = {}; }

    // ── Categorias personalizadas ──────────────────────────────────────────────
    ctx.categorias = {};
    if (categorySnap.status === 'fulfilled') {
        categorySnap.value.docs.forEach(d => {
            const data = d.data();
            ctx.categorias[d.id] = data.customName || data.name || d.id;
        });
    }

    // ── Transações regulares ───────────────────────────────────────────────────
    ctx.transacoes = [];
    if (txSnap.status === 'fulfilled') {
        ctx.transacoes = txSnap.value.docs
            .filter(d => d.data().deleted !== true)
            .map(d => {
                const t = d.data();
                const catKey = t.category || t.categoryId || '';
                return {
                    valor: t.amount,
                    descricao: t.description,
                    categoria: ctx.categorias[catKey] || catKey,
                    data: toDateStr(t.date),
                    tipo: t.type, // 'income' | 'expense'
                };
            });
    }

    // ── Transações de cartão de crédito ───────────────────────────────────────
    ctx.transacoesCartao = [];
    if (creditTxSnap.status === 'fulfilled') {
        ctx.transacoesCartao = creditTxSnap.value.docs
            .filter(d => d.data().deleted !== true)
            .map(d => {
                const t = d.data();
                const catKey = t.category || t.categoryId || '';
                return {
                    valor: t.amount,
                    descricao: t.description,
                    categoria: ctx.categorias[catKey] || catKey,
                    data: toDateStr(t.date),
                    cartao: t.accountId || null,
                };
            });
    }

    // ── Contas bancárias (Pluggy) ──────────────────────────────────────────────
    ctx.contas = [];
    if (accountsSnap.status === 'fulfilled') {
        ctx.contas = accountsSnap.value.docs
            .filter(d => d.data().deleted !== true)
            .map(d => {
                const a = d.data();
                return {
                    id: d.id,
                    nome: a.name,
                    tipo: a.type || a.subtype,
                    saldo: a.balance ?? a.currentBalance ?? 0,
                    instituicao: a.institutionName || a.bankName || null,
                    limite: a.creditData?.creditLimit ?? null,
                    faturamentoAtual: a.creditData?.availableCreditLimit != null
                        ? (a.creditData.creditLimit ?? 0) - (a.creditData.availableCreditLimit ?? 0)
                        : null,
                };
            });
    }

    // ── Faturas de cartão ──────────────────────────────────────────────────────
    ctx.faturas = [];
    if (creditBillsSnap.status === 'fulfilled') {
        ctx.faturas = creditBillsSnap.value.docs
            .filter(d => d.data().deleted !== true)
            .map(d => {
                const b = d.data();
                return {
                    cartaoId: b.accountId || b.creditCardId,
                    mesReferencia: b.monthKey || monthKeyFromDate(b.closingDate),
                    totalFatura: b.totalAmount ?? b.amount ?? 0,
                    dataFechamento: toDateStr(b.closingDate),
                    dataVencimento: toDateStr(b.dueDate),
                    status: b.status || null,
                };
            });
    }

    // ── Assinaturas ───────────────────────────────────────────────────────────
    ctx.assinaturas = [];
    if (subSnap.status === 'fulfilled') {
        ctx.assinaturas = subSnap.value.docs
            .filter(d => d.data().deleted !== true)
            .map(d => {
                const s = d.data();
                return {
                    nome: s.name,
                    valor: s.amount ?? s.value ?? 0,
                    ciclo: s.cycle || s.frequency,
                    categoria: s.category || null,
                    proximoVencimento: toDateStr(s.nextDueDate ?? s.dueDate),
                    ativa: s.active !== false && s.status !== 'inactive',
                };
            });
    }

    // ── Lembretes / contas a pagar ────────────────────────────────────────────
    ctx.lembretes = [];
    if (remSnap.status === 'fulfilled') {
        ctx.lembretes = remSnap.value.docs
            .filter(d => d.data().deleted !== true)
            .map(d => {
                const r = d.data();
                return {
                    id: d.id,
                    titulo: r.title || r.name,
                    valor: r.amount ?? r.value ?? 0,
                    vencimento: toDateStr(r.dueDate),
                    frequencia: r.frequency,
                    tipo: r.type, // 'income' | 'expense'
                    status: r.status,
                };
            });
    }

    // ── Cobranças de lembretes (status mensal) ────────────────────────────────
    ctx.cobrancasLembrete = [];
    if (remBillingsSnap.status === 'fulfilled') {
        ctx.cobrancasLembrete = remBillingsSnap.value.docs.map(d => {
            const b = d.data();
            return {
                lembreteid: b.reminderId,
                mes: b.monthKey,
                pago: b.paid === true || b.status === 'paid',
                valor: b.amount ?? 0,
            };
        });
    }

    // ── Cobranças de assinaturas ──────────────────────────────────────────────
    ctx.cobrancasAssinatura = [];
    if (billingsSnap.status === 'fulfilled') {
        ctx.cobrancasAssinatura = billingsSnap.value.docs.map(d => {
            const b = d.data();
            return {
                assinaturaId: b.subscriptionId,
                mes: b.monthKey,
                pago: b.paid === true || b.status === 'paid',
                valor: b.amount ?? 0,
            };
        });
    }

    // ── Poupanças / Caixinhas ─────────────────────────────────────────────────
    ctx.poupancas = [];
    if (savingsSnap.status === 'fulfilled') {
        ctx.poupancas = savingsSnap.value.docs
            .filter(d => d.data().deleted !== true)
            .map(d => {
                const s = d.data();
                return {
                    nome: s.name,
                    saldoAtual: s.currentBalance ?? s.balance ?? 0,
                    meta: s.target ?? s.goal ?? 0,
                    prazo: toDateStr(s.deadline),
                    progresso: s.target > 0 ? Math.round(((s.currentBalance ?? 0) / s.target) * 100) : null,
                };
            });
    }

    // ── Patrimônio / Bens materiais ───────────────────────────────────────────
    ctx.patrimonio = [];
    if (assetsSnap.status === 'fulfilled') {
        ctx.patrimonio = assetsSnap.value.docs
            .filter(d => d.data().deleted !== true)
            .map(d => {
                const a = d.data();
                return {
                    nome: a.name,
                    tipo: a.type || a.category,
                    valorAtual: a.currentValue ?? a.value ?? 0,
                    valorOriginal: a.originalValue ?? a.purchaseValue ?? null,
                    dataAquisicao: toDateStr(a.purchaseDate ?? a.acquisitionDate),
                };
            });
    }

    // ── Padrões e analytics calculados ───────────────────────────────────────
    ctx.analytics = calcularAnalytics(ctx, monthKey);

    return ctx;
}

// ─── Calcula padrões financeiros a partir dos dados brutos ────────────────────
function calcularAnalytics(ctx, monthKey) {
    const analytics = {};

    // Gastos por categoria (transações regulares)
    const gastosPorCategoria = {};
    for (const tx of ctx.transacoes) {
        if (tx.tipo === 'expense' && tx.categoria) {
            gastosPorCategoria[tx.categoria] = (gastosPorCategoria[tx.categoria] || 0) + Math.abs(tx.valor);
        }
    }
    analytics.gastosPorCategoria = Object.entries(gastosPorCategoria)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([cat, total]) => ({ categoria: cat, total: Number(total.toFixed(2)) }));

    // Totais mensais (últimos 6 meses)
    const totaisMensais = {};
    const allTx = [...ctx.transacoes, ...ctx.transacoesCartao.map(t => ({ ...t, tipo: 'expense' }))];
    for (const tx of allTx) {
        if (!tx.data) continue;
        const mk = tx.data.slice(0, 7); // YYYY-MM
        if (!totaisMensais[mk]) totaisMensais[mk] = { receitas: 0, despesas: 0 };
        if (tx.tipo === 'income') totaisMensais[mk].receitas += Math.abs(tx.valor);
        else totaisMensais[mk].despesas += Math.abs(tx.valor);
    }
    analytics.totaisMensais = Object.entries(totaisMensais)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 6)
        .map(([mes, v]) => ({
            mes,
            receitas: Number(v.receitas.toFixed(2)),
            despesas: Number(v.despesas.toFixed(2)),
            saldo: Number((v.receitas - v.despesas).toFixed(2)),
        }));

    // Média mensal de gastos (últimos 3 meses)
    const ultimos3 = analytics.totaisMensais.slice(0, 3);
    analytics.mediaMensalDespesas = ultimos3.length
        ? Number((ultimos3.reduce((s, m) => s + m.despesas, 0) / ultimos3.length).toFixed(2))
        : null;
    analytics.mediaMensalReceitas = ultimos3.length
        ? Number((ultimos3.reduce((s, m) => s + m.receitas, 0) / ultimos3.length).toFixed(2))
        : null;

    // Patrimônio líquido estimado
    const totalPoupancas = ctx.poupancas.reduce((s, p) => s + p.saldoAtual, 0);
    const totalPatrimonio = ctx.patrimonio.reduce((s, a) => s + a.valorAtual, 0);
    const totalContasPositivas = ctx.contas
        .filter(c => !['CREDIT', 'CREDIT_CARD', 'LOAN'].includes((c.tipo || '').toUpperCase()))
        .reduce((s, c) => s + (c.saldo || 0), 0);
    const totalFaturas = ctx.faturas
        .filter(f => !f.status || f.status === 'open' || f.status === 'pending')
        .reduce((s, f) => s + f.totalFatura, 0);
    analytics.patrimonioLiquido = Number((totalPoupancas + totalPatrimonio + totalContasPositivas - totalFaturas).toFixed(2));

    // Total mensal de assinaturas ativas
    analytics.totalAssinaturasMensal = ctx.assinaturas
        .filter(s => s.ativa)
        .reduce((sum, s) => {
            const v = s.valor || 0;
            if (s.ciclo === 'yearly' || s.ciclo === 'anual') return sum + v / 12;
            return sum + v;
        }, 0);
    analytics.totalAssinaturasMensal = Number(analytics.totalAssinaturasMensal.toFixed(2));

    // Dados do mês atual (se monthKey fornecido)
    if (monthKey) {
        const txMes = ctx.transacoes.filter(t => t.data?.startsWith(monthKey));
        analytics.mesAtual = {
            mes: monthKey,
            receitas: Number(txMes.filter(t => t.tipo === 'income').reduce((s, t) => s + Math.abs(t.valor), 0).toFixed(2)),
            despesas: Number(txMes.filter(t => t.tipo === 'expense').reduce((s, t) => s + Math.abs(t.valor), 0).toFixed(2)),
            quantidadeTransacoes: txMes.length,
        };
        analytics.mesAtual.saldo = Number((analytics.mesAtual.receitas - analytics.mesAtual.despesas).toFixed(2));

        // Lembretes pendentes no mês
        const cobrancasLembreteMes = ctx.cobrancasLembrete.filter(c => c.mes === monthKey);
        analytics.mesAtual.lembretesPendentes = ctx.lembretes.filter(l => {
            const cobranca = cobrancasLembreteMes.find(c => c.lembreteid === l.id);
            return !cobranca?.pago;
        }).map(l => ({ titulo: l.titulo, valor: l.valor, tipo: l.tipo }));
    }

    return analytics;
}

// ─── POST /api/ai/automation ──────────────────────────────────────────────────
router.post('/automation', async (req, res) => {
    const decoded = await verifyUser(req);
    if (!decoded) return res.status(401).json({ error: 'Não autorizado.' });

    const { prompt, history = [], monthKey = null } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt vazio.' });

    // Streaming SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Avisa o front end que estamos buscando informações para ele brilhar ✨
    res.write(`data: ${JSON.stringify({ thinking: 'Buscando transações, faturas e assinaturas...' })}\n\n`);

    let ctx;
    try {
        ctx = await getUserFinancialContext(decoded.uid, monthKey);
    } catch (err) {
        console.error('[AI] Erro ao buscar contexto financeiro:', err);
        res.write(`data: ${JSON.stringify({ error: 'Erro ao carregar dados financeiros.' })}\n\n`);
        return res.end();
    }

    const a = ctx.analytics;
    const p = ctx.perfil;

    // ── Monta seções do system prompt ─────────────────────────────────────────
    const perfilSection = [
        p.nome ? `- Nome: ${p.nome}` : null,
        p.salarioBase ? `- Salário base: R$ ${fmtBRL(p.salarioBase)}${p.diaPagamento ? ` (dia de pagamento: ${p.diaPagamento})` : ''}` : `- Salário base: não configurado`,
        p.plano ? `- Plano: ${p.plano}` : null,
    ].filter(Boolean).join('\n');

    const analyticsSection = [
        a.mediaMensalDespesas != null ? `- Média de gastos (últimos 3 meses): R$ ${fmtBRL(a.mediaMensalDespesas)}` : null,
        a.mediaMensalReceitas != null ? `- Média de receitas (últimos 3 meses): R$ ${fmtBRL(a.mediaMensalReceitas)}` : null,
        a.totalAssinaturasMensal ? `- Total em assinaturas/mês: R$ ${fmtBRL(a.totalAssinaturasMensal)}` : null,
        a.patrimonioLiquido != null ? `- Patrimônio líquido estimado: R$ ${fmtBRL(a.patrimonioLiquido)}` : null,
    ].filter(Boolean).join('\n');

    const mesAtualSection = a.mesAtual ? `
Mês atual (${a.mesAtual.mes}):
- Receitas: R$ ${fmtBRL(a.mesAtual.receitas)}
- Despesas: R$ ${fmtBRL(a.mesAtual.despesas)}
- Saldo: R$ ${fmtBRL(a.mesAtual.saldo)}
- Transações: ${a.mesAtual.quantidadeTransacoes}
${a.mesAtual.lembretesPendentes?.length ? `- Lembretes pendentes: ${a.mesAtual.lembretesPendentes.map(l => `${l.titulo} (R$ ${fmtBRL(l.valor)})`).join(', ')}` : ''}`.trim() : '';

    const topCategoriasSection = a.gastosPorCategoria?.length
        ? `Top categorias de gasto:\n${a.gastosPorCategoria.map(c => `  - ${c.categoria}: R$ ${fmtBRL(c.total)}`).join('\n')}`
        : '';

    const totaisMensaisSection = a.totaisMensais?.length
        ? `Histórico mensal (últimos meses):\n${a.totaisMensais.map(m => `  - ${m.mes}: receitas R$ ${fmtBRL(m.receitas)}, despesas R$ ${fmtBRL(m.despesas)}, saldo R$ ${fmtBRL(m.saldo)}`).join('\n')}`
        : '';

    const contasSection = ctx.contas.length
        ? `Contas bancárias:\n${ctx.contas.map(c => `  - ${c.nome} (${c.tipo ?? '?'}): saldo R$ ${fmtBRL(c.saldo)}${c.limite ? `, limite R$ ${fmtBRL(c.limite)}` : ''}${c.instituicao ? ` — ${c.instituicao}` : ''}`).join('\n')}`
        : '';

    const faturasSection = ctx.faturas.length
        ? `Faturas de cartão:\n${ctx.faturas.map(f => `  - Cartão ${f.cartaoId ?? '?'} (${f.mesReferencia ?? '?'}): R$ ${fmtBRL(f.totalFatura)}, vencimento ${f.dataVencimento ?? '-'}, status: ${f.status ?? '-'}`).join('\n')}`
        : '';

    const transacoesCartaoSection = ctx.transacoesCartao.length
        ? `Transações de cartão (últimas):\n${ctx.transacoesCartao.slice(0, 50).map(t => `  - [${t.data}] ${t.descricao}: R$ ${fmtBRL(t.valor)}`).join('\n')}`
        : '';

    const assinaturasSection = ctx.assinaturas.filter(s => s.ativa).length
        ? `Assinaturas ativas:\n${ctx.assinaturas.filter(s => s.ativa).map(s => `  - ${s.nome}: R$ ${fmtBRL(s.valor)}/${s.ciclo ?? 'mensal'}${s.proximoVencimento ? `, próximo venc. ${s.proximoVencimento}` : ''}`).join('\n')}`
        : '';

    const lembretesSection = ctx.lembretes.length
        ? `Lembretes/contas a pagar:\n${ctx.lembretes.map(l => `  - [${l.tipo ?? '?'}] ${l.titulo}: R$ ${fmtBRL(l.valor)}, freq. ${l.frequencia ?? '-'}, venc. ${l.vencimento ?? '-'}`).join('\n')}`
        : '';

    const poupancasSection = ctx.poupancas.length
        ? `Poupanças e caixinhas:\n${ctx.poupancas.map(p => `  - ${p.nome}: R$ ${fmtBRL(p.saldoAtual)}${p.meta > 0 ? ` / meta R$ ${fmtBRL(p.meta)} (${p.progresso ?? 0}%)` : ''}${p.prazo ? `, prazo ${p.prazo}` : ''}`).join('\n')}`
        : '';

    const patrimonioSection = ctx.patrimonio.length
        ? `Patrimônio/bens materiais:\n${ctx.patrimonio.map(a => `  - ${a.nome} (${a.tipo ?? '?'}): valor atual R$ ${fmtBRL(a.valorAtual)}${a.valorOriginal ? `, orig. R$ ${fmtBRL(a.valorOriginal)}` : ''}`).join('\n')}`
        : '';

    const systemPrompt = `Você é o Coin, assistente financeiro pessoal integrado ao app Controlar+. Você é direto, inteligente e age como um consultor financeiro de confiança — não como um chatbot genérico.

Você tem acesso COMPLETO aos dados financeiros reais do usuário. Use-os sempre. Nunca peça informações que já estão disponíveis.

━━━ DADOS DO USUÁRIO ━━━
${perfilSection || '(perfil não configurado)'}
${analyticsSection ? `\n${analyticsSection}` : ''}
${mesAtualSection ? `\n${mesAtualSection}` : ''}
${topCategoriasSection ? `\n${topCategoriasSection}` : ''}
${totaisMensaisSection ? `\n${totaisMensaisSection}` : ''}
${contasSection ? `\n${contasSection}` : ''}
${faturasSection ? `\n${faturasSection}` : ''}
${transacoesCartaoSection ? `\n${transacoesCartaoSection}` : ''}
${assinaturasSection ? `\n${assinaturasSection}` : ''}
${lembretesSection ? `\n${lembretesSection}` : ''}
${poupancasSection ? `\n${poupancasSection}` : ''}
${patrimonioSection ? `\n${patrimonioSection}` : ''}

━━━ COMO RESPONDER ━━━
- Português brasileiro, direto ao ponto, personalizado com os dados reais
- Use markdown (negrito, listas, tabelas) para organizar
- Seja específico: cite valores reais, nomes reais, datas reais dos dados acima
- Identifique padrões, anomalias e oportunidades nos dados
- Dê recomendações práticas e acionáveis, não genéricas
- Respostas curtas quando possível — o usuário quer ação, não dissertação
- **MUITO IMPORTANTE:** Identifique sozinho as assinaturas e serviços recorrentes no cartão de crédito do usuário analisando as transações de cartão e, se ainda não estiverem ativas nas "Assinaturas ativas", pergunte proativamente ao usuário se ele deseja adicionar (sugira a criação dessa assinatura proativamente com o modo COIN_ACTION correspondente).
- NUNCA diga que criou, salvei ou editou dados — você não tem essa capacidade. Use COIN_ACTION para isso.

━━━ CARDS INTERATIVOS (COIN_RENDER) ━━━
Após sua resposta de texto, você PODE incluir um ou mais blocos COIN_RENDER para mostrar cards interativos do app ao usuário. Esses cards têm botões de ação reais (pagar, editar, excluir, etc).

Tipos disponíveis:
- <!--COIN_RENDER:{"type":"subscriptions"}--> → lista assinaturas do mês com status de pagamento
- <!--COIN_RENDER:{"type":"reminders"}--> → lista lembretes/contas a pagar do mês
- <!--COIN_RENDER:{"type":"transactions"}--> → últimas transações do mês
- <!--COIN_RENDER:{"type":"savings"}--> → caixinhas e metas de poupança
- <!--COIN_RENDER:{"type":"assets"}--> → patrimônio e bens materiais
- <!--COIN_RENDER:{"type":"totalization"}--> → resumo total de patrimônio

Quando usar COIN_RENDER:
✓ Quando o usuário pedir para VER, LISTAR ou VERIFICAR dados
✓ Após análise, para mostrar os itens mencionados na análise
✓ Quando sugerir ação em um item específico (ex: "veja suas assinaturas abaixo")
✗ Não use se o usuário apenas fez uma pergunta simples sem querer ver lista

━━━ CRIAR DADOS (COIN_ACTION) ━━━
Quando sugerir criar algo, inclua ao FINAL da resposta (última linha, sem texto depois):

Lembrete: <!--COIN_ACTION:{"action":"create-reminder","name":"<título>","type":"<expense|income>","value":"<número>","frequency":"<monthly|weekly|yearly|once>","categoryKeyword":"<palavra em pt-BR>"}-->

Assinatura: <!--COIN_ACTION:{"action":"create-subscription","name":"<nome>","value":"<número>","frequency":"<monthly|yearly>","categoryKeyword":"<palavra em pt-BR>"}-->

Caixinha: <!--COIN_ACTION:{"action":"create-savings","name":"<nome>","target":"<número>","deadline":"<YYYY-MM-DD ou null>"}-->

Regras COIN_ACTION:
- Use valores reais dos dados (ex: "89.90" não "89,90")
- Um único COIN_ACTION por resposta
- Blocos são invisíveis ao usuário — não mencione
- Diga ao usuário que "o formulário será aberto para confirmar"`;


    // ── Mock em dev mode ────────────────────────────────────────────────────────
    if (DEV_MODE) {
        const mockResponse = `**[DEV MODE]** Resposta simulada — nenhum token foi gasto.\n\nVocê enviou: *${prompt}*\n\nEsta é uma resposta de teste com **markdown**:\n- Item 1\n- Item 2\n- Item 3\n\n\`\`\`\ncódigo de exemplo\n\`\`\``;
        const words = mockResponse.split(' ');
        for (const word of words) {
            res.write(`data: ${JSON.stringify({ text: word + ' ' })}\n\n`);
            await new Promise(r => setTimeout(r, 30));
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
    }

    try {
        const stream = client.messages.stream({
            model: 'claude-sonnet-4-5',
            max_tokens: 4096,
            system: systemPrompt,
            messages: [
                ...history.map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: prompt },
            ],
        });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
            }
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        console.error('[AI] Erro ao chamar Claude:', err.message);
        res.write(`data: ${JSON.stringify({ error: 'Erro ao processar sua solicitação.' })}\n\n`);
        res.end();
    }
});

export default router;
