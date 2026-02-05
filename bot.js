require('dotenv').config();

// ============================================
// DEPENDENCIAS
// ============================================
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bodyParser = require('body-parser');
const Web3 = require('web3');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// ============================================
// CONFIGURACIÓN DESDE .ENV
// ============================================

// Configuración básica
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DB_URL = process.env.DB_URL;
const DB_KEY = process.env.DB_KEY;
const WEBHOOK_SECRET_KEY = process.env.WEBHOOK_SECRET_KEY;

// Configuración de pagos
const MINIMO_CUP = parseFloat(process.env.MINIMO_CUP || 1000);
const MINIMO_SALDO = parseFloat(process.env.MINIMO_SALDO || 500);
const MINIMO_USDT = parseFloat(process.env.MINIMO_USDT || 10);
const MAXIMO_CUP = parseFloat(process.env.MAXIMO_CUP || 50000);

// Información de pagos
const PAGO_CUP_TARJETA = process.env.PAGO_CUP_TARJETA;
const PAGO_SALDO_MOVIL = process.env.PAGO_SALDO_MOVIL;
const PAGO_USDT_ADDRESS = process.env.PAGO_USDT_ADDRESS;
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || '';

// Configuración de administrador
const ADMIN_CHAT_ID = process.env.ADMIN_GROUP;

// Configuración de servidor
const PORT = process.env.PORT || 3000;
const WEB_PORT = process.env.WEB_PORT || 8080;

// Configuración de tokens
const CWS_PER_100_SALDO = 10;
const CWT_PER_10_USDT = 0.5;
const MIN_CWT_USE = 5;
const MIN_CWS_USE = 100;

// ============================================
// VALIDACIÓN DE VARIABLES
// ============================================

if (!TELEGRAM_TOKEN || !DB_URL || !DB_KEY) {
    console.error('❌ Faltan variables de entorno críticas. Verifica TELEGRAM_TOKEN, DB_URL, DB_KEY');
    process.exit(1);
}

if (!WEBHOOK_SECRET_KEY) {
    console.warn('⚠️ WEBHOOK_SECRET_KEY no está configurada. Esto es un riesgo de seguridad!');
}

// ============================================
// INICIALIZACIÓN
// ============================================

// Inicializar Express
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuración de sesiones para el dashboard web
app.use(session({
    secret: WEBHOOK_SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Inicializar bot de Telegram
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Inicializar Supabase
const supabase = createClient(DB_URL, DB_KEY);

// Inicializar Web3 para BSC
const web3 = new Web3(new Web3.providers.HttpProvider('https://bsc-dataseed.binance.org/'));

// Variables globales
const activeSessions = {};

// ============================================
// FUNCIONES AUXILIARES
// ============================================

// Middleware para verificar token de webhook
const verifyWebhookToken = (req, res, next) => {
    if (!WEBHOOK_SECRET_KEY) {
        console.log('⚠️ WEBHOOK_SECRET_KEY no configurada, aceptando todas las solicitudes');
        return next();
    }
    
    const authToken = req.headers['x-auth-token'] || req.body.auth_token;
    
    if (!authToken) {
        console.log('❌ Token de autenticación faltante');
        return res.status(401).json({ 
            success: false, 
            message: 'Token de autenticación requerido',
            required: true 
        });
    }
    
    if (authToken !== WEBHOOK_SECRET_KEY) {
        console.log('❌ Token de autenticación inválido');
        return res.status(403).json({ 
            success: false, 
            message: 'Token de autenticación inválido',
            required: true 
        });
    }
    
    next();
};

// Middleware para autenticación web
function requireAuth(req, res, next) {
    if (req.session.userId && req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'No autorizado' });
    }
}

// Formatear moneda
function formatCurrency(amount, currency) {
    const symbols = {
        'cup': 'CUP',
        'saldo': 'Saldo',
        'usdt': 'USDT',
        'cws': 'CWS',
        'cwt': 'CWT'
    };
    
    const symbol = symbols[currency] || currency.toUpperCase();
    return `$${parseFloat(amount).toFixed(2)} ${symbol}`;
}

// Obtener usuario por Telegram ID
async function getUser(telegramId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
    
    if (error) return null;
    return data;
}

// Actualizar usuario
async function updateUser(telegramId, updates) {
    const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('telegram_id', telegramId);
    
    return !error;
}

// Obtener usuario por teléfono
async function getUserByPhone(phone) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('phone_number', phone)
        .single();
    
    if (error) return null;
    return data;
}

// Verificar transacción BSC
async function checkBSCTransaction(txHash, expectedAmount, expectedTo) {
    try {
        if (!BSCSCAN_API_KEY) {
            return { success: false, error: 'BSCScan API key no configurada' };
        }
        
        const url = `https://api.bscscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${BSCSCAN_API_KEY}`;
        const response = await axios.get(url);
        
        if (response.data.status === '1') {
            const detailsUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${BSCSCAN_API_KEY}`;
            const details = await axios.get(detailsUrl);
            
            if (details.data.result) {
                const tx = details.data.result;
                if (tx.to && tx.to.toLowerCase() === expectedTo.toLowerCase()) {
                    const amount = parseFloat(web3.utils.fromWei(tx.value, 'ether'));
                    const diff = Math.abs(amount - expectedAmount);
                    const margin = expectedAmount * 0.01;
                    
                    if (diff <= margin) {
                        return { success: true, amount: amount, from: tx.from };
                    }
                }
            }
        }
        return { success: false };
    } catch (error) {
        console.error('Error verificando transacción BSC:', error);
        return { success: false, error: error.message };
    }
}

// Aplicar bono primer depósito
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
        await updateUser(userId, { [campoBono]: false });
    }

    return amount + bono;
}

// Calcular tokens
function calcularTokens(amount, currency) {
    switch (currency) {
        case 'saldo':
            return Math.floor(amount / 100) * CWS_PER_100_SALDO;
        case 'usdt':
            return (amount / 10) * CWT_PER_10_USDT;
        default:
            return 0;
    }
}

// Procesar pago automático
async function procesarPagoAutomatico(userId, amount, currency, txId, tipoPago) {
    try {
        console.log(`💰 Procesando pago automático: ${userId}, ${amount}, ${currency}, ${txId}, ${tipoPago}`);
        
        const user = await getUser(userId);
        if (!user) {
            console.log(`❌ Usuario ${userId} no encontrado`);
            return { success: false, message: 'Usuario no encontrado' };
        }

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
            if (currency === 'cup' && amount < MINIMO_CUP) {
                const nuevoPendiente = (user.pending_balance_cup || 0) + amount;
                await updateUser(userId, { pending_balance_cup: nuevoPendiente });

                const mensajeUsuario = `⚠️ *Depósito menor al mínimo*\n\n` +
                    `Recibimos ${formatCurrency(amount, currency)} pero el mínimo es ${formatCurrency(MINIMO_CUP, 'cup')}.\n` +
                    `Este monto se ha acumulado a tu saldo pendiente: *${formatCurrency(nuevoPendiente, 'cup')}*\n\n` +
                    `Cuando tus depósitos pendientes sumen ${formatCurrency(MINIMO_CUP, 'cup')} o más, se acreditarán automáticamente.\n\n` +
                    `💰 *Faltan:* ${formatCurrency(MINIMO_CUP - nuevoPendiente, 'cup')}`;
                
                await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
                
                return { success: false, message: 'Monto menor al mínimo, acumulado' };
            } else {
                return await procesarDepositoDirecto(userId, amount, currency, txId, tipoPago);
            }
        } else {
            return await procesarDepositoConOrden(userId, amount, currency, txId, tipoPago, pendingTx[0]);
        }
    } catch (error) {
        console.error('❌ Error procesando pago automático:', error);
        return { success: false, message: error.message };
    }
}

// Procesar depósito directo
async function procesarDepositoDirecto(userId, amount, currency, txId, tipoPago) {
    const user = await getUser(userId);
    if (!user) return { success: false, message: 'Usuario no encontrado' };

    const minimos = { cup: MINIMO_CUP, saldo: MINIMO_SALDO, usdt: MINIMO_USDT };
    if (amount < minimos[currency]) {
        const mensajeUsuario = `⚠️ *Depósito menor al mínimo*\n\n` +
            `Recibimos ${formatCurrency(amount, currency)} pero el mínimo es ${formatCurrency(minimos[currency], currency)}.\n` +
            `Este monto no se acreditará hasta que realices un depósito de ${formatCurrency(minimos[currency], currency)} o más.`;
        
        await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
        return { success: false, message: 'Monto menor al mínimo' };
    }

    const montoConBono = await aplicarBonoPrimerDeposito(userId, currency, amount);
    const tokensGanados = calcularTokens(amount, currency);
    
    const updates = {
        [`balance_${currency}`]: (user[`balance_${currency}`] || 0) + montoConBono
    };

    if (currency === 'saldo') {
        updates.tokens_cws = (user.tokens_cws || 0) + tokensGanados;
    } else if (currency === 'usdt') {
        updates.tokens_cwt = (user.tokens_cwt || 0) + tokensGanados;
    }

    await updateUser(userId, updates);

    await supabase.from('transactions').insert({
        user_id: userId,
        type: 'AUTO_DEPOSIT',
        currency: currency,
        amount: montoConBono,
        amount_requested: amount,
        tokens_generated: tokensGanados,
        status: 'completed',
        tx_id: txId,
        tipo_pago: tipoPago
    });

    const bonoMensaje = montoConBono > amount ? 
        `\n🎉 *¡Bono aplicado!* +${formatCurrency(montoConBono - amount, currency)}` : '';
    
    const tokensMensaje = tokensGanados > 0 ? 
        `\n🎫 *Tokens ganados:* +${tokensGanados} ${currency === 'saldo' ? 'CWS' : 'CWT'}` : '';

    const mensajeUsuario = `✅ *¡Depósito Acreditado Automáticamente!*\n\n` +
        `💰 Monto recibido: ${formatCurrency(amount, currency)}\n` +
        `${bonoMensaje}${tokensMensaje}\n` +
        `💵 Total acreditado: *${formatCurrency(montoConBono, currency)}*\n\n` +
        `📊 Nuevo saldo ${currency.toUpperCase()}: *${formatCurrency(updates[`balance_${currency}`], currency)}*\n` +
        `🆔 ID Transacción: \`${txId}\``;
    
    await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });

    if (ADMIN_CHAT_ID) {
        const mensajeAdmin = `✅ *DEPÓSITO AUTOMÁTICO*\n\n` +
            `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
            `📞 Teléfono: ${user.phone_number || 'No vinculado'}\n` +
            `💰 Monto: ${formatCurrency(amount, currency)}\n` +
            `🎁 Total con bono: ${formatCurrency(montoConBono, currency)}\n` +
            `🎫 Tokens: ${tokensGanados} ${currency === 'saldo' ? 'CWS' : 'CWT'}\n` +
            `🔧 Tipo: ${tipoPago}\n` +
            `🆔 ID: \`${txId}\``;
        
        await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
    }

    return { success: true, montoConBono, tokensGanados };
}

