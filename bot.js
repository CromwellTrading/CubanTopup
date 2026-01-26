require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto-js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.DB_URL, process.env.DB_KEY);
const activeSessions = {};
const phoneVerificationCodes = {}; // Para códigos de verificación de teléfono

// Configuración
const MIN_CUP = parseFloat(process.env.MINIMO_CUP || 1000);
const MIN_SALDO = parseFloat(process.env.MINIMO_SALDO || 500);
const MIN_USDT = parseFloat(process.env.MINIMO_USDT || 10);
const MAX_CUP = parseFloat(process.env.MAXIMO_CUP || 50000);
const ADMIN_CHAT_ID = process.env.ADMIN_GROUP;
const PAGO_CUP_TARJETA = process.env.PAGO_CUP_TARJETA;
const PAGO_SALDO_MOVIL = process.env.PAGO_SALDO_MOVIL;
const USDT_RATE_CUP = parseFloat(process.env.USDT_RATE_CUP || 280);
const USDT_RATE_SALDO = parseFloat(process.env.USDT_RATE_SALDO || 275);

// --- Teclados (Keyboards) ---
const mainKeyboard = {
    inline_keyboard: [
        [{ text: '🎮 Comprar Diamantes (MLBB)', callback_data: 'shop' }],
        [{ text: '👛 Mi Billetera / Saldo', callback_data: 'wallet' }],
        [{ text: '🪙 Guía USDT (SafePal)', callback_data: 'usdt_guide' }],
        [{ text: '📱 Vincular Teléfono', callback_data: 'link_phone' }],
        [{ text: '🎁 Reclamar Pago', callback_data: 'claim_payment' }],
        [{ text: '🔄 Actualizar Saldos', callback_data: 'refresh_wallet' }]
    ]
};

const walletKeyboard = {
    inline_keyboard: [
        [{ text: '➕ Recargar Saldo Interno', callback_data: 'recharge_menu' }],
        [{ text: '📜 Ver Mi Historial', callback_data: 'history' }],
        [{ text: '📱 Vincular Teléfono', callback_data: 'link_phone' }],
        [{ text: '📊 Ver Saldo Pendiente', callback_data: 'view_pending' }],
        [{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]
    ]
};

const backKeyboard = (callback_data) => ({
    inline_keyboard: [[{ text: '🔙 Volver', callback_data }]]
});

const rechargeMethodsKeyboard = {
    inline_keyboard: [
        [{ text: '💳 CUP (Tarjeta)', callback_data: 'dep_init:cup' }],
        [{ text: '📲 Saldo Móvil', callback_data: 'dep_init:saldo' }],
        [{ text: '🪙 USDT Bep20 (SafePal)', callback_data: 'dep_init:usdt' }],
        [{ text: '🔙 Volver', callback_data: 'wallet' }]
    ]
};

const shopKeyboard = {
    inline_keyboard: [
        [{ text: '💎 100 Diamantes - $250 CUP', callback_data: 'buy_select:1' }],
        [{ text: '💎 300 Diamantes - $700 CUP', callback_data: 'buy_select:2' }],
        [{ text: '💎 500 Diamantes - $1100 CUP', callback_data: 'buy_select:3' }],
        [{ text: '💎 1000 Diamantes - $2100 CUP', callback_data: 'buy_select:4' }],
        [{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]
    ]
};

const paymentCurrencyKeyboard = (productId) => ({
    inline_keyboard: [
        [
            { text: '💳 CUP', callback_data: `pay_now:${productId}:cup` },
            { text: '📲 Saldo', callback_data: `pay_now:${productId}:saldo` }
        ],
        [{ text: '🪙 USDT', callback_data: `pay_now:${productId}:usdt` }],
        [{ text: '🔙 Volver a Tienda', callback_data: 'shop' }]
    ]
});

const historyBackKeyboard = {
    inline_keyboard: [[{ text: '🔙 Volver a Billetera', callback_data: 'wallet' }]]
};

const linkPhoneKeyboard = {
    inline_keyboard: [
        [{ text: '📱 Ingresar Número', callback_data: 'enter_phone' }],
        [{ text: '❌ Cancelar', callback_data: 'start_back' }]
    ]
};

const claimPaymentKeyboard = {
    inline_keyboard: [
        [{ text: '🔍 Buscar por ID', callback_data: 'search_payment_id' }],
        [{ text: '📋 Ver Pendientes', callback_data: 'view_pending_payments' }],
        [{ text: '🔙 Volver', callback_data: 'start_back' }]
    ]
};

// --- Funciones Auxiliares ---
function formatCurrency(amount, currency) {
    return `$${parseFloat(amount).toFixed(2)} ${currency.toUpperCase()}`;
}

function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function getUser(telegramId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
    
    if (error) {
        console.error('Error obteniendo usuario:', error);
        return null;
    }
    
    return data;
}

async function updateUser(telegramId, updates) {
    const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('telegram_id', telegramId);
    
    if (error) {
        console.error('Error actualizando usuario:', error);
        return false;
    }
    
    return true;
}

async function aplicarBonoPrimerDeposito(userId, currency, amount) {
    const user = await getUser(userId);
    if (!user) return amount;

    let bono = 0;
    let bonoPorcentaje = 0;
    let campoBono = '';

    switch (currency) {
        case 'cup':
            campoBono = 'first_dep_cup';
            bonoPorcentaje = user.first_dep_cup ? 0.10 : 0;
            break;
        case 'saldo':
            campoBono = 'first_dep_saldo';
            bonoPorcentaje = user.first_dep_saldo ? 0.10 : 0;
            break;
        case 'usdt':
            campoBono = 'first_dep_usdt';
            bonoPorcentaje = user.first_dep_usdt ? 0.05 : 0;
            break;
    }

    if (bonoPorcentaje > 0) {
        bono = amount * bonoPorcentaje;
        
        // Marcar que ya usó el bono
        await updateUser(userId, { [campoBono]: false });
    }

    return amount + bono;
}

async function procesarPagoAutomatico(userId, amount, currency, txId, tipoPago) {
    try {
        console.log(`💰 Procesando pago automático: ${userId}, ${amount}, ${currency}, ${txId}, ${tipoPago}`);
        
        const user = await getUser(userId);
        if (!user) {
            console.log(`❌ Usuario ${userId} no encontrado`);
            return { success: false, message: 'Usuario no encontrado' };
        }

        // Verificar si hay orden pendiente
        const { data: pendingTx } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', currency)
            .eq('type', 'DEPOSIT')
            .order('created_at', { ascending: false })
            .limit(1);

        if (!pendingTx || pendingTx.length === 0) {
            // No hay orden pendiente, verificar si es menor al mínimo
            const minimo = { cup: MIN_CUP, saldo: MIN_SALDO, usdt: MIN_USDT }[currency];
            
            if (amount < minimo) {
                if (currency === 'cup') {
                    // Acumular en pending_balance_cup
                    const nuevoPendiente = (user.pending_balance_cup || 0) + amount;
                    await updateUser(userId, { pending_balance_cup: nuevoPendiente });

                    const mensajeUsuario = `⚠️ *Depósito menor al mínimo*\n\n` +
                        `Recibimos ${formatCurrency(amount, currency)} pero el mínimo es ${formatCurrency(minimo, 'cup')}.\n` +
                        `Este monto se ha acumulado a tu saldo pendiente: *${formatCurrency(nuevoPendiente, 'cup')}*\n\n` +
                        `Cuando tus depósitos pendientes sumen ${formatCurrency(minimo, 'cup')} o más, se acreditarán automáticamente.\n\n` +
                        `💰 *Faltan:* ${formatCurrency(MIN_CUP - nuevoPendiente, 'cup')}`;
                    
                    await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
                    
                    // Notificar al admin
                    const mensajeAdmin = `⚠️ *DEPÓSITO MENOR AL MÍNIMO*\n\n` +
                        `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                        `📞 Teléfono: ${user.phone_number || 'No vinculado'}\n` +
                        `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                        `📊 Acumulado pendiente: ${formatCurrency(nuevoPendiente, 'cup')}\n` +
                        `🎯 Faltan: ${formatCurrency(MIN_CUP - nuevoPendiente, 'cup')}\n` +
                        `🔧 Tipo: ${tipoPago}\n` +
                        `🆔 ID: \`${txId}\``;
                    
                    await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                } else {
                    const mensajeUsuario = `⚠️ *Depósito menor al mínimo*\n\n` +
                        `Recibimos ${formatCurrency(amount, currency)} pero el mínimo es ${formatCurrency(minimo, currency)}.\n` +
                        `Este monto no se acreditará hasta que realices un depósito de ${formatCurrency(minimo, currency)} o más.`;
                    
                    await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
                    
                    const mensajeAdmin = `⚠️ *DEPÓSITO MENOR AL MÍNIMO*\n\n` +
                        `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                        `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                        `🎯 Mínimo requerido: ${formatCurrency(minimo, currency)}\n` +
                        `🔧 Tipo: ${tipoPago}\n` +
                        `🆔 ID: \`${txId}\``;
                    
                    await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                }
                
                return { success: false, message: 'Monto menor al mínimo, sin orden pendiente' };
            } else {
                // No hay orden pero el monto es mayor al mínimo, aplicar bono y acreditar
                const montoConBono = await aplicarBonoPrimerDeposito(userId, currency, amount);
                const nuevoSaldo = (user[`balance_${currency}`] || 0) + montoConBono;
                
                await updateUser(userId, { [`balance_${currency}`]: nuevoSaldo });

                // Crear transacción
                await supabase.from('transactions').insert({
                    user_id: userId,
                    type: 'AUTO_DEPOSIT',
                    currency: currency,
                    amount: montoConBono,
                    amount_requested: amount,
                    status: 'completed',
                    tx_id: txId,
                    tipo_pago: tipoPago
                });

                const bonoMensaje = montoConBono > amount ? 
                    `\n🎉 *¡Bono aplicado!* +${formatCurrency(montoConBono - amount, currency)}` : '';

                const mensajeUsuario = `✅ *¡Depósito Acreditado Automáticamente!*\n\n` +
                    `💰 Monto recibido: ${formatCurrency(amount, currency)}\n` +
                    `${bonoMensaje}\n` +
                    `💵 Total acreditado: *${formatCurrency(montoConBono, currency)}*\n\n` +
                    `📊 Nuevo saldo ${currency.toUpperCase()}: *${formatCurrency(nuevoSaldo, currency)}*\n` +
                    `🆔 ID Transacción: \`${txId}\`\n` +
                    `🔧 Tipo: ${tipoPago}`;
                
                await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
                
                // Notificar al admin
                const mensajeAdmin = `✅ *DEPÓSITO AUTOMÁTICO*\n\n` +
                    `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                    `📞 Teléfono: ${user.phone_number || 'No vinculado'}\n` +
                    `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                    `🎁 Total con bono: ${formatCurrency(montoConBono, currency)}\n` +
                    `🔧 Tipo: ${tipoPago}\n` +
                    `🆔 ID Transacción: \`${txId}\`\n` +
                    `📊 Nuevo saldo: ${formatCurrency(nuevoSaldo, currency)}`;
                
                await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });

                return { success: true, montoConBono, nuevoSaldo };
            }
        } else {
            // Hay orden pendiente
            const orden = pendingTx[0];
            const montoSolicitado = orden.amount_requested;
            
            // Verificar que el monto coincida (con margen del 10%)
            const margen = montoSolicitado * 0.1;
            if (Math.abs(amount - montoSolicitado) > margen) {
                const mensajeUsuario = `⚠️ *Monto no coincide*\n\n` +
                    `📋 Solicitaste: ${formatCurrency(montoSolicitado, currency)}\n` +
                    `💰 Recibido: ${formatCurrency(amount, currency)}\n\n` +
                    `Contacta al administrador para aclaración.`;
                
                await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
                
                const mensajeAdmin = `⚠️ *MONTO NO COINCIDE*\n\n` +
                    `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                    `📋 Orden #: ${orden.id}\n` +
                    `🎯 Solicitado: ${formatCurrency(montoSolicitado, currency)}\n` +
                    `💰 Recibido: ${formatCurrency(amount, currency)}\n` +
                    `🔧 Tipo: ${tipoPago}\n` +
                    `🆔 ID: \`${txId}\``;
                
                await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                
                return { success: false, message: 'Monto no coincide' };
            }

            // Aplicar bono si es primer depósito
            const montoConBono = await aplicarBonoPrimerDeposito(userId, currency, amount);
            const nuevoSaldo = (user[`balance_${currency}`] || 0) + montoConBono;
            
            // Actualizar saldo
            await updateUser(userId, { [`balance_${currency}`]: nuevoSaldo });

            // Actualizar transacción
            await supabase
                .from('transactions')
                .update({ 
                    status: 'completed',
                    amount: montoConBono,
                    tx_id: txId,
                    tipo_pago: tipoPago
                })
                .eq('id', orden.id);

            const bonoMensaje = montoConBono > amount ? 
                `\n🎉 *¡Bono aplicado!* +${formatCurrency(montoConBono - amount, currency)}` : '';

            const mensajeUsuario = `✨ *¡Depósito Completado!*\n\n` +
                `📋 Monto solicitado: ${formatCurrency(montoSolicitado, currency)}\n` +
                `💰 Monto recibido: ${formatCurrency(amount, currency)}\n` +
                `${bonoMensaje}\n` +
                `💵 Total acreditado: *${formatCurrency(montoConBono, currency)}*\n\n` +
                `📊 Nuevo saldo ${currency.toUpperCase()}: *${formatCurrency(nuevoSaldo, currency)}*\n` +
                `🆔 ID Transacción: \`${txId}\`\n` +
                `🔧 Tipo: ${tipoPago}`;
            
            await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });

            // Notificar al admin
            const mensajeAdmin = `✅ *DEPÓSITO COMPLETADO*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                `📋 Orden #: ${orden.id}\n` +
                `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                `🎁 Total con bono: ${formatCurrency(montoConBono, currency)}\n` +
                `🔧 Tipo: ${tipoPago}\n` +
                `🆔 ID Transacción: \`${txId}\`\n` +
                `📊 Nuevo saldo: ${formatCurrency(nuevoSaldo, currency)}`;
            
            await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });

            return { success: true, montoConBono, nuevoSaldo };
        }
    } catch (error) {
        console.error('❌ Error procesando pago automático:', error);
        return { success: false, message: error.message };
    }
}

