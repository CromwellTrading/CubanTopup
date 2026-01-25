require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto-js');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.DB_URL, process.env.DB_KEY);
const activeSessions = {};

// --- Ayudantes de Interfaz ---
const mainKeyboard = {
    inline_keyboard: [
        [{ text: '🎮 Comprar Diamantes (MLBB)', callback_data: 'shop' }],
        [{ text: '👛 Mi Billetera / Saldo', callback_data: 'wallet' }],
        [{ text: '🪙 Guía USDT (SafePal)', callback_data: 'usdt_guide' }]
    ]
};

const backBtn = (dest) => [[{ text: '🔙 Volver', callback_data: dest }]];

// --- Lógica de Firma API ---
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

// --- COMANDO INICIO ---
bot.onText(/\/start/, async (msg) => {
    const { id, first_name } = msg.from;
    await supabase.from('users').upsert({ telegram_id: id, first_name, username: msg.from.username });
    bot.sendMessage(id, `👋 ¡Hola, **${first_name}**!\n\nBienvenido a tu centro de recargas automáticas. Aquí puedes gestionar tus diamantes de MLBB y comprar USDT de forma segura.\n\n¿Qué operación deseas realizar?`, {
        parse_mode: 'Markdown', reply_markup: mainKeyboard
    });
});