// Procesar depósito con orden
async function procesarDepositoConOrden(userId, amount, currency, txId, tipoPago, orden) {
    const user = await getUser(userId);
    if (!user) return { success: false, message: 'Usuario no encontrado' };

    const montoSolicitado = orden.amount_requested;
    const margen = montoSolicitado * 0.1;
    if (Math.abs(amount - montoSolicitado) > margen) {
        const mensajeUsuario = `⚠️ *Monto no coincide*\n\n` +
            `📋 Solicitaste: ${formatCurrency(montoSolicitado, currency)}\n` +
            `💰 Recibido: ${formatCurrency(amount, currency)}\n\n` +
            `Contacta al administrador para aclaración.`;
        
        await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
        return { success: false, message: 'Monto no coincide' };
    }

    const montoConBono = await aplicarBonoPrimerDeposito(userId, currency, amount);
    const tokensGanados = calcularTokens(amount, currency);
    
    const updates = {
        [`balance_${currency}`]: (user[`balance_${currency}`] || 0) + montoConBono
    };

    if (currency === 'saldo') {
        updates.tokens_cws = (user.tokens_cws || 0) + tokensGanados;
    } else if (currency === 'usdt') {
        updates.tokens_cwt = (user.tokens_cwt || 0) + tokensGanados;
    }

    await updateUser(userId, updates);

    await supabase
        .from('transactions')
        .update({ 
            status: 'completed',
            amount: montoConBono,
            tokens_generated: tokensGanados,
            tx_id: txId,
            tipo_pago: tipoPago
        })
        .eq('id', orden.id);

    const bonoMensaje = montoConBono > amount ? 
        `\n🎉 *¡Bono aplicado!* +${formatCurrency(montoConBono - amount, currency)}` : '';
    
    const tokensMensaje = tokensGanados > 0 ? 
        `\n🎫 *Tokens ganados:* +${tokensGanados} ${currency === 'saldo' ? 'CWS' : 'CWT'}` : '';

    const mensajeUsuario = `✨ *¡Depósito Completado!*\n\n` +
        `📋 Monto solicitado: ${formatCurrency(montoSolicitado, currency)}\n` +
        `💰 Monto recibido: ${formatCurrency(amount, currency)}\n` +
        `${bonoMensaje}${tokensMensaje}\n` +
        `💵 Total acreditado: *${formatCurrency(montoConBono, currency)}*\n\n` +
        `📊 Nuevo saldo ${currency.toUpperCase()}: *${formatCurrency(updates[`balance_${currency}`], currency)}*\n` +
        `🆔 ID Transacción: \`${txId}\``;
    
    await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });

    if (ADMIN_CHAT_ID) {
        const mensajeAdmin = `✅ *DEPÓSITO COMPLETADO*\n\n` +
            `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
            `📋 Orden #: ${orden.id}\n` +
            `💰 Monto: ${formatCurrency(amount, currency)}\n` +
            `🎁 Total con bono: ${formatCurrency(montoConBono, currency)}\n` +
            `🎫 Tokens: ${tokensGanados} ${currency === 'saldo' ? 'CWS' : 'CWT'}\n` +
            `🔧 Tipo: ${tipoPago}\n` +
            `🆔 ID: \`${txId}\``;
        
        await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
    }

    return { success: true, montoConBono, tokensGanados };
}

// ============================================
// RUTAS DE TELEGRAM BOT
// ============================================

// Teclados
const mainKeyboard = {
    inline_keyboard: [
        [{ text: '👛 Mi Billetera', callback_data: 'wallet' }],
        [{ text: '💰 Recargar Wallet', callback_data: 'recharge_menu' }],
        [{ text: '📱 Vincular Teléfono', callback_data: 'link_phone' }],
        [{ text: '🎁 Reclamar Pago', callback_data: 'claim_payment' }],
        [{ text: '📜 Términos y Condiciones', callback_data: 'terms' }],
        [{ text: '🔄 Actualizar', callback_data: 'refresh_wallet' }]
    ]
};

const walletKeyboard = {
    inline_keyboard: [
        [{ text: '💰 Recargar Wallet', callback_data: 'recharge_menu' }],
        [{ text: '📜 Historial', callback_data: 'history' }],
        [{ text: '📱 Vincular Teléfono', callback_data: 'link_phone' }],
        [{ text: '📊 Saldo Pendiente', callback_data: 'view_pending' }],
        [{ text: '🔙 Volver', callback_data: 'start_back' }]
    ]
};

const backKeyboard = (callback_data) => ({
    inline_keyboard: [[{ text: '🔙 Volver', callback_data }]]
});

const rechargeMethodsKeyboard = {
    inline_keyboard: [
        [{ text: '💳 CUP (Tarjeta)', callback_data: 'dep_init:cup' }],
        [{ text: '📲 Saldo Móvil', callback_data: 'dep_init:saldo' }],
        [{ text: '🪙 USDT BEP20', callback_data: 'dep_init:usdt' }],
        [{ text: '🔙 Volver', callback_data: 'wallet' }]
    ]
};

const termsKeyboard = {
    inline_keyboard: [[{ text: '✅ Aceptar Términos', callback_data: 'accept_terms' }]]
};

const claimPaymentKeyboard = {
    inline_keyboard: [
        [{ text: '🔍 Buscar por ID', callback_data: 'search_payment_id' }],
        [{ text: '📋 Ver Pendientes', callback_data: 'view_pending_payments' }],
        [{ text: '🔙 Volver', callback_data: 'start_back' }]
    ]
};

