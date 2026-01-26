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

// Evitar error 409: Esperamos un poco antes de conectar el polling
let bot;
setTimeout(() => {
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    console.log("🤖 Bot de Telegram conectado (Polling activado)");
    iniciarLogicaBot(); // Lanzamos la lógica después de conectar
}, 5000);

const supabase = createClient(process.env.DB_URL, process.env.DB_KEY);
const activeSessions = {};

// Constantes
const MI_TARJETA = process.env.PAGO_CUP_TARJETA || "9227069995328054";
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- SERVIDOR WEBHOOK PARA DEKU SMS ---
app.post('/webhook', async (req, res) => {
    console.log("📥 Petición recibida en /webhook");
    try {
        const data = req.body;
        const remitente = (data.dirección || data.sender || "").toUpperCase();
        const mensaje = (data.text || data.body || "");

        console.log(`📱 Remitente detectado: ${remitente}`);
        console.log(`💬 Contenido: ${mensaje}`);

        if (remitente.includes("PAGO") || remitente.includes("TRANSFER")) {
            const montoMatch = mensaje.match(/(\d+\.?\d*)\s*CUP/);
            const montoDetectado = montoMatch ? parseFloat(montoMatch[1]) : 0;
            const idMatch = mensaje.match(/(TMW\d+|KW\w+|T\d+[A-Z]+)/);
            const transId = idMatch ? idMatch[1] : null;
            const telMatch = mensaje.match(/(5\d{7,9})/);
            const telefonoCliente = telMatch ? telMatch[1] : null;

            console.log(`🔍 Análisis: ID=${transId}, Monto=${montoDetectado}, Tel=${telefonoCliente}`);

            const MIN_CUP = 1000;

            if (transId && montoDetectado > 0) {
                if (telefonoCliente) {
                    const { data: user } = await supabase.from('users').select('*').eq('phone_number', telefonoCliente).single();
                    
                    if (user) {
                        let acumulado = (user.pending_balance_cup || 0) + montoDetectado;

                        if (acumulado < MIN_CUP) {
                            await supabase.from('users').update({ pending_balance_cup: acumulado }).eq('telegram_id', user.telegram_id);
                            bot.sendMessage(user.telegram_id, `⚠️ **Pago recibido, pero incompleto.**\n\nHas enviado $${montoDetectado} CUP. Tu saldo acumulado "en la nube" es de **$${acumulado} CUP**.\n\nFaltan $${MIN_CUP - acumulado} CUP para llegar al mínimo y acreditar.`);
                        } else {
                            // Aplicar bonos (10% primer depósito)
                            let montoFinal = acumulado;
                            if (user.first_dep_cup) montoFinal = acumulado * 1.10;

                            const nuevoBalance = (user.balance_cup || 0) + montoFinal;

                            await supabase.from('users').update({ 
                                balance_cup: nuevoBalance, 
                                pending_balance_cup: 0,
                                first_dep_cup: false 
                            }).eq('telegram_id', user.telegram_id);

                            await supabase.from('transactions').insert([{
                                user_id: user.telegram_id, type: 'DEPOSIT_AUTO', currency: 'cup', amount: montoFinal, status: 'completed', tx_id: transId
                            }]);

                            bot.sendMessage(user.telegram_id, `✨ **¡Se ha agregado $${montoFinal} CUP con éxito!**\nDisfruta tu compra. Saldo actual: $${nuevoBalance} CUP.`);
                        }
                    } else {
                        console.log("⚠️ El número no coincide con ningún usuario registrado.");
                    }
                } else {
                    await supabase.from('pending_sms_payments').upsert([{ tx_id: transId, amount: montoDetectado, raw_message: mensaje, claimed: false }], { onConflict: 'tx_id' });
                    console.log("💾 Pago guardado en pendientes (ID reclamable)");
                }
            }
        }
        res.status(200).send('OK');
    } catch (e) {
        console.error("❌ Error Webhook:", e);
        res.status(500).send('Error');
    }
});

// --- KEEP ALIVE ---
app.get('/keepalive', (req, res) => res.send('OK'));
setInterval(() => { axios.get(`${RENDER_URL}/keepalive`).catch(() => {}); }, 5 * 60 * 1000);

