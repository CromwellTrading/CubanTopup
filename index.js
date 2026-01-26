require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto-js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bodyParser = require('body-parser');

// --- INICIALIZACIÓN ---
const app = express();
app.use(bodyParser.json());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.DB_URL, process.env.DB_KEY);
const activeSessions = {};

// Constantes de entorno
const MI_TARJETA = process.env.PAGO_CUP_TARJETA || "9227069995328054";
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- SERVIDOR WEBHOOK PARA DEKU SMS ---

app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        const remitente = (data.dirección || data.sender || "").toUpperCase();
        const mensaje = (data.text || data.body || "");

        if (remitente.includes("PAGOxMOVIL") || remitente.includes("PAGO")) {
            console.log(`📩 SMS Procesando: ${mensaje}`);

            const montoMatch = mensaje.match(/(\d+\.?\d*)\s*CUP/);
            const monto = montoMatch ? parseFloat(montoMatch[1]) : 0;
            const idMatch = mensaje.match(/(TMW\d+|KW\w+|T\d+[A-Z]+)/);
            const transId = idMatch ? idMatch[1] : null;
            const telMatch = mensaje.match(/(5\d{7,9})/);
            const telefonoCliente = telMatch ? telMatch[1] : null;

            if (transId && monto > 0) {
                // ESCENARIO: SE DETECTA NÚMERO (Tarjeta-Tarjeta / Monedero-Monedero)
                if (telefonoCliente) {
                    const { data: user } = await supabase.from('users').select('*').eq('phone_number', telefonoCliente).single();
                    if (user) {
                        const nuevoSaldo = (user.balance_cup || 0) + monto;
                        await supabase.from('users').update({ balance_cup: nuevoSaldo }).eq('telegram_id', user.telegram_id);
                        await supabase.from('transactions').insert([{
                            user_id: user.telegram_id, type: 'DEPOSIT_AUTO', currency: 'cup', amount: monto, status: 'completed', tx_id: transId
                        }]);
                        bot.sendMessage(user.telegram_id, `✅ **¡Pago Automático Detectado!**\nRecibidos: $${monto} CUP\nNuevo saldo: $${nuevoSaldo}`);
                    }
                } 
                // ESCENARIO: SIN NÚMERO (Tarjeta-Monedero) -> Guardar para reclamar
                else {
                    await supabase.from('pending_sms_payments').upsert([{ tx_id: transId, amount: monto, raw_message: mensaje, claimed: false }], { onConflict: 'tx_id' });
                }
            }
        }
        res.status(200).send('OK');
    } catch (e) {
        console.error("Error Webhook:", e);
        res.status(500).send('Error');
    }
});

// --- KEEP ALIVE INTERNO ---
app.get('/keepalive', (req, res) => res.send('OK'));
setInterval(() => {
    axios.get(`${RENDER_URL}/keepalive`).catch(() => console.log("Ping fallido, pero sigo intentando..."));
}, 5 * 60 * 1000); // 5 minutos

// --- LÓGICA DE API RECARGAS ---
async function ejecutarRecargaAPI(path, data) {
    data.member_code = process.env.RECARGA_MEMBER_ID;
    const bodyString = JSON.stringify(data);
    const signature = crypto.HmacSHA256(bodyString, process.env.RECARGA_API_SECRET).toString(crypto.enc.Hex);
    try {
        const res = await axios.post(`${process.env.RECARGA_ENDPOINT}${path}`, bodyString, {
            headers: { 'Content-Type': 'application/json', 'x-liog-sign': signature }
        });
        return res.data;
    } catch (err) { return { ok: false, message: "Error de conexión." }; }
}

// --- TECLADOS ---
const mainKeyboard = {
    inline_keyboard: [
        [{ text: '🎮 Comprar Diamantes (MLBB)', callback_data: 'shop' }],
        [{ text: '👛 Mi Billetera / Saldo', callback_data: 'wallet' }],
        [{ text: '🪙 Guía USDT (SafePal)', callback_data: 'usdt_guide' }]
    ]
};
const backBtn = (dest) => [[{ text: '🔙 Volver', callback_data: dest }]];

// --- MANEJO DE COMANDOS ---
bot.onText(/\/start/, async (msg) => {
    const { id, first_name } = msg.from;
    const { data: user } = await supabase.from('users').upsert({ telegram_id: id, first_name, username: msg.from.username }, { onConflict: 'telegram_id' }).select().single();

    if (!user.phone_number) {
        bot.sendMessage(id, `👋 ¡Bienvenido **${first_name}**!\n\nPara usar el bot, primero debes **vincular tu número de teléfono** de Transfermóvil.`, {
            reply_markup: { inline_keyboard: [[{ text: '📲 Vincular Número', callback_data: 'link_phone' }]] }
        });
    } else {
        bot.sendMessage(id, `👋 ¡Hola **${first_name}**! Tu número vinculado es **${user.phone_number}**.`, { reply_markup: mainKeyboard });
    }
});