// Webhook para recibir pagos del parser Python
app.post('/payment-notification', verifyWebhookToken, async (req, res) => {
    try {
        const { type, user_id, amount, currency, tx_id, tipo_pago, phone, message } = req.body;
        
        console.log(`📥 Notificación recibida: ${type}, Usuario: ${user_id}, Monto: ${amount} ${currency}`);
        
        if (type === 'AUTO_PAYMENT') {
            const result = await procesarPagoAutomatico(user_id, amount, currency, tx_id, tipo_pago);
            res.json(result);
        } 
        else if (type === 'PENDING_PAYMENT') {
            // Guardar pago pendiente
            const { data, error } = await supabase.from('pending_sms_payments').insert({
                user_id: user_id,
                phone: phone,
                amount: amount,
                currency: currency,
                tx_id: tx_id,
                tipo_pago: tipo_pago,
                raw_message: message,
                claimed: false
            });
            
            if (error) {
                res.status(500).json({ success: false, error: error.message });
            } else {
                res.json({ success: true, message: 'Pago pendiente registrado' });
            }
        }
        else if (type === 'USDT_VERIFIED') {
            const result = await procesarPagoAutomatico(user_id, amount, 'usdt', tx_id, 'USDT_WEB');
            res.json(result);
        }
        else if (type === 'CLAIM_PAYMENT') {
            const user = await getUser(user_id);
            const result = await procesarPagoAutomatico(user_id, amount, currency, tx_id, tipo_pago);
            res.json(result);
        }
        else if (type === 'WEB_REGISTRATION') {
            // Solo registrar en logs
            console.log(`📝 Registro web completado para usuario: ${user_id}`);
            res.json({ success: true });
        }
        else {
            res.status(400).json({ success: false, message: 'Tipo de notificación desconocido' });
        }
    } catch (error) {
        console.error('❌ Error en payment-notification:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Keep alive endpoint
app.get('/keepalive', (req, res) => {
    res.json({ 
        status: 'alive', 
        timestamp: new Date().toISOString(),
        service: 'cromwell-bot-server',
        uptime: process.uptime(),
        security_enabled: !!WEBHOOK_SECRET_KEY
    });
});

// ============================================
// MANEJO DE COMANDOS DE TELEGRAM
// ============================================

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
        accepted_terms: false,
        pending_balance_cup: 0,
        balance_cup: 0,
        balance_saldo: 0,
        balance_usdt: 0,
        tokens_cws: 0,
        tokens_cwt: 0,
        usdt_wallet: null,
        last_active: new Date().toISOString()
    }, { onConflict: 'telegram_id' });
    
    const welcomeMessage = `👋 ¡Hola, **${first_name}**!\n\n` +
        `Bienvenido a **Cromwell Store Wallet**\n\n` +
        `✨ *Características:*\n` +
        `✅ Wallet multipropósito\n` +
        `✅ Detección automática de pagos\n` +
        `✅ Tokens CWS y CWT\n` +
        `✅ Bonos en primer depósito\n\n` +
        `🎁 *Beneficios primer depósito:*\n` +
        `• 💳 CUP: 10% extra\n` +
        `• 📱 Saldo Móvil: 10% extra + Tokens CWS\n` +
        `• 🪙 USDT: 5% extra + Tokens CWT\n\n` +
        `⚠️ *Debes aceptar los términos y condiciones para continuar.*`;
    
    await bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown', 
        reply_markup: mainKeyboard 
    });
});

// Manejo de callbacks
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const [action, param1, param2] = query.data.split(':');

    try {
        await bot.answerCallbackQuery(query.id);

        switch (action) {
            case 'start_back':
                await handleStartBack(chatId, messageId);
                break;
            case 'wallet':
                await handleWallet(chatId, messageId);
                break;
            case 'refresh_wallet':
                await handleRefreshWallet(chatId, messageId);
                break;
            case 'recharge_menu':
                await handleRechargeMenu(chatId, messageId);
                break;
            case 'dep_init':
                await handleDepositInit(chatId, messageId, param1);
                break;
            case 'confirm_deposit':
                await handleConfirmDeposit(chatId, messageId, param1, param2);
                break;
            case 'terms':
                await handleTerms(chatId, messageId);
                break;
            case 'accept_terms':
                await handleAcceptTerms(chatId, messageId);
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
            case 'history':
                await handleHistory(chatId, messageId);
                break;
            case 'view_pending':
                await handleViewPending(chatId, messageId);
                break;
            case 'enter_usdt_wallet':
                await handleEnterUsdtWallet(chatId, messageId);
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
        `¿En qué puedo ayudarte hoy?`;
    
    await bot.editMessageText(welcomeMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
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
    const faltante = MINIMO_CUP - pendiente;
    
    let message = `👛 *Tu Billetera Cromwell*\n\n` +
        `💰 *CUP:* **${formatCurrency(user.balance_cup, 'cup')}**\n` +
        `📱 *Saldo Móvil:* **${formatCurrency(user.balance_saldo, 'saldo')}**\n` +
        `🪙 *USDT:* **${formatCurrency(user.balance_usdt, 'usdt')}**\n` +
        `🎫 *CWS (Tokens Saldo):* **${user.tokens_cws || 0}**\n` +
        `🎟️ *CWT (Tokens USDT):* **${(user.tokens_cwt || 0).toFixed(2)}**\n\n`;
    
    if (pendiente > 0) {
        message += `📥 *CUP Pendientes:* **${formatCurrency(pendiente, 'cup')}**\n`;
        if (faltante > 0) {
            message += `🎯 *Faltan:* ${formatCurrency(faltante, 'cup')} para el mínimo\n\n`;
        }
    }
    
    message += `📞 *Teléfono:* ${user.phone_number ? `+53 ${user.phone_number}` : '❌ No vinculado'}\n\n` +
        `💡 *Mínimos para usar tokens:*\n` +
        `• CWT: ${MIN_CWT_USE} CWT\n` +
        `• CWS: ${MIN_CWS_USE} CWS\n\n` +
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

async function handleRechargeMenu(chatId, messageId) {
    const user = await getUser(chatId);
    
    if (!user.accepted_terms) {
        await bot.editMessageText('❌ *Debes aceptar los términos y condiciones primero.*', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: backKeyboard('start_back')
        });
        return;
    }
    
    const message = `💰 *Recargar Tu Wallet*\n\n` +
        `Selecciona el método de pago:\n\n` +
        `💡 *Consejo:* Vincula tu teléfono para pagos automáticos.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: rechargeMethodsKeyboard
    });
}

async function handleDepositInit(chatId, messageId, currency) {
    const user = await getUser(chatId);
    
    if (!user.phone_number && currency !== 'usdt') {
        await bot.editMessageText('❌ *Debes vincular tu teléfono primero* para pagos con CUP o Saldo Móvil.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: backKeyboard('recharge_menu')
        });
        return;
    }
    
    let instrucciones = '';
    let minimo = MINIMO_CUP;
    let maximo = MAXIMO_CUP;
    let metodoPago = '';
    let extraInfo = '';
    
    if (currency === 'cup') {
        minimo = MINIMO_CUP;
        maximo = MAXIMO_CUP;
        metodoPago = 'Tarjeta';
        if (PAGO_CUP_TARJETA) {
            instrucciones = `💳 *Pagar a Tarjeta:* \`${PAGO_CUP_TARJETA}\``;
        } else {
            instrucciones = `💳 *Pagar a Tarjeta:* \`[NO CONFIGURADA]\``;
        }
        if (PAGO_SALDO_MOVIL) {
            extraInfo = `\n📱 *# a confirmar:* \`${PAGO_SALDO_MOVIL}\``;
        }
    } else if (currency === 'saldo') {
        minimo = MINIMO_SALDO;
        maximo = 10000;
        metodoPago = 'Saldo Móvil';
        if (PAGO_SALDO_MOVIL) {
            instrucciones = `📱 *Pagar a Saldo Móvil:* \`${PAGO_SALDO_MOVIL}\``;
        } else {
            instrucciones = `📱 *Pagar a Saldo Móvil:* \`[NO CONFIGURADA]\``;
        }
        const cwsPor100 = Math.floor(minimo / 100) * CWS_PER_100_SALDO;
        extraInfo = `\n🎫 *Ganas ${CWS_PER_100_SALDO} CWS por cada 100 de saldo*\n` +
            `(Ej: ${minimo} saldo = ${cwsPor100} CWS)`;
    } else if (currency === 'usdt') {
        minimo = MINIMO_USDT;
        maximo = 1000;
        metodoPago = 'USDT BEP20';
        if (PAGO_USDT_ADDRESS) {
            instrucciones = `🪙 *Dirección USDT (BEP20):*\n\`${PAGO_USDT_ADDRESS}\``;
        } else {
            instrucciones = `🪙 *Dirección USDT (BEP20):*\n\`[NO CONFIGURADA]\``;
        }
        const cwtPor10 = (minimo / 10) * CWT_PER_10_USDT;
        extraInfo = `\n🎟️ *Ganas ${CWT_PER_10_USDT} CWT por cada 10 USDT*\n` +
            `(Ej: ${minimo} USDT = ${cwtPor10.toFixed(2)} CWT)\n\n` +
            `⚠️ *SOLO RED BEP20*`;
    }
    
    activeSessions[chatId] = { 
        step: 'waiting_deposit_amount', 
        currency: currency,
        metodoPago: metodoPago
    };
    
    const bonoPorcentaje = currency === 'usdt' ? '5%' : '10%';
    
    const message = `💰 *Recargar ${currency.toUpperCase()}*\n\n` +
        `*Método:* ${metodoPago}\n` +
        `*Mínimo:* ${formatCurrency(minimo, currency)}\n` +
        `*Máximo:* ${formatCurrency(maximo, currency)}\n\n` +
        `🎁 *Bono primer depósito:* ${bonoPorcentaje}\n` +
        `${extraInfo}\n\n` +
        `${instrucciones}\n\n` +
        `Por favor, escribe el monto exacto que deseas depositar:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('recharge_menu')
    });
}

async function handleConfirmDeposit(chatId, messageId, currency, txId) {
    const session = activeSessions[chatId];
    if (!session || !session.amount) return;
    
    const user = await getUser(chatId);
    const monto = session.amount;
    
    const bonoPorcentaje = currency === 'usdt' ? 0.05 : 0.10;
    const bono = user[`first_dep_${currency}`] ? monto * bonoPorcentaje : 0;
    const totalConBono = monto + bono;
    const tokens = calcularTokens(monto, currency);
    
    const { data: tx } = await supabase.from('transactions').insert([{
        user_id: chatId,
        type: 'DEPOSIT',
        currency: currency,
        amount_requested: monto,
        estimated_bonus: bono,
        estimated_tokens: tokens,
        status: 'pending',
        user_name: user.first_name,
        user_username: user.username,
        user_phone: user.phone_number,
        usdt_wallet: currency === 'usdt' ? session.usdtWallet : null
    }]).select().single();
    
    let instruccionesFinales = '';
    
    if (currency === 'cup') {
        if (PAGO_CUP_TARJETA) {
            instruccionesFinales = `💳 *INSTRUCCIONES PARA PAGAR:*\n\n` +
                `1. Ve a Transfermóvil\n` +
                `2. Activa *"Mostrar número al destinatario"*\n` +
                `3. Transfiere *EXACTAMENTE* ${formatCurrency(monto, 'cup')}\n` +
                `4. A la tarjeta: \`${PAGO_CUP_TARJETA}\`\n\n` +
                `⚠️ *IMPORTANTE:*\n` +
                `• El monto debe ser exacto\n` +
                `• Tu número debe estar visible\n` +
                `• Usa el mismo teléfono vinculado`;
        } else {
            instruccionesFinales = `❌ *Tarjeta no configurada*\n\n` +
                `Contacta al administrador para obtener la tarjeta de destino.`;
        }
    } else if (currency === 'saldo') {
        if (PAGO_SALDO_MOVIL) {
            instruccionesFinales = `📱 *INSTRUCCIONES PARA PAGAR:*\n\n` +
                `1. Ve a Transfermóvil\n` +
                `2. Envía saldo a: \`${PAGO_SALDO_MOVIL}\`\n` +
                `3. Monto exacto: ${formatCurrency(monto, 'saldo')}\n\n` +
                `⚠️ *IMPORTANTE:*\n` +
                `• Toma captura de pantalla de la transferencia\n` +
                `• No esperes al SMS de confirmación\n` +
                `• Si no llega notificación, usa la captura`;
        } else {
            instruccionesFinales = `❌ *Número de saldo no configurado*\n\n` +
                `Contacta al administrador para obtener el número de destino.`;
        }
    } else if (currency === 'usdt') {
        if (PAGO_USDT_ADDRESS) {
            instruccionesFinales = `🪙 *INSTRUCCIONES PARA PAGAR:*\n\n` +
                `1. Ve a SafePal o tu wallet\n` +
                `2. Envía USDT (BEP20) a:\n\`${PAGO_USDT_ADDRESS}\`\n` +
                `3. Monto exacto: ${formatCurrency(monto, 'usdt')}\n` +
                `4. Desde wallet: \`${session.usdtWallet}\`\n\n` +
                `⚠️ *IMPORTANTE:*\n` +
                `• SOLO red BEP20 (Binance Smart Chain)\n` +
                `• Guarda el hash de transacción\n` +
                `• La verificación puede tomar 5-15 minutos`;
        } else {
            instruccionesFinales = `❌ *Dirección USDT no configurada*\n\n` +
                `Contacta al administrador para obtener la dirección de destino.`;
        }
    }
    
    const message = `✅ *Orden Creada #${tx.id}*\n\n` +
        `💰 *Monto a pagar:* ${formatCurrency(monto, currency)}\n` +
        `🎁 *Bono estimado:* ${formatCurrency(bono, currency)}\n` +
        `🎫 *Tokens estimados:* ${tokens} ${currency === 'saldo' ? 'CWS' : 'CWT'}\n` +
        `💵 *Total a acreditar:* ${formatCurrency(totalConBono, currency)}\n\n` +
        `${instruccionesFinales}\n\n` +
        `Presiona *"✅ Entendido"* cuando hayas leído y estés listo para pagar.`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '✅ Entendido - Listo para Pagar', callback_data: `deposit_confirmed:${tx.id}` }],
            [{ text: '❌ Cancelar', callback_data: 'recharge_menu' }]
        ]
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
    
    if (ADMIN_CHAT_ID) {
        const adminMessage = `📋 *NUEVA SOLICITUD DE DEPÓSITO #${tx.id}*\n\n` +
            `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
            `📞 Teléfono: ${user.phone_number || 'No vinculado'}\n` +
            `💰 Monto: ${formatCurrency(monto, currency)}\n` +
            `💳 Método: ${currency.toUpperCase()}\n` +
            `🎁 Bono: ${formatCurrency(bono, currency)}\n` +
            `🎫 Tokens: ${tokens}\n\n` +
            `Estado: ⏳ PENDIENTE`;
        
        if (currency === 'usdt') {
            adminMessage += `\n👛 Wallet: \`${session.usdtWallet}\``;
        }
        
        await bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });
    }
    
    delete activeSessions[chatId];
}