// --- API Endpoint para recibir notificaciones de Python ---
app.post('/payment-notification', async (req, res) => {
    try {
        const { type, user_id, amount, currency, tx_id, tipo_pago, phone, message } = req.body;
        
        console.log(`📥 Notificación recibida:`, { type, user_id, amount, currency, tx_id, tipo_pago });
        
        if (type === 'PENDING_PAYMENT') {
            // Notificar al admin sobre pago pendiente
            const mensajeAdmin = `📥 *PAGO PENDIENTE (Tarjeta→Monedero)*\n\n` +
                `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                `🔧 Tipo: ${tipo_pago}\n` +
                `🆔 ID: \`${tx_id}\`\n` +
                `📞 Teléfono: ${phone || 'No disponible'}\n\n` +
                `El usuario debe usar el botón '🎁 Reclamar Pago' con este ID`;
            
            await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
            
            return res.json({ success: true, message: 'Notificación recibida' });
        }
        
        if (type === 'AUTO_PAYMENT') {
            if (!user_id) {
                return res.status(400).json({ success: false, message: 'user_id requerido' });
            }
            
            const result = await procesarPagoAutomatico(user_id, amount, currency, tx_id, tipo_pago);
            res.json(result);
        }
    } catch (error) {
        console.error('❌ Error en payment-notification:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- Manejo de Comandos y Mensajes ---

// Comando /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const { id, first_name, username } = msg.from;
    
    await supabase.from('users').upsert({ 
        telegram_id: id, 
        first_name, 
        username: username,
        phone_number: null,
        first_dep_cup: true,
        first_dep_saldo: true,
        first_dep_usdt: true,
        pending_balance_cup: 0,
        balance_cup: 0,
        balance_saldo: 0,
        balance_usdt: 0,
        last_active: new Date().toISOString()
    }, { onConflict: 'telegram_id' });
    
    const welcomeMessage = `👋 ¡Hola, **${first_name}**!\n\n` +
        `Bienvenido al sistema de pagos automáticos de Transfermóvil.\n\n` +
        `✨ *Características principales:*\n` +
        `✅ Detección automática de pagos\n` +
        `✅ Vincula tu teléfono para pagos instantáneos\n` +
        `✅ Bonos en primer depósito\n` +
        `✅ Saldo pendiente para montos pequeños\n\n` +
        `🎁 *Beneficios por primer depósito:*\n` +
        `• 💳 CUP: 10% extra\n` +
        `• 📱 Saldo Móvil: 10% extra\n` +
        `• 🪙 USDT: 5% extra\n\n` +
        `💡 *Consejo:* Vincula tu teléfono primero para pagos automáticos.\n\n` +
        `¿Qué deseas hacer?`;
    
    await bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown', 
        reply_markup: mainKeyboard 
    });
});