// --- MANEJO DE CALLBACKS (BOTONES) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const [action, p1, p2] = query.data.split(':');

    if (action === 'start_back') {
        bot.editMessageText("¿En qué más puedo ayudarte hoy?", { chat_id: chatId, message_id: query.message.message_id, reply_markup: mainKeyboard });
    }

    // --- SECCIÓN: BILLETERA ---
    if (action === 'wallet') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        bot.editMessageText(`👛 **Estado de tu Cuenta**\n\n💰 CUP: **$${u.balance_cup}**\n📱 Saldo: **$${u.balance_saldo}**\n💵 USDT: **$${u.balance_usdt}**\n\n¿Qué deseas hacer?`, {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Recargar Saldo Interno', callback_data: 'recharge_menu' }],
                    [{ text: '📜 Ver Mi Historial', callback_data: 'history' }],
                    ...backBtn('start_back')
                ]
            }
        });
    }

    if (action === 'history') {
        const { data: txs } = await supabase.from('transactions').select('*').eq('user_id', chatId).order('created_at', { ascending: false }).limit(5);
        let txt = "📜 **Tus últimas 5 operaciones:**\n\n";
        if (!txs || txs.length === 0) txt += "_Aún no tienes movimientos._";
        else {
            txs.forEach(t => {
                let icon = t.status === 'completed' ? '✅' : t.status === 'pending' ? '⏳' : '❌';
                txt += `${icon} ${t.type} - $${t.amount || t.amount_requested} ${t.currency.toUpperCase()}\n`;
            });
        }
        bot.editMessageText(txt, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: backBtn('wallet') } });
    }

    if (action === 'recharge_menu') {
        bot.editMessageText("🚀 **Selecciona el método de pago:**\n\nRecuerda que esto es para saldo **interno** del bot.", {
            chat_id: chatId, message_id: query.message.message_id,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💳 CUP (Tarjeta)', callback_data: 'dep_init:cup' }],
                    [{ text: '📲 Saldo Móvil', callback_data: 'dep_init:saldo' }],
                    [{ text: '🪙 USDT Bep20 (Desde SafePal)', callback_data: 'dep_init:usdt' }],
                    ...backBtn('wallet')
                ]
            }
        });
    }

    // --- SECCIÓN: GUÍA USDT ---
    if (action === 'usdt_guide') {
        const guide = `📖 **Guía de USDT BEP20 (SafePal)**\n\n1️⃣ Descarga e instala **SafePal** desde la PlayStore/AppStore.\n2️⃣ Entra en "Gestión de Monedas" y busca **USDT-BEP20**.\n3️⃣ Activa la casilla. Para recibir, toca la moneda y dale a "Recibir" para copiar tu dirección.\n4️⃣ Para enviar (pagar en el bot), toca "Enviar", pega la dirección que te daré al recargar y pon la cantidad exacta.\n\n⚠️ **IMPORTANTE:** Solo aceptamos red **BEP20**. Si usas otra red, los fondos se perderán.\n\n🤔 **¿Quieres comprar USDT para tu cuenta de SafePal?**`;
        bot.editMessageText(guide, {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛍️ Comprar USDT a mi Wallet', callback_data: 'buy_ext_usdt_init' }],
                    ...backBtn('start_back')
                ]
            }
        });
    }

    // --- SECCIÓN: COMPRA USDT EXTERNO ---
    if (action === 'buy_ext_usdt_init') {
        activeSessions[chatId] = { step: 'waiting_personal_wallet' };
        bot.sendMessage(chatId, "📌 **Configuración de Billetera**\n\nPor favor, pega aquí tu dirección de **USDT BEP20** de SafePal donde recibirás los fondos:", { reply_markup: { inline_keyboard: backBtn('usdt_guide') } });
    }

    if (action === 'buy_ext_pay') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        bot.sendMessage(chatId, `¿Cómo deseas pagar tus **${activeSessions[chatId].amount_usdt} USDT**?\n\n💵 Tasa CUP: \`${process.env.USDT_RATE_CUP}\`\n📱 Tasa Saldo: \`${process.env.USDT_RATE_SALDO}\``, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `Pagar en CUP ($${activeSessions[chatId].amount_usdt * process.env.USDT_RATE_CUP})`, callback_data: `buy_ext_final:cup` }],
                    [{ text: `Pagar en Saldo ($${activeSessions[chatId].amount_usdt * process.env.USDT_RATE_SALDO})`, callback_data: `buy_ext_final:saldo` }]
                ]
            }
        });
    }

    if (action === 'buy_ext_final') {
        const sess = activeSessions[chatId];
        sess.currency = p1;
        sess.step = 'waiting_proof_ext';
        const total = sess.amount_usdt * (p1 === 'cup' ? process.env.USDT_RATE_CUP : process.env.USDT_RATE_SALDO);
        
        let instruc = p1 === 'cup' ? `💳 Tarjeta: \`${process.env.PAGO_CUP_TARJETA}\`\n# Confirmar: \`${process.env.PAGO_SALDO_MOVIL}\`` : `📱 Saldo al: \`${process.env.PAGO_SALDO_MOVIL}\``;
        
        bot.sendMessage(chatId, `✅ **Orden Lista**\nTotal a pagar: **$${total} ${p1.toUpperCase()}**\n\n${instruc}\n\nEnvía la captura del pago aquí:`, { parse_mode: 'Markdown' });
    }

    // --- SECCIÓN: TIENDA (MLBB) ---
    if (action === 'shop') {
        const { data: items } = await supabase.from('products').select('*').eq('is_active', true);
        const buttons = items.map(i => [{ text: `💎 ${i.name} ($${i.price_cup} CUP)`, callback_data: `buy_select:${i.id}` }]);
        bot.editMessageText("💎 **Selecciona el paquete de Diamantes:**", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [...buttons, ...backBtn('start_back')] } });
    }

    if (action === 'buy_select') {
        bot.sendMessage(chatId, "Elige tu moneda de pago:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'CUP', callback_data: `pay_now:${p1}:cup` }, { text: 'Saldo', callback_data: `pay_now:${p1}:saldo` }],
                    [{ text: 'USDT', callback_data: `pay_now:${p1}:usdt` }],
                    ...backBtn('shop')
                ]
            }
        });
    }

    if (action === 'pay_now') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        const { data: p } = await supabase.from('products').select('*').eq('id', p1).single();
        const cost = p[`price_${p2}`];
        if (u[`balance_${p2}`] < cost) return bot.answerCallbackQuery(query.id, { text: "⚠️ No tienes saldo suficiente en el bot.", show_alert: true });
        activeSessions[chatId] = { step: 'ask_player_id', product: p, currency: p2, cost: cost };
        bot.sendMessage(chatId, "🎮 Escribe tu **ID de Jugador**:", { reply_markup: { inline_keyboard: backBtn('shop') } });
    }

    // --- ACCIONES ADMIN ---
    if (action === 'adm_approve') {
        const { data: tx } = await supabase.from('transactions').select('*').eq('id', p1).single();
        const { data: user } = await supabase.from('users').select('*').eq('telegram_id', tx.user_id).single();
        
        if (tx.type === 'EXTERNAL_USDT') {
            bot.sendMessage(tx.user_id, `✅ **Compra de USDT Aprobada**\nTu envío de USDT a SafePal está siendo procesado por el admin.`);
        } else {
            await supabase.from('users').update({ [`balance_${tx.currency}`]: (user[`balance_${tx.currency}`] || 0) + tx.amount_requested }).eq('telegram_id', tx.user_id);
            bot.sendMessage(tx.user_id, `✨ **¡Saldo Acreditado!**\nYa tienes $${tx.amount_requested} ${tx.currency.toUpperCase()} en tu cuenta.`);
        }
        await supabase.from('transactions').update({ status: 'completed' }).eq('id', p1);
        bot.editMessageCaption(`✅ **PROCESADO** por admin.`, { chat_id: process.env.ADMIN_GROUP, message_id: query.message.message_id });
    }

    if (action === 'adm_reject') {
        activeSessions[chatId] = { step: 'adm_reason', txId: p1, msgId: query.message.message_id };
        bot.sendMessage(chatId, "❌ ¿Motivo del rechazo?");
    }
});