// --- LÓGICA DEL BOT ---
function iniciarLogicaBot() {
    const mainKeyboard = {
        inline_keyboard: [
            [{ text: '🎮 Comprar Diamantes (MLBB)', callback_data: 'shop' }],
            [{ text: '👛 Mi Billetera / Saldo', callback_data: 'wallet' }],
            [{ text: '🪙 Guía USDT (SafePal)', callback_data: 'usdt_guide' }]
        ]
    };

    const backBtn = (dest) => [[{ text: '🔙 Volver', callback_data: dest }]];

    bot.onText(/\/start/, async (msg) => {
        const { id, first_name } = msg.from;
        const { data: user } = await supabase.from('users').upsert({ telegram_id: id, first_name, username: msg.from.username }, { onConflict: 'telegram_id' }).select().single();

        if (!user.phone_number) {
            bot.sendMessage(id, `👋 ¡Hola **${first_name}**!\n\nPara recargas automáticas, vincula tu número de Transfermóvil.\n\n🎁 **Bono:** ¡10% extra en tu primer depósito!`, {
                reply_markup: { inline_keyboard: [[{ text: '📲 Vincular Número', callback_data: 'link_phone' }]] }
            });
        } else {
            bot.sendMessage(id, `👋 ¡Hola **${first_name}**!`, { reply_markup: mainKeyboard });
        }
    });

    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const [action, p1, p2] = query.data.split(':');

        if (action === 'start_back') {
            bot.editMessageText("🏠 Menú Principal:", { chat_id: chatId, message_id: query.message.message_id, reply_markup: mainKeyboard });
        }

        if (action === 'usdt_guide') {
            const guide = `📖 **Guía de USDT (SafePal)**\n\n1️⃣ Descarga **SafePal**.\n2️⃣ Activa la red **USDT-BEP20**.\n3️⃣ Para comprar saldo en el bot con USDT, usa la dirección que te daremos.\n\n⚠️ **Primer depósito:** ¡5% de bono extra en USDT!`;
            bot.editMessageText(guide, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: backBtn('start_back') } });
        }

        if (action === 'wallet') {
            const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            bot.editMessageText(`👛 **Tu Wallet**\n\n💰 CUP: **$${u.balance_cup}**\n☁️ Pendiente: $${u.pending_balance_cup || 0} CUP`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '➕ Recargar CUP', callback_data: 'recharge_cup' }], [{ text: '🔍 Reclamar ID', callback_data: 'claim_id' }], ...backBtn('start_back')] }
            });
        }

        if (action === 'recharge_cup') {
            bot.sendMessage(chatId, `💳 Transfiere a:\n\`${MI_TARJETA}\`\n\nMínimo: $1000 CUP.\nUsa tu número vinculado para acreditar automático.`);
        }

        if (action === 'link_phone') {
            activeSessions[chatId] = { step: 'waiting_phone' };
            bot.sendMessage(chatId, "📱 Envía tu número (ej: 53591902):");
        }

        if (action === 'claim_id') {
            activeSessions[chatId] = { step: 'waiting_id' };
            bot.sendMessage(chatId, "🔍 Envía el ID de Transfermóvil:");
        }

        if (action === 'shop') {
            const { data: items } = await supabase.from('products').select('*').eq('is_active', true);
            const buttons = items.map(i => [{ text: `💎 ${i.name} ($${i.price_cup} CUP)`, callback_data: `buy_select:${i.id}` }]);
            bot.editMessageText("💎 **MLBB Shop:**", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [...buttons, ...backBtn('start_back')] } });
        }

        if (action === 'buy_select') {
            bot.sendMessage(chatId, "Pagar con CUP?", { reply_markup: { inline_keyboard: [[{ text: 'Confirmar Pago', callback_data: `pay_now:${p1}:cup` }]] } });
        }

        if (action === 'pay_now') {
            const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            const { data: p } = await supabase.from('products').select('*').eq('id', p1).single();
            if (u.balance_cup < p.price_cup) return bot.answerCallbackQuery(query.id, { text: "Saldo insuficiente", show_alert: true });
            activeSessions[chatId] = { step: 'ask_player_id', product: p, cost: p.price_cup };
            bot.sendMessage(chatId, "🎮 Escribe tu ID de Jugador:");
        }
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const session = activeSessions[chatId];
        if (!session || msg.text?.startsWith('/')) return;

        if (session.step === 'waiting_phone') {
            await supabase.from('users').update({ phone_number: msg.text.trim() }).eq('telegram_id', chatId);
            bot.sendMessage(chatId, "✅ Vinculado.", { reply_markup: mainKeyboard });
            delete activeSessions[chatId];
        } else if (session.step === 'waiting_id') {
            const txId = msg.text.trim().toUpperCase();
            const { data: pago } = await supabase.from('pending_sms_payments').select('*').eq('tx_id', txId).eq('claimed', false).single();
            if (pago) {
                const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
                let final = u.first_dep_cup ? pago.amount * 1.10 : pago.amount;
                await supabase.from('users').update({ balance_cup: u.balance_cup + final, first_dep_cup: false }).eq('telegram_id', chatId);
                await supabase.from('pending_sms_payments').update({ claimed: true, claimed_by: chatId }).eq('id', pago.id);
                bot.sendMessage(chatId, `✅ $${final} CUP sumados.`);
            } else {
                bot.sendMessage(chatId, "❌ ID no válido.");
            }
            delete activeSessions[chatId];
        }
    });
}

app.listen(PORT, () => console.log(`🚀 Webhook escuchando en puerto ${PORT}`));