// Manejo de Callbacks (Botones)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const [action, param1, param2] = query.data.split(':');

    try {
        // Responder al callback para quitar el "cargando"
        await bot.answerCallbackQuery(query.id);

        switch (action) {
            case 'start_back':
                await handleStartBack(chatId, messageId);
                break;
                
            case 'shop':
                await handleShop(chatId, messageId);
                break;
                
            case 'wallet':
                await handleWallet(chatId, messageId);
                break;
                
            case 'refresh_wallet':
                await handleRefreshWallet(chatId, messageId);
                break;
                
            case 'usdt_guide':
                await handleUsdtGuide(chatId, messageId);
                break;
                
            case 'link_phone':
                await handleLinkPhone(chatId, messageId);
                break;
                
            case 'enter_phone':
                await handleEnterPhone(chatId, messageId);
                break;
                
            case 'claim_payment':
                await handleClaimPayment(chatId, messageId);
                break;
                
            case 'search_payment_id':
                await handleSearchPaymentId(chatId, messageId);
                break;
                
            case 'view_pending_payments':
                await handleViewPendingPayments(chatId, messageId);
                break;
                
            case 'recharge_menu':
                await handleRechargeMenu(chatId, messageId);
                break;
                
            case 'dep_init':
                await handleDepositInit(chatId, messageId, param1);
                break;
                
            case 'history':
                await handleHistory(chatId, messageId);
                break;
                
            case 'view_pending':
                await handleViewPending(chatId, messageId);
                break;
                
            case 'buy_select':
                await handleBuySelect(chatId, messageId, param1);
                break;
                
            case 'pay_now':
                await handlePayNow(chatId, messageId, param1, param2);
                break;
                
            case 'buy_ext_usdt_init':
                await handleBuyExtUsdtInit(chatId, messageId);
                break;
                
            case 'buy_ext_pay':
                await handleBuyExtPay(chatId, messageId);
                break;
                
            case 'buy_ext_final':
                await handleBuyExtFinal(chatId, messageId, param1);
                break;
                
            case 'adm_approve':
                await handleAdminApprove(chatId, messageId, param1);
                break;
                
            case 'adm_reject':
                await handleAdminReject(chatId, messageId, param1);
                break;
                
            default:
                console.log(`Acción no reconocida: ${action}`);
        }
    } catch (error) {
        console.error('Error en callback:', error);
        await bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.');
    }
});

// Funciones de manejo de callbacks
async function handleStartBack(chatId, messageId) {
    const user = await getUser(chatId);
    const welcomeMessage = `👋 ¡Hola, **${user.first_name}**!\n\n` +
        `¿En qué más puedo ayudarte hoy?`;
    
    await bot.editMessageText(welcomeMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
    });
}

async function handleShop(chatId, messageId) {
    const products = [
        { id: 1, name: '100 Diamantes', price_cup: 250 },
        { id: 2, name: '300 Diamantes', price_cup: 700 },
        { id: 3, name: '500 Diamantes', price_cup: 1100 },
        { id: 4, name: '1000 Diamantes', price_cup: 2100 }
    ];
    
    let message = `💎 *Tienda de Diamantes MLBB*\n\n`;
    
    products.forEach(product => {
        message += `${product.name}: *$${product.price_cup} CUP*\n`;
        message += `   📱 Saldo: *$${(product.price_cup * 0.95).toFixed(0)}*\n`;
        message += `   🪙 USDT: *$${(product.price_cup / USDT_RATE_CUP).toFixed(2)}*\n\n`;
    });
    
    message += `Selecciona un paquete:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: shopKeyboard
    });
}

async function handleWallet(chatId, messageId) {
    const user = await getUser(chatId);
    
    if (!user) {
        await bot.editMessageText('❌ No se pudo obtener tu información.', {
            chat_id: chatId,
            message_id: messageId
        });
        return;
    }
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = MIN_CUP - pendiente;
    
    let message = `👛 *Estado de tu Cuenta*\n\n` +
        `💰 CUP: **${formatCurrency(user.balance_cup, 'cup')}**\n` +
        `📱 Saldo Móvil: **${formatCurrency(user.balance_saldo, 'saldo')}**\n` +
        `🪙 USDT: **${formatCurrency(user.balance_usdt, 'usdt')}**\n\n`;
    
    if (pendiente > 0) {
        message += `📥 *CUP Pendientes:* **${formatCurrency(pendiente, 'cup')}**\n`;
        if (faltante > 0) {
            message += `🎯 *Faltan:* ${formatCurrency(faltante, 'cup')} para el mínimo\n\n`;
        } else {
            message += `✅ *¡Listo para acreditar!* (Se procesará automáticamente)\n\n`;
        }
    }
    
    message += `📞 *Teléfono vinculado:* ${user.phone_number ? `+53 ${user.phone_number}` : '❌ No vinculado'}\n\n` +
        `¿Qué deseas hacer?`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: walletKeyboard
    });
}

async function handleRefreshWallet(chatId, messageId) {
    await updateUser(chatId, { last_active: new Date().toISOString() });
    await handleWallet(chatId, messageId);
}

async function handleUsdtGuide(chatId, messageId) {
    const guideMessage = `📖 *Guía de USDT BEP20 (SafePal)*\n\n` +
        `1️⃣ Descarga e instala **SafePal** desde la PlayStore/AppStore.\n` +
        `2️⃣ Entra en "Gestión de Monedas" y busca **USDT-BEP20**.\n` +
        `3️⃣ Activa la casilla. Para recibir, toca la moneda y dale a "Recibir" para copiar tu dirección.\n` +
        `4️⃣ Para enviar (pagar en el bot), toca "Enviar", pega la dirección que te daré al recargar y pon la cantidad exacta.\n\n` +
        `⚠️ *IMPORTANTE:* Solo aceptamos red **BEP20**. Si usas otra red, los fondos se perderán.\n\n` +
        `¿Quieres comprar USDT para tu cuenta de SafePal?`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🛍️ Comprar USDT a mi Wallet', callback_data: 'buy_ext_usdt_init' }],
            [{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]
        ]
    };
    
    await bot.editMessageText(guideMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

async function handleLinkPhone(chatId, messageId) {
    const user = await getUser(chatId);
    
    let message = `📱 *Vincular Teléfono*\n\n`;
    
    if (user.phone_number) {
        message += `✅ *Teléfono actual:* +53 ${user.phone_number}\n\n`;
        message += `Para cambiar tu número, ingresa el nuevo número de teléfono (ejemplo: 5351234567):`;
        
        activeSessions[chatId] = { 
            step: 'waiting_phone_change',
            oldPhone: user.phone_number 
        };
    } else {
        message += `Para que detectemos automáticamente tus pagos, vincula tu número de teléfono de Cuba.\n\n`;
        message += `Ingresa tu número (ejemplo: 5351234567):`;
        
        activeSessions[chatId] = { step: 'waiting_phone' };
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: linkPhoneKeyboard
    });
}

async function handleEnterPhone(chatId, messageId) {
    const message = `📱 *Ingresa tu número de teléfono*\n\n` +
        `Por favor, escribe tu número de teléfono cubano:\n\n` +
        `*Formato:* 5XXXXXXXX\n` +
        `*Ejemplo:* 5351234567\n\n` +
        `⚠️ *IMPORTANTE:* Este debe ser el mismo número que usas en Transfermóvil.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
    
    // No necesitamos editar el teclado aquí, ya está en el estado
}

async function handleClaimPayment(chatId, messageId) {
    const message = `🎁 *Reclamar Pago (Tarjeta→Monedero)*\n\n` +
        `Si hiciste un pago de *Tarjeta → Monedero*:\n\n` +
        `1. Busca el ID de transacción en el mensaje de Transfermóvil\n` +
        `2. Ejemplo: "Id Transaccion: TMW162915233"\n` +
        `3. Usa la opción "🔍 Buscar por ID"\n\n` +
        `O si prefieres ver todos tus pagos pendientes:\n` +
        `Usa "📋 Ver Pendientes"`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: claimPaymentKeyboard
    });
}