async function handleTerms(chatId, messageId) {
    const terms = `📜 *Términos y Condiciones de Cromwell Store*\n\n` +
        `1. *ACEPTACIÓN*: Al usar este servicio, aceptas estos términos.\n\n` +
        `2. *PROPÓSITO*: La billetera es exclusiva para pagos en Cromwell Store. El dinero no es retirable, excepto los bonos que son utilizables para recargas.\n\n` +
        `3. *DEPÓSITOS*:\n` +
        `   • Mínimos: CUP=${MINIMO_CUP}, Saldo=${MINIMO_SALDO}, USDT=${MINIMO_USDT}\n` +
        `   • Bonos solo en primer depósito por método\n` +
        `   • Tokens no son retirables, solo usables en tienda\n\n` +
        `4. *TOKENS*:\n` +
        `   • CWS: Ganas ${CWS_PER_100_SALDO} por cada 100 de saldo\n` +
        `   • CWT: Ganas ${CWT_PER_10_USDT} por cada 10 USDT\n` +
        `   • Mínimos para usar: CWT=${MIN_CWT_USE}, CWS=${MIN_CWS_USE}\n\n` +
        `5. *SEGURIDAD*:\n` +
        `   • Toma capturas de pantalla de todas las transacciones\n` +
        `   • ETECSA puede fallar con notificaciones SMS\n` +
        `   • Tu responsabilidad guardar comprobantes\n\n` +
        `6. *REEMBOLSOS*:\n` +
        `   • Si envías dinero y no se acredita pero tienes captura válida\n` +
        `   • Contacta al administrador dentro de las 24 horas\n` +
        `   • Se investigará y resolverá en 48 horas máximo\n\n` +
        `7. *PROHIBIDO*:\n` +
        `   • Uso fraudulento o múltiples cuentas\n` +
        `   • Lavado de dinero o actividades ilegales\n` +
        `   • Spam o abuso del sistema\n\n` +
        `8. *MODIFICACIONES*: Podemos cambiar estos términos notificando con 72 horas de anticipación.\n\n` +
        `_Última actualización: ${new Date().toLocaleDateString()}_`;
    
    await bot.editMessageText(terms, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: termsKeyboard
    });
}

async function handleAcceptTerms(chatId, messageId) {
    await updateUser(chatId, { accepted_terms: true });
    
    await bot.editMessageText('✅ *¡Términos aceptados!*\n\nAhora puedes usar todos los servicios de Cromwell Store.', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
    });
}

async function handleLinkPhone(chatId, messageId) {
    const user = await getUser(chatId);
    
    let message = `📱 *Vincular Teléfono*\n\n`;
    
    if (user.phone_number) {
        message += `✅ *Teléfono actual:* +53 ${user.phone_number}\n\n`;
        message += `Para cambiar, escribe tu nuevo número (ejemplo: 5351234567):`;
        
        activeSessions[chatId] = { 
            step: 'waiting_phone_change',
            oldPhone: user.phone_number 
        };
    } else {
        message += `Para pagos automáticos, vincula tu número de Cuba.\n\n`;
        message += `Escribe tu número (ejemplo: 5351234567):`;
        
        activeSessions[chatId] = { step: 'waiting_phone' };
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleEnterPhone(chatId, messageId) {
    const message = `📱 *Ingresa tu número*\n\n` +
        `Formato: 5XXXXXXXX\n` +
        `Ejemplo: 5351234567\n\n` +
        `⚠️ Debe ser el mismo de Transfermóvil.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleClaimPayment(chatId, messageId) {
    const message = `🎁 *Reclamar Pago*\n\n` +
        `Para pagos que no se detectaron automáticamente:\n\n` +
        `1. Pagos *Tarjeta → Monedero* (sin número visible)\n` +
        `2. Pagos con ID de transacción necesario\n` +
        `3. Pagos con problemas de notificación\n\n` +
        `Selecciona una opción:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: claimPaymentKeyboard
    });
}

