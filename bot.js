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
const cors = require('cors');

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

// Configuración del servidor
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
    console.error('❌ Faltan variables críticas de entorno. Verifica TELEGRAM_TOKEN, DB_URL, DB_KEY');
    process.exit(1);
}

if (!WEBHOOK_SECRET_KEY) {
    console.warn('⚠️ WEBHOOK_SECRET_KEY no configurada. ¡Esto es un riesgo de seguridad!');
}

// ============================================
// INICIALIZACIÓN
// ============================================

// Inicializar Express
const app = express();

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/css', express.static(__dirname + '/public/css'));
app.use('/js', express.static(__dirname + '/public/js'));
app.use('/assets', express.static(__dirname + '/public/assets'));

// Configuración de sesión para el panel web
app.use(session({
    secret: WEBHOOK_SECRET_KEY || 'cromwell-store-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Middleware de depuración para sesiones
app.use((req, res, next) => {
    console.log('🔍 Información de sesión:', {
        sessionId: req.sessionID,
        userId: req.session.userId,
        authenticated: req.session.authenticated,
        path: req.path
    });
    next();
});

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

// Middleware para verificar token webhook
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
        console.log('✅ Usuario autenticado:', req.session.userId);
        next();
    } else {
        console.log('❌ Usuario no autenticado');
        // Para solicitudes API, retornar JSON
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        // Para páginas HTML, redirigir a login
        res.redirect('/');
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
    
    if (currency === 'usdt' || currency === 'cwt') {
        return `${parseFloat(amount).toFixed(2)} ${symbol}`;
    }
    
    return `$${parseFloat(amount).toFixed(2)} ${symbol}`;
}

// Obtener usuario por Telegram ID
async function getUser(telegramId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
    
    if (error) {
        console.log('Error obteniendo usuario:', error);
        return null;
    }
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
    // Normalizar teléfono: remover todos los caracteres no numéricos
    const normalizedPhone = phone.replace(/[^\d]/g, '');
    
    console.log('🔍 Buscando usuario por teléfono normalizado:', normalizedPhone);
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('phone_number', normalizedPhone)
        .single();
    
    if (error) {
        console.log('Error buscando usuario por teléfono:', error);
        return null;
    }
    return data;
}

// Verificar transacción BSC
async function checkBSCTransaction(txHash, expectedAmount, expectedTo) {
    try {
        if (!BSCSCAN_API_KEY) {
            return { success: false, error: 'Clave API BSCScan no configurada' };
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

// Aplicar bono de primer depósito
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

                const mensajeUsuario = `⚠️ *Depósito por debajo del mínimo*\n\n` +
                    `Recibimos ${formatCurrency(amount, currency)} pero el mínimo es ${formatCurrency(MINIMO_CUP, 'cup')}.\n` +
                    `Este monto se ha añadido a tu saldo pendiente: *${formatCurrency(nuevoPendiente, 'cup')}*\n\n` +
                    `Cuando tus depósitos pendientes sumen ${formatCurrency(MINIMO_CUP, 'cup')} o más, se acreditarán automáticamente.\n\n` +
                    `💰 *Faltante:* ${formatCurrency(MINIMO_CUP - nuevoPendiente, 'cup')}`;
                
                await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
                
                return { success: false, message: 'Monto por debajo del mínimo, acumulado' };
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
        const mensajeUsuario = `⚠️ *Depósito por debajo del mínimo*\n\n` +
            `Recibimos ${formatCurrency(amount, currency)} pero el mínimo es ${formatCurrency(minimos[currency], currency)}.\n` +
            `Este monto no se acreditará hasta que hagas un depósito de ${formatCurrency(minimos[currency], currency)} o más.`;
        
        await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
        return { success: false, message: 'Monto por debajo del mínimo' };
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
        `🆔 ID de Transacción: \`${txId}\``;
    
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
            `📋 Solicitado: ${formatCurrency(montoSolicitado, currency)}\n` +
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
        `🆔 ID de Transacción: \`${txId}\``;
    
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
// TELEGRAM BOT - FLUJO ACTUALIZADO
// ============================================

// Teclados actualizados
const mainKeyboard = {
    inline_keyboard: [
        [{ text: '👛 Mi Billetera', callback_data: 'wallet' }],
        [{ text: '💰 Recargar Billetera', callback_data: 'recharge_menu' }],
        [{ text: '📱 Cambiar Teléfono', callback_data: 'link_phone' }],
        [{ text: '🎁 Reclamar Pago', callback_data: 'claim_payment' }],
        [{ text: '📜 Ver Términos Web', callback_data: 'view_terms_web' }],
        [{ text: '🔄 Actualizar', callback_data: 'refresh_wallet' }]
    ]
};

const walletKeyboard = {
    inline_keyboard: [
        [{ text: '💰 Recargar Billetera', callback_data: 'recharge_menu' }],
        [{ text: '📜 Historial', callback_data: 'history' }],
        [{ text: '📱 Cambiar Teléfono', callback_data: 'link_phone' }],
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

// ============================================
// MANEJO DE COMANDOS TELEGRAM
// ============================================

// Comando /start - FLUJO ACTUALIZADO
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const { id, first_name, username } = msg.from;
    
    console.log(`🚀 Usuario ${id} (${first_name}) inició el bot`);
    
    // Verificar si el usuario existe
    let user = await getUser(chatId);
    
    if (!user) {
        // Crear nuevo usuario
        user = {
            telegram_id: id,
            first_name: first_name,
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
        };
        
        await supabase.from('users').upsert(user, { onConflict: 'telegram_id' });
        user = await getUser(chatId);
    }
    
    // PASO 1: Verificar si tiene número vinculado
    if (!user.phone_number) {
        const message = `📱 *¡Bienvenido a Cromwell Store Wallet!*\n\n` +
            `👋 Hola **${first_name}**, para comenzar necesitamos vincular tu número de teléfono.\n\n` +
            `⚠️ *IMPORTANTE:* Este debe ser el número *desde el que harás los pagos* en Transfermóvil.\n\n` +
            `🔢 *Formato requerido:*\n` +
            `• 10 dígitos\n` +
            `• Comienza con 53\n` +
            `• Ejemplo: *5351234567*\n\n` +
            `Por favor, escribe tu número de teléfono:`;
        
        activeSessions[chatId] = { step: 'waiting_phone_start' };
        
        return bot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }
        });
    }
    
    // PASO 2: Verificar si aceptó términos
    if (!user.accepted_terms) {
        return handleTerms(chatId, null);
    }
    
    // PASO 3: Usuario completo - Mostrar menú principal
    const welcomeMessage = `✅ *¡Bienvenido de nuevo, ${first_name}!*\n\n` +
        `🆔 *Tu ID de Telegram es:* \`${id}\`\n\n` +
        `⚠️ *GUARDA ESTE ID* - Lo necesitarás para acceder a la web.\n\n` +
        `Solo puedes acceder a la web con tu ID de Telegram.\n\n` +
        `¿Cómo puedo ayudarte hoy?`;
    
    await bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown', 
        reply_markup: mainKeyboard 
    });
});

// ============================================
// MANEJO DE CALLBACKS
// ============================================

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
            case 'view_terms_web':
                await handleViewTermsWeb(chatId, messageId);
                break;
            default:
                console.log(`Acción no reconocida: ${action}`);
        }
    } catch (error) {
        console.error('Error en callback:', error);
        await bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.');
    }
});

// ============================================
// FUNCIONES DE MANEJO DE CALLBACKS (ACTUALIZADAS)
// ============================================