// --- MANEJO DE CALLBACKS ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const [action, p1, p2] = query.data.split(':');

    if (action === 'start_back') {
        bot.editMessageText("🏠 Menú Principal:", { chat_id: chatId, message_id: query.message.message_id, reply_markup: mainKeyboard });
    }

    if (action === 'link_phone') {
        activeSessions[chatId] = { step: 'waiting_phone' };
        bot.sendMessage(chatId, "📱 Envía tu número de teléfono (8 dígitos, empieza con 5):");
    }

    if (action === 'wallet') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        bot.editMessageText(`👛 **Tu Billetera**\n\n💰 CUP: **$${u.balance_cup}**\n📱 Saldo: **$${u.balance_saldo}**\n\n¿Qué deseas hacer?`, {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Recargar CUP', callback_data: 'recharge_cup' }],
                    [{ text: '🔍 Reclamar por ID', callback_data: 'claim_id' }],
                    ...backBtn('start_back')
                ]
            }
        });
    }

    if (action === 'recharge_cup') {
        bot.editMessageText(`💳 **Recarga CUP**\n\nTransfiere a:\n\`${MI_TARJETA}\`\n\nEl sistema acreditará automáticamente si usas tu número vinculado.`, {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: backBtn('wallet') }
        });
    }

    if (action === 'claim_id') {
        activeSessions[chatId] = { step: 'waiting_id' };
        bot.sendMessage(chatId, "🔍 Envía el ID de transacción (ej: TMW12345678):");
    }

    if (action === 'shop') {
        const { data: items } = await supabase.from('products').select('*').eq('is_active', true);
        const buttons = items.map(i => [{ text: `💎 ${i.name} ($${i.price_cup} CUP)`, callback_data: `buy_select:${i.id}` }]);
        bot.editMessageText("💎 **Paquetes MLBB:**", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [...buttons, ...backBtn('start_back')] } });
    }

    if (action === 'buy_select') {
        bot.sendMessage(chatId, "Pagar con:", {
            reply_markup: {
                inline_keyboard: [[{ text: 'CUP', callback_data: `pay_now:${p1}:cup` }], ...backBtn('shop')]
            }
        });
    }

    if (action === 'pay_now') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        const { data: p } = await supabase.from('products').select('*').eq('id', p1).single();
        const cost = p[`price_${p2}`];
        if (u[`balance_${p2}`] < cost) return bot.answerCallbackQuery(query.id, { text: "❌ Saldo insuficiente", show_alert: true });
        activeSessions[chatId] = { step: 'ask_player_id', product: p, currency: p2, cost: cost };
        bot.sendMessage(chatId, "🎮 ID de Jugador:");
    }
});

// --- LÓGICA DE MENSAJES ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = activeSessions[chatId];
    if (!session || msg.text?.startsWith('/')) return;

    if (session.step === 'waiting_phone') {
        const phone = msg.text.trim();
        if (!/^5\d{7}$/.test(phone)) return bot.sendMessage(chatId, "❌ Formato inválido. Ejemplo: 53591902");
        await supabase.from('users').update({ phone_number: phone }).eq('telegram_id', chatId);
        bot.sendMessage(chatId, "✅ Número vinculado.", { reply_markup: mainKeyboard });
        delete activeSessions[chatId];
    }

    else if (session.step === 'waiting_id') {
        const txId = msg.text.trim().toUpperCase();
        const { data: pago } = await supabase.from('pending_sms_payments').select('*').eq('tx_id', txId).eq('claimed', false).single();
        if (pago) {
            const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            await supabase.from('users').update({ balance_cup: u.balance_cup + pago.amount }).eq('telegram_id', chatId);
            await supabase.from('pending_sms_payments').update({ claimed: true, claimed_by: chatId }).eq('id', pago.id);
            bot.sendMessage(chatId, `✅ $${pago.amount} CUP acreditados.`, { reply_markup: mainKeyboard });
        } else {
            bot.sendMessage(chatId, "❌ ID no encontrado o ya reclamado.");
        }
        delete activeSessions[chatId];
    }

    else if (session.step === 'ask_player_id') {
        session.player_tag = msg.text;
        session.step = 'ask_zone_id';
        bot.sendMessage(chatId, "📍 Zone ID:");
    } 

    else if (session.step === 'ask_zone_id') {
        bot.sendMessage(chatId, "🚀 Procesando...");
        const res = await ejecutarRecargaAPI('/order-create', {
            product_id: session.product.api_prod_id, variation_id: session.product.api_var_id,
            user_id: session.player_tag, server_id: msg.text, qty: 1, partner_ref: `RECARGA-${Date.now()}`
        });
        if (res.ok) {
            const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            await supabase.from('users').update({ [`balance_${session.currency}`]: u[`balance_${session.currency}`] - session.cost }).eq('telegram_id', chatId);
            bot.sendMessage(chatId, `✅ Recarga exitosa! ID: ${res.data.order_id}`, { reply_markup: mainKeyboard });
        } else {
            bot.sendMessage(chatId, `❌ Error: ${res.message}`);
        }
        delete activeSessions[chatId];
    }
});

app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
