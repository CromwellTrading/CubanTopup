require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto-js');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.DB_URL, process.env.DB_KEY);
const activeSessions = {};

// --- FUNCIONES AUXILIARES ---
async function ejecutarRecargaAPI(path, data) {
    data.member_code = process.env.RECARGA_MEMBER_ID;
    const bodyString = JSON.stringify(data);
    const signature = crypto.HmacSHA256(bodyString, process.env.RECARGA_API_SECRET).toString(crypto.enc.Hex);
    try {
        const res = await axios.post(`${process.env.RECARGA_ENDPOINT}${path}`, bodyString, {
            headers: { 'Content-Type': 'application/json', 'x-liog-sign': signature }
        });
        return res.data;
    } catch (err) {
        return { ok: false, message: "Error de conexión con el servidor central." };
    }
}

const mainKeyboard = {
    inline_keyboard: [
        [{ text: '💎 Comprar Diamantes MLBB', callback_data: 'shop' }],
        [{ text: '👛 Mi Billetera / Saldo', callback_data: 'wallet' }]
    ]
};

const backButton = (target) => [[{ text: '🔙 Volver', callback_data: target }]];

// --- FLUJO PRINCIPAL ---
bot.onText(/\/start/, async (msg) => {
    const { id, username, first_name } = msg.from;
    await supabase.from('users').upsert({ telegram_id: id, username, first_name });
    bot.sendMessage(id, `⭐ **SISTEMA DE RECARGAS** ⭐\nHola ${first_name}, selecciona una opción:`, { parse_mode: 'Markdown', reply_markup: mainKeyboard });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const [action, p1, p2] = query.data.split(':');

    if (action === 'start_back') {
        bot.editMessageText("⭐ **SISTEMA DE RECARGAS** ⭐", { chat_id: chatId, message_id: query.message.message_id, reply_markup: mainKeyboard });
    }

    // --- SECCIÓN WALLET ---
    if (action === 'wallet') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        bot.editMessageText(`👛 **Tu Billetera**\n\nCUP: $${u.balance_cup}\nSaldo: $${u.balance_saldo}\nUSDT: $${u.balance_usdt}`, {
            chat_id: chatId, message_id: query.message.message_id,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Recargar CUP', callback_data: 'dep_init:cup' }],
                    [{ text: '➕ Recargar Saldo', callback_data: 'dep_init:saldo' }],
                    [{ text: '➕ Recargar USDT', callback_data: 'dep_init:usdt' }],
                    ...backButton('start_back')
                ]
            }
        });
    }

    if (action === 'dep_init') {
        activeSessions[chatId] = { step: 'waiting_amount', currency: p1 };
        bot.sendMessage(chatId, `💰 **¿Cuánto deseas recargar?**\n(Mínimo: 1000 - Máximo: 10000)`, {
            reply_markup: { inline_keyboard: backButton('wallet') }
        });
    }

    // --- SECCIÓN TIENDA ---
    if (action === 'shop') {
        const { data: items } = await supabase.from('products').select('*').eq('is_active', true);
        const buttons = items.map(i => [{ text: `${i.name} - $${i.price_cup} CUP`, callback_data: `buy_select:${i.id}` }]);
        bot.editMessageText("💎 **Selecciona un paquete:**", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [...buttons, ...backButton('start_back')] } });
    }

    if (action === 'buy_select') {
        bot.sendMessage(chatId, `¿Con qué moneda deseas pagar?`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: `CUP`, callback_data: `pay_now:${p1}:cup` }, { text: `Saldo`, callback_data: `pay_now:${p1}:saldo` }],
                    [{ text: `USDT`, callback_data: `pay_now:${p1}:usdt` }],
                    ...backButton('shop')
                ]
            }
        });
    }

    if (action === 'pay_now') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        const { data: p } = await supabase.from('products').select('*').eq('id', p1).single();
        const cost = p[`price_${p2}`];

        if (u[`balance_${p2}`] < cost) return bot.answerCallbackQuery(query.id, { text: "❌ Saldo insuficiente", show_alert: true });

        activeSessions[chatId] = { step: 'ask_player_id', product: p, currency: p2, cost: cost };
        bot.sendMessage(chatId, "🎮 **Ingresa tu ID de Jugador:**", { reply_markup: { inline_keyboard: backButton('shop') } });
    }

    // --- ACCIONES ADMIN ---
    if (action === 'adm_approve') {
        const { data: tx } = await supabase.from('transactions').select('*').eq('id', p1).single();
        const { data: user } = await supabase.from('users').select('*').eq('telegram_id', tx.user_id).single();
        
        const newBalance = (user[`balance_${tx.currency}`] || 0) + tx.amount_requested;
        await supabase.from('users').update({ [`balance_${tx.currency}`]: newBalance }).eq('telegram_id', tx.user_id);
        await supabase.from('transactions').update({ status: 'completed' }).eq('id', p1);
        
        bot.sendMessage(tx.user_id, `✅ **Depósito Aprobado**\nSe han acreditado $${tx.amount_requested} ${tx.currency.toUpperCase()} a tu cuenta.`);
        bot.editMessageCaption(`✅ **APROBADO**\nUsuario: ${user.first_name}\nMonto: $${tx.amount_requested}`, { chat_id: process.env.ADMIN_GROUP, message_id: query.message.message_id });
    }

    if (action === 'adm_reject') {
        activeSessions[chatId] = { step: 'adm_reason', txId: p1, msgId: query.message.message_id };
        bot.sendMessage(chatId, "❌ Escribe el motivo del rechazo:");
    }
});