// --- LÓGICA DE MENSAJES ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = activeSessions[chatId];
    if (!session || msg.text?.startsWith('/')) return;

    // A. Recarga Saldo Interno (Poner Monto)
    if (session.step === 'waiting_amount') {
        const amt = parseFloat(msg.text);
        const cur = session.currency;
        const lim = { cup: [1000, 10000], saldo: [500, 5000], usdt: [10, 100] };
        if (isNaN(amt) || amt < lim[cur][0] || amt > lim[cur][1]) return bot.sendMessage(chatId, `❌ Monto fuera de límites (${lim[cur][0]}-${lim[cur][1]}). Prueba de nuevo:`);
        
        session.amount = amt;
        session.step = 'waiting_proof';
        let instruc = cur === 'cup' ? `💳 Tarjeta: \`${process.env.PAGO_CUP_TARJETA}\`\n# Confirmar: \`${process.env.PAGO_SALDO_MOVIL}\`` : 
                      cur === 'saldo' ? `📱 Saldo al: \`${process.env.PAGO_SALDO_MOVIL}\`` : 
                      `🪙 Dirección USDT (Bep20): \`${process.env.PAGO_USDT_ADRESS}\`\n⚠️ *Usa solo SafePal Bep20.*`;
        
        bot.sendMessage(chatId, `Perfecto, envía **$${amt} ${cur.toUpperCase()}**\n\n${instruc}\n\nEnvía la foto del comprobante:`, { parse_mode: 'Markdown' });
    }

    // B. Compra USDT Externo (Configurar Wallet)
    else if (session.step === 'waiting_personal_wallet') {
        await supabase.from('users').update({ personal_usdt_address: msg.text }).eq('telegram_id', chatId);
        session.step = 'waiting_ext_amount';
        bot.sendMessage(chatId, "✅ Wallet guardada. ¿Cuántos **USDT** deseas comprar?\n(Mínimo 10 - Máximo 100)");
    }

    else if (session.step === 'waiting_ext_amount') {
        const amt = parseFloat(msg.text);
        if (isNaN(amt) || amt < 10 || amt > 100) return bot.sendMessage(chatId, "❌ El mínimo es 10 y el máximo 100 USDT.");
        session.amount_usdt = amt;
        session.step = 'ready_to_pay_ext';
        // Simulamos un click al botón de pago para fluidez
        bot.sendMessage(chatId, "Excelente.", { reply_markup: { inline_keyboard: [[{ text: '💳 Elegir método de pago', callback_data: 'buy_ext_pay' }]] } });
    }

    // C. Envío de comprobantes (Ambos tipos)
    else if ((session.step === 'waiting_proof' || session.step === 'waiting_proof_ext') && msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileUrl = await bot.getFileLink(fileId);
        const type = session.step === 'waiting_proof_ext' ? 'EXTERNAL_USDT' : 'DEPOSIT';
        
        const { data: tx } = await supabase.from('transactions').insert([{
            user_id: chatId, type: type, currency: session.currency, 
            amount_requested: session.amount || session.amount_usdt, status: 'pending'
        }]).select().single();

        bot.sendPhoto(process.env.ADMIN_GROUP, fileId, {
            caption: `🚨 **ALERTA DE PAGO (${type})**\nUsuario: ${msg.from.first_name}\nMonto: $${session.amount || session.amount_usdt} ${session.currency.toUpperCase()}`,
            reply_markup: { inline_keyboard: [[{ text: '✅ Aprobar', callback_data: `adm_approve:${tx.id}` }], [{ text: '❌ Rechazar', callback_data: `adm_reject:${tx.id}` }]] }
        });

        bot.sendMessage(chatId, "✨ **¡Comprobante recibido!**\n\nTu solicitud está en fila. Solemos tardar 1-10 min, pero si hay apagones en Cuba puede demorar más. ¡Gracias por tu paciencia!", { reply_markup: mainKeyboard });
        delete activeSessions[chatId];
    }

    // D. Proceso Recarga Juego
    else if (session.step === 'ask_player_id') {
        session.player_tag = msg.text;
        session.step = 'ask_zone_id';
        bot.sendMessage(chatId, "📍 Escribe tu **Zone ID**:");
    } else if (session.step === 'ask_zone_id') {
        bot.sendMessage(chatId, "🚀 Procesando...");
        const res = await ejecutarRecargaAPI('/order-create', {
            product_id: session.product.api_prod_id,
            variation_id: session.product.api_var_id,
            user_id: session.player_tag,
            server_id: msg.text, qty: 1, partner_ref: `RECARGA-${Date.now()}`
        });

        if (res.ok) {
            const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            await supabase.from('users').update({ [`balance_${session.currency}`]: u[`balance_${session.currency}`] - session.cost }).eq('telegram_id', chatId);
            bot.sendMessage(chatId, `✅ **¡RECARGA EXITOSA!**\nOrden: \`${res.data.order_id}\``, { reply_markup: mainKeyboard });
        } else {
            bot.sendMessage(chatId, `❌ Error: ${res.message}`, { reply_markup: mainKeyboard });
        }
        delete activeSessions[chatId];
    }
});

http.createServer((req, res) => { res.write("Sistema Activo"); res.end(); }).listen(process.env.PORT || 3000);