async function handleSearchPaymentId(chatId, messageId) {
    const message = `🔍 *Buscar por ID de Transacción*\n\n` +
        `Busca el ID en tu SMS de Transfermóvil:\n\n` +
        `Ejemplo: "Id Transaccion: TMW162915233"\n\n` +
        `Escribe el ID que quieres reclamar:`;
    
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
        .or(`user_id.eq.${chatId},phone.eq.${(await getUser(chatId))?.phone_number}`)
        .order('created_at', { ascending: false });
    
    let message = `📋 *Tus Pagos Pendientes*\n\n`;
    
    if (!pendingPayments || pendingPayments.length === 0) {
        message += `No tienes pagos pendientes por reclamar.`;
    } else {
        pendingPayments.forEach((payment, index) => {
            message += `${index + 1}. ${formatCurrency(payment.amount, payment.currency)}\n`;
            message += `   🆔 ID: \`${payment.tx_id}\`\n`;
            message += `   📅 ${new Date(payment.created_at).toLocaleDateString()}\n`;
            message += `   🔧 ${payment.tipo_pago}\n\n`;
        });
        
        message += `Para reclamar, usa "🔍 Buscar por ID"`;
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('claim_payment')
    });
}

async function handleHistory(chatId, messageId) {
    const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', chatId)
        .order('created_at', { ascending: false })
        .limit(15);
    
    let message = `📜 *Historial de Transacciones*\n\n`;
    
    if (!transactions || transactions.length === 0) {
        message += `No tienes transacciones registradas.`;
    } else {
        transactions.forEach((tx, index) => {
            let icon = '🔸';
            if (tx.status === 'completed') icon = '✅';
            else if (tx.status === 'pending') icon = '⏳';
            else if (tx.status === 'rejected') icon = '❌';
            
            const fecha = new Date(tx.created_at).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            message += `${icon} *${tx.type === 'DEPOSIT' ? 'Depósito' : tx.type}*\n`;
            message += `💰 ${formatCurrency(tx.amount || tx.amount_requested, tx.currency)}\n`;
            message += `📅 ${fecha}\n`;
            message += `📊 ${tx.status}\n`;
            if (tx.tx_id) message += `🆔 \`${tx.tx_id}\`\n`;
            if (tx.tokens_generated > 0) message += `🎫 +${tx.tokens_generated}\n`;
            message += `\n`;
        });
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('wallet')
    });
}

async function handleViewPending(chatId, messageId) {
    const user = await getUser(chatId);
    
    if (!user) return;
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = MINIMO_CUP - pendiente;
    const bono = user.first_dep_cup ? pendiente * 0.10 : 0;
    const totalConBono = pendiente + bono;
    
    let message = `📊 *Saldo Pendiente CUP*\n\n`;
    
    if (pendiente > 0) {
        message += `💰 *Acumulado:* ${formatCurrency(pendiente, 'cup')}\n`;
        
        if (user.first_dep_cup) {
            message += `🎁 *Bono disponible:* ${formatCurrency(bono, 'cup')} (10%)\n`;
            message += `💵 *Total con bono:* ${formatCurrency(totalConBono, 'cup')}\n`;
        }
        
        if (faltante > 0) {
            message += `\n❌ *Faltan:* ${formatCurrency(faltante, 'cup')}\n`;
            message += `Realiza otro depósito de ${formatCurrency(faltante, 'cup')} o más.`;
        } else {
            message += `\n✅ *¡Ya superaste el mínimo!*\n`;
            message += `Se acreditará automáticamente en breve.`;
        }
    } else {
        message += `No tienes saldo pendiente acumulado.\n\n`;
        message += `Los depósitos menores a ${formatCurrency(MINIMO_CUP, 'cup')} se acumulan aquí.`;
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('wallet')
    });
}

