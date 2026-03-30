import axios from 'axios';

/**
 * Envia um evento de venda para o Utmify.
 * @param {Object} data - Dados da venda
 * @param {string} data.orderId - ID do pedido/transação
 * @param {string} data.email - Email do cliente
 * @param {string} data.name - Nome do cliente
 * @param {string} [data.phone] - Telefone do cliente
 * @param {string} [data.document] - CPF/CNPJ do cliente
 * @param {number} data.value - Valor da venda (ex: 35.90)
 * @param {string} [data.status] - Status da venda (padrão: 'APPROVED')
 * @param {string} [data.productName] - Nome do produto (padrão: 'Plano Pro')
 * @param {string} [data.productId] - ID do produto (padrão: 'pro_plan')
 * @param {string} [data.ip] - IP do cliente
 */
export async function sendUtmifySale(data) {
    const token = process.env.UTMIFY_API_TOKEN;
    const pixelId = process.env.UTMIFY_PIXEL_ID;

    if (!token) {
        console.warn('[Utmify] Token não configurado. Pulando postback.');
        return;
    }

    try {
        const payload = {
            orderId: data.orderId,
            status: data.status || 'APPROVED',
            name: data.name,
            email: data.email,
            phone: data.phone || null,
            document: data.document || null,
            ip: data.ip || null,
            value: data.value,
            currency: 'BRL',
            products: [
                {
                    id: data.productId || 'pro_plan',
                    name: data.productName || 'Plano Pro - Controlar+',
                    priceInCents: Math.round(data.value * 100)
                }
            ],
            // Se houver UTMs enviadas no data, usa elas, caso contrário o Utmify tenta parear por email/ip
            utm_source: data.utm_source || null,
            utm_medium: data.utm_medium || null,
            utm_campaign: data.utm_campaign || null,
            utm_content: data.utm_content || null,
            utm_term: data.utm_term || null,
            pixel_id: pixelId
        };

        const response = await axios.post('https://api.utmify.com.br/api/webhook/sales', payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`[Utmify] Postback enviado para ${data.email} | Order: ${data.orderId} | Response:`, response.status);
    } catch (error) {
        console.error('[Utmify] Erro ao enviar postback:', error.response?.data || error.message);
    }
}