async function handleSearchPaymentId(chatId, messageId) {
    const message = `🔍 *Buscar Pago por ID*\n\n` +
        `Por favor, escribe el ID de la transacción que quieres reclamar:\n\n` +
        `*Ejemplo:* TMW162915233\n\n` +
        `Este ID aparece en el mensaje de Transfermóvil cuando haces un pago de Tarjeta→Monedero.`;
    
    activeSessions[chatId] = { step: 'search_payment_id' };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleViewPendingPayments(chatId, messageId) {
    const { data: pendingPayments } = await supabase
        .from('pending_sms_payments')
        .select('*')
        .eq('claimed', false)
        .order('created_at', { ascending: false });
    
    let message = `📋 *Pagos Pendientes por Reclamar*\n\n`;
    
    if (!pendingPayments || pendingPayments.length === 0) {
        message += `No tienes pagos pendientes por reclamar.\n\n`;
        message += `Los pagos de Tarjeta→Monedero aparecerán aquí después de que los hagas.`;
    } else {
        pendingPayments.forEach((payment, index) => {
            message += `${index + 1}. ${formatCurrency(payment.amount, payment.currency)}\n`;
            message += `   🆔 ID: \`${payment.tx_id}\`\n`;
            message += `   📅 Fecha: ${new Date(payment.created_at).toLocaleDateString()}\n\n`;
        });
        
        message += `Para reclamar un pago, usa la opción "🔍 Buscar por ID" e ingresa el ID correspondiente.`;
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('claim_payment')
    });
}

async function handleRechargeMenu(chatId, messageId) {
    const message = `🚀 *Recargar Saldo Interno*\n\n` +
        `Selecciona el método de pago:\n\n` +
        `💡 *Consejo:* Vincula tu teléfono primero para pagos automáticos.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: rechargeMethodsKeyboard
    });
}

async function handleDepositInit(chatId, messageId, currency) {
    let instrucciones = '';
    let minimo = MIN_CUP;
    let maximo = MAX_CUP;
    let metodoPago = '';
    
    if (currency === 'cup') {
        minimo = MIN_CUP;
        maximo = MAX_CUP;
        metodoPago = 'Tarjeta';
        instrucciones = `💳 *Pagar a Tarjeta:* \`${PAGO_CUP_TARJETA}\`\n📱 *# a confirmar:* \`${PAGO_SALDO_MOVIL}\``;
    } else if (currency === 'saldo') {
        minimo = MIN_SALDO;
        maximo = 10000;
        metodoPago = 'Saldo Móvil';
        instrucciones = `📱 *Pagar a Saldo Móvil:* \`${PAGO_SALDO_MOVIL}\``;
    } else if (currency === 'usdt') {
        minimo = MIN_USDT;
        maximo = 1000;
        metodoPago = 'USDT BEP20';
        instrucciones = `🪙 *Dirección USDT (BEP20):* \`${process.env.PAGO_USDT_ADDRESS}\`\n⚠️ *Usa solo SafePal BEP20*`;
    }
    
    activeSessions[chatId] = { 
        step: 'waiting_deposit_amount', 
        currency: currency,
        metodoPago: metodoPago
    };
    
    const message = `💰 *Recargar ${currency.toUpperCase()}*\n\n` +
        `*Método:* ${metodoPago}\n` +
        `*Límites:* ${formatCurrency(minimo, currency)} - ${formatCurrency(maximo, currency)}\n\n` +
        `🎁 *Beneficio primer depósito:* ${currency === 'usdt' ? '5%' : '10%'}\n\n` +
        `${instrucciones}\n\n` +
        `Por favor, escribe el monto que deseas depositar:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('recharge_menu')
    });
}

async function handleHistory(chatId, messageId) {
    const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', chatId)
        .order('created_at', { ascending: false })
        .limit(10);
    
    let message = `📜 *Historial de Transacciones*\n\n`;
    
    if (!transactions || transactions.length === 0) {
        message += `No tienes transacciones registradas.\n`;
        message += `Tus depósitos y compras aparecerán aquí.`;
    } else {
        transactions.forEach((tx, index) => {
            let icon = '🔸';
            if (tx.status === 'completed') icon = '✅';
            else if (tx.status === 'pending') icon = '⏳';
            else if (tx.status === 'rejected') icon = '❌';
            
            const fecha = new Date(tx.created_at).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            
            message += `${icon} *${tx.type}* - ${formatCurrency(tx.amount || tx.amount_requested, tx.currency)}\n`;
            message += `   📅 ${fecha} | Estado: ${tx.status}\n`;
            if (tx.tx_id) message += `   🆔 ID: \`${tx.tx_id}\`\n`;
            message += `\n`;
        });
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: historyBackKeyboard
    });
}

async function handleViewPending(chatId, messageId) {
    const user = await getUser(chatId);
    
    if (!user) return;
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = MIN_CUP - pendiente;
    const bono = user.first_dep_cup ? pendiente * 0.10 : 0;
    const totalConBono = pendiente + bono;
    
    let message = `📊 *Detalle Saldo Pendiente CUP*\n\n`;
    
    if (pendiente > 0) {
        message += `💰 *Acumulado:* ${formatCurrency(pendiente, 'cup')}\n`;
        
        if (user.first_dep_cup) {
            message += `🎁 *Bono disponible:* ${formatCurrency(bono, 'cup')} (10%)\n`;
            message += `💵 *Total con bono:* ${formatCurrency(totalConBono, 'cup')}\n`;
        }
        
        message += `\n📱 *Teléfono vinculado:* ${user.phone_number ? `+53 ${user.phone_number}` : '❌ No vinculado'}\n\n`;
        message += `*Límites:*\n`;
        message += `✅ Mínimo requerido: ${formatCurrency(MIN_CUP, 'cup')}\n`;
        
        if (faltante > 0) {
            message += `❌ Faltan: ${formatCurrency(faltante, 'cup')}\n\n`;
            message += `Realiza otro depósito de ${formatCurrency(faltante, 'cup')} o más para completar el mínimo.`;
        } else {
            message += `✅ ¡Ya superaste el mínimo!\n\n`;
            message += `El saldo se acreditará automáticamente en los próximos minutos.`;
        }
    } else {
        message += `No tienes saldo pendiente acumulado.\n\n`;
        message += `Los depósitos menores a ${formatCurrency(MIN_CUP, 'cup')} se acumularán aquí.`;
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('wallet')
    });
}