async function handleStartBack(chatId, messageId) {
    const user = await getUser(chatId);
    const message = `✅ *¡Bienvenido de nuevo, ${user.first_name}!*\n\n` +
        `🆔 *Tu ID de Telegram es:* \`${chatId}\`\n\n` +
        `⚠️ *GUARDA ESTE ID* - Lo necesitarás para acceder a la web.\n\n` +
        `Solo puedes acceder a la web con tu ID de Telegram.\n\n` +
        `¿Cómo puedo ayudarte hoy?`;
    
    await bot.editMessageText(message, {
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
        `🆔 *ID de Telegram:* \`${chatId}\`\n\n` +
        `💰 *CUP:* **${formatCurrency(user.balance_cup, 'cup')}**\n` +
        `📱 *Saldo Móvil:* **${formatCurrency(user.balance_saldo, 'saldo')}**\n` +
        `🪙 *USDT:* **${formatCurrency(user.balance_usdt, 'usdt')}**\n` +
        `🎫 *CWS (Tokens de Saldo):* **${user.tokens_cws || 0}**\n` +
        `🎟️ *CWT (Tokens de USDT):* **${(user.tokens_cwt || 0).toFixed(2)}**\n\n`;
    
    if (pendiente > 0) {
        message += `📥 *CUP Pendiente:* **${formatCurrency(pendiente, 'cup')}**\n`;
        if (faltante > 0) {
            message += `🎯 *Faltante:* ${formatCurrency(faltante, 'cup')} para el mínimo\n\n`;
        }
    }
    
    message += `📞 *Teléfono vinculado:* ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : '❌ No vinculado'}\n\n` +
        `💡 *Mínimo para usar tokens:*\n` +
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
    
    const message = `💰 *Recargar tu Billetera*\n\n` +
        `📞 *Teléfono vinculado:* +53 ${user.phone_number ? user.phone_number.substring(2) : 'No vinculado'}\n\n` +
        `Selecciona el método de pago:\n\n` +
        `⚠️ *Importante:* Usa el mismo teléfono vinculado para pagar.`;
    
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
            instrucciones = `💳 *Paga a la tarjeta:* \`${PAGO_CUP_TARJETA}\``;
        } else {
            instrucciones = `💳 *Paga a la tarjeta:* \`[NO CONFIGURADO]\``;
        }
    } else if (currency === 'saldo') {
        minimo = MINIMO_SALDO;
        maximo = 10000;
        metodoPago = 'Saldo Móvil';
        if (PAGO_SALDO_MOVIL) {
            instrucciones = `📱 *Paga al número:* \`${PAGO_SALDO_MOVIL}\``;
        } else {
            instrucciones = `📱 *Paga al número:* \`[NO CONFIGURADO]\``;
        }
        const cwsPor100 = Math.floor(minimo / 100) * CWS_PER_100_SALDO;
        extraInfo = `\n🎫 *Gana ${CWS_PER_100_SALDO} CWS por cada 100 de saldo*\n` +
            `(Ej: ${minimo} saldo = ${cwsPor100} CWS)`;
    } else if (currency === 'usdt') {
        minimo = MINIMO_USDT;
        maximo = 1000;
        metodoPago = 'USDT BEP20';
        if (PAGO_USDT_ADDRESS) {
            instrucciones = `🪙 *Dirección USDT (BEP20):*\n\`${PAGO_USDT_ADDRESS}\``;
        } else {
            instrucciones = `🪙 *Dirección USDT (BEP20):*\n\`[NO CONFIGURADO]\``;
        }
        const cwtPor10 = (minimo / 10) * CWT_PER_10_USDT;
        extraInfo = `\n🎟️ *Gana ${CWT_PER_10_USDT} CWT por cada 10 USDT*\n` +
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

async function handleConfirmDeposit(chatId, messageId, currency, amount) {
    const session = activeSessions[chatId];
    const user = await getUser(chatId);
    
    if (!user) {
        if (messageId) {
            await bot.editMessageText('❌ No se pudo obtener tu información.', {
                chat_id: chatId,
                message_id: messageId
            });
        } else {
            await bot.sendMessage(chatId, '❌ No se pudo obtener tu información.');
        }
        return;
    }
    
    // Si no se pasa el monto, obtenerlo de la sesión
    if (!amount && session && session.amount) {
        amount = session.amount;
    }
    
    if (!amount) {
        if (messageId) {
            await bot.editMessageText('❌ No se encontró el monto. Por favor, inicia el depósito nuevamente.', {
                chat_id: chatId,
                message_id: messageId
            });
        } else {
            await bot.sendMessage(chatId, '❌ No se encontró el monto. Por favor, inicia el depósito nuevamente.');
        }
        delete activeSessions[chatId];
        return;
    }
    
    // Validar límites
    const limites = { 
        cup: [MINIMO_CUP, MAXIMO_CUP], 
        saldo: [MINIMO_SALDO, 10000], 
        usdt: [MINIMO_USDT, 1000] 
    };
    
    if (amount < limites[currency][0] || amount > limites[currency][1]) {
        const mensaje = `❌ *Monto fuera de límites*\n\n` +
            `Debe estar entre ${formatCurrency(limites[currency][0], currency)} y ${formatCurrency(limites[currency][1], currency)}.\n\n` +
            `Por favor, inicia el depósito nuevamente.`;
        
        if (messageId) {
            await bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            });
        } else {
            await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        }
        delete activeSessions[chatId];
        return;
    }
    
    // Crear orden de depósito
    const { data: transaction, error } = await supabase
        .from('transactions')
        .insert([{
            user_id: chatId,
            type: 'DEPOSIT',
            currency: currency,
            amount_requested: amount,
            status: 'pending',
            user_name: user.first_name,
            user_username: user.username,
            user_phone: user.phone_number,
            usdt_wallet: currency === 'usdt' ? (session ? session.usdtWallet : null) : null
        }])
        .select()
        .single();
    
    if (error) {
        console.error('Error creando transacción:', error);
        const mensajeError = '❌ Ocurrió un error al crear la orden de depósito.';
        
        if (messageId) {
            await bot.editMessageText(mensajeError, {
                chat_id: chatId,
                message_id: messageId
            });
        } else {
            await bot.sendMessage(chatId, mensajeError);
        }
        return;
    }
    
    // Preparar instrucciones según el método
    let instrucciones = '';
    let metodoPago = '';
    let bonoPorcentaje = currency === 'usdt' ? '5%' : '10%';
    
    if (currency === 'cup') {
        metodoPago = 'Tarjeta';
        if (PAGO_CUP_TARJETA) {
            instrucciones = `💳 *Paga a la tarjeta:* \`${PAGO_CUP_TARJETA}\``;
        } else {
            instrucciones = `💳 *Paga a la tarjeta:* \`[NO CONFIGURADO]\``;
        }
    } else if (currency === 'saldo') {
        metodoPago = 'Saldo Móvil';
        if (PAGO_SALDO_MOVIL) {
            instrucciones = `📱 *Paga al número:* \`${PAGO_SALDO_MOVIL}\``;
        } else {
            instrucciones = `📱 *Paga al número:* \`[NO CONFIGURADO]\``;
        }
    } else if (currency === 'usdt') {
        metodoPago = 'USDT BEP20';
        if (PAGO_USDT_ADDRESS) {
            instrucciones = `🪙 *Envía USDT a la dirección (BEP20):*\n\`${PAGO_USDT_ADDRESS}\``;
        } else {
            instrucciones = `🪙 *Envía USDT a la dirección (BEP20):*\n\`[NO CONFIGURADO]\``;
        }
    }
    
    // Calcular bono y tokens
    const bono = user[`first_dep_${currency}`] ? amount * (currency === 'usdt' ? 0.05 : 0.10) : 0;
    const totalConBono = amount + bono;
    const tokens = calcularTokens(amount, currency);
    
    const mensaje = `✅ *Orden de depósito creada*\n\n` +
        `🆔 *Número de orden:* ${transaction.id}\n` +
        `💰 *Monto solicitado:* ${formatCurrency(amount, currency)}\n` +
        `🎁 *Bono por primer depósito:* ${formatCurrency(bono, currency)} (${bonoPorcentaje})\n` +
        `💵 *Total a acreditar:* ${formatCurrency(totalConBono, currency)}\n` +
        `🎫 *Tokens a ganar:* ${tokens} ${currency === 'saldo' ? 'CWS' : 'CWT'}\n\n` +
        `*Instrucciones de pago:*\n` +
        `${instrucciones}\n\n` +
        `⚠️ *IMPORTANTE:*\n` +
        `• Realiza el pago con el teléfono vinculado: +53 ${user.phone_number.substring(2)}\n` +
        `• El monto debe ser exactamente ${formatCurrency(amount, currency)}\n` +
        `• Para CUP/Saldo: Activa "Mostrar número al destinatario" en Transfermóvil\n` +
        `• Guarda el comprobante de la transacción\n\n` +
        `Una vez realizado el pago, el sistema lo detectará automáticamente.`;
    
    if (messageId) {
        await bot.editMessageText(mensaje, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: backKeyboard('start_back')
        });
    } else {
        await bot.sendMessage(chatId, mensaje, {
            parse_mode: 'Markdown',
            reply_markup: backKeyboard('start_back')
        });
    }
    
    // Limpiar sesión
    delete activeSessions[chatId];
}