async function handleEnterUsdtWallet(chatId, messageId) {
    const message = `👛 *Wallet para USDT*\n\n` +
        `Escribe la dirección USDT (BEP20) desde la que enviarás:\n\n` +
        `Formato: 0x... (42 caracteres)\n` +
        `Ejemplo: 0x742d35Cc6634C0532925a3b844Bc9e\\
e8e64dA7F2E\n\n` +
        `⚠️ Esta wallet quedará vinculada a tu cuenta.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

// ============================================
// MANEJO DE MENSAJES DE TEXTO DE TELEGRAM
// ============================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const session = activeSessions[chatId];
    
    if (!text || text.startsWith('/')) return;
    
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
                    
                case 'waiting_usdt_wallet':
                    await handleUsdtWalletInput(chatId, text, session);
                    break;
                    
                case 'waiting_usdt_hash':
                    await handleUsdtHashInput(chatId, text, session);
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
    const phoneRegex = /^5\d{7,9}$/;
    if (!phoneRegex.test(phone)) {
        await bot.sendMessage(chatId,
            `❌ *Formato incorrecto*\n\n` +
            `Usa: 5XXXXXXXX\n` +
            `Ejemplo: 5351234567\n\n` +
            `Intenta de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const { data: existingUser } = await supabase
        .from('users')
        .select('telegram_id, first_name')
        .eq('phone_number', phone)
        .neq('telegram_id', chatId)
        .single();
    
    if (existingUser) {
        await bot.sendMessage(chatId,
            `❌ *Teléfono ya en uso*\n\n` +
            `Este número ya está vinculado a otra cuenta.\n` +
            `👤 Usuario: ${existingUser.first_name}\n\n` +
            `Si es tu número, contacta al administrador.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
        delete activeSessions[chatId];
        return;
    }
    
    await updateUser(chatId, { phone_number: phone });
    
    let message = '';
    if (session.step === 'waiting_phone_change' && session.oldPhone) {
        message = `✅ *Teléfono actualizado*\n\n` +
            `📱 *Anterior:* +53 ${session.oldPhone}\n` +
            `📱 *Nuevo:* +53 ${phone}\n\n` +
            `Ahora los pagos se detectarán con este número.`;
    } else {
        message = `✅ *¡Teléfono vinculado!*\n\n` +
            `📱 *Número:* +53 ${phone}\n\n` +
            `Ahora tus pagos se detectarán automáticamente cuando:\n` +
            `✅ Envíes de Tarjeta→Tarjeta\n` +
            `✅ Envíes de Monedero→Tarjeta\n` +
            `✅ Envíes de Monedero→Monedero\n\n` +
            `⚠️ *Para pagos Tarjeta→Monedero:*\n` +
            `Usa '🎁 Reclamar Pago'\n\n` +
            `💡 Siempre usa este número en Transfermóvil.`;
    }
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
    });
    
    delete activeSessions[chatId];
}

async function handleSearchPaymentIdInput(chatId, txId) {
    const txIdClean = txId.trim().toUpperCase();
    
    const { data: pendingPayment } = await supabase
        .from('pending_sms_payments')
        .select('*')
        .eq('tx_id', txIdClean)
        .eq('claimed', false)
        .single();
    
    if (pendingPayment) {
        const user = await getUser(chatId);
        if (user && (user.telegram_id === pendingPayment.user_id || user.phone_number === pendingPayment.phone)) {
            const result = await procesarPagoAutomatico(
                chatId, 
                pendingPayment.amount, 
                pendingPayment.currency, 
                pendingPayment.tx_id, 
                pendingPayment.tipo_pago
            );
            
            if (result.success) {
                await supabase
                    .from('pending_sms_payments')
                    .update({ claimed: true, claimed_by: chatId })
                    .eq('id', pendingPayment.id);
                
                await bot.sendMessage(chatId,
                    `✅ *¡Pago reclamado exitosamente!*\n\n` +
                    `Se ha acreditado ${formatCurrency(pendingPayment.amount, pendingPayment.currency)} a tu wallet.`,
                    { parse_mode: 'Markdown', reply_markup: mainKeyboard }
                );
            }
        } else {
            await bot.sendMessage(chatId,
                `❌ *Este pago no te pertenece*\n\n` +
                `El pago con ID \`${txIdClean}\` está registrado para otro usuario.`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
        }
    } else {
        const { data: pendingTx } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', chatId)
            .eq('status', 'pending')
            .eq('type', 'DEPOSIT')
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (pendingTx && pendingTx.length > 0) {
            const orden = pendingTx[0];
            
            await bot.sendMessage(chatId,
                `📋 *Tienes una orden pendiente #${orden.id}*\n\n` +
                `💰 Monto: ${formatCurrency(orden.amount_requested, orden.currency)}\n` +
                `💳 Método: ${orden.currency.toUpperCase()}\n\n` +
                `Si ya realizaste el pago, espera a que se detecte automáticamente.\n` +
                `Si no se detecta en 10 minutos, contacta al administrador.`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
        } else {
            await bot.sendMessage(chatId,
                `❌ *ID no encontrado*\n\n` +
                `No encontramos pagos pendientes con el ID: \`${txIdClean}\`\n\n` +
                `Verifica:\n` +
                `1. Que el ID sea correcto\n` +
                `2. Que el pago sea de *Tarjeta→Monedero*\n` +
                `3. Que no haya sido reclamado antes`,
                { parse_mode: 'Markdown', reply_markup: claimPaymentKeyboard }
            );
        }
    }
    
    delete activeSessions[chatId];
}

async function handleDepositAmountInput(chatId, amountText, session) {
    const amount = parseFloat(amountText);
    const currency = session.currency;
    
    const limites = { 
        cup: [MINIMO_CUP, MAXIMO_CUP], 
        saldo: [MINIMO_SALDO, 10000], 
        usdt: [MINIMO_USDT, 1000] 
    };
    
    if (isNaN(amount) || amount < limites[currency][0] || amount > limites[currency][1]) {
        await bot.sendMessage(chatId, 
            `❌ *Monto fuera de límites*\n\n` +
            `Debe estar entre ${formatCurrency(limites[currency][0], currency)} y ${formatCurrency(limites[currency][1], currency)}.\n\n` +
            `Escribe un monto válido:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const user = await getUser(chatId);
    
    if (currency === 'usdt') {
        session.amount = amount;
        session.step = 'waiting_usdt_wallet';
        
        await bot.sendMessage(chatId,
            `✅ *Monto establecido:* ${formatCurrency(amount, 'usdt')}\n\n` +
            `Ahora escribe la dirección USDT (BEP20) desde la que enviarás:\n\n` +
            `Formato: 0x... (42 caracteres)\n` +
            `Esta wallet quedará vinculada a tu cuenta.`,
            { parse_mode: 'Markdown' }
        );
    } else {
        session.amount = amount;
        await handleConfirmDeposit(chatId, null, currency, null);
    }
}

async function handleUsdtWalletInput(chatId, wallet, session) {
    if (!wallet.startsWith('0x') || wallet.length !== 42) {
        await bot.sendMessage(chatId,
            `❌ *Dirección inválida*\n\n` +
            `Debe comenzar con "0x" y tener 42 caracteres.\n\n` +
            `Ejemplo válido:\n\`0x742d35Cc6634C0532925a3b844Bc9e8e64dA7F2E\`\n\n` +
            `Intenta de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    session.usdtWallet = wallet;
    await updateUser(chatId, { usdt_wallet: wallet });
    
    await handleConfirmDeposit(chatId, null, 'usdt', null);
}

async function handleUsdtHashInput(chatId, hash, session) {
    if (!PAGO_USDT_ADDRESS) {
        await bot.sendMessage(chatId,
            `❌ *Dirección USDT no configurada*\n\n` +
            `Contacta al administrador.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
        delete activeSessions[chatId];
        return;
    }
    
    const result = await checkBSCTransaction(hash, session.amount, PAGO_USDT_ADDRESS);
    
    if (result.success) {
        const user = await getUser(chatId);
        const resultPago = await procesarPagoAutomatico(chatId, result.amount, 'usdt', hash, 'USDT_BEP20');
        
        if (resultPago.success) {
            await bot.sendMessage(chatId,
                `✅ *¡Transacción USDT verificada!*\n\n` +
                `Hash: \`${hash.substring(0, 20)}...\`\n` +
                `Monto: ${formatCurrency(result.amount, 'usdt')}\n\n` +
                `El pago ha sido acreditado a tu wallet.`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
        }
    } else {
        await bot.sendMessage(chatId,
            `❌ *Transacción no verificada*\n\n` +
            `No pudimos verificar la transacción con hash:\n\`${hash}\`\n\n` +
            `Verifica:\n` +
            `1. Que el hash sea correcto\n` +
            `2. Que la transacción esté confirmada\n` +
            `3. Que se envió a la dirección correcta\n\n` +
            `Intenta de nuevo o contacta al administrador.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
    }
    
    delete activeSessions[chatId];
}

// ============================================
// RUTAS DEL DASHBOARD WEB
// ============================================

// 1. Login web
app.post('/api/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Faltan credenciales' });
        }
        
        // Buscar usuario por Telegram ID o teléfono
        let user;
        
        if (identifier.startsWith('@') || !isNaN(identifier)) {
            // Es un Telegram ID
            const telegramId = identifier.replace('@', '');
            user = await getUser(parseInt(telegramId));
        } else {
            // Es un teléfono
            const phone = identifier.replace(/[^\d]/g, '');
            user = await getUserByPhone(phone);
        }
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar contraseña web (si tiene)
        if (user.web_password) {
            const validPassword = await bcrypt.compare(password, user.web_password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Contraseña incorrecta' });
            }
        } else {
            // Usuario no tiene contraseña web registrada
            return res.status(403).json({ 
                error: 'Debes registrar una contraseña primero',
                needsRegistration: true,
                userId: user.telegram_id 
            });
        }
        
        // Crear sesión
        req.session.userId = user.telegram_id;
        req.session.authenticated = true;
        req.session.userData = {
            telegramId: user.telegram_id,
            username: user.username,
            firstName: user.first_name,
            phone: user.phone_number
        };
        
        res.json({ 
            success: true, 
            user: {
                id: user.telegram_id,
                username: user.username,
                firstName: user.first_name,
                phone: user.phone_number,
                balance_cup: user.balance_cup || 0,
                balance_saldo: user.balance_saldo || 0,
                balance_usdt: user.balance_usdt || 0,
                tokens_cws: user.tokens_cws || 0,
                tokens_cwt: user.tokens_cwt || 0
            }
        });
        
    } catch (error) {
        console.error('Error en login web:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 2. Registro de contraseña web
app.post('/api/register-password', async (req, res) => {
    try {
        const { identifier, password, confirmPassword } = req.body;
        
        if (!identifier || !password || !confirmPassword) {
            return res.status(400).json({ error: 'Faltan datos' });
        }
        
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Las contraseñas no coinciden' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }
        
        // Buscar usuario
        let user;
        
        if (identifier.startsWith('@') || !isNaN(identifier)) {
            const telegramId = identifier.replace('@', '');
            user = await getUser(parseInt(telegramId));
        } else {
            const phone = identifier.replace(/[^\d]/g, '');
            user = await getUserByPhone(phone);
        }
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar si ya tiene contraseña
        if (user.web_password) {
            return res.status(400).json({ error: 'Ya tienes una contraseña registrada' });
        }
        
        // Hash de la contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Actualizar usuario
        const { error } = await supabase
            .from('users')
            .update({ web_password: hashedPassword })
            .eq('telegram_id', user.telegram_id);
        
        if (error) {
            throw error;
        }
        
        // Enviar notificación al bot
        try {
            await axios.post(`http://localhost:${PORT}/payment-notification`, {
                auth_token: WEBHOOK_SECRET_KEY,
                type: 'WEB_REGISTRATION',
                user_id: user.telegram_id,
                user_name: user.first_name,
                timestamp: new Date().toISOString()
            });
        } catch (notifError) {
            console.error('Error enviando notificación:', notifError);
        }
        
        res.json({ success: true, message: 'Contraseña registrada exitosamente' });
        
    } catch (error) {
        console.error('Error en registro web:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 3. Obtener datos del usuario (protegido)
app.get('/api/user-data', requireAuth, async (req, res) => {
    try {
        const user = await getUser(req.session.userId);
        
        if (!user) {
            req.session.destroy();
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Obtener transacciones recientes
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', user.telegram_id)
            .order('created_at', { ascending: false })
            .limit(10);
        
        // Obtener pagos pendientes
        const { data: pendingPayments } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('claimed', false)
            .or(`user_id.eq.${user.telegram_id},phone.eq.${user.phone_number}`);
        
        res.json({
            success: true,
            user: {
                id: user.telegram_id,
                username: user.username,
                firstName: user.first_name,
                phone: user.phone_number,
                usdt_wallet: user.usdt_wallet,
                balance_cup: user.balance_cup || 0,
                balance_saldo: user.balance_saldo || 0,
                balance_usdt: user.balance_usdt || 0,
                tokens_cws: user.tokens_cws || 0,
                tokens_cwt: user.tokens_cwt || 0,
                pending_balance_cup: user.pending_balance_cup || 0,
                accepted_terms: user.accepted_terms || false
            },
            transactions: transactions || [],
            pendingPayments: pendingPayments || [],
            stats: {
                total_deposits: transactions ? transactions.filter(t => t.type === 'DEPOSIT' && t.status === 'completed').length : 0,
                total_amount: transactions ? transactions.filter(t => t.status === 'completed').reduce((sum, t) => sum + (t.amount || 0), 0) : 0,
                pending_count: pendingPayments ? pendingPayments.length : 0
            }
        });
        
    } catch (error) {
        console.error('Error obteniendo datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 4. Crear solicitud de depósito web
app.post('/api/create-deposit', requireAuth, async (req, res) => {
    try {
        const { currency, amount, usdtWallet } = req.body;
        const userId = req.session.userId;
        
        if (!currency || !amount) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }
        
        // Validar monto mínimo
        const minimos = { cup: MINIMO_CUP, saldo: MINIMO_SALDO, usdt: MINIMO_USDT };
        if (amount < minimos[currency]) {
            return res.status(400).json({ 
                error: `Monto mínimo: ${minimos[currency]} ${currency.toUpperCase()}` 
            });
        }
        
        const user = await getUser(userId);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Para USDT, validar wallet
        if (currency === 'usdt') {
            if (!usdtWallet) {
                return res.status(400).json({ error: 'Se requiere wallet para USDT' });
            }
            if (!usdtWallet.startsWith('0x') || usdtWallet.length !== 42) {
                return res.status(400).json({ error: 'Wallet USDT inválida' });
            }
        }
        
        // Verificar si ya tiene una solicitud pendiente
        const { data: pendingTx } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', currency)
            .eq('type', 'DEPOSIT')
            .limit(1);
        
        if (pendingTx && pendingTx.length > 0) {
            return res.status(400).json({ 
                error: 'Ya tienes una solicitud pendiente para este método',
                existingOrder: pendingTx[0]
            });
        }
        
        // Calcular bono y tokens
        const bonoPorcentaje = currency === 'usdt' ? 0.05 : 0.10;
        const bono = user[`first_dep_${currency}`] ? amount * bonoPorcentaje : 0;
        const totalConBono = amount + bono;
        const tokens = calcularTokens(amount, currency);
        
        // Crear transacción
        const { data: transaction, error } = await supabase
            .from('transactions')
            .insert([{
                user_id: userId,
                type: 'DEPOSIT',
                currency: currency,
                amount_requested: amount,
                estimated_bonus: bono,
                estimated_tokens: tokens,
                status: 'pending',
                user_name: user.first_name,
                user_username: user.username,
                user_phone: user.phone_number,
                usdt_wallet: currency === 'usdt' ? usdtWallet : null
            }])
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        // Preparar datos de respuesta
        let paymentInfo = {};
        
        switch (currency) {
            case 'cup':
                paymentInfo = {
                    method: 'Tarjeta',
                    target: PAGO_CUP_TARJETA || '[NO CONFIGURADO]',
                    instructions: [
                        'Activar "Mostrar número al destinatario" en Transfermóvil',
                        `Transferir EXACTAMENTE ${amount} CUP`,
                        `A la tarjeta: ${PAGO_CUP_TARJETA || '[NO CONFIGURADO]'}`,
                        'Usar el mismo teléfono vinculado'
                    ]
                };
                break;
            case 'saldo':
                paymentInfo = {
                    method: 'Saldo Móvil',
                    target: PAGO_SALDO_MOVIL || '[NO CONFIGURADO]',
                    instructions: [
                        `Enviar saldo a: ${PAGO_SALDO_MOVIL || '[NO CONFIGURADO]'}`,
                        `Monto exacto: ${amount}`,
                        'Tomar captura de pantalla de la transferencia',
                        'No esperar al SMS de confirmación'
                    ]
                };
                break;
            case 'usdt':
                paymentInfo = {
                    method: 'USDT BEP20',
                    target: PAGO_USDT_ADDRESS || '[NO CONFIGURADO]',
                    instructions: [
                        `Enviar USDT (BEP20) a: ${PAGO_USDT_ADDRESS || '[NO CONFIGURADO]'}`,
                        `Monto exacto: ${amount} USDT`,
                        `Desde wallet: ${usdtWallet}`,
                        'SOLO red BEP20 (Binance Smart Chain)',
                        'Guardar el hash de transacción'
                    ]
                };
                break;
        }
        
        res.json({
            success: true,
            order: {
                id: transaction.id,
                amount: amount,
                currency: currency,
                bonus: bono,
                tokens: tokens,
                total: totalConBono,
                status: 'pending'
            },
            paymentInfo: paymentInfo
        });
        
    } catch (error) {
        console.error('Error creando depósito:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 5. Verificar transacción USDT web
app.post('/api/verify-usdt', requireAuth, async (req, res) => {
    try {
        const { txHash, orderId } = req.body;
        const userId = req.session.userId;
        
        if (!txHash || !orderId) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }
        
        // Obtener orden
        const { data: order, error: orderError } = await supabase
            .from('transactions')
            .select('*')
            .eq('id', orderId)
            .eq('user_id', userId)
            .single();
        
        if (orderError || !order) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        if (order.currency !== 'usdt') {
            return res.status(400).json({ error: 'Esta orden no es de USDT' });
        }
        
        if (order.status !== 'pending') {
            return res.status(400).json({ error: 'Esta orden ya fue procesada' });
        }
        
        // Verificar transacción en BSC
        const verification = await checkBSCTransaction(txHash, order.amount_requested, PAGO_USDT_ADDRESS);
        
        if (!verification.success) {
            return res.status(400).json({ 
                error: 'No se pudo verificar la transacción',
                details: verification.error || 'Transacción no encontrada o inválida'
            });
        }
        
        // Verificar que la transacción venga de la wallet correcta
        if (verification.from.toLowerCase() !== order.usdt_wallet.toLowerCase()) {
            return res.status(400).json({ 
                error: 'La transacción no viene de la wallet registrada',
                expected: order.usdt_wallet,
                received: verification.from
            });
        }
        
        // Actualizar orden con el hash
        const { error: updateError } = await supabase
            .from('transactions')
            .update({ 
                tx_id: txHash,
                status: 'verifying'
            })
            .eq('id', orderId);
        
        if (updateError) {
            throw updateError;
        }
        
        // Notificar al endpoint interno para procesamiento
        try {
            await axios.post(`http://localhost:${PORT}/payment-notification`, {
                auth_token: WEBHOOK_SECRET_KEY,
                type: 'USDT_VERIFIED',
                user_id: userId,
                amount: verification.amount,
                currency: 'usdt',
                tx_id: txHash,
                tipo_pago: 'USDT_WEB'
            });
        } catch (notifError) {
            console.error('Error notificando:', notifError);
        }
        
        res.json({
            success: true,
            message: 'Transacción verificada. Procesando pago...',
            transaction: {
                hash: txHash,
                amount: verification.amount,
                from: verification.from,
                status: 'verifying'
            }
        });
        
    } catch (error) {
        console.error('Error verificando USDT:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 6. Reclamar pago por ID web
app.post('/api/claim-payment', requireAuth, async (req, res) => {
    try {
        const { txId } = req.body;
        const userId = req.session.userId;
        
        if (!txId) {
            return res.status(400).json({ error: 'ID de transacción requerido' });
        }
        
        // Buscar pago pendiente
        const { data: pendingPayment, error: paymentError } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('tx_id', txId.trim().toUpperCase())
            .eq('claimed', false)
            .single();
        
        if (paymentError || !pendingPayment) {
            return res.status(404).json({ error: 'Pago pendiente no encontrado' });
        }
        
        // Verificar que el pago pertenece al usuario
        const user = await getUser(userId);
        if (!user || (user.telegram_id !== pendingPayment.user_id && user.phone_number !== pendingPayment.phone)) {
            return res.status(403).json({ error: 'Este pago no te pertenece' });
        }
        
        // Notificar al endpoint interno para procesar
        try {
            const result = await axios.post(`http://localhost:${PORT}/payment-notification`, {
                auth_token: WEBHOOK_SECRET_KEY,
                type: 'CLAIM_PAYMENT',
                user_id: userId,
                amount: pendingPayment.amount,
                currency: pendingPayment.currency,
                tx_id: pendingPayment.tx_id,
                tipo_pago: pendingPayment.tipo_pago,
                payment_id: pendingPayment.id
            });
            
            if (result.data.success) {
                // Marcar como reclamado
                await supabase
                    .from('pending_sms_payments')
                    .update({ 
                        claimed: true, 
                        claimed_by: userId,
                        claimed_at: new Date().toISOString()
                    })
                    .eq('id', pendingPayment.id);
            }
            
            res.json(result.data);
            
        } catch (botError) {
            console.error('Error contactando al servicio:', botError);
            res.status(500).json({ error: 'Error procesando el pago' });
        }
        
    } catch (error) {
        console.error('Error reclamando pago:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 7. Logout web
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Error cerrando sesión' });
        }
        res.json({ success: true });
    });
});

// 8. Verificar sesión web
app.get('/api/check-session', (req, res) => {
    if (req.session.userId && req.session.authenticated) {
        res.json({ authenticated: true, userId: req.session.userId });
    } else {
        res.json({ authenticated: false });
    }
});

// 9. Verificar transacciones USDT automáticamente
app.post('/api/check-usdt-transactions', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await getUser(userId);
        
        if (!user || !user.usdt_wallet) {
            return res.json({ success: false, message: 'No hay wallet configurada' });
        }
        
        if (!BSCSCAN_API_KEY) {
            return res.json({ success: false, message: 'Servicio BSCScan no configurado' });
        }
        
        // Obtener transacciones pendientes del usuario
        const { data: pendingOrders } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', 'usdt')
            .eq('type', 'DEPOSIT');
        
        if (!pendingOrders || pendingOrders.length === 0) {
            return res.json({ success: false, message: 'No hay órdenes pendientes' });
        }
        
        // Verificar transacciones desde la wallet del usuario a nuestra dirección
        const url = `https://api.bscscan.com/api?module=account&action=txlist&address=${PAGO_USDT_ADDRESS}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc&apikey=${BSCSCAN_API_KEY}`;
        const response = await axios.get(url);
        
        let foundTransactions = [];
        
        if (response.data.status === '1') {
            const transactions = response.data.result;
            
            for (const order of pendingOrders) {
                // Buscar transacción que coincida
                const matchingTx = transactions.find(tx => {
                    const txAmount = parseFloat(web3.utils.fromWei(tx.value, 'ether'));
                    const amountDiff = Math.abs(txAmount - order.amount_requested);
                    const margin = order.amount_requested * 0.01;
                    
                    return tx.from.toLowerCase() === user.usdt_wallet.toLowerCase() &&
                           amountDiff <= margin &&
                           tx.to.toLowerCase() === PAGO_USDT_ADDRESS.toLowerCase();
                });
                
                if (matchingTx) {
                    foundTransactions.push({
                        orderId: order.id,
                        txHash: matchingTx.hash,
                        amount: parseFloat(web3.utils.fromWei(matchingTx.value, 'ether'))
                    });
                }
            }
        }
        
        res.json({
            success: true,
            found: foundTransactions.length > 0,
            transactions: foundTransactions
        });
        
    } catch (error) {
        console.error('Error verificando transacciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 10. Estadísticas de admin
app.get('/api/admin/stats', requireAuth, async (req, res) => {
    try {
        const user = await getUser(req.session.userId);
        
        // Verificar si es admin
        const adminId = process.env.ADMIN_GROUP || '';
        if (!adminId || user.telegram_id.toString() !== adminId.replace('-100', '')) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        // Estadísticas generales
        const { count: totalUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
        
        const { data: recentTransactions } = await supabase
            .from('transactions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        
        const { data: allPending } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('claimed', false);
        
        // Calcular totales por moneda
        const { data: balances } = await supabase
            .from('users')
            .select('balance_cup, balance_saldo, balance_usdt');
        
        let totalCup = 0, totalSaldo = 0, totalUsdt = 0;
        if (balances) {
            balances.forEach(user => {
                totalCup += user.balance_cup || 0;
                totalSaldo += user.balance_saldo || 0;
                totalUsdt += user.balance_usdt || 0;
            });
        }
        
        // Usuarios activos hoy
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const { data: activeUsers } = await supabase
            .from('users')
            .select('telegram_id, first_name, last_active')
            .gte('last_active', today.toISOString());
        
        res.json({
            success: true,
            stats: {
                totalUsers,
                totalCup,
                totalSaldo,
                totalUsdt,
                pendingPayments: allPending ? allPending.length : 0,
                activeToday: activeUsers ? activeUsers.length : 0,
                recentTransactions: recentTransactions ? recentTransactions.length : 0
            },
            recentTransactions: recentTransactions || [],
            pendingPayments: allPending || [],
            activeUsers: activeUsers || []
        });
        
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 11. Ruta para servir archivos HTML
app.get('/', (req, res) => {
    if (req.session.authenticated) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(__dirname + '/public/index.html');
    }
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

app.get('/admin', requireAuth, async (req, res) => {
    const user = await getUser(req.session.userId);
    const adminId = process.env.ADMIN_GROUP || '';
    
    if (!adminId || user.telegram_id.toString() !== adminId.replace('-100', '')) {
        return res.redirect('/dashboard');
    }
    
    res.sendFile(__dirname + '/public/admin.html');
});

// ============================================
// SCHEDULERS Y TAREAS PROGRAMADAS
// ============================================

// Schedule para verificar saldos pendientes
setInterval(async () => {
    try {
        const { data: users } = await supabase
            .from('users')
            .select('*')
            .gte('pending_balance_cup', MINIMO_CUP);
        
        if (users && users.length > 0) {
            console.log(`📊 Procesando ${users.length} usuarios con saldo pendiente...`);
            
            for (const user of users) {
                const montoConBono = await aplicarBonoPrimerDeposito(user.telegram_id, 'cup', user.pending_balance_cup);
                const nuevoSaldo = (user.balance_cup || 0) + montoConBono;
                
                await updateUser(user.telegram_id, { 
                    balance_cup: nuevoSaldo,
                    pending_balance_cup: 0 
                });
                
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
                
                const bonoMensaje = montoConBono > user.pending_balance_cup ? 
                    `\n🎉 *¡Bono aplicado!* +${formatCurrency(montoConBono - user.pending_balance_cup, 'cup')}` : '';
                
                await bot.sendMessage(user.telegram_id,
                    `🎉 *¡Saldo Pendiente Acreditado!*\n\n` +
                    `Acumulado: ${formatCurrency(user.pending_balance_cup, 'cup')}\n` +
                    `${bonoMensaje}\n` +
                    `💵 Total: *${formatCurrency(montoConBono, 'cup')}*\n\n` +
                    `📊 Nuevo saldo CUP: *${formatCurrency(nuevoSaldo, 'cup')}*\n\n` +
                    `✅ ¡Ya puedes usar tu saldo!`,
                    { parse_mode: 'Markdown' }
                );
                
                console.log(`✅ Saldo pendiente acreditado para ${user.telegram_id}`);
            }
        }
    } catch (error) {
        console.error('❌ Error en schedule de saldos pendientes:', error);
    }
}, 5 * 60 * 1000); // Cada 5 minutos

// Schedule para verificar USDT automáticamente
setInterval(async () => {
    if (!BSCSCAN_API_KEY || !PAGO_USDT_ADDRESS) return;
    
    try {
        const { data: pendingUsdt } = await supabase
            .from('transactions')
            .select('*, users!inner(usdt_wallet, telegram_id)')
            .eq('status', 'pending')
            .eq('currency', 'usdt')
            .eq('type', 'DEPOSIT')
            .not('users.usdt_wallet', 'is', null);
        
        if (pendingUsdt && pendingUsdt.length > 0) {
            console.log(`🔍 Verificando ${pendingUsdt.length} transacciones USDT pendientes...`);
            
            for (const tx of pendingUsdt) {
                const user = tx.users;
                
                const url = `https://api.bscscan.com/api?module=account&action=txlist&address=${PAGO_USDT_ADDRESS}&startblock=0&endblock=99999999&sort=desc&apikey=${BSCSCAN_API_KEY}`;
                const response = await axios.get(url);
                
                if (response.data.status === '1') {
                    const transactions = response.data.result;
                    
                    const userTx = transactions.find(t => 
                        t.from.toLowerCase() === user.usdt_wallet.toLowerCase() &&
                        Math.abs(parseFloat(web3.utils.fromWei(t.value, 'ether')) - tx.amount_requested) <= (tx.amount_requested * 0.01)
                    );
                    
                    if (userTx) {
                        const result = await procesarPagoAutomatico(
                            user.telegram_id,
                            parseFloat(web3.utils.fromWei(userTx.hash, 'ether')),
                            'usdt',
                            userTx.hash,
                            'USDT_AUTO_DETECTED'
                        );
                        
                        if (result.success) {
                            console.log(`✅ USDT detectado automáticamente para ${user.telegram_id}`);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error verificando USDT automático:', error);
    }
}, 10 * 60 * 1000); // Cada 10 minutos

// Limpiar sesiones inactivas
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

// ============================================
// INICIAR SERVIDORES
// ============================================

// Servidor principal (bot + API)
app.listen(PORT, () => {
    console.log(`\n🤖 Cromwell Bot & Server iniciado`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🛠️ Admin: http://localhost:${PORT}/admin`);
    console.log(`🔄 Keep alive: http://localhost:${PORT}/keepalive`);
    console.log(`🤖 Bot Token: ${TELEGRAM_TOKEN ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO'}`);
    console.log(`🔐 Seguridad: ${WEBHOOK_SECRET_KEY ? '✅ ACTIVADA' : '⚠️ DESACTIVADA'}`);
    console.log(`💰 Mínimos: CUP=${MINIMO_CUP}, Saldo=${MINIMO_SALDO}, USDT=${MINIMO_USDT}`);
    console.log(`🎫 Tokens: ${CWS_PER_100_SALDO} CWS/100 saldo, ${CWT_PER_10_USDT} CWT/10 USDT`);
    console.log(`📞 Teléfono: ${PAGO_SALDO_MOVIL || '❌ No configurado'}`);
    console.log(`💳 Tarjeta: ${PAGO_CUP_TARJETA ? PAGO_CUP_TARJETA.substring(0, 4) + '...' + PAGO_CUP_TARJETA.substring(-4) : '❌ No configurada'}`);
    console.log(`🪙 USDT Address: ${PAGO_USDT_ADDRESS ? PAGO_USDT_ADDRESS.substring(0, 10) + '...' + PAGO_USDT_ADDRESS.substring(-10) : '❌ No configurada'}`);
});