async function handleBuySelect(chatId, messageId, productId) {
    const products = {
        '1': { name: '100 Diamantes', price_cup: 250 },
        '2': { name: '300 Diamantes', price_cup: 700 },
        '3': { name: '500 Diamantes', price_cup: 1100 },
        '4': { name: '1000 Diamantes', price_cup: 2100 }
    };
    
    const product = products[productId];
    
    if (!product) {
        await bot.editMessageText('❌ Producto no encontrado.', {
            chat_id: chatId,
            message_id: messageId
        });
        return;
    }
    
    const price_saldo = product.price_cup * 0.95;
    const price_usdt = product.price_cup / USDT_RATE_CUP;
    
    const message = `💎 *${product.name}*\n\n` +
        `Precios:\n` +
        `💳 CUP: ${formatCurrency(product.price_cup, 'cup')}\n` +
        `📱 Saldo: ${formatCurrency(price_saldo, 'saldo')}\n` +
        `🪙 USDT: ${formatCurrency(price_usdt, 'usdt')}\n\n` +
        `Selecciona tu método de pago:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: paymentCurrencyKeyboard(productId)
    });
}

async function handlePayNow(chatId, messageId, productId, currency) {
    const products = {
        '1': { name: '100 Diamantes', price_cup: 250, api_prod_id: 'mlbb-100', api_var_id: 'var-100' },
        '2': { name: '300 Diamantes', price_cup: 700, api_prod_id: 'mlbb-300', api_var_id: 'var-300' },
        '3': { name: '500 Diamantes', price_cup: 1100, api_prod_id: 'mlbb-500', api_var_id: 'var-500' },
        '4': { name: '1000 Diamantes', price_cup: 2100, api_prod_id: 'mlbb-1000', api_var_id: 'var-1000' }
    };
    
    const product = products[productId];
    const user = await getUser(chatId);
    
    if (!product || !user) {
        await bot.editMessageText('❌ Error al procesar la compra.', {
            chat_id: chatId,
            message_id: messageId
        });
        return;
    }
    
    let cost = 0;
    if (currency === 'cup') cost = product.price_cup;
    else if (currency === 'saldo') cost = product.price_cup * 0.95;
    else if (currency === 'usdt') cost = product.price_cup / USDT_RATE_CUP;
    
    // Verificar saldo suficiente
    if (user[`balance_${currency}`] < cost) {
        const falta = cost - user[`balance_${currency}`];
        const message = `❌ *Saldo insuficiente*\n\n` +
            `Necesitas ${formatCurrency(cost, currency)} pero tienes ${formatCurrency(user[`balance_${currency}`], currency)}.\n\n` +
            `💡 Te faltan ${formatCurrency(falta, currency)}.\n\n` +
            `Recarga tu saldo y vuelve a intentarlo.`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: backKeyboard(`buy_select:${productId}`)
        });
        return;
    }
    
    activeSessions[chatId] = { 
        step: 'ask_player_id', 
        product: product, 
        currency: currency, 
        cost: cost,
        messageId: messageId
    };
    
    const message = `🎮 *Información de Recarga*\n\n` +
        `Producto: ${product.name}\n` +
        `Método: ${currency.toUpperCase()}\n` +
        `Costo: ${formatCurrency(cost, currency)}\n\n` +
        `Por favor, escribe tu **ID de Jugador** de MLBB:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleBuyExtUsdtInit(chatId, messageId) {
    const user = await getUser(chatId);
    
    let message = `🛍️ *Comprar USDT para tu Wallet*\n\n`;
    
    if (user.personal_usdt_address) {
        message += `✅ *Wallet guardada:* \`${user.personal_usdt_address.substring(0, 20)}...\`\n\n`;
        message += `Para cambiar tu dirección, escribe la nueva dirección USDT BEP20:`;
        
        activeSessions[chatId] = { step: 'waiting_personal_wallet_update' };
    } else {
        message += `Para enviarte USDT a tu wallet personal, necesitamos tu dirección USDT BEP20.\n\n`;
        message += `Por favor, escribe tu dirección USDT BEP20 de SafePal:`;
        
        activeSessions[chatId] = { step: 'waiting_personal_wallet' };
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleBuyExtPay(chatId, messageId) {
    const session = activeSessions[chatId];
    
    if (!session || !session.amount_usdt) {
        await bot.editMessageText('❌ Error: No se encontró información de la compra.', {
            chat_id: chatId,
            message_id: messageId
        });
        return;
    }
    
    const costo_cup = session.amount_usdt * USDT_RATE_CUP;
    const costo_saldo = session.amount_usdt * USDT_RATE_SALDO;
    
    const message = `💰 *Método de Pago para USDT*\n\n` +
        `Cantidad: ${formatCurrency(session.amount_usdt, 'usdt')}\n\n` +
        `💵 *Tasas de cambio:*\n` +
        `• CUP: 1 USDT = $${USDT_RATE_CUP} CUP\n` +
        `• Saldo: 1 USDT = $${USDT_RATE_SALDO}\n\n` +
        `Selecciona cómo deseas pagar:`;
    
    const keyboard = {
        inline_keyboard: [
            [
                { 
                    text: `💳 Pagar en CUP (${formatCurrency(costo_cup, 'cup')})`, 
                    callback_data: `buy_ext_final:cup` 
                }
            ],
            [
                { 
                    text: `📱 Pagar en Saldo (${formatCurrency(costo_saldo, 'saldo')})`, 
                    callback_data: `buy_ext_final:saldo` 
                }
            ],
            [{ text: '🔙 Volver', callback_data: 'usdt_guide' }]
        ]
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

async function handleBuyExtFinal(chatId, messageId, currency) {
    const session = activeSessions[chatId];
    
    if (!session || !session.amount_usdt) {
        await bot.editMessageText('❌ Error: No se encontró información de la compra.', {
            chat_id: chatId,
            message_id: messageId
        });
        return;
    }
    
    const total = session.amount_usdt * (currency === 'cup' ? USDT_RATE_CUP : USDT_RATE_SALDO);
    session.currency = currency;
    session.total = total;
    session.step = 'waiting_proof_ext';
    
    let instrucciones = '';
    if (currency === 'cup') {
        instrucciones = `💳 *Pagar a Tarjeta:* \`${PAGO_CUP_TARJETA}\`\n📱 *# a confirmar:* \`${PAGO_SALDO_MOVIL}\``;
    } else {
        instrucciones = `📱 *Pagar a Saldo Móvil:* \`${PAGO_SALDO_MOVIL}\``;
    }
    
    const message = `✅ *Orden de Compra USDT*\n\n` +
        `Cantidad: ${formatCurrency(session.amount_usdt, 'usdt')}\n` +
        `Método: ${currency.toUpperCase()}\n` +
        `Total a pagar: ${formatCurrency(total, currency)}\n\n` +
        `${instrucciones}\n\n` +
        `⚠️ *IMPORTANTE:*\n` +
        `1. Realiza el pago exacto\n` +
        `2. Toma una captura del comprobante\n` +
        `3. Envía la captura aquí`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleAdminApprove(chatId, messageId, transactionId) {
    if (chatId.toString() !== ADMIN_CHAT_ID.toString()) {
        return;
    }
    
    const { data: tx } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .single();
    
    if (!tx) {
        await bot.editMessageCaption(`❌ Transacción no encontrada.`, {
            chat_id: chatId,
            message_id: messageId
        });
        return;
    }
    
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', tx.user_id)
        .single();
    
    if (tx.type === 'EXTERNAL_USDT') {
        // Compra de USDT externo
        await bot.sendMessage(tx.user_id, 
            `✅ *Compra de USDT Aprobada*\n\n` +
            `Tu pedido de ${formatCurrency(tx.amount_requested, 'usdt')} está siendo procesado.\n` +
            `El USDT será enviado a tu wallet en las próximas horas.\n\n` +
            `📋 ID de orden: ${tx.id}`
        , { parse_mode: 'Markdown' });
    } else {
        // Depósito normal
        const montoConBono = await aplicarBonoPrimerDeposito(tx.user_id, tx.currency, tx.amount_requested);
        const nuevoSaldo = (user[`balance_${tx.currency}`] || 0) + montoConBono;
        
        await supabase
            .from('users')
            .update({ [`balance_${tx.currency}`]: nuevoSaldo })
            .eq('telegram_id', tx.user_id);
        
        const bonoMensaje = montoConBono > tx.amount_requested ? 
            `\n🎉 *¡Bono aplicado!* +${formatCurrency(montoConBono - tx.amount_requested, tx.currency)}` : '';
        
        await bot.sendMessage(tx.user_id,
            `✨ *¡Depósito Aprobado!*\n\n` +
            `Monto: ${formatCurrency(tx.amount_requested, tx.currency)}\n` +
            `${bonoMensaje}\n` +
            `Total acreditado: *${formatCurrency(montoConBono, tx.currency)}*\n\n` +
            `Nuevo saldo ${tx.currency.toUpperCase()}: *${formatCurrency(nuevoSaldo, tx.currency)}*\n\n` +
            `¡Ya puedes usar tu saldo!`
        , { parse_mode: 'Markdown' });
    }
    
    await supabase
        .from('transactions')
        .update({ status: 'completed' })
        .eq('id', transactionId);
    
    await bot.editMessageCaption(`✅ *APROBADO* por administrador.`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleAdminReject(chatId, messageId, transactionId) {
    if (chatId.toString() !== ADMIN_CHAT_ID.toString()) {
        return;
    }
    
    activeSessions[chatId] = { 
        step: 'adm_reason', 
        txId: transactionId, 
        msgId: messageId 
    };
    
    await bot.sendMessage(chatId, "❌ *Motivo del rechazo:*\n\nPor favor, escribe el motivo por el cual rechazas esta transacción:", {
        parse_mode: 'Markdown'
    });
}

// --- Manejo de Mensajes de Texto ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const session = activeSessions[chatId];
    
    if (!text || msg.text?.startsWith('/')) return;
    
    try {
        if (session) {
            switch (session.step) {
                case 'waiting_phone':
                case 'waiting_phone_change':
                    await handlePhoneInput(chatId, text, session);
                    break;
                    
                case 'search_payment_id':
                    await handleSearchPaymentIdInput(chatId, text);
                    break;
                    
                case 'waiting_deposit_amount':
                    await handleDepositAmountInput(chatId, text, session);
                    break;
                    
                case 'ask_player_id':
                    await handlePlayerIdInput(chatId, text, session);
                    break;
                    
                case 'ask_zone_id':
                    await handleZoneIdInput(chatId, text, session);
                    break;
                    
                case 'waiting_personal_wallet':
                case 'waiting_personal_wallet_update':
                    await handlePersonalWalletInput(chatId, text, session);
                    break;
                    
                case 'waiting_ext_amount':
                    await handleExtAmountInput(chatId, text, session);
                    break;
                    
                case 'waiting_proof':
                case 'waiting_proof_ext':
                    if (msg.photo) {
                        await handleProofPhoto(chatId, msg, session);
                    }
                    break;
                    
                case 'adm_reason':
                    await handleAdminReasonInput(chatId, text, session);
                    break;
                    
                default:
                    console.log(`Paso no manejado: ${session.step}`);
            }
        }
    } catch (error) {
        console.error('Error procesando mensaje:', error);
        await bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.');
    }
});

async function handlePhoneInput(chatId, phone, session) {
    // Validar formato de teléfono
    const phoneRegex = /^5\d{7,9}$/;
    if (!phoneRegex.test(phone)) {
        await bot.sendMessage(chatId,
            `❌ *Formato incorrecto*\n\n` +
            `Por favor, usa el formato: 5XXXXXXXX\n` +
            `Ejemplo: 5351234567\n\n` +
            `Intenta de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Verificar si el teléfono ya está en uso por otro usuario
    const { data: existingUser } = await supabase
        .from('users')
        .select('telegram_id, first_name')
        .eq('phone_number', phone)
        .neq('telegram_id', chatId)
        .single();
    
    if (existingUser) {
        await bot.sendMessage(chatId,
            `❌ *Teléfono ya en uso*\n\n` +
            `Este número ya está vinculado a otra cuenta:\n` +
            `👤 Usuario: ${existingUser.first_name}\n\n` +
            `Si este es tu número, contacta al administrador.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
        delete activeSessions[chatId];
        return;
    }
    
    // Guardar teléfono
    await updateUser(chatId, { phone_number: phone });
    
    let message = '';
    if (session.step === 'waiting_phone_change' && session.oldPhone) {
        message = `✅ *Teléfono actualizado*\n\n` +
            `📱 *Anterior:* +53 ${session.oldPhone}\n` +
            `📱 *Nuevo:* +53 ${phone}\n\n` +
            `Ahora tus pagos se detectarán con este nuevo número.`;
    } else {
        message = `✅ *¡Teléfono vinculado exitosamente!*\n\n` +
            `📱 *Número:* +53 ${phone}\n\n` +
            `Ahora tus pagos de Transfermóvil se detectarán automáticamente cuando:\n` +
            `✅ Envíes de Tarjeta→Tarjeta\n` +
            `✅ Envíes de Monedero→Tarjeta\n` +
            `✅ Envíes de Monedero→Monedero\n\n` +
            `⚠️ *Para pagos Tarjeta→Monedero:*\n` +
            `Usa el botón '🎁 Reclamar Pago'\n\n` +
            `💡 *Recuerda:* Siempre usa este número en Transfermóvil.`;
    }
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
    });
    
    delete activeSessions[chatId];
}

async function handleSearchPaymentIdInput(chatId, txId) {
    const txIdClean = txId.trim().toUpperCase();
    
    // Buscar pago pendiente
    const { data: pendingPayment } = await supabase
        .from('pending_sms_payments')
        .select('*')
        .eq('tx_id', txIdClean)
        .eq('claimed', false)
        .single();
    
    if (!pendingPayment) {
        await bot.sendMessage(chatId,
            `❌ *ID no encontrado*\n\n` +
            `No encontramos un pago pendiente con el ID: \`${txIdClean}\`\n\n` +
            `Verifica:\n` +
            `1. Que el ID sea correcto\n` +
            `2. Que el pago sea de *Tarjeta→Monedero*\n` +
            `3. Que no haya sido reclamado antes\n\n` +
            `Intenta de nuevo o contacta al administrador.`,
            { parse_mode: 'Markdown', reply_markup: claimPaymentKeyboard }
        );
        return;
    }
    
    // Verificar si hay orden pendiente
    const { data: pendingTx } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .eq('currency', pendingPayment.currency)
        .eq('type', 'DEPOSIT')
        .order('created_at', { ascending: false })
        .limit(1);
    
    if (!pendingTx || pendingTx.length === 0) {
        await bot.sendMessage(chatId,
            `❌ *No tienes orden pendiente*\n\n` +
            `Encontramos un pago de ${formatCurrency(pendingPayment.amount, pendingPayment.currency)}\n` +
            `🆔 ID: \`${txIdClean}\`\n\n` +
            `Pero no tienes una solicitud de depósito pendiente.\n\n` +
            `Para reclamar este pago:\n` +
            `1. Ve a "👛 Mi Billetera / Saldo"\n` +
            `2. Selecciona "➕ Recargar Saldo Interno"\n` +
            `3. Elige ${pendingPayment.currency.toUpperCase()}\n` +
            `4. Solicita el monto exacto: ${formatCurrency(pendingPayment.amount, pendingPayment.currency)}\n` +
            `5. Luego busca este ID de nuevo`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
        return;
    }
    
    const orden = pendingTx[0];
    const montoSolicitado = orden.amount_requested;
    
    // Verificar que el monto coincida (con margen del 10%)
    const margen = montoSolicitado * 0.1;
    if (Math.abs(pendingPayment.amount - montoSolicitado) > margen) {
        await bot.sendMessage(chatId,
            `⚠️ *Monto no coincide*\n\n` +
            `📋 Solicitaste: ${formatCurrency(montoSolicitado, pendingPayment.currency)}\n` +
            `💰 Pago pendiente: ${formatCurrency(pendingPayment.amount, pendingPayment.currency)}\n\n` +
            `Crea una nueva solicitud por el monto correcto.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
        return;
    }
    
    // Procesar el pago
    const result = await procesarPagoAutomatico(chatId, pendingPayment.amount, pendingPayment.currency, txIdClean, "TARJETA_MONEDERO");
    
    if (result.success) {
        // Marcar como reclamado
        await supabase
            .from('pending_sms_payments')
            .update({ claimed: true, claimed_by: chatId })
            .eq('id', pendingPayment.id);
        
        // Actualizar la transacción original
        await supabase
            .from('transactions')
            .update({ 
                tx_id: txIdClean,
                tipo_pago: "TARJETA_MONEDERO"
            })
            .eq('id', orden.id);
    }
    
    delete activeSessions[chatId];
}

async function handleDepositAmountInput(chatId, amountText, session) {
    const amount = parseFloat(amountText);
    const currency = session.currency;
    
    // Definir límites
    const limites = { 
        cup: [MIN_CUP, MAX_CUP], 
        saldo: [MIN_SALDO, 10000], 
        usdt: [MIN_USDT, 1000] 
    };
    
    if (isNaN(amount) || amount < limites[currency][0] || amount > limites[currency][1]) {
        await bot.sendMessage(chatId, 
            `❌ *Monto fuera de límites*\n\n` +
            `El monto debe estar entre ${formatCurrency(limites[currency][0], currency)} y ${formatCurrency(limites[currency][1], currency)}.\n\n` +
            `Por favor, escribe un monto válido:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const user = await getUser(chatId);
    
    // Crear transacción pendiente
    const { data: tx } = await supabase.from('transactions').insert([{
        user_id: chatId,
        user_name: user.first_name,
        user_username: user.username,
        user_phone: user.phone_number,
        type: 'DEPOSIT',
        currency: currency,
        amount_requested: amount,
        status: 'pending'
    }]).select().single();
    
    session.txId = tx.id;
    session.amount = amount;
    session.step = 'waiting_proof';
    
    let instrucciones = '';
    if (currency === 'cup') {
        instrucciones = `💳 *Pagar a Tarjeta:* \`${PAGO_CUP_TARJETA}\`\n📱 *# a confirmar:* \`${PAGO_SALDO_MOVIL}\``;
    } else if (currency === 'saldo') {
        instrucciones = `📱 *Pagar a Saldo Móvil:* \`${PAGO_SALDO_MOVIL}\``;
    } else if (currency === 'usdt') {
        instrucciones = `🪙 *Dirección USDT (BEP20):* \`${process.env.PAGO_USDT_ADDRESS}\`\n⚠️ *Usa solo SafePal BEP20*`;
    }
    
    const message = `✅ *Orden creada #${tx.id}*\n\n` +
        `💰 Monto: ${formatCurrency(amount, currency)}\n` +
        `🔧 Método: ${session.metodoPago}\n\n` +
        `${instrucciones}\n\n` +
        `📞 *Teléfono vinculado:* ${user.phone_number ? `+53 ${user.phone_number}` : '❌ No vinculado'}\n\n` +
        `⚠️ *IMPORTANTE:*\n` +
        `• Usa el mismo número vinculado\n` +
        `• Los pagos se detectan automáticamente\n` +
        `• Para Tarjeta→Monedero, usa "🎁 Reclamar Pago"\n\n` +
        `🎁 *Beneficio primer depósito:* ${currency === 'usdt' ? '5%' : '10%'}\n\n` +
        `📸 *Envía una captura del comprobante de pago:*`;
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
    });
    
    // Notificar al admin - TICKET DE SOLICITUD
    const metodoPago = currency === 'cup' ? 'Tarjeta' : currency === 'saldo' ? 'Saldo Móvil' : 'USDT';
    const bonoPorcentaje = currency === 'usdt' ? '5%' : '10%';
    const bonoMonto = amount * (currency === 'usdt' ? 0.05 : 0.10);
    const totalConBono = amount + bonoMonto;
    
    const adminMessage = `📋 *SOLICITUD DE DEPÓSITO #${tx.id}*\n\n` +
        `👤 *Usuario:* ${user.first_name} (@${user.username || 'sin usuario'})\n` +
        `📞 *Teléfono:* ${user.phone_number || 'No vinculado'}\n` +
        `💰 *Monto:* ${formatCurrency(amount, currency)}\n` +
        `💳 *Método:* ${metodoPago}\n\n` +
        `📍 *Instrucciones para el cliente:*\n` +
        `${instrucciones.split('\n').join('\n📍 ')}\n\n` +
        `🎁 *Beneficio primer depósito:*\n` +
        `• Porcentaje: ${bonoPorcentaje}\n` +
        `• Bono: ${formatCurrency(bonoMonto, currency)}\n` +
        `• Total a acreditar: ${formatCurrency(totalConBono, currency)}\n\n` +
        `📊 *Límites:*\n` +
        `• Mínimo: ${formatCurrency(limites[currency][0], currency)}\n` +
        `• Máximo: ${formatCurrency(limites[currency][1], currency)}\n\n` +
        `⏰ *Esperando pago...*\n` +
        `🆔 ID Transacción: \`${tx.id}\``;
    
    await bot.sendMessage(ADMIN_CHAT_ID, adminMessage, {
        parse_mode: 'Markdown'
    });
    
    delete activeSessions[chatId];
}

async function handlePlayerIdInput(chatId, playerId, session) {
    session.player_id = playerId;
    session.step = 'ask_zone_id';
    
    await bot.sendMessage(chatId,
        `✅ *ID de Jugador guardado:* ${playerId}\n\n` +
        `Ahora escribe tu **Zone ID**:`,
        { parse_mode: 'Markdown' }
    );
}

async function handleZoneIdInput(chatId, zoneId, session) {
    const user = await getUser(chatId);
    
    // Verificar saldo nuevamente
    if (user[`balance_${session.currency}`] < session.cost) {
        await bot.sendMessage(chatId,
            `❌ *Saldo insuficiente*\n\n` +
            `Necesitas ${formatCurrency(session.cost, session.currency)} pero tienes ${formatCurrency(user[`balance_${session.currency}`], session.currency)}.\n\n` +
            `Recarga tu saldo y vuelve a intentarlo.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
        delete activeSessions[chatId];
        return;
    }
    
    await bot.sendMessage(chatId, `🎮 *Procesando recarga...*\n\nID Jugador: ${session.player_id}\nZone ID: ${zoneId}\n\n⏳ Por favor, espera...`, {
        parse_mode: 'Markdown'
    });
    
    try {
        // Aquí iría la llamada a la API de recarga
        // Por ahora simulamos una respuesta exitosa
        const recargaExitosa = true;
        
        if (recargaExitosa) {
            // Descontar saldo
            const nuevoSaldo = user[`balance_${session.currency}`] - session.cost;
            await updateUser(chatId, { [`balance_${session.currency}`]: nuevoSaldo });
            
            // Crear transacción
            await supabase.from('transactions').insert({
                user_id: chatId,
                type: 'PURCHASE',
                currency: session.currency,
                amount: session.cost,
                status: 'completed',
                product_name: session.product.name,
                player_id: session.player_id,
                zone_id: zoneId
            });
            
            const orderId = `ORD${Date.now()}`;
            
            await bot.sendMessage(chatId,
                `✅ *¡Recarga Exitosa!*\n\n` +
                `💎 Producto: ${session.product.name}\n` +
                `💰 Costo: ${formatCurrency(session.cost, session.currency)}\n` +
                `🎮 ID Jugador: ${session.player_id}\n` +
                `📍 Zone ID: ${zoneId}\n` +
                `🆔 Orden: \`${orderId}\`\n\n` +
                `📊 Nuevo saldo ${session.currency.toUpperCase()}: ${formatCurrency(nuevoSaldo, session.currency)}\n\n` +
                `¡Disfruta tus diamantes!`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
            
            // Notificar al admin
            await bot.sendMessage(ADMIN_CHAT_ID,
                `✅ *RECARGA PROCESADA*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                `💎 Producto: ${session.product.name}\n` +
                `💰 Costo: ${formatCurrency(session.cost, session.currency)}\n` +
                `🎮 ID Jugador: ${session.player_id}\n` +
                `📍 Zone ID: ${zoneId}\n` +
                `🆔 Orden: ${orderId}`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await bot.sendMessage(chatId,
                `❌ *Error en la recarga*\n\n` +
                `Hubo un problema al procesar tu recarga.\n` +
                `Por favor, contacta al administrador.`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
        }
    } catch (error) {
        console.error('Error en recarga:', error);
        await bot.sendMessage(chatId,
            `❌ *Error en la recarga*\n\n` +
            `Hubo un problema al procesar tu recarga.\n` +
            `Error: ${error.message}\n\n` +
            `Por favor, contacta al administrador.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
    }
    
    delete activeSessions[chatId];
}

async function handlePersonalWalletInput(chatId, walletAddress, session) {
    // Validar dirección de wallet (formato básico de dirección Ethereum)
    if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
        await bot.sendMessage(chatId,
            `❌ *Dirección inválida*\n\n` +
            `Por favor, ingresa una dirección USDT BEP20 válida.\n` +
            `Debe comenzar con "0x" y tener 42 caracteres.\n\n` +
            `Intenta de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    await updateUser(chatId, { personal_usdt_address: walletAddress });
    
    const message = session.step === 'waiting_personal_wallet_update' ?
        `✅ *Wallet actualizada*\n\n` +
        `Nueva dirección: \`${walletAddress.substring(0, 20)}...\`\n\n` +
        `Ahora puedes comprar USDT para esta wallet.` :
        `✅ *Wallet guardada*\n\n` +
        `Dirección: \`${walletAddress.substring(0, 20)}...\`\n\n` +
        `Ahora escribe cuántos USDT deseas comprar:\n` +
        `(Mínimo: ${MIN_USDT} - Máximo: 100)`;
    
    if (session.step === 'waiting_personal_wallet_update') {
        activeSessions[chatId] = { step: 'waiting_ext_amount' };
    } else {
        activeSessions[chatId] = { step: 'waiting_ext_amount' };
    }
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
    });
}

async function handleExtAmountInput(chatId, amountText, session) {
    const amount = parseFloat(amountText);
    
    if (isNaN(amount) || amount < MIN_USDT || amount > 100) {
        await bot.sendMessage(chatId,
            `❌ *Cantidad inválida*\n\n` +
            `La cantidad debe estar entre ${MIN_USDT} y 100 USDT.\n\n` +
            `Intenta de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    session.amount_usdt = amount;
    session.step = 'ready_to_pay_ext';
    
    const costo_cup = amount * USDT_RATE_CUP;
    const costo_saldo = amount * USDT_RATE_SALDO;
    
    const message = `✅ *Cantidad establecida*\n\n` +
        `Cantidad: ${formatCurrency(amount, 'usdt')}\n\n` +
        `💵 *Opciones de pago:*\n` +
        `• CUP: ${formatCurrency(costo_cup, 'cup')}\n` +
        `• Saldo: ${formatCurrency(costo_saldo, 'saldo')}\n\n` +
        `Selecciona cómo deseas pagar:`;
    
    const keyboard = {
        inline_keyboard: [
            [
                { 
                    text: `💳 Pagar en CUP (${formatCurrency(costo_cup, 'cup')})`, 
                    callback_data: `buy_ext_final:cup` 
                }
            ],
            [
                { 
                    text: `📱 Pagar en Saldo (${formatCurrency(costo_saldo, 'saldo')})`, 
                    callback_data: `buy_ext_final:saldo` 
                }
            ]
        ]
    };
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

async function handleProofPhoto(chatId, msg, session) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileUrl = await bot.getFileLink(fileId);
    const type = session.step === 'waiting_proof_ext' ? 'EXTERNAL_USDT' : 'DEPOSIT';
    const user = await getUser(chatId);
    
    const { data: tx } = await supabase.from('transactions').insert([{
        user_id: chatId,
        type: type,
        currency: session.currency,
        amount_requested: session.amount || session.amount_usdt,
        status: 'pending',
        user_name: user.first_name,
        user_username: user.username,
        user_phone: user.phone_number
    }]).select().single();
    
    const caption = type === 'EXTERNAL_USDT' ?
        `🛍️ *SOLICITUD DE USDT EXTERNO #${tx.id}*\n\n` +
        `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
        `💰 Cantidad: ${formatCurrency(session.amount_usdt, 'usdt')}\n` +
        `💳 Método: ${session.currency.toUpperCase()}\n` +
        `📞 Teléfono: ${user.phone_number || 'No vinculado'}\n\n` +
        `Wallet destino: \`${user.personal_usdt_address}\`` :
        `📋 *COMPROBANTE DE PAGO #${tx.id}*\n\n` +
        `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
        `💰 Monto: ${formatCurrency(session.amount, session.currency)}\n` +
        `💳 Método: ${session.currency.toUpperCase()}\n` +
        `📞 Teléfono: ${user.phone_number || 'No vinculado'}`;
    
    const adminKeyboard = {
        inline_keyboard: [
            [
                { text: '✅ Aprobar', callback_data: `adm_approve:${tx.id}` },
                { text: '❌ Rechazar', callback_data: `adm_reject:${tx.id}` }
            ]
        ]
    };
    
    await bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
        caption: caption,
        parse_mode: 'Markdown',
        reply_markup: adminKeyboard
    });
    
    await bot.sendMessage(chatId,
        `✨ *¡Comprobante recibido!*\n\n` +
        `Tu solicitud #${tx.id} está en revisión.\n` +
        `⏳ Tiempo estimado: 1-10 minutos\n\n` +
        `Te notificaremos cuando sea procesada.`,
        { parse_mode: 'Markdown', reply_markup: mainKeyboard }
    );
    
    delete activeSessions[chatId];
}

async function handleAdminReasonInput(chatId, reason, session) {
    if (chatId.toString() !== ADMIN_CHAT_ID.toString()) {
        return;
    }
    
    const { data: tx } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', session.txId)
        .single();
    
    if (!tx) {
        await bot.sendMessage(chatId, '❌ Transacción no encontrada.');
        delete activeSessions[chatId];
        return;
    }
    
    // Actualizar transacción como rechazada
    await supabase
        .from('transactions')
        .update({ 
            status: 'rejected',
            admin_notes: reason
        })
        .eq('id', session.txId);
    
    // Notificar al usuario
    await bot.sendMessage(tx.user_id,
        `❌ *Solicitud rechazada*\n\n` +
        `Tu solicitud #${session.txId} ha sido rechazada.\n\n` +
        `📝 *Motivo:* ${reason}\n\n` +
        `Si crees que esto es un error, contacta al administrador.`,
        { parse_mode: 'Markdown' }
    );
    
    // Actualizar mensaje en el grupo admin
    await bot.editMessageCaption(`❌ *RECHAZADO*\n\nMotivo: ${reason}`, {
        chat_id: chatId,
        message_id: session.msgId,
        parse_mode: 'Markdown'
    });
    
    delete activeSessions[chatId];
}

// --- Keep Alive Endpoint ---
app.get('/keepalive', (req, res) => {
    res.json({ 
        status: 'alive', 
        timestamp: new Date().toISOString(),
        service: 'telegram-bot',
        uptime: process.uptime(),
        users: Object.keys(activeSessions).length
    });
});

// --- Endpoint para estadísticas ---
app.get('/stats', async (req, res) => {
    try {
        const { count: userCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
        
        const { count: txCount } = await supabase
            .from('transactions')
            .select('*', { count: 'exact', head: true });
        
        const { count: pendingCount } = await supabase
            .from('pending_sms_payments')
            .select('*', { count: 'exact', head: true })
            .eq('claimed', false);
        
        res.json({
            users: userCount,
            transactions: txCount,
            pending_payments: pendingCount,
            active_sessions: Object.keys(activeSessions).length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Schedule para verificar saldos pendientes cada 5 minutos ---
setInterval(async () => {
    try {
        // Buscar usuarios con saldo pendiente que supere el mínimo
        const { data: users } = await supabase
            .from('users')
            .select('*')
            .gte('pending_balance_cup', MIN_CUP);
        
        if (users && users.length > 0) {
            console.log(`📊 Procesando ${users.length} usuarios con saldo pendiente...`);
            
            for (const user of users) {
                const montoConBono = await aplicarBonoPrimerDeposito(user.telegram_id, 'cup', user.pending_balance_cup);
                const nuevoSaldo = (user.balance_cup || 0) + montoConBono;
                
                // Acreditar saldo
                await updateUser(user.telegram_id, { 
                    balance_cup: nuevoSaldo,
                    pending_balance_cup: 0 
                });
                
                // Crear transacción
                await supabase.from('transactions').insert({
                    user_id: user.telegram_id,
                    type: 'AUTO_ACCUMULATED',
                    currency: 'cup',
                    amount: montoConBono,
                    amount_requested: user.pending_balance_cup,
                    status: 'completed',
                    tx_id: `ACCUM_${Date.now()}`,
                    tipo_pago: 'ACUMULADO'
                });
                
                // Notificar al usuario
                const bonoMensaje = montoConBono > user.pending_balance_cup ? 
                    `\n🎉 *¡Bono aplicado!* +${formatCurrency(montoConBono - user.pending_balance_cup, 'cup')}` : '';
                
                await bot.sendMessage(user.telegram_id,
                    `🎉 *¡Saldo Pendiente Acreditado!*\n\n` +
                    `Se ha acumulado ${formatCurrency(user.pending_balance_cup, 'cup')}\n` +
                    `${bonoMensaje}\n` +
                    `💵 Total acreditado: *${formatCurrency(montoConBono, 'cup')}*\n\n` +
                    `📊 Nuevo saldo CUP: *${formatCurrency(nuevoSaldo, 'cup')}*\n\n` +
                    `✅ ¡Ya puedes usar tu saldo!`,
                    { parse_mode: 'Markdown' }
                );
                
                // Notificar al admin
                await bot.sendMessage(ADMIN_CHAT_ID,
                    `✅ *SALDO PENDIENTE ACREDITADO*\n\n` +
                    `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                    `💰 Acumulado: ${formatCurrency(user.pending_balance_cup, 'cup')}\n` +
                    `🎁 Total con bono: ${formatCurrency(montoConBono, 'cup')}\n` +
                    `📊 Nuevo saldo: ${formatCurrency(nuevoSaldo, 'cup')}`,
                    { parse_mode: 'Markdown' }
                );
                
                console.log(`✅ Saldo pendiente acreditado para ${user.telegram_id}`);
            }
        }
    } catch (error) {
        console.error('❌ Error en schedule de saldos pendientes:', error);
    }
}, 5 * 60 * 1000); // Cada 5 minutos

// --- Schedule para limpiar sesiones inactivas ---
setInterval(() => {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutos
    
    for (const [chatId, session] of Object.entries(activeSessions)) {
        if (session.lastActivity && (now - session.lastActivity) > timeout) {
            delete activeSessions[chatId];
            console.log(`🧹 Sesión limpiada para ${chatId}`);
        }
    }
}, 10 * 60 * 1000); // Cada 10 minutos

// --- Iniciar Servidor ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🤖 Bot Telegram escuchando en puerto ${PORT}`);
    console.log(`🌐 Webhook disponible en: http://localhost:${PORT}/payment-notification`);
    console.log(`📊 Estadísticas: http://localhost:${PORT}/stats`);
    console.log(`🔄 Keep alive: http://localhost:${PORT}/keepalive`);
    console.log(`💰 Mínimos: CUP=${MIN_CUP}, Saldo=${MIN_SALDO}, USDT=${MIN_USDT}`);
    console.log(`📞 Teléfono para pagos: ${PAGO_SALDO_MOVIL}`);
    console.log(`💳 Tarjeta para pagos: ${PAGO_CUP_TARJETA}`);
});

// --- Manejo de errores no capturados ---
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});