async function handleTerms(chatId, messageId) {
    const terms = `📜 *Términos y Condiciones de Cromwell Store*\n\n` +
        `1. *ACEPTACIÓN*: Al usar este servicio, aceptas estos términos.\n\n` +
        `2. *PROPÓSITO*: La billetera es exclusiva para pagos en Cromwell Store. El dinero no es retirable, excepto los bonos que son utilizables para recargas.\n\n` +
        `3. *DEPÓSITOS*:\n` +
        `   • Mínimos: CUP=${MINIMO_CUP}, Saldo=${MINIMO_SALDO}, USDT=${MINIMO_USDT}\n` +
        `   • Bonos solo en el primer depósito por método\n` +
        `   • Los tokens no son retirables, solo utilizables en la tienda\n\n` +
        `4. *TOKENS*:\n` +
        `   • CWS: Gana ${CWS_PER_100_SALDO} por cada 100 de saldo\n` +
        `   • CWT: Gana ${CWT_PER_10_USDT} por cada 10 USDT\n` +
        `   • Mínimo para usar: CWT=${MIN_CWT_USE}, CWS=${MIN_CWS_USE}\n\n` +
        `5. *SEGURIDAD*:\n` +
        `   • Toma capturas de pantalla de todas las transacciones\n` +
        `   • ETECSA puede fallar con las notificaciones SMS\n` +
        `   • Tu responsabilidad guardar los recibos\n\n` +
        `6. *REEMBOLSOS*:\n` +
        `   • Si envías dinero y no se acredita pero tienes captura válida\n` +
        `   • Contacta al administrador dentro de 24 horas\n` +
        `   • Se investigará y resolverá en 48 horas máximo\n\n` +
        `7. *PROHIBIDO*:\n` +
        `   • Uso fraudulento o múltiples cuentas\n` +
        `   • Lavado de dinero o actividades ilegales\n` +
        `   • Spam o abuso del sistema\n\n` +
        `8. *MODIFICACIONES*: Podemos cambiar estos términos notificando con 72 horas de anticipación.\n\n` +
        `_Última actualización: ${new Date().toLocaleDateString()}_\n\n` +
        `⚠️ *Para ver estos términos y condiciones nuevamente, visita nuestra web.*`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '✅ Aceptar Términos', callback_data: 'accept_terms' }]
        ]
    };
    
    if (messageId) {
        await bot.editMessageText(terms, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } else {
        await bot.sendMessage(chatId, terms, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
}

async function handleAcceptTerms(chatId, messageId) {
    await updateUser(chatId, { accepted_terms: true });
    
    const user = await getUser(chatId);
    const message = `✅ *¡Términos aceptados!*\n\n` +
        `🆔 *Tu ID de Telegram es:* \`${chatId}\`\n\n` +
        `⚠️ *GUARDA ESTE ID* - Lo necesitarás para acceder a la web.\n\n` +
        `Solo puedes acceder a la web con tu ID de Telegram.\n\n` +
        `Ahora puedes usar todos los servicios de Cromwell Store.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
    });
}

async function handleLinkPhone(chatId, messageId) {
    const user = await getUser(chatId);
    
    let message = `📱 *Cambiar Teléfono Vinculado*\n\n`;
    
    if (user.phone_number) {
        message += `📞 *Teléfono actual:* +53 ${user.phone_number.substring(2)}\n\n`;
    }
    
    message += `Por favor, escribe tu nuevo número de teléfono:\n\n` +
        `🔢 *Formato requerido:*\n` +
        `• 10 dígitos\n` +
        `• Comienza con 53\n` +
        `• Ejemplo: *5351234567*\n\n` +
        `⚠️ *IMPORTANTE:* Este debe ser el número *desde el que harás los pagos* en Transfermóvil.`;
    
    activeSessions[chatId] = { 
        step: 'waiting_phone_change',
        oldPhone: user.phone_number 
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleEnterPhone(chatId, messageId) {
    const message = `📱 *Ingresa tu número*\n\n` +
        `Formato: 535XXXXXXX\n` +
        `Ejemplo: 5351234567\n\n` +
        `⚠️ Debe ser el mismo de Transfermóvil desde el que pagarás.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleClaimPayment(chatId, messageId) {
    const message = `🎁 *Reclamar Pago*\n\n` +
        `Para pagos que no fueron detectados automáticamente:\n\n` +
        `1. Pagos *Tarjeta → Billetera* (sin número visible)\n` +
        `2. Pagos que necesitan ID de transacción\n` +
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
        `Encuentra el ID en tu SMS de Transfermóvil:\n\n` +
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
    const user = await getUser(chatId);
    const phone = user.phone_number;
    
    const { data: pendingPayments } = await supabase
        .from('pending_sms_payments')
        .select('*')
        .eq('claimed', false)
        .or(`user_id.eq.${chatId},phone.eq.${phone}`)
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
            message += `📊 ${tx.status === 'completed' ? 'Completado' : tx.status === 'pending' ? 'Pendiente' : tx.status}\n`;
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
    
    let message = `📊 *Saldo CUP Pendiente*\n\n`;
    
    if (pendiente > 0) {
        message += `💰 *Acumulado:* ${formatCurrency(pendiente, 'cup')}\n`;
        
        if (user.first_dep_cup) {
            message += `🎁 *Bono disponible:* ${formatCurrency(bono, 'cup')} (10%)\n`;
            message += `💵 *Total con bono:* ${formatCurrency(totalConBono, 'cup')}\n`;
        }
        
        if (faltante > 0) {
            message += `\n❌ *Faltante:* ${formatCurrency(faltante, 'cup')}\n`;
            message += `Haz otro depósito de ${formatCurrency(faltante, 'cup')} o más.`;
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
        `Ejemplo: 0x742d35Cc6634C0532925a3b844Bc9e8e64dA7F2E\n\n` +
        `⚠️ Esta wallet se vinculará a tu cuenta.`;
    
    activeSessions[chatId] = { step: 'waiting_usdt_wallet' };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleViewTermsWeb(chatId, messageId) {
    const message = `🌐 *Términos y Condiciones en la Web*\n\n` +
        `Para ver los términos y condiciones actualizados, visita nuestro sitio web.\n\n` +
        `Una vez que hayas iniciado sesión con tu ID de Telegram, podrás verlos en la sección correspondiente.\n\n` +
        `⚠️ *Recuerda:* Tu ID de Telegram es: \`${chatId}\``;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('start_back')
    });
}

// ============================================
// MANEJO DE MENSAJES DE TEXTO TELEGRAM
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
                case 'waiting_phone_start':
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

// Función para manejar entrada de teléfono (ACTUALIZADA)
async function handlePhoneInput(chatId, phone, session) {
    // Limpiar número: remover espacios, guiones, paréntesis, etc.
    let cleanPhone = phone.replace(/[^\d]/g, '');
    
    console.log(`📱 Número recibido: ${phone}, Limpio: ${cleanPhone}`);
    
    // Validar formato
    if (!cleanPhone.startsWith('53')) {
        // Si no comienza con 53, agregarlo (asumiendo que es un número cubano)
        if (cleanPhone.length === 8) {
            cleanPhone = '53' + cleanPhone;
        } else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
            // Si tiene 9 dígitos y comienza con 5, agregar 53 al principio
            cleanPhone = '53' + cleanPhone;
        } else {
            await bot.sendMessage(chatId,
                `❌ *Formato incorrecto*\n\n` +
                `El número debe comenzar con *53* y tener 10 dígitos.\n\n` +
                `Ejemplos válidos:\n` +
                `• *5351234567* (10 dígitos)\n` +
                `• *51234567* (8 dígitos, se completará a 5351234567)\n\n` +
                `Inténtalo de nuevo:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
    }
    
    // Validar longitud final (debe tener 10 dígitos: 53 + 8 dígitos)
    if (cleanPhone.length !== 10) {
        await bot.sendMessage(chatId,
            `❌ *Longitud incorrecta*\n\n` +
            `El número debe tener *10 dígitos* (53 + 8 dígitos).\n\n` +
            `Ejemplo: *5351234567*\n\n` +
            `Inténtalo de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Verificar que sea un número válido (solo dígitos después de limpiar)
    if (!/^\d+$/.test(cleanPhone)) {
        await bot.sendMessage(chatId,
            `❌ *Caracteres inválidos*\n\n` +
            `El número solo debe contener dígitos.\n\n` +
            `Inténtalo de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Verificar si el número ya está en uso por otro usuario
    const { data: existingUser } = await supabase
        .from('users')
        .select('telegram_id, first_name')
        .eq('phone_number', cleanPhone)
        .neq('telegram_id', chatId)
        .single();
    
    if (existingUser) {
        await bot.sendMessage(chatId,
            `❌ *Teléfono ya en uso*\n\n` +
            `Este número ya está vinculado a otra cuenta.\n` +
            `👤 Usuario: ${existingUser.first_name}\n\n` +
            `Si es tu número, contacta al administrador.`,
            { parse_mode: 'Markdown' }
        );
        
        // Si es el flujo de inicio, mostrar mensaje para intentar de nuevo
        if (session.step === 'waiting_phone_start') {
            activeSessions[chatId] = { step: 'waiting_phone_start' };
        }
        
        return;
    }
    
    // Guardar número normalizado
    await updateUser(chatId, { phone_number: cleanPhone });
    
    let message = '';
    if (session.step === 'waiting_phone_change' && session.oldPhone) {
        message = `✅ *Teléfono actualizado*\n\n` +
            `📱 *Anterior:* +53 ${session.oldPhone.substring(2)}\n` +
            `📱 *Nuevo:* +53 ${cleanPhone.substring(2)}\n\n` +
            `Ahora los pagos se detectarán con este número.`;
    } else if (session.step === 'waiting_phone_start') {
        message = `✅ *¡Teléfono vinculado!*\n\n` +
            `📱 *Número:* +53 ${cleanPhone.substring(2)}\n\n` +
            `⚠️ *IMPORTANTE:*\n` +
            `• Usa este mismo número en Transfermóvil\n` +
            `• Desde este número harás los pagos\n` +
            `• Mantén activa la opción "Mostrar número al destinatario"\n\n` +
            `Ahora debes aceptar los términos y condiciones para continuar.`;
    } else {
        message = `✅ *¡Teléfono vinculado!*\n\n` +
            `📱 *Número:* +53 ${cleanPhone.substring(2)}\n\n` +
            `Ahora tus pagos se detectarán automáticamente cuando:\n` +
            `✅ Envíes desde Tarjeta→Tarjeta\n` +
            `✅ Envíes desde Billetera→Tarjeta\n` +
            `✅ Envíes desde Billetera→Billetera\n\n` +
            `⚠️ *Para pagos Tarjeta→Billetera:*\n` +
            `Usa '🎁 Reclamar Pago'\n\n` +
            `💡 Siempre usa este número en Transfermóvil.`;
    }
    
    // Enviar mensaje apropiado
    if (session.step === 'waiting_phone_start') {
        // Después de vincular teléfono al inicio, mostrar términos
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        await handleTerms(chatId, null);
    } else {
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: mainKeyboard
        });
    }
    
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
                    `${formatCurrency(pendingPayment.amount, pendingPayment.currency)} ha sido acreditado a tu billetera.`,
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
                `Si ya hiciste el pago, espera a que se detecte automáticamente.\n` +
                `Si no se detecta en 10 minutos, contacta al administrador.`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
        } else {
            await bot.sendMessage(chatId,
                `❌ *ID no encontrado*\n\n` +
                `No encontramos pagos pendientes con ID: \`${txIdClean}\`\n\n` +
                `Verifica:\n` +
                `1. Que el ID sea correcto\n` +
                `2. Que el pago sea *Tarjeta→Billetera*\n` +
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
            `Esta wallet se vinculará a tu cuenta.`,
            { parse_mode: 'Markdown' }
        );
    } else {
        session.amount = amount;
        await handleConfirmDeposit(chatId, null, currency, amount);
    }
}

async function handleUsdtWalletInput(chatId, wallet, session) {
    if (!wallet.startsWith('0x') || wallet.length !== 42) {
        await bot.sendMessage(chatId,
            `❌ *Dirección inválida*\n\n` +
            `Debe comenzar con "0x" y tener 42 caracteres.\n\n` +
            `Ejemplo válido:\n\`0x742d35Cc6634C0532925a3b844Bc9e8e64dA7F2E\`\n\n` +
            `Inténtalo de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    session.usdtWallet = wallet;
    await updateUser(chatId, { usdt_wallet: wallet });
    
    await handleConfirmDeposit(chatId, null, 'usdt', session.amount);
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
                `El pago ha sido acreditado a tu billetera.`,
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
// ENDPOINT PARA RECIBIR PAGOS DEL PARSER
// ============================================

app.post('/payment-notification', verifyWebhookToken, async (req, res) => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('📥 PAYMENT-NOTIFICATION RECIBIDA EN EL BOT');
        console.log('🕐 Hora:', new Date().toISOString());
        console.log('📦 Datos recibidos COMPLETOS:');
        console.log(JSON.stringify(req.body, null, 2));
        console.log('📋 Headers recibidos:', {
            'x-auth-token': req.headers['x-auth-token'],
            'content-type': req.headers['content-type']
        });
        console.log('='.repeat(80) + '\n');
        
        const { 
            type, 
            amount, 
            currency, 
            tx_id, 
            tipo_pago, 
            phone, 
            tarjeta_destino, 
            raw_message,
            auth_token,
            source
        } = req.body;
        
        // Validar campos requeridos
        if (!type || !amount || !currency || !tx_id) {
            console.log('❌ Campos requeridos faltantes en payload');
            return res.status(400).json({ 
                success: false, 
                message: 'Campos requeridos faltantes: type, amount, currency, tx_id' 
            });
        }
        
        // Verificar token (ya hecho por middleware, pero por si acaso)
        if (auth_token && auth_token !== WEBHOOK_SECRET_KEY) {
            console.log('❌ Token de autenticación inválido en payload');
            console.log(`🔑 Token recibido: ${auth_token ? auth_token.substring(0, 10) + '...' : 'No proporcionado'}`);
            console.log(`🔑 Token esperado: ${WEBHOOK_SECRET_KEY ? WEBHOOK_SECRET_KEY.substring(0, 10) + '...' : 'No configurado'}`);
            return res.status(403).json({ 
                success: false, 
                message: 'Token de autenticación inválido' 
            });
        }
        
        // Procesar según tipo
        switch (type) {
            case 'SMS_PAYMENT_DETECTED':
                console.log(`🔍 Procesando SMS_PAYMENT_DETECTED`);
                console.log(`📞 Teléfono recibido: ${phone}`);
                console.log(`💰 Monto: ${amount} ${currency}`);
                console.log(`🆔 TX ID: ${tx_id}`);
                console.log(`🔧 Tipo Pago: ${tipo_pago}`);
                console.log(`💳 Tarjeta Destino: ${tarjeta_destino}`);
                
                let user = null;
                let normalizedPhone = null;
                
                // Si hay teléfono, buscar usuario
                if (phone) {
                    normalizedPhone = phone.replace(/[^\d]/g, '');
                    console.log(`🔍 Buscando usuario con teléfono normalizado: ${normalizedPhone}`);
                    
                    user = await getUserByPhone(normalizedPhone);
                    
                    if (user) {
                        console.log(`✅ Usuario encontrado:`);
                        console.log(`   ID: ${user.telegram_id}`);
                        console.log(`   Nombre: ${user.first_name}`);
                        console.log(`   Teléfono en DB: ${user.phone_number}`);
                        console.log(`   Username: ${user.username || 'No tiene'}`);
                        
                        // Procesar pago automático
                        console.log(`🚀 Procesando pago automático para usuario ${user.telegram_id}`);
                        
                        const result = await procesarPagoAutomatico(
                            user.telegram_id, 
                            amount, 
                            currency, 
                            tx_id, 
                            tipo_pago
                        );
                        
                        console.log(`✅ Resultado del procesamiento:`, result);
                        
                        // Notificar al admin
                        if (ADMIN_CHAT_ID && result.success) {
                            const mensajeAdmin = `✅ *PAGO DETECTADO Y PROCESADO*\n\n` +
                                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                                `🆔 ID: ${user.telegram_id}\n` +
                                `📞 Teléfono: ${normalizedPhone}\n` +
                                `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                                `🔧 Tipo: ${tipo_pago}\n` +
                                `💳 Tarjeta: ${tarjeta_destino}\n` +
                                `🆔 TX ID: \`${tx_id}\`\n\n` +
                                `🎁 Bono aplicado: ${result.montoConBono ? formatCurrency(result.montoConBono - amount, currency) : '0'}\n` +
                                `🎫 Tokens: ${result.tokensGanados || 0}`;
                            
                            await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                        }
                        
                        return res.json(result);
                    } else {
                        console.log(`❌ Usuario NO encontrado para teléfono: ${normalizedPhone}`);
                        
                        // Guardar como pago pendiente
                        console.log(`📝 Guardando como pago pendiente...`);
                        
                        const { data, error } = await supabase
                            .from('pending_sms_payments')
                            .insert({
                                phone: normalizedPhone,
                                amount: amount,
                                currency: currency,
                                tx_id: tx_id,
                                tipo_pago: tipo_pago,
                                tarjeta_destino: tarjeta_destino,
                                raw_message: raw_message,
                                claimed: false,
                                created_at: new Date().toISOString()
                            });
                        
                        if (error) {
                            console.error('❌ Error guardando pago pendiente:', error);
                            return res.status(500).json({ 
                                success: false, 
                                message: 'Error guardando pago pendiente',
                                error: error.message 
                            });
                        }
                        
                        console.log(`✅ Pago pendiente guardado para teléfono: ${normalizedPhone}`);
                        
                        // Notificar al admin
                        if (ADMIN_CHAT_ID) {
                            const mensajeAdmin = `📱 *PAGO NO IDENTIFICADO*\n\n` +
                                `📞 Teléfono: ${normalizedPhone}\n` +
                                `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                                `🔧 Tipo: ${tipo_pago}\n` +
                                `💳 Tarjeta: ${tarjeta_destino}\n` +
                                `🆔 ID: \`${tx_id}\`\n\n` +
                                `ℹ️ Este pago está pendiente de reclamar.\n` +
                                `Mensaje: ${raw_message.substring(0, 100)}...`;
                            
                            await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                        }
                        
                        return res.json({ 
                            success: false, 
                            message: 'Usuario no encontrado, pago guardado como pendiente',
                            phone: normalizedPhone,
                            tx_id: tx_id,
                            tipo_pago: tipo_pago
                        });
                    }
                } else {
                    // Pago sin teléfono (tarjeta a monedero)
                    console.log(`⚠️ Pago sin teléfono: ${tx_id}, Tipo: ${tipo_pago}`);
                    
                    // Guardar como pago pendiente
                    const { data, error } = await supabase
                        .from('pending_sms_payments')
                        .insert({
                            phone: null,
                            amount: amount,
                            currency: currency,
                            tx_id: tx_id,
                            tipo_pago: tipo_pago,
                            tarjeta_destino: tarjeta_destino,
                            raw_message: raw_message,
                            claimed: false,
                            created_at: new Date().toISOString()
                        });
                    
                    if (error) {
                        console.error('❌ Error guardando pago pendiente:', error);
                        return res.status(500).json({ 
                            success: false, 
                            message: 'Error guardando pago pendiente',
                            error: error.message 
                        });
                    }
                    
                    console.log(`✅ Pago pendiente guardado (sin teléfono)`);
                    
                    // Notificar al admin
                    if (ADMIN_CHAT_ID) {
                        const mensajeAdmin = `📱 *PAGO SIN TELÉFONO*\n\n` +
                            `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                            `🔧 Tipo: ${tipo_pago}\n` +
                            `💳 Tarjeta: ${tarjeta_destino}\n` +
                            `🆔 ID: \`${tx_id}\`\n\n` +
                            `ℹ️ Este pago no tiene teléfono asociado.`;
                        
                        await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                    }
                    
                    return res.json({ 
                        success: false, 
                        message: 'Pago sin teléfono, guardado como pendiente',
                        tx_id: tx_id
                    });
                }
                break;
                
            case 'AUTO_PAYMENT':
                // Para compatibilidad con versiones antiguas
                console.log(`🔄 Procesando AUTO_PAYMENT (legacy)`);
                const { user_id } = req.body;
                
                if (!user_id) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'user_id requerido para AUTO_PAYMENT' 
                    });
                }
                
                const result = await procesarPagoAutomatico(user_id, amount, currency, tx_id, tipo_pago);
                return res.json(result);
                
            case 'PENDING_PAYMENT':
                // Para compatibilidad
                console.log(`📝 Guardando PENDING_PAYMENT (legacy)`);
                const { data, error } = await supabase.from('pending_sms_payments').insert({
                    phone: phone,
                    amount: amount,
                    currency: currency,
                    tx_id: tx_id,
                    tipo_pago: tipo_pago,
                    tarjeta_destino: tarjeta_destino,
                    raw_message: raw_message,
                    claimed: false
                });
                
                if (error) {
                    return res.status(500).json({ success: false, error: error.message });
                } else {
                    return res.json({ success: true, message: 'Pago pendiente registrado' });
                }
                
            default:
                console.log(`❌ Tipo de notificación desconocido: ${type}`);
                return res.status(400).json({ 
                    success: false, 
                    message: 'Tipo de notificación desconocido',
                    received_type: type 
                });
        }
        
    } catch (error) {
        console.error('❌ Error en payment-notification:', error);
        console.error('Stack trace:', error.stack);
        
        // Enviar error al admin
        if (ADMIN_CHAT_ID) {
            const errorMsg = `❌ *ERROR EN PAYMENT-NOTIFICATION*\n\n` +
                `Error: ${error.message}\n` +
                `Hora: ${new Date().toLocaleString()}\n` +
                `Body recibido: ${JSON.stringify(req.body).substring(0, 200)}...`;
            
            try {
                await bot.sendMessage(ADMIN_CHAT_ID, errorMsg, { parse_mode: 'Markdown' });
            } catch (botError) {
                console.error('Error enviando mensaje de error:', botError);
            }
        }
        
        return res.status(500).json({ 
            success: false, 
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ============================================
// FUNCIÓN PARA BUSCAR USUARIO POR TELÉFONO (MEJORADA CON LOGS)
// ============================================

async function getUserByPhone(phone) {
    try {
        if (!phone) {
            console.log('❌ No se proporcionó teléfono para buscar');
            return null;
        }
        
        // Normalizar teléfono: remover todos los caracteres no numéricos
        const normalizedPhone = phone.replace(/[^\d]/g, '');
        console.log(`🔍 Buscando usuario con teléfono normalizado: ${normalizedPhone}`);
        
        // Si el teléfono tiene menos de 8 dígitos, no es válido
        if (normalizedPhone.length < 8) {
            console.log(`❌ Teléfono demasiado corto: ${normalizedPhone}`);
            return null;
        }
        
        // Preparar diferentes formatos para buscar
        let searchPatterns = [];
        
        // Si el teléfono comienza con 53 y tiene 10 dígitos
        if (normalizedPhone.startsWith('53') && normalizedPhone.length === 10) {
            searchPatterns.push(normalizedPhone); // 5351234567
            searchPatterns.push(normalizedPhone.substring(2)); // 51234567 (sin 53)
        } 
        // Si el teléfono tiene 8 dígitos (asumimos que es sin 53)
        else if (normalizedPhone.length === 8) {
            searchPatterns.push(`53${normalizedPhone}`); // 5351234567
            searchPatterns.push(normalizedPhone); // 51234567
        }
        // Otros formatos
        else {
            searchPatterns.push(normalizedPhone);
            // Si tiene 9 dígitos y comienza con 5
            if (normalizedPhone.length === 9 && normalizedPhone.startsWith('5')) {
                searchPatterns.push(`53${normalizedPhone}`); // 53512345678
                searchPatterns.push(normalizedPhone.substring(1)); // 12345678 (sin el 5 inicial)
            }
        }
        
        // Eliminar duplicados
        searchPatterns = [...new Set(searchPatterns)];
        
        console.log(`🔍 Patrones de búsqueda a probar:`, searchPatterns);
        
        // Buscar en la base de datos con cada patrón
        for (const pattern of searchPatterns) {
            console.log(`🔍 Probando patrón: ${pattern}`);
            
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('phone_number', pattern)
                .single();
            
            if (error) {
                if (error.code !== 'PGRST116') { // PGRST116 = no rows returned (es esperado)
                    console.log(`⚠️ Error buscando con patrón ${pattern}:`, error.message);
                }
            }
            
            if (data) {
                console.log(`✅ Usuario encontrado con patrón ${pattern}:`, {
                    id: data.telegram_id,
                    name: data.first_name,
                    phone_in_db: data.phone_number
                });
                return data;
            }
        }
        
        // Si no se encontró con búsqueda exacta, buscar por coincidencia parcial (últimos 8 dígitos)
        console.log(`🔍 Buscando por coincidencia parcial (últimos 8 dígitos)...`);
        const last8Digits = normalizedPhone.slice(-8);
        
        const { data: allUsers, error: allUsersError } = await supabase
            .from('users')
            .select('*')
            .not('phone_number', 'is', null);
        
        if (allUsersError) {
            console.log(`⚠️ Error obteniendo todos los usuarios:`, allUsersError.message);
            return null;
        }
        
        if (allUsers && allUsers.length > 0) {
            for (const user of allUsers) {
                if (user.phone_number) {
                    const dbPhone = user.phone_number.replace(/[^\d]/g, '');
                    
                    // Comparar últimos 8 dígitos
                    if (dbPhone.endsWith(last8Digits)) {
                        console.log(`✅ Usuario encontrado por coincidencia parcial:`, {
                            id: user.telegram_id,
                            name: user.first_name,
                            phone_in_db: user.phone_number,
                            last_8_digits: dbPhone.slice(-8)
                        });
                        return user;
                    }
                    
                    // También comparar si el teléfono de la DB termina con los últimos 8 dígitos del teléfono buscado
                    // o viceversa
                    if (last8Digits.endsWith(dbPhone.slice(-8)) || dbPhone.endsWith(last8Digits.slice(-8))) {
                        console.log(`✅ Coincidencia flexible encontrada:`, {
                            id: user.telegram_id,
                            name: user.first_name,
                            phone_in_db: user.phone_number
                        });
                        return user;
                    }
                }
            }
        }
        
        console.log(`❌ Usuario no encontrado para ningún patrón de teléfono`);
        return null;
        
    } catch (error) {
        console.error('❌ Error en getUserByPhone:', error);
        console.error('Stack:', error.stack);
        return null;
    }
}
// Endpoint keep alive
app.get('/keepalive', (req, res) => {
    res.json({ 
        status: 'alive', 
        timestamp: new Date().toISOString(),
        service: 'cromwell-bot-server',
        uptime: process.uptime(),
        security_enabled: !!WEBHOOK_SECRET_KEY
    });
});

// 1. Login web - SOLO CON ID DE TELEGRAM
app.post('/api/login', async (req, res) => {
    try {
        console.log('🔑 Intento de login:', req.body);
        const { identifier, password } = req.body;
        
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Credenciales faltantes' });
        }
        
        // SOLO aceptar ID de Telegram (debe ser un número)
        const telegramId = parseInt(identifier);
        if (isNaN(telegramId)) {
            return res.status(400).json({ error: 'Solo ID de Telegram (número) está permitido' });
        }
        
        // Buscar usuario por ID de Telegram
        const user = await getUser(telegramId);
        
        if (!user) {
            console.log('❌ Usuario no encontrado:', telegramId);
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar contraseña web (si tienen una)
        if (user.web_password) {
            const validPassword = await bcrypt.compare(password, user.web_password);
            if (!validPassword) {
                console.log('❌ Contraseña incorrecta para usuario:', telegramId);
                return res.status(401).json({ error: 'Contraseña incorrecta' });
            }
        } else {
            // Usuario no tiene contraseña web registrada
            console.log('ℹ️ Usuario sin contraseña web:', telegramId);
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

        // Guardar sesión explícitamente
        req.session.save((err) => {
            if (err) {
                console.error('Error guardando sesión:', err);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            
            console.log('✅ Sesión creada para:', user.telegram_id);
            console.log('✅ SessionID:', req.sessionID);
            
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
        });
        
    } catch (error) {
        console.error('❌ Error en login web:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 2. Registro de contraseña web - SOLO CON ID DE TELEGRAM
app.post('/api/register-password', async (req, res) => {
    try {
        const { identifier, password, confirmPassword } = req.body;
        
        if (!identifier || !password || !confirmPassword) {
            return res.status(400).json({ error: 'Datos faltantes' });
        }
        
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Las contraseñas no coinciden' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }
        
        // SOLO aceptar ID de Telegram
        const telegramId = parseInt(identifier);
        if (isNaN(telegramId)) {
            return res.status(400).json({ error: 'Solo ID de Telegram (número) está permitido' });
        }
        
        const user = await getUser(telegramId);
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar si ya tiene contraseña
        if (user.web_password) {
            return res.status(400).json({ error: 'Ya tienes una contraseña registrada' });
        }
        
        // Hashear contraseña
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

// 3. Obtener datos de usuario (protegido)
app.get('/api/user-data', requireAuth, async (req, res) => {
    try {
        console.log('📊 Obteniendo datos para usuario:', req.session.userId);
        
        const user = await getUser(req.session.userId);
        
        if (!user) {
            console.log('❌ Usuario no encontrado en sesión:', req.session.userId);
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
                accepted_terms: user.accepted_terms || false,
                first_dep_cup: user.first_dep_cup || true,
                first_dep_saldo: user.first_dep_saldo || true,
                first_dep_usdt: user.first_dep_usdt || true
            },
            transactions: transactions || [],
            pendingPayments: pendingPayments || [],
            stats: {
                total_deposits: transactions ? transactions.filter(t => t.type === 'DEPOSIT' && t.status === 'completed').length : 0,
                total_amount: transactions ? transactions.filter(t => t.status === 'completed').reduce((sum, t) => sum + (t.amount || 0), 0) : 0,
                pending_count: pendingPayments ? pendingPayments.length : 0
            }
        });
        
        console.log('✅ Datos enviados para usuario:', user.telegram_id);
        
    } catch (error) {
        console.error('❌ Error obteniendo datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 4. Crear solicitud de depósito web
app.post('/api/create-deposit', requireAuth, async (req, res) => {
    try {
        const { currency, amount, usdtWallet } = req.body;
        const userId = req.session.userId;
        
        if (!currency || !amount) {
            return res.status(400).json({ error: 'Datos requeridos faltantes' });
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
                return res.status(400).json({ error: 'Wallet requerida para USDT' });
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
        
        // Preparar datos de pago
        let paymentInfo = {};
        
        switch (currency) {
            case 'cup':
                paymentInfo = {
                    method: 'Tarjeta',
                    target: PAGO_CUP_TARJETA || '[NO CONFIGURADO]',
                    instructions: [
                        'Activa "Mostrar número al destinatario" en Transfermóvil',
                        `Transfiere EXACTAMENTE ${amount} CUP`,
                        `A la tarjeta: ${PAGO_CUP_TARJETA || '[NO CONFIGURADO]'}`,
                        'Usa el mismo teléfono vinculado'
                    ]
                };
                break;
            case 'saldo':
                paymentInfo = {
                    method: 'Saldo Móvil',
                    target: PAGO_SALDO_MOVIL || '[NO CONFIGURADO]',
                    instructions: [
                        `Envía saldo a: ${PAGO_SALDO_MOVIL || '[NO CONFIGURADO]'}`,
                        `Monto exacto: ${amount}`,
                        'Toma captura de pantalla de la transferencia',
                        'No esperes confirmación por SMS'
                    ]
                };
                break;
            case 'usdt':
                paymentInfo = {
                    method: 'USDT BEP20',
                    target: PAGO_USDT_ADDRESS || '[NO CONFIGURADO]',
                    instructions: [
                        `Envía USDT (BEP20) a: ${PAGO_USDT_ADDRESS || '[NO CONFIGURADO]'}`,
                        `Monto exacto: ${amount} USDT`,
                        `Desde wallet: ${usdtWallet}`,
                        'SOLO red BEP20 (Binance Smart Chain)',
                        'Guarda el hash de la transacción'
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
            return res.status(400).json({ error: 'Datos requeridos faltantes' });
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
            return res.status(400).json({ error: 'Esta orden no es USDT' });
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
        
        // Actualizar orden con hash
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
        
        // Notificar endpoint interno para procesamiento
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
        
        // Notificar endpoint interno para procesar
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
            console.error('Error contactando servicio:', botError);
            res.status(500).json({ error: 'Error procesando pago' });
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
            console.error('Error en logout:', err);
            return res.status(500).json({ error: 'Error cerrando sesión' });
        }
        console.log('✅ Sesión cerrada exitosamente');
        res.json({ success: true });
    });
});

// 8. Verificar sesión web
app.get('/api/check-session', (req, res) => {
    console.log('🔍 Verificando sesión:', req.session);
    
    if (req.session.userId && req.session.authenticated) {
        res.json({ 
            authenticated: true, 
            userId: req.session.userId,
            sessionId: req.sessionID
        });
    } else {
        res.json({ 
            authenticated: false,
            sessionId: req.sessionID
        });
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
        
        // Obtener órdenes pendientes del usuario
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
                // Encontrar transacción coincidente
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

// 10. Estadísticas de administrador
app.get('/api/admin/stats', requireAuth, async (req, res) => {
    try {
        const user = await getUser(req.session.userId);
        
        // Verificar si es administrador
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

// 11. Endpoint de depuración para ver sesiones
app.get('/api/debug', (req, res) => {
    res.json({
        session: req.session,
        sessionId: req.sessionID,
        cookies: req.cookies,
        headers: req.headers
    });
});

// 12. Depuración de todas las sesiones (solo desarrollo)
app.get('/api/debug-all-sessions', (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ error: 'Solo en desarrollo' });
    }
    
    res.json({
        activeSessions: Object.keys(activeSessions),
        totalSessions: Object.keys(activeSessions).length
    });
});

// 13. Endpoint de depuración de sesión
app.get('/api/debug-session', (req, res) => {
    res.json({
        session: req.session,
        sessionID: req.sessionID,
        cookies: req.cookies
    });
});

// 14. Ruta para archivos HTML
app.get('/', (req, res) => {
    if (req.session.authenticated) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(__dirname + '/public/index.html');
    }
});

app.get('/dashboard', (req, res) => {
    console.log('📄 Accediendo al dashboard, sesión:', req.session);
    
    if (req.session.userId && req.session.authenticated) {
        console.log('✅ Usuario autenticado, sirviendo dashboard');
        res.sendFile(__dirname + '/public/dashboard.html');
    } else {
        console.log('❌ Usuario no autenticado, redirigiendo a login');
        res.redirect('/');
    }
});

app.get('/admin', requireAuth, async (req, res) => {
    const user = await getUser(req.session.userId);
    const adminId = process.env.ADMIN_GROUP || '';
    
    if (!adminId || user.telegram_id.toString() !== adminId.replace('-100', '')) {
        return res.redirect('/dashboard');
    }
    
    res.sendFile(__dirname + '/public/admin.html');
});

// Ruta para servir cualquier archivo del dashboard
app.get('/:page', (req, res) => {
    const page = req.params.page;
    if (page.includes('.html') || page.includes('.css') || page.includes('.js') || page.includes('.ico')) {
        res.sendFile(__dirname + '/public/' + page);
    } else {
        res.redirect('/');
    }
});

// ============================================
// RUTAS ADICIONALES NECESARIAS PARA EL DASHBOARD
// ============================================

// Ruta para notificaciones
app.get('/api/notificaciones', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    // Obtener notificaciones del usuario
    const { data: notifications } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    res.json({
      success: true,
      notifications: notifications || []
    });
  } catch (error) {
    console.error('Error obteniendo notificaciones:', error);
    res.json({ success: true, notifications: [] });
  }
});

// Ruta para pagos pendientes
app.get('/api/pagos-pendientes', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await getUser(userId);
    
    const { data: pendingPayments } = await supabase
      .from('pending_sms_payments')
      .select('*')
      .eq('claimed', false)
      .or(`user_id.eq.${userId},phone.eq.${user.phone_number}`);
    
    res.json({
      success: true,
      pendingPayments: pendingPayments || []
    });
  } catch (error) {
    console.error('Error obteniendo pagos pendientes:', error);
    res.json({ success: true, pendingPayments: [] });
  }
});

// WebSocket endpoint (simulado)
app.get('/ws', (req, res) => {
  res.status(404).json({ error: 'WebSocket no implementado' });
});

// Ruta para el service worker
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.sendFile(__dirname + '/public/sw.js');
});

// Ruta para información de pago simplificada
app.get('/api/payment-info-simple', (req, res) => {
    res.json({
        cup_target: PAGO_CUP_TARJETA || 'NO CONFIGURADO',
        saldo_target: PAGO_SALDO_MOVIL || 'NO CONFIGURADO',
        usdt_target: PAGO_USDT_ADDRESS || 'NO CONFIGURADO',
        minimo_cup: MINIMO_CUP,
        minimo_saldo: MINIMO_SALDO,
        minimo_usdt: MINIMO_USDT,
        maximo_cup: MAXIMO_CUP
    });
});

// Ruta para información de pago
app.get('/api/payment-info', requireAuth, (req, res) => {
  res.json({
    cup_target: PAGO_CUP_TARJETA,
    saldo_target: PAGO_SALDO_MOVIL,
    usdt_target: PAGO_USDT_ADDRESS,
    minimo_cup: MINIMO_CUP,
    minimo_saldo: MINIMO_SALDO,
    minimo_usdt: MINIMO_USDT,
    maximo_cup: MAXIMO_CUP,
    cws_per_100: CWS_PER_100_SALDO,
    cwt_per_10: CWT_PER_10_USDT,
    min_cwt: MIN_CWT_USE,
    min_cws: MIN_CWS_USE
  });
});

// Ruta para notificaciones (nueva)
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    // Obtener transacciones recientes como notificaciones
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    // Convertir transacciones a formato de notificación
    const notifications = (transactions || []).map(tx => ({
      id: tx.id,
      title: tx.type === 'DEPOSIT' ? 'Depósito' : 
             tx.type === 'AUTO_DEPOSIT' ? 'Depósito Automático' : tx.type,
      message: `${tx.status === 'completed' ? '✅' : '⏳'} ${formatCurrency(tx.amount || tx.amount_requested, tx.currency)}`,
      type: tx.status === 'completed' ? 'success' : 
            tx.status === 'pending' ? 'warning' : 'info',
      timestamp: tx.created_at,
      read: true,
      icon: 'payment'
    }));
    
    res.json({
      success: true,
      notifications: notifications
    });
  } catch (error) {
    console.error('Error obteniendo notificaciones:', error);
    res.json({ success: true, notifications: [] });
  }
});

// Ruta para check-payment
app.get('/api/check-payment/:orderId', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.session.userId;
    
    const { data: transaction, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();
    
    if (error || !transaction) {
      return res.status(404).json({ 
        success: false, 
        error: 'Orden no encontrada' 
      });
    }
    
    res.json({
      success: true,
      status: transaction.status,
      message: transaction.status === 'completed' ? 'Pago completado' :
              transaction.status === 'pending' ? 'Pago pendiente' : 'Estado desconocido',
      transaction: transaction
    });
  } catch (error) {
    console.error('Error verificando pago:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// Ruta para cancelar depósito
app.post('/api/cancel-deposit/:orderId', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.session.userId;
    
    const { data: transaction, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .single();
    
    if (fetchError || !transaction) {
      return res.status(404).json({ 
        success: false, 
        error: 'Orden no encontrada o no cancelable' 
      });
    }
    
    const { error: updateError } = await supabase
      .from('transactions')
      .update({ status: 'cancelled' })
      .eq('id', orderId);
    
    if (updateError) {
      throw updateError;
    }
    
    res.json({
      success: true,
      message: 'Orden cancelada exitosamente'
    });
  } catch (error) {
    console.error('Error cancelando depósito:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// Ruta para buscar pago por ID
app.get('/api/search-payment/:txId', requireAuth, async (req, res) => {
  try {
    const { txId } = req.params;
    const userId = req.session.userId;
    const user = await getUser(userId);
    
    const { data: pendingPayments, error } = await supabase
      .from('pending_sms_payments')
      .select('*')
      .or(`tx_id.ilike.%${txId}%,tx_id.ilike.%${txId.toUpperCase()}%`)
      .eq('claimed', false);
    
    if (error) {
      throw error;
    }
    
    // Filtrar solo los que pertenecen al usuario
    const userPayments = (pendingPayments || []).filter(payment => 
      payment.user_id == userId || payment.phone === user.phone_number
    );
    
    res.json({
      success: true,
      results: userPayments
    });
  } catch (error) {
    console.error('Error buscando pago:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// Ruta para verificación manual
app.post('/api/manual-verification', requireAuth, async (req, res) => {
  try {
    // Esta es una ruta simplificada - en producción necesitarías manejar archivos
    const { amount, method, date, description } = req.body;
    
    if (!amount || !method || !date || !description) {
      return res.status(400).json({ 
        success: false, 
        error: 'Faltan datos requeridos' 
      });
    }
    
    // Crear una solicitud de verificación manual
    const { data, error } = await supabase
      .from('manual_verifications')
      .insert([{
        user_id: req.session.userId,
        amount: parseFloat(amount),
        currency: method,
        description: description,
        requested_at: new Date().toISOString(),
        status: 'pending'
      }]);
    
    if (error) {
      throw error;
    }
    
    res.json({
      success: true,
      message: 'Solicitud de verificación manual enviada. Un administrador la revisará en 24-48 horas.'
    });
  } catch (error) {
    console.error('Error en verificación manual:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// Ruta para actualizar perfil
app.post('/api/update-profile', requireAuth, async (req, res) => {
    try {
        const { first_name, phone_number, usdt_wallet, current_password } = req.body;
        const userId = req.session.userId;
        
        const user = await getUser(userId);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar contraseña actual si se está cambiando información sensible
        if ((phone_number || usdt_wallet) && !current_password) {
            return res.status(400).json({ error: 'Se requiere contraseña actual para cambiar información sensible' });
        }
        
        if (current_password) {
            // Verificar si tiene contraseña configurada
            if (!user.web_password) {
                return res.status(400).json({ error: 'No tienes contraseña configurada' });
            }
            
            const validPassword = await bcrypt.compare(current_password, user.web_password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Contraseña actual incorrecta' });
            }
        }
        
        const updates = {};
        if (first_name) updates.first_name = first_name;
        
        if (phone_number) {
            // Normalizar teléfono
            const cleanPhone = phone_number.replace(/[^\d]/g, '');
            
            // Validar formato
            if (!cleanPhone.startsWith('53')) {
                // Si tiene 8 dígitos, agregar 53
                if (cleanPhone.length === 8) {
                    updates.phone_number = '53' + cleanPhone;
                } else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
                    updates.phone_number = '53' + cleanPhone;
                } else if (cleanPhone.length === 10 && cleanPhone.startsWith('53')) {
                    updates.phone_number = cleanPhone;
                } else {
                    return res.status(400).json({ error: 'Formato de teléfono inválido' });
                }
            } else if (cleanPhone.length === 10) {
                updates.phone_number = cleanPhone;
            } else {
                return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos (53 + 8 dígitos)' });
            }
            
            // Verificar si el teléfono ya está en uso por otro usuario
            const { data: existingUser } = await supabase
                .from('users')
                .select('telegram_id')
                .eq('phone_number', updates.phone_number)
                .neq('telegram_id', userId)
                .single();
            
            if (existingUser) {
                return res.status(400).json({ error: 'Este teléfono ya está vinculado a otra cuenta' });
            }
        }
        
        if (usdt_wallet) {
            if (!usdt_wallet.startsWith('0x') || usdt_wallet.length !== 42) {
                return res.status(400).json({ error: 'Wallet USDT inválida. Debe comenzar con 0x y tener 42 caracteres' });
            }
            updates.usdt_wallet = usdt_wallet;
        }
        
        // Solo actualizar si hay cambios
        if (Object.keys(updates).length > 0) {
            const { error } = await supabase
                .from('users')
                .update(updates)
                .eq('telegram_id', userId);
            
            if (error) {
                throw error;
            }
            
            // Notificar al bot de Telegram sobre el cambio
            try {
                if (ADMIN_CHAT_ID) {
                    const mensajeAdmin = `📱 *PERFIL ACTUALIZADO*\n\n` +
                        `👤 Usuario: ${updates.first_name || user.first_name}\n` +
                        `🆔 ID: ${userId}\n` +
                        `${phone_number ? `📞 Teléfono: ${updates.phone_number}\n` : ''}` +
                        `${usdt_wallet ? `👛 Wallet: ${updates.usdt_wallet}\n` : ''}` +
                        `🕐 Fecha: ${new Date().toLocaleString()}`;
                    
                    await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                }
            } catch (notifError) {
                console.error('Error notificando cambio:', notifError);
            }
            
            res.json({ 
                success: true, 
                message: 'Perfil actualizado exitosamente',
                updates: updates 
            });
        } else {
            res.json({ success: true, message: 'Sin cambios' });
        }
        
    } catch (error) {
        console.error('Error actualizando perfil:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============================================
// PROGRAMADORES Y TAREAS PROGRAMADAS
// ============================================

// Programar verificación de saldos pendientes
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
                    `✅ ¡Ahora puedes usar tu saldo!`,
                    { parse_mode: 'Markdown' }
                );
                
                console.log(`✅ Saldo pendiente acreditado para ${user.telegram_id}`);
            }
        }
    } catch (error) {
        console.error('❌ Error en programador de saldo pendiente:', error);
    }
}, 5 * 60 * 1000); // Cada 5 minutos

// Programar verificación de USDT automáticamente
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
    console.log(`🔐 Seguridad: ${WEBHOOK_SECRET_KEY ? '✅ ACTIVADA' : '⚠️ DESACTIVADA'}`);
    console.log(`💰 Mínimos: CUP=${MINIMO_CUP}, Saldo=${MINIMO_SALDO}, USDT=${MINIMO_USDT}`);
    console.log(`📞 Teléfono para pagos: ${PAGO_SALDO_MOVIL || '❌ No configurado'}`);
    console.log(`💳 Tarjeta para pagos: ${PAGO_CUP_TARJETA ? '✅ Configurada' : '❌ No configurada'}`);
    console.log(`🪙 Dirección USDT: ${PAGO_USDT_ADDRESS ? '✅ Configurada' : '❌ No configurada'}`);
    console.log(`\n🚀 Bot listo para recibir mensajes...`);
});

// Manejo global de errores
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});
