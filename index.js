require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto-js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bodyParser = require('body-parser');

// --- 1. CONFIGURACIÓN DEL SERVIDOR Y BOT ---
const app = express();
app.use(bodyParser.json());

const supabase = createClient(process.env.DB_URL, process.env.DB_KEY);
const activeSessions = {};

// Evitar Conflicto 409 (Doble instancia)
let bot;
setTimeout(() => {
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    console.log("🟢 BOT: Conectado y escuchando mensajes...");
    iniciarFuncionesBot();
}, 5000);

// Variables Globales
const MI_TARJETA = process.env.PAGO_CUP_TARJETA || "9227069995328054";
const MI_MONEDERO = process.env.MONEDERO_MOVIL || "5XXXXXXX";
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- 2. LÓGICA DE BONOS ---
function calcularMontoConBono(monto, moneda, esPrimerDeposito) {
    if (!esPrimerDeposito) return monto;
    let bono = 0;
    if (moneda === 'cup') bono = 0.10;    // 10%
    if (moneda === 'saldo') bono = 0.10;  // 10%
    if (moneda === 'usdt') bono = 0.05;   // 5%
    return monto * (1 + bono);
}

// --- 3. WEBHOOK (RECEPTOR DE SMS / DEKU SMS) ---
app.post('/webhook', async (req, res) => {
    console.log("📥 WEBHOOK: Nueva petición recibida.");
    try {
        const data = req.body;
        const remitente = (data.sender || data.dirección || "").toUpperCase();
        const mensaje = (data.text || data.body || "");

        console.log(`📝 Datos del SMS -> De: ${remitente} | Msg: ${mensaje}`);

        // A. DETECCIÓN TRANSFERMÓVIL (PAGOS CUP)
        if (remitente.includes("PAGO") || remitente.includes("TRANSFER")) {
            const monto = parseFloat(mensaje.match(/(\d+\.?\d*)\s*CUP/)?.[1] || 0);
            const txId = mensaje.match(/(TMW\d+|KW\w+|T\d+[A-Z]+)/)?.[1];
            const telOrigen = mensaje.match(/(5\d{7,9})/)?.[1];

            console.log(`🔍 Análisis CUP: Monto=${monto}, ID=${txId}, Tel=${telOrigen}`);

            if (txId && monto > 0) {
                if (telOrigen) {
                    // Pago con número (Automático)
                    const { data: user } = await supabase.from('users').select('*').eq('phone_number', telOrigen).single();
                    if (user) {
                        let acumulado = (user.pending_balance_cup || 0) + monto;
                        if (acumulado < 1000) {
                            await supabase.from('users').update({ pending_balance_cup: acumulado }).eq('telegram_id', user.telegram_id);
                            bot.sendMessage(user.telegram_id, `⚠️ **Pago recibido ($${monto})**\nTu saldo acumulado es $${acumulado} CUP. El mínimo para acreditar es $1000. Envía el resto para completar.`);
                        } else {
                            const montoFinal = calcularMontoConBono(acumulado, 'cup', user.first_dep_cup);
                            const nuevoBalance = (user.balance_cup || 0) + montoFinal;
                            await supabase.from('users').update({ 
                                balance_cup: nuevoBalance, 
                                pending_balance_cup: 0, 
                                first_dep_cup: false 
                            }).eq('telegram_id', user.telegram_id);
                            bot.sendMessage(user.telegram_id, `✨ **¡Se ha agregado $${montoFinal} CUP con éxito!**\nDisfruta tu compra. Saldo actual: $${nuevoBalance}`);
                        }
                    }
                } else {
                    // Sin número (Tarjeta a Monedero) -> Guardar en pendientes
                    await supabase.from('pending_sms_payments').upsert([{ tx_id: txId, amount: monto, raw_message: mensaje, claimed: false }]);
                    console.log("💾 Guardado en Pendientes (Reclamable por ID).");
                }
            }
        }

        // B. DETECCIÓN SALDO MÓVIL (888 / CUBACEL)
        if (remitente.includes("888") || mensaje.includes("transferencia")) {
            const montoSaldo = parseFloat(mensaje.match(/(\d+\.?\d*)\s*CUP/)?.[1] || 0);
            const telSaldo = mensaje.match(/(5\d{7,9})/)?.[1];

            console.log(`🔍 Análisis Saldo: Monto=${montoSaldo}, Tel=${telSaldo}`);

            if (telSaldo && montoSaldo > 0) {
                const { data: user } = await supabase.from('users').select('*').eq('phone_number', telSaldo).single();
                if (user) {
                    const montoFinal = calcularMontoConBono(montoSaldo, 'saldo', user.first_dep_saldo);
                    const nuevoBalance = (user.balance_saldo || 0) + montoFinal;
                    await supabase.from('users').update({ balance_saldo: nuevoBalance, first_dep_saldo: false }).eq('telegram_id', user.telegram_id);
                    bot.sendMessage(user.telegram_id, `✨ **¡Se ha agregado $${montoFinal} de Saldo Móvil con éxito!**`);
                }
            }
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error("❌ ERROR WEBHOOK:", err);
        res.status(500).send('Error');
    }
});

// --- 4. FUNCIONES DEL BOT ---
function iniciarFuncionesBot() {
    const mainKeyboard = {
        inline_keyboard: [
            [{ text: '🎮 Tienda MLBB', callback_data: 'shop' }],
            [{ text: '👛 Mi Billetera', callback_data: 'wallet' }],
            [{ text: '🪙 Guía SafePal (USDT)', callback_data: 'usdt_guide' }]
        ]
    };

    bot.onText(/\/start/, async (msg) => {
        const { id, first_name } = msg.from;
        const { data: user } = await supabase.from('users').upsert({ telegram_id: id, first_name }).select().single();
        
        if (!user.phone_number) {
            bot.sendMessage(id, `👋 ¡Hola **${first_name}**!\n\nPara usar el bot, vincula tu número de Transfermóvil/Móvil.\n\n🎁 **Bonos de primer depósito:**\n- CUP: 10%\n- Saldo: 10%\n- USDT: 5%`, {
                reply_markup: { inline_keyboard: [[{ text: '📲 Vincular mi Número', callback_data: 'link_phone' }]] }
            });
        } else {
            bot.sendMessage(id, `🏠 **Menú Principal**\nHola ${first_name}, ¿qué deseas hacer?`, { reply_markup: mainKeyboard });
        }
    });

    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;

        // ACCIÓN: GUÍA SAFEPAL
        if (data === 'usdt_guide') {
            console.log("🛠 Ejecutando Callback: usdt_guide");
            const textoGuia = `📖 **Guía de Depósito USDT (SafePal)**\n\n1️⃣ Abre tu App **SafePal**.\n2️⃣ Envía USDT por la red **BEP20** a la dirección:\n\n\`TU_DIRECCION_WALLET_AQUI\`\n\n3️⃣ Una vez enviada, contacta a soporte para acreditar.\n\n🎁 **Bono:** 5% extra en tu primer depósito USDT.`;
            bot.editMessageText(textoGuia, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'start_back' }]] }
            });
        }

        // ACCIÓN: VOLVER AL INICIO
        if (data === 'start_back') {
            bot.editMessageText("🏠 **Menú Principal**", { chat_id: chatId, message_id: query.message.message_id, reply_markup: mainKeyboard });
        }

        // ACCIÓN: BILLETERA
        if (data === 'wallet') {
            const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            const balanceMsg = `👛 **Tu Wallet**\n\n💳 CUP: **$${u.balance_cup}**\n📱 Saldo: **$${u.balance_saldo}**\n💵 USDT: **$${u.balance_usdt}**\n\n☁️ Pendiente (CUP): $${u.pending_balance_cup || 0}`;
            bot.editMessageText(balanceMsg, {
                chat_id: chatId, message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Recargar CUP (Tarjeta)', callback_data: 'rec_cup' }],
                        [{ text: '📲 Recargar Saldo Móvil', callback_data: 'rec_saldo' }],
                        [{ text: '🔍 Reclamar por ID', callback_data: 'claim_id' }],
                        [{ text: '🔙 Volver', callback_data: 'start_back' }]
                    ]
                }
            });
        }

        // ACCIÓN: RECARGAR CUP
        if (data === 'rec_cup') {
            bot.sendMessage(chatId, `💳 **Depósito CUP**\n\nTransfiere a la tarjeta:\n\`${MI_TARJETA}\`\n\nMínimo: $1000 CUP.\n\n⚠️ Hazlo desde tu número vinculado.`);
        }

        // ACCIÓN: RECARGAR SALDO
        if (data === 'rec_saldo') {
            bot.sendMessage(chatId, `📱 **Depósito Saldo Móvil**\n\nEnvía transferencia de saldo al:\n\`${MI_MONEDERO}\`\n\nEl bot acreditará automáticamente.`);
        }

        // ACCIÓN: VINCULAR TELÉFONO
        if (data === 'link_phone') {
            activeSessions[chatId] = { step: 'waiting_phone' };
            bot.sendMessage(chatId, "📱 Escribe tu número de teléfono cubano (8 dígitos, ej: 53591902):");
        }

        // ACCIÓN: RECLAMAR ID
        if (data === 'claim_id') {
            activeSessions[chatId] = { step: 'waiting_id' };
            bot.sendMessage(chatId, "🔍 Escribe el ID de transacción (TMW...):");
        }
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        const session = activeSessions[chatId];
        if (!session || !text || text.startsWith('/')) return;

        if (session.step === 'waiting_phone') {
            const phone = text.trim();
            if (!/^5\d{7}$/.test(phone)) return bot.sendMessage(chatId, "❌ Número inválido. Debe tener 8 dígitos y empezar con 5.");
            await supabase.from('users').update({ phone_number: phone }).eq('telegram_id', chatId);
            bot.sendMessage(chatId, "✅ Número vinculado con éxito.", { reply_markup: mainKeyboard });
            delete activeSessions[chatId];
        }

        if (session.step === 'waiting_id') {
            const txId = text.trim().toUpperCase();
            const { data: pago } = await supabase.from('pending_sms_payments').select('*').eq('tx_id', txId).eq('claimed', false).single();
            if (pago) {
                const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
                const final = calcularMontoConBono(pago.amount, 'cup', u.first_dep_cup);
                await supabase.from('users').update({ balance_cup: (u.balance_cup || 0) + final, first_dep_cup: false }).eq('telegram_id', chatId);
                await supabase.from('pending_sms_payments').update({ claimed: true, claimed_by: chatId }).eq('id', pago.id);
                bot.sendMessage(chatId, `✨ **¡Se ha agregado $${final} CUP con éxito!**`, { reply_markup: mainKeyboard });
            } else {
                bot.sendMessage(chatId, "❌ ID no encontrado o ya fue reclamado.");
            }
            delete activeSessions[chatId];
        }
    });
}

// Keep-Alive para Render
app.get('/keepalive', (req, res) => res.send('System Online'));
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