// --- MENSAJES Y FOTOS ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = activeSessions[chatId];
    if (!session || msg.text?.startsWith('/')) return;

    // 1. Cliente pone el monto
    if (session.step === 'waiting_amount') {
        const amount = parseFloat(msg.text);
        if (isNaN(amount) || amount < 1000 || amount > 10000) {
            return bot.sendMessage(chatId, "⚠️ El monto debe ser un número entre 1000 y 10000.");
        }
        session.amount = amount;
        session.step = 'waiting_proof';
        let instruccion = session.currency === 'cup' ? `💳 Tarjeta: \`${process.env.PAGO_CUP_TARJETA}\`` : 
                          session.currency === 'saldo' ? `📱 Móvil: \`${process.env.PAGO_SALDO_MOVIL}\`` : 
                          `💲 USDT: \`${process.env.PAGO_USDT_ADRESS}\``;
        
        bot.sendMessage(chatId, `Monto a recargar: **$${amount}**\n\n${instruccion}\n\nEnvía la **FOTO** del comprobante ahora:`, { parse_mode: 'Markdown' });
    }

    // 2. Cliente envía la foto
    else if (session.step === 'waiting_proof' && msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileUrl = await bot.getFileLink(fileId);
        const resp = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const filePath = `comprobantes/${chatId}_${Date.now()}.jpg`;
        
        await supabase.storage.from('deposit-proofs').upload(filePath, resp.data);
        const { data: url } = supabase.storage.from('deposit-proofs').getPublicUrl(filePath);

        const { data: tx } = await supabase.from('transactions').insert([{
            user_id: chatId, type: 'DEPOSIT', currency: session.currency, 
            amount_requested: session.amount, proof_url: url.publicUrl
        }]).select().single();

        bot.sendPhoto(process.env.ADMIN_GROUP, fileId, {
            caption: `💰 **NUEVO PAGO**\nUsuario: ${msg.from.first_name}\nMonto solicitado: $${session.amount} ${session.currency.toUpperCase()}`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Aprobar', callback_data: `adm_approve:${tx.id}` }],
                    [{ text: '❌ Rechazar', callback_data: `adm_reject:${tx.id}` }]
                ]
            }
        });
        bot.sendMessage(chatId, "✅ Comprobante enviado. Espera a que el admin lo valide.", { reply_markup: mainKeyboard });
        delete activeSessions[chatId];
    }

    // 3. Admin pone motivo de rechazo
    else if (session.step === 'adm_reason' && chatId == process.env.BOT_ADMIN_ID) {
        const { data: tx } = await supabase.from('transactions').select('*').eq('id', session.txId).single();
        await supabase.from('transactions').update({ status: 'rejected', reject_reason: msg.text }).eq('id', session.txId);
        
        bot.sendMessage(tx.user_id, `❌ **Depósito Rechazado**\nMotivo: ${msg.text}`);
        bot.sendMessage(chatId, "✅ Rechazo procesado.");
        delete activeSessions[chatId];
    }

    // 4. Proceso de Recarga MLBB
    else if (session.step === 'ask_player_id') {
        session.player_tag = msg.text;
        session.step = 'ask_zone_id';
        bot.sendMessage(chatId, "📍 **Ingresa tu Zone ID (Servidor):**");
    } else if (session.step === 'ask_zone_id') {
        const zone = msg.text;
        bot.sendMessage(chatId, "🚀 Procesando...");
        const res = await ejecutarRecargaAPI('/order-create', {
            product_id: session.product.api_prod_id,
            variation_id: session.product.api_var_id,
            user_id: session.player_tag,
            server_id: zone,
            qty: 1,
            partner_ref: `ORD-${Date.now()}`
        });

        if (res.ok) {
            const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            await supabase.from('users').update({ [`balance_${session.currency}`]: u[`balance_${session.currency}`] - session.cost }).eq('telegram_id', chatId);
            bot.sendMessage(chatId, `✅ **ÉXITO!**\nOrden: ${res.data.order_id}`, { reply_markup: mainKeyboard });
        } else {
            bot.sendMessage(chatId, `❌ Error: ${res.message}`, { reply_markup: mainKeyboard });
        }
        delete activeSessions[chatId];
    }
});

http.createServer((q, s) => { s.write("OK"); s.end(); }).listen(process.env.PORT || 3000);
