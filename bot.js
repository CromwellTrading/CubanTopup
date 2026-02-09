// bot.js - Cromwell Store Bot Completo con WebApp
require('dotenv').config();

// ============================================
// DEPENDENCIES
// ============================================
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cors = require('cors');

// Import handlers
const GameRechargeHandler = require('./game_recharges.js');
const SokyRecargasHandler = require('./sokyrecargas.js');
const BolitaHandler = require('./BolitaHandler.js');
// Nota: El handler de Apuestas Deportivas se agregará después
// const ApuestasHandler = require('./ApuestasHandler.js');

// ============================================
// ENVIRONMENT VARIABLES (FROM .env)
// ============================================

// Bot configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DB_URL = process.env.DB_URL;
const DB_KEY = process.env.DB_KEY;
const WEBHOOK_SECRET_KEY = process.env.WEBHOOK_SECRET_KEY;

// Payment configuration
const MINIMO_CUP = parseFloat(process.env.MINIMO_CUP) || 1000;
const MINIMO_SALDO = parseFloat(process.env.MINIMO_SALDO) || 500;
const MAXIMO_CUP = parseFloat(process.env.MAXIMO_CUP) || 50000;

// Exchange rates
const USDT_RATE_0_30 = parseFloat(process.env.USDT_RATE_0_30) || 650;
const USDT_RATE_30_PLUS = parseFloat(process.env.USDT_RATE_30_PLUS) || 680;
const SALDO_MOVIL_RATE = parseFloat(process.env.SALDO_MOVIL_RATE) || 2.1;

// Token configuration
const CWS_PER_100_SALDO = 10;
const MIN_CWS_USE = parseInt(process.env.MIN_CWS_USE) || 100;

// Payment information
const PAGO_CUP_TARJETA = process.env.PAGO_CUP_TARJETA;
const PAGO_SALDO_MOVIL = process.env.PAGO_SALDO_MOVIL;
const PAGO_USDT_ADDRES = process.env.PAGO_USDT_ADDRES;

// Admin configuration
const ADMIN_CHAT_ID = process.env.ADMIN_GROUP;
const BOT_ADMIN_ID = process.env.BOT_ADMIN_ID; // ID único del admin

// Server configuration
const PORT = process.env.PORT || 3000;

// SokyRecargas configuration
const SOKY_API_TOKEN = process.env.SOKY_API_TOKEN;
const SOKY_RATE_CUP = parseFloat(process.env.SOKY_RATE_CUP) || 632;

// LioGames API
const LIOGAMES_SECRET = process.env.LIOGAMES_SECRET;
const LIOGAMES_MEMBER_CODE = process.env.LIOGAMES_MEMBER_CODE;

// Python webhook
const PYTHON_WEBHOOK_URL = process.env.PYTHON_WEBHOOK_URL;

// Validator API
const RECARGA_API_SECRET = process.env.RECARGA_API_SECRET;
const RECARGA_ENDPOINT = process.env.RECARGA_ENDPOINT;
const RECARGA_MEMBER_ID = process.env.RECARGA_MEMBER_ID;

// ============================================
// VALIDATION
// ============================================

if (!TELEGRAM_TOKEN) {
    console.error('❌ ERROR: TELEGRAM_TOKEN no está configurado en .env');
    process.exit(1);
}

if (!DB_URL || !DB_KEY) {
    console.error('❌ ERROR: DB_URL o DB_KEY no están configurados en .env');
    process.exit(1);
}

if (!LIOGAMES_SECRET || !LIOGAMES_MEMBER_CODE) {
    console.warn('⚠️ ADVERTENCIA: LIOGAMES_SECRET o LIOGAMES_MEMBER_CODE no configurados');
}

if (!SOKY_API_TOKEN) {
    console.warn('⚠️ ADVERTENCIA: SOKY_API_TOKEN no configurado');
}

// ============================================
// INITIALIZATION
// ============================================

// Initialize Express
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

// Session configuration for web panel
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

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Initialize Supabase
const supabase = createClient(DB_URL, DB_KEY);

// Initialize handlers
const gameHandler = new GameRechargeHandler(bot, supabase);
const sokyHandler = new SokyRecargasHandler(bot, supabase);
const bolitaHandler = new BolitaHandler(bot, supabase);
// Nota: Inicializar ApuestasHandler después
// const apuestasHandler = new ApuestasHandler(bot, supabase);

// Global variables
const activeSessions = {};

// ============================================
// HELPER FUNCTIONS
// ============================================

// Middleware to verify webhook token
const verifyWebhookToken = (req, res, next) => {
    // Permitir solicitudes desde Telegram WebApp sin token
    const telegramWebApp = req.headers['user-agent']?.includes('Telegram') || 
                          req.headers['origin']?.includes('telegram.org');
    
    if (telegramWebApp) {
        console.log('✅ Solicitud de Telegram WebApp, permitiendo sin token');
        return next();
    }
    
    if (!WEBHOOK_SECRET_KEY) {
        console.log('⚠️ WEBHOOK_SECRET_KEY not configured, accepting all requests');
        return next();
    }
    
    const authToken = req.headers['x-auth-token'] || req.body.auth_token;
    
    if (!authToken) {
        console.log('❌ Missing authentication token');
        return res.status(401).json({ 
            success: false, 
            message: 'Authentication token required',
            required: true 
        });
    }
    
    if (authToken !== WEBHOOK_SECRET_KEY) {
        console.log('❌ Invalid authentication token');
        return res.status(403).json({ 
            success: false, 
            message: 'Invalid authentication token',
            required: true 
        });
    }
    
    next();
};

// Middleware for web authentication
function requireAuth(req, res, next) {
    if (req.session.userId && req.session.authenticated) {
        console.log('✅ Authenticated user:', req.session.userId);
        next();
    } else {
        console.log('❌ Unauthenticated user');
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        res.redirect('/');
    }
}

// Format currency
function formatCurrency(amount, currency) {
    const symbols = {
        'cup': 'CUP',
        'saldo': 'Saldo',
        'cws': 'CWS'
    };
    
    const symbol = symbols[currency] || currency.toUpperCase();
    
    if (currency === 'cws') {
        return `${Math.floor(amount)} ${symbol}`;
    }
    
    return `$${parseFloat(amount).toFixed(2)} ${symbol}`;
}

// Get user by Telegram ID
async function getUser(telegramId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
    
    if (error) {
        console.log('Error getting user:', error);
        return null;
    }
    return data;
}

// Update user
async function updateUser(telegramId, updates) {
    const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('telegram_id', telegramId);
    
    return !error;
}

// Check if user has pending deposit order
async function tieneOrdenPendiente(telegramId, currency = null) {
    try {
        let query = supabase
            .from('transactions')
            .select('*')
            .eq('user_id', telegramId)
            .eq('status', 'pending')
            .eq('type', 'DEPOSIT');
        
        if (currency) {
            query = query.eq('currency', currency);
        }
        
        const { data, error } = await query;
        
        if (error) {
            console.log('Error checking pending order:', error);
            return null;
        }
        
        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('Error in tieneOrdenPendiente:', error);
        return null;
    }
}

// Cancel pending order
async function cancelarOrdenPendiente(telegramId, currency = null) {
    try {
        const orden = await tieneOrdenPendiente(telegramId, currency);
        
        if (!orden) {
            return { success: false, message: 'No tienes órdenes pendientes para cancelar' };
        }
        
        const { error } = await supabase
            .from('transactions')
            .update({ status: 'canceled', canceled_at: new Date().toISOString() })
            .eq('id', orden.id);
        
        if (error) {
            throw error;
        }
        
        return { success: true, message: `Orden #${orden.id} cancelada exitosamente` };
    } catch (error) {
        console.error('Error canceling order:', error);
        return { success: false, message: 'Error al cancelar la orden' };
    }
}

// Get user by phone
async function getUserByPhone(phone) {
    try {
        if (!phone) {
            console.log('❌ No phone provided for search');
            return null;
        }
        
        const normalizedPhone = phone.replace(/[^\d]/g, '');
        console.log(`🔍 Searching user with normalized phone: ${normalizedPhone}`);
        
        let searchPatterns = [];
        
        if (normalizedPhone.startsWith('53') && normalizedPhone.length === 10) {
            searchPatterns.push(normalizedPhone);
            searchPatterns.push(normalizedPhone.substring(2));
        } else if (normalizedPhone.length === 8) {
            searchPatterns.push(`53${normalizedPhone}`);
            searchPatterns.push(normalizedPhone);
        } else {
            searchPatterns.push(normalizedPhone);
        }
        
        searchPatterns = [...new Set(searchPatterns)];
        
        console.log(`🔍 Search patterns to try:`, searchPatterns);
        
        for (const pattern of searchPatterns) {
            console.log(`🔍 Trying pattern: ${pattern}`);
            
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('phone_number', pattern)
                .single();
            
            if (error) {
                if (error.code !== 'PGRST116') {
                    console.log(`⚠️ Error searching with pattern ${pattern}:`, error.message);
                }
            }
            
            if (data) {
                console.log(`✅ User found with pattern ${pattern}:`, {
                    id: data.telegram_id,
                    name: data.first_name,
                    phone_in_db: data.phone_number
                });
                return data;
            }
        }
        
        console.log(`❌ User not found for any phone pattern`);
        return null;
        
    } catch (error) {
        console.error('❌ Error in getUserByPhone:', error);
        return null;
    }
}

// Calculate CUP from USDT
function calculateCupFromUsdt(usdtAmount) {
    if (usdtAmount <= 30) {
        return usdtAmount * USDT_RATE_0_30;
    } else {
        return (30 * USDT_RATE_0_30) + ((usdtAmount - 30) * USDT_RATE_30_PLUS);
    }
}

// Calculate Saldo Móvil from CUP
function calculateSaldoMovilFromCup(cupAmount) {
    const raw = cupAmount / SALDO_MOVIL_RATE;
    return Math.ceil(raw / 5) * 5;
}

// Verify duplicate transaction
async function verificarTransaccionDuplicada(tx_id) {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('tx_id', tx_id)
            .eq('status', 'completed')
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.log('Error checking duplicate:', error);
        }
        
        return data !== null;
    } catch (error) {
        console.error('Error in verificarTransaccionDuplicada:', error);
        return false;
    }
}

// Check pending request
async function verificarSolicitudPendiente(userId, currency) {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', currency)
            .eq('type', 'DEPOSIT')
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (error) {
            console.log('Error checking pending request:', error);
            return null;
        }
        
        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('Error in verificarSolicitudPendiente:', error);
        return null;
    }
}

// Notify admin about new request
async function notificarSolicitudNueva(solicitud) {
    try {
        if (!ADMIN_CHAT_ID) return;
        
        const user = await getUser(solicitud.user_id);
        if (!user) return;
        
        const mensajeAdmin = `📝 *NUEVA SOLICITUD DE DEPÓSITO*\n\n` +
            `🆔 *Orden #:* ${solicitud.id}\n` +
            `👤 *Usuario:* ${user.first_name} (@${user.username || 'sin usuario'})\n` +
            `🆔 *ID:* ${user.telegram_id}\n` +
            `📞 *Teléfono:* ${user.phone_number || 'No vinculado'}\n` +
            `💰 *Monto solicitado:* ${formatCurrency(solicitud.amount_requested, solicitud.currency)}\n` +
            `💳 *Método:* ${solicitud.currency.toUpperCase()}\n` +
            `📅 *Fecha:* ${new Date(solicitud.created_at).toLocaleString()}\n\n` +
            `⚠️ *Esperando pago del usuario*`;
        
        await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error notifying new request:', error);
    }
}

// Process automatic payment
async function procesarPagoAutomatico(userId, amount, currency, txId, tipoPago) {
    try {
        console.log(`💰 Processing automatic payment: ${userId}, ${amount}, ${currency}, ${txId}, ${tipoPago}`);
        
        // 1. Check if transaction already exists
        const esDuplicado = await verificarTransaccionDuplicada(txId);
        if (esDuplicado) {
            console.log(`❌ Duplicate transaction detected: ${txId}`);
            return { 
                success: false, 
                message: 'Esta transacción ya fue procesada anteriormente',
                esDuplicado: true 
            };
        }
        
        // 2. Check if user has pending request
        const solicitudPendiente = await verificarSolicitudPendiente(userId, currency);
        
        if (!solicitudPendiente) {
            console.log(`❌ User ${userId} has no pending request for ${currency}`);
            
            // Save as unrequested payment (external transfer)
            await supabase.from('unrequested_payments').insert({
                user_id: userId,
                amount: amount,
                currency: currency,
                tx_id: txId,
                tipo_pago: tipoPago,
                status: 'no_request',
                created_at: new Date().toISOString()
            });
            
            // Only notify admin
            if (ADMIN_CHAT_ID) {
                const user = await getUser(userId);
                const adminMsg = `⚠️ *Transferencia exterior recibida*\n\n` +
                    `👤 Usuario: ${user ? user.first_name : 'Desconocido'}\n` +
                    `🆔 ID: ${userId}\n` +
                    `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                    `🔧 Tipo: ${tipoPago}\n` +
                    `🆔 TX ID: \`${txId}\`\n\n` +
                    `Este pago se guardó como transferencia exterior (sin solicitud).`;
                await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
            }
            
            return { 
                success: false, 
                message: 'Pago guardado como transferencia exterior',
                esTransferenciaExterior: true 
            };
        }
        
        // 3. Verify amount matches (with 10% margin)
        const montoSolicitado = solicitudPendiente.amount_requested;
        const margen = montoSolicitado * 0.1;
        
        if (Math.abs(amount - montoSolicitado) > margen) {
            console.log(`❌ Amount doesn't match: Requested ${montoSolicitado}, Received ${amount}`);
            
            // Notify user
            await bot.sendMessage(userId,
                `⚠️ *Monto no coincide*\n\n` +
                `📋 Solicitado: ${formatCurrency(montoSolicitado, currency)}\n` +
                `💰 Recibido: ${formatCurrency(amount, currency)}\n\n` +
                `Contacta al administrador para aclaración.`,
                { parse_mode: 'Markdown' }
            );
            
            return { 
                success: false, 
                message: 'Monto no coincide con la solicitud',
                montoSolicitado: montoSolicitado,
                montoRecibido: amount 
            };
        }
        
        // 4. Process payment
        const user = await getUser(userId);
        if (!user) {
            console.log(`❌ User ${userId} not found`);
            return { success: false, message: 'Usuario no encontrado' };
        }
        
        let montoConBono = amount;
        let tokensGanados = 0;
        
        // Apply bonus only for first deposit
        if (currency === 'cup' && user.first_dep_cup) {
            montoConBono = amount * 1.10;
            await updateUser(userId, { first_dep_cup: false });
        } else if (currency === 'saldo' && user.first_dep_saldo) {
            montoConBono = amount * 1.10;
            await updateUser(userId, { first_dep_saldo: false });
        }
        
        // Calculate tokens for saldo
        if (currency === 'saldo') {
            tokensGanados = Math.floor(amount / 100) * CWS_PER_100_SALDO;
        }
        
        // Update user balance
        const updates = {
            [`balance_${currency}`]: (user[`balance_${currency}`] || 0) + montoConBono
        };
        
        if (currency === 'saldo') {
            updates.tokens_cws = (user.tokens_cws || 0) + tokensGanados;
        }
        
        await updateUser(userId, updates);
        
        // Update transaction as completed
        await supabase
            .from('transactions')
            .update({ 
                status: 'completed',
                amount: montoConBono,
                tokens_generated: tokensGanados,
                tx_id: txId,
                tipo_pago: tipoPago,
                completed_at: new Date().toISOString()
            })
            .eq('id', solicitudPendiente.id);
        
        const bonoMensaje = montoConBono > amount ? 
            `\n🎉 *¡Bono aplicado!* +${formatCurrency(montoConBono - amount, currency)}` : '';
        
        const tokensMensaje = tokensGanados > 0 ? 
            `\n🎫 *Tokens ganados:* +${tokensGanados} CWS` : '';
        
        // Notify user
        const mensajeUsuario = `✨ *¡Depósito Completado!*\n\n` +
            `📋 Orden #${solicitudPendiente.id}\n` +
            `💰 Monto recibido: ${formatCurrency(amount, currency)}\n` +
            `${bonoMensaje}${tokensMensaje}\n` +
            `💵 Total acreditado: *${formatCurrency(montoConBono, currency)}*\n\n` +
            `📊 Nuevo saldo ${currency.toUpperCase()}: *${formatCurrency(updates[`balance_${currency}`], currency)}*\n` +
            `🆔 ID de Transacción: \`${txId}\``;
        
        await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
        
        // Notify admin
        if (ADMIN_CHAT_ID) {
            const mensajeAdmin = `✅ *DEPÓSITO COMPLETADO*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                `📋 Orden #: ${solicitudPendiente.id}\n` +
                `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                `🎁 Total con bono: ${formatCurrency(montoConBono, currency)}\n` +
                `🎫 Tokens: ${tokensGanados} CWS\n` +
                `🔧 Tipo: ${tipoPago}\n` +
                `🆔 TX ID: \`${txId}\``;
            
            await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
        }
        
        return { 
            success: true, 
            montoConBono, 
            tokensGanados,
            ordenId: solicitudPendiente.id,
            tx_id: txId,
            montoRecibido: amount,
            bono: montoConBono - amount
        };
        
    } catch (error) {
        console.error('❌ Error procesando pago automático:', error);
        return { success: false, message: error.message };
    }
}

// ============================================
// ADMIN FUNCTIONS
// ============================================

// Check if user is admin
function esAdmin(userId) {
    return userId.toString() === BOT_ADMIN_ID.toString();
}

// Get total balances from all users
async function obtenerEstadisticasTotales() {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('balance_cup, balance_saldo, tokens_cws');
        
        if (error) throw error;
        
        let totalCUP = 0;
        let totalSaldo = 0;
        let totalCWS = 0;
        
        users.forEach(user => {
            totalCUP += parseFloat(user.balance_cup) || 0;
            totalSaldo += parseFloat(user.balance_saldo) || 0;
            totalCWS += parseFloat(user.tokens_cws) || 0;
        });
        
        return {
            totalCUP: Math.round(totalCUP * 100) / 100,
            totalSaldo: Math.round(totalSaldo * 100) / 100,
            totalCWS: Math.round(totalCWS)
        };
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        return null;
    }
}

// Get user statistics
async function obtenerEstadisticasUsuario(userId) {
    try {
        const user = await getUser(userId);
        if (!user) return null;
        
        // Get transaction history
        const { data: transacciones } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);
        
        // Get pending orders
        const { data: ordenesPendientes } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
        
        // Get bolita bets
        const { data: apuestasBolita } = await supabase
            .from('bolita_apuestas')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);
        
        return {
            usuario: {
                id: user.telegram_id,
                nombre: user.first_name,
                username: user.username,
                telefono: user.phone_number,
                balance_cup: user.balance_cup || 0,
                balance_saldo: user.balance_saldo || 0,
                tokens_cws: user.tokens_cws || 0,
                fecha_registro: user.created_at || user.last_active
            },
            transacciones: transacciones || [],
            ordenesPendientes: ordenesPendientes || [],
            apuestasBolita: apuestasBolita || []
        };
    } catch (error) {
        console.error('Error obteniendo estadísticas usuario:', error);
        return null;
    }
}

// Admin panel keyboard
const createAdminKeyboard = () => ({
    inline_keyboard: [
        [
            { text: '📊 Estadísticas Totales', callback_data: 'admin_stats_total' },
            { text: '🔍 Buscar Usuario', callback_data: 'admin_search_user' }
        ],
        [
            { text: '📋 Ver Todas Órdenes Pendientes', callback_data: 'admin_pending_orders' },
            { text: '🎮 Ver Juegos Activos', callback_data: 'admin_active_games' }
        ],
        [
            { text: '💰 Ver Pagos Pendientes', callback_data: 'admin_pending_payments' },
            { text: '🔄 Sincronizar Base de Datos', callback_data: 'admin_sync_db' }
        ],
        [
            { text: '🔙 Volver al Menú Principal', callback_data: 'start_back' }
        ]
    ]
});

// User search keyboard
const createUserSearchKeyboard = (userId) => ({
    inline_keyboard: [
        [
            { text: '👛 Ver Billetera', callback_data: `admin_user_wallet:${userId}` },
            { text: '📜 Historial Transacciones', callback_data: `admin_user_history:${userId}` }
        ],
        [
            { text: '📋 Órdenes Pendientes', callback_data: `admin_user_orders:${userId}` },
            { text: '🎱 Apuestas La Bolita', callback_data: `admin_user_bets:${userId}` }
        ],
        [
            { text: '📊 Estadísticas Detalladas', callback_data: `admin_user_stats:${userId}` },
            { text: '📞 Contactar Usuario', callback_data: `admin_contact_user:${userId}` }
        ],
        [
            { text: '🔙 Volver al Panel Admin', callback_data: 'admin_panel' },
            { text: '🔄 Buscar Otro Usuario', callback_data: 'admin_search_user' }
        ]
    ]
});

// ============================================
// KEYBOARDS (ORGANIZADOS EN 2 COLUMNAS)
// ============================================

// Main keyboard with WebApp button - ORGANIZADO EN 2 COLUMNAS
const createMainKeyboard = () => ({
    inline_keyboard: [
        [
            { text: '👛 Mi Billetera', callback_data: 'wallet' },
            { text: '💰 Recargar Billetera', callback_data: 'recharge_menu' }
        ],
        [
            { text: '📱 Recargas ETECSA', callback_data: 'soky_offers' },
            { text: '🎮 Recargar Juegos', callback_data: 'games_menu' }
        ],
        [
            { text: '📱 Cambiar Teléfono', callback_data: 'link_phone' },
            { text: '🎁 Reclamar Pago', callback_data: 'claim_payment' }
        ],
        [
            { text: '🌐 Abrir WebApp', callback_data: 'open_webapp' },
            { text: '🎱 La Bolita', callback_data: 'bolita_menu' }
        ],
        [
            { text: '⚽ Apuestas', callback_data: 'apuestas_menu' },
            { text: '🔄 Actualizar', callback_data: 'refresh_wallet' }
        ]
    ]
});

// Wallet keyboard - ORGANIZADO EN 2 COLUMNAS
const createWalletKeyboard = () => ({
    inline_keyboard: [
        [
            { text: '💰 Recargar Billetera', callback_data: 'recharge_menu' },
            { text: '📱 Recargas ETECSA', callback_data: 'soky_offers' }
        ],
        [
            { text: '🎮 Recargar Juegos', callback_data: 'games_menu' },
            { text: '🎱 La Bolita', callback_data: 'bolita_menu' }
        ],
        [
            { text: '⚽ Apuestas', callback_data: 'apuestas_menu' },
            { text: '📜 Historial', callback_data: 'history' }
        ],
        [
            { text: '📱 Cambiar Teléfono', callback_data: 'link_phone' },
            { text: '📊 Saldo Pendiente', callback_data: 'view_pending' }
        ],
        [
            { text: '🌐 Abrir WebApp', callback_data: 'open_webapp' },
            { text: '❌ Cancelar Orden Pendiente', callback_data: 'cancel_pending_order' }
        ],
        [
            { text: '🔙 Volver al Inicio', callback_data: 'start_back' }
        ]
    ]
});

// Recharge methods keyboard - ORGANIZADO EN 2 COLUMNAS
const createRechargeMethodsKeyboard = () => ({
    inline_keyboard: [
        [
            { text: '💳 CUP (Tarjeta)', callback_data: 'dep_init:cup' },
            { text: '📲 Saldo Móvil', callback_data: 'dep_init:saldo' }
        ],
        [
            { text: '🔙 Volver a Billetera', callback_data: 'wallet' }
        ]
    ]
});

// Cancel order keyboard
const createCancelOrderKeyboard = (ordenId, currency) => ({
    inline_keyboard: [
        [
            { text: '✅ Sí, cancelar orden', callback_data: `confirm_cancel:${ordenId}:${currency}` },
            { text: '❌ No, mantener orden', callback_data: 'recharge_menu' }
        ]
    ]
});

// Terms keyboard
const createTermsKeyboard = () => ({
    inline_keyboard: [
        [{ text: '✅ Aceptar Términos', callback_data: 'accept_terms' }],
        [{ text: '🔙 Volver', callback_data: 'start_back' }]
    ]
});

// Claim payment keyboard - ORGANIZADO EN 2 COLUMNAS
const createClaimPaymentKeyboard = () => ({
    inline_keyboard: [
        [
            { text: '🔍 Buscar por ID', callback_data: 'search_payment_id' },
            { text: '📋 Ver Pendientes', callback_data: 'view_pending_payments' }
        ],
        [
            { text: '🔙 Volver al Inicio', callback_data: 'start_back' }
        ]
    ]
});

// Back keyboard
const createBackKeyboard = (callback_data) => ({
    inline_keyboard: [[{ text: '🔙 Volver', callback_data }]]
});

// Deposit confirmation keyboard
const createDepositConfirmKeyboard = (currency, amount) => ({
    inline_keyboard: [
        [
            { text: '✅ Confirmar Depósito', callback_data: `confirm_deposit:${currency}:${amount}` },
            { text: '❌ Cancelar', callback_data: 'recharge_menu' }
        ]
    ]
});

// ============================================
// TELEGRAM BOT - COMMAND HANDLERS
// ============================================

// Command /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const { first_name, username } = msg.from;
    
    console.log(`🚀 User ${userId} (${first_name}) started the bot`);
    
    // Check if admin
    if (esAdmin(userId)) {
        const adminMessage = `👑 *Panel de Administración*\n\n` +
            `Bienvenido, Administrador.\n\n` +
            `Selecciona una opción del menú:`;
        
        await bot.sendMessage(chatId, adminMessage, { 
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
        return;
    }
    
    let user = await getUser(chatId);
    
    if (!user) {
        user = {
            telegram_id: userId,
            first_name: first_name,
            username: username,
            phone_number: null,
            first_dep_cup: true,
            first_dep_saldo: true,
            accepted_terms: false,
            pending_balance_cup: 0,
            balance_cup: 0,
            balance_saldo: 0,
            tokens_cws: 0,
            last_active: new Date().toISOString()
        };
        
        await supabase.from('users').upsert(user, { onConflict: 'telegram_id' });
        user = await getUser(chatId);
    }
    
    // STEP 1: Check if phone is linked
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
    
    // STEP 2: Check if terms accepted
    if (!user.accepted_terms) {
        return handleTerms(chatId, null);
    }
    
    // STEP 3: Complete user - Show main menu
    const welcomeMessage = `✅ *¡Bienvenido de nuevo, ${first_name}!*\n\n` +
        `🆔 *Tu ID de Telegram es:* \`${userId}\`\n\n` +
        `⚠️ *GUARDA ESTE ID* - Lo necesitarás para acceder a la web.\n\n` +
        `Ahora también puedes usar nuestra *WebApp* para una mejor experiencia.\n\n` +
        `¿Cómo puedo ayudarte hoy?`;
    
    await bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown', 
        reply_markup: createMainKeyboard()
    });
});

// Command /admin
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!esAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ No tienes permisos de administrador.');
        return;
    }
    
    const adminMessage = `👑 *Panel de Administración*\n\n` +
        `Bienvenido, Administrador.\n\n` +
        `Selecciona una opción del menú:`;
    
    await bot.sendMessage(chatId, adminMessage, { 
        parse_mode: 'Markdown',
        reply_markup: createAdminKeyboard()
    });
});

// Command /webapp
bot.onText(/\/webapp/, async (msg) => {
    const chatId = msg.chat.id;
    const baseUrl = process.env.WEBAPP_URL || `http://localhost:${PORT || 3000}`;
    const webAppUrl = `${baseUrl}/webapp.html?userId=${chatId}`;
    
    const message = `🌐 *WebApp Cromwell Store*\n\n` +
        `Accede a nuestra WebApp para una mejor experiencia:\n\n` +
        `✅ Interfaz más amigable\n` +
        `✅ Navegación más rápida\n` +
        `✅ Todas las funciones disponibles\n\n` +
        `⚠️ *Tu ID de Telegram:* \`${chatId}\`\n\n` +
        `Haz clic en el botón de abajo para abrir:`;
    
    await bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                {
                    text: '🌐 Abrir WebApp',
                    web_app: { url: webAppUrl }
                }
            ]]
        }
    });
});

// ============================================
// TELEGRAM BOT - CALLBACK HANDLERS
// ============================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const messageId = query.message.message_id;
    const data = query.data;

    try {
        await bot.answerCallbackQuery(query.id);

        // Admin functions first
        if (esAdmin(userId)) {
            const adminHandled = await handleAdminCallbacks(chatId, messageId, userId, data);
            if (adminHandled) return;
        }

        // THEN: Try to handle with sokyHandler
        const handledBySoky = await sokyHandler.handleCallback(query);
        if (handledBySoky) {
            return;
        }

        // THEN: Try to handle with gameHandler
        const handledByGame = await gameHandler.handleCallback(query);
        if (handledByGame) {
            return;
        }

        // THEN: Try to handle with bolitaHandler
        const handledByBolita = await bolitaHandler.handleCallback(query);
        if (handledByBolita) {
            return;
        }

        // FINALLY: Process normal bot actions
        const [action, param1, param2, param3] = data.split(':');

        switch (action) {
            case 'start_back':
                await handleStartBack(chatId, messageId);
                break;
            case 'open_webapp':
                await handleOpenWebApp(chatId, messageId);
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
            case 'games_menu':
                await gameHandler.showGamesList(chatId, messageId);
                break;
            case 'apuestas_menu':
                await handleApuestasMenu(chatId, messageId);
                break;
            case 'dep_init':
                await handleDepositInit(chatId, messageId, param1);
                break;
            case 'confirm_deposit':
                await handleConfirmDeposit(chatId, messageId, param1, param2);
                break;
            case 'cancel_pending_order':
                await handleCancelPendingOrder(chatId, messageId);
                break;
            case 'confirm_cancel':
                await handleConfirmCancel(chatId, messageId, param1, param2);
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
            default:
                console.log(`Acción no reconocida: ${action}`);
        }
    } catch (error) {
        console.error('Error en callback:', error);
        await bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.');
    }
});

// ============================================
// ADMIN CALLBACK HANDLER
// ============================================

async function handleAdminCallbacks(chatId, messageId, adminId, data) {
    const [action, param1, param2] = data.split(':');
    
    switch (action) {
        case 'admin_panel':
            await showAdminPanel(chatId, messageId);
            return true;
            
        case 'admin_stats_total':
            await showTotalStats(chatId, messageId);
            return true;
            
        case 'admin_search_user':
            await searchUserPrompt(chatId, messageId);
            return true;
            
        case 'admin_user_wallet':
            await showUserWallet(chatId, messageId, param1);
            return true;
            
        case 'admin_user_history':
            await showUserHistory(chatId, messageId, param1);
            return true;
            
        case 'admin_user_orders':
            await showUserOrders(chatId, messageId, param1);
            return true;
            
        case 'admin_user_bets':
            await showUserBets(chatId, messageId, param1);
            return true;
            
        case 'admin_user_stats':
            await showUserStats(chatId, messageId, param1);
            return true;
            
        case 'admin_contact_user':
            await contactUserPrompt(chatId, messageId, param1);
            return true;
            
        case 'admin_pending_orders':
            await showAllPendingOrders(chatId, messageId);
            return true;
            
        case 'admin_active_games':
            await showActiveGames(chatId, messageId);
            return true;
            
        case 'admin_pending_payments':
            await showPendingPayments(chatId, messageId);
            return true;
            
        case 'admin_sync_db':
            await syncDatabase(chatId, messageId);
            return true;
    }
    
    return false;
}

// ============================================
// NORMAL BOT HANDLER FUNCTIONS
// ============================================

async function handleStartBack(chatId, messageId) {
    const user = await getUser(chatId);
    const message = `✅ *¡Bienvenido de nuevo, ${user.first_name}!*\n\n` +
        `🆔 *Tu ID de Telegram es:* \`${chatId}\`\n\n` +
        `⚠️ *GUARDA ESTE ID* - Lo necesitarás para acceder a la web.\n\n` +
        `Ahora también puedes use nuestra *WebApp* para una mejor experiencia.\n\n` +
        `¿Cómo puedo ayudarte hoy?`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createMainKeyboard()
    });
}

async function handleOpenWebApp(chatId, messageId) {
    const baseUrl = process.env.WEBAPP_URL || `http://localhost:${PORT || 3000}`;
    const webAppUrl = `${baseUrl}/webapp.html?userId=${chatId}`;
    
    console.log(`🔗 WebApp URL generada para ${chatId}: ${webAppUrl}`);
    
    const message = `🌐 *Abrir WebApp Cromwell Store*\n\n` +
        `Haz clic en el botón de abajo para abrir la WebApp:\n\n` +
        `⚠️ *Tu ID de Telegram:* \`${chatId}\`\n` +
        `Guarda este ID por si necesitas contactar soporte.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                {
                    text: '🌐 Abrir WebApp',
                    web_app: { url: webAppUrl }
                }
            ]]
        }
    });
}

async function handleApuestasMenu(chatId, messageId) {
    const message = `⚽ *Apuestas Deportivas*\n\n` +
        `Próximamente disponible...\n\n` +
        `Muy pronto podrás hacer apuestas deportivas con tus CWS.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createBackKeyboard('start_back')
    });
}

async function handleWallet(chatId, messageId) {
    const user = await getUser(chatId);
    
    if (!user) {
        await bot.editMessageText('❌ No se pudo obtener tu información.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackKeyboard('start_back')
        });
        return;
    }
    
    // Check for pending orders
    const ordenPendiente = await tieneOrdenPendiente(chatId);
    const pendienteMsg = ordenPendiente ? 
        `\n⚠️ *Tienes una orden pendiente:*\n` +
        `🆔 Orden #${ordenPendiente.id}\n` +
        `💰 ${formatCurrency(ordenPendiente.amount_requested, ordenPendiente.currency)}\n` +
        `💳 ${ordenPendiente.currency.toUpperCase()}\n` +
        `📅 ${new Date(ordenPendiente.created_at).toLocaleDateString()}\n\n` : '';
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = MINIMO_CUP - pendiente;
    
    let message = `👛 *Tu Billetera Cromwell*\n\n` +
        `🆔 *ID de Telegram:* \`${chatId}\`\n\n` +
        `💰 *CUP:* **${formatCurrency(user.balance_cup, 'cup')}**\n` +
        `📱 *Saldo Móvil:* **${formatCurrency(user.balance_saldo, 'saldo')}**\n` +
        `🎫 *CWS (Tokens):* **${user.tokens_cws || 0}**\n\n` +
        pendienteMsg;
    
    if (pendiente > 0) {
        message += `📥 *CUP Pendiente:* **${formatCurrency(pendiente, 'cup')}**\n`;
        if (faltante > 0) {
            message += `🎯 *Faltante:* ${formatCurrency(faltante, 'cup')} para el mínimo\n\n`;
        }
    }
    
    message += `📞 *Teléfono vinculado:* ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : '❌ No vinculado'}\n\n` +
        `💡 *Mínimo para usar tokens:*\n` +
        `• CWS: ${MIN_CWS_USE} CWS\n\n` +
        `🎮 *Para recargar juegos:*\n` +
        `• 1 CWS = $10 CUP de descuento\n\n` +
        `¿Qué deseas hacer?`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createWalletKeyboard()
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
            reply_markup: createBackKeyboard('start_back')
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
        reply_markup: createRechargeMethodsKeyboard()
    });
}

async function handleDepositInit(chatId, messageId, currency) {
    const user = await getUser(chatId);
    
    if (!user.phone_number) {
        await bot.editMessageText('❌ *Debes vincular tu teléfono primero* para pagos con CUP o Saldo Móvil.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createBackKeyboard('recharge_menu')
        });
        return;
    }
    
    // Check for pending order
    const ordenPendiente = await tieneOrdenPendiente(chatId, currency);
    if (ordenPendiente) {
        const mensaje = `❌ *Ya tienes una orden pendiente*\n\n` +
            `🆔 Orden #${ordenPendiente.id}\n` +
            `💰 Monto: ${formatCurrency(ordenPendiente.amount_requested, currency)}\n` +
            `⏳ Estado: Pendiente\n\n` +
            `Debes cancelar esta orden antes de crear una nueva.\n\n` +
            `¿Deseas cancelar la orden pendiente?`;
        
        await bot.editMessageText(mensaje, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createCancelOrderKeyboard(ordenPendiente.id, currency)
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
    }
    
    activeSessions[chatId] = { 
        step: 'waiting_deposit_amount', 
        currency: currency,
        metodoPago: metodoPago
    };
    
    const bonoPorcentaje = '10%';
    
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
        reply_markup: createBackKeyboard('recharge_menu')
    });
}

async function handleCancelPendingOrder(chatId, messageId) {
    const ordenPendiente = await tieneOrdenPendiente(chatId);
    
    if (!ordenPendiente) {
        await bot.editMessageText('❌ No tienes órdenes pendientes para cancelar.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createWalletKeyboard()
        });
        return;
    }
    
    const mensaje = `❓ *¿Confirmar cancelación?*\n\n` +
        `🆔 Orden #${ordenPendiente.id}\n` +
        `💰 Monto: ${formatCurrency(ordenPendiente.amount_requested, ordenPendiente.currency)}\n` +
        `💳 Método: ${ordenPendiente.currency.toUpperCase()}\n\n` +
        `Esta acción no se puede deshacer.`;
    
    await bot.editMessageText(mensaje, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createCancelOrderKeyboard(ordenPendiente.id, ordenPendiente.currency)
    });
}

async function handleConfirmCancel(chatId, messageId, ordenId, currency) {
    const result = await cancelarOrdenPendiente(chatId, currency);
    
    if (result.success) {
        await bot.editMessageText(`✅ ${result.message}`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createWalletKeyboard()
        });
    } else {
        await bot.editMessageText(`❌ ${result.message}`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createWalletKeyboard()
        });
    }
}

async function handleConfirmDeposit(chatId, messageId, currency, amount) {
    const session = activeSessions[chatId];
    const user = await getUser(chatId);
    
    if (!user) {
        if (messageId) {
            await bot.editMessageText('❌ No se pudo obtener tu información.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, '❌ No se pudo obtener tu información.', {
                reply_markup: createBackKeyboard('recharge_menu')
            });
        }
        return;
    }
    
    if (!amount && session && session.amount) {
        amount = session.amount;
    }
    
    if (!amount) {
        if (messageId) {
            await bot.editMessageText('❌ No se encontró el monto. Por favor, inicia el depósito nuevamente.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, '❌ No se encontró el monto. Por favor, inicia el depósito nuevamente.', {
                reply_markup: createBackKeyboard('recharge_menu')
            });
        }
        delete activeSessions[chatId];
        return;
    }
    
    const limites = { 
        cup: [MINIMO_CUP, MAXIMO_CUP], 
        saldo: [MINIMO_SALDO, 10000]
    };
    
    if (amount < limites[currency][0] || amount > limites[currency][1]) {
        const mensaje = `❌ *Monto fuera de límites*\n\n` +
            `Debe estar entre ${formatCurrency(limites[currency][0], currency)} y ${formatCurrency(limites[currency][1], currency)}.\n\n` +
            `Por favor, inicia el depósito nuevamente.`;
        
        if (messageId) {
            await bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, mensaje, { 
                parse_mode: 'Markdown',
                reply_markup: createBackKeyboard('recharge_menu')
            });
        }
        delete activeSessions[chatId];
        return;
    }
    
    // Check again for pending order (in case user opened multiple tabs)
    const ordenPendiente = await tieneOrdenPendiente(chatId, currency);
    if (ordenPendiente) {
        const mensaje = `❌ *Ya tienes una orden pendiente*\n\n` +
            `🆔 Orden #${ordenPendiente.id}\n` +
            `💰 Monto: ${formatCurrency(ordenPendiente.amount_requested, currency)}\n` +
            `⏳ Estado: Pendiente\n\n` +
            `Debes cancelar esta orden antes de crear una nueva.`;
        
        if (messageId) {
            await bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, mensaje, {
                parse_mode: 'Markdown',
                reply_markup: createBackKeyboard('recharge_menu')
            });
        }
        delete activeSessions[chatId];
        return;
    }
    
    const bonoPorcentaje = 0.10;
    const bono = user[`first_dep_${currency}`] ? amount * bonoPorcentaje : 0;
    const totalConBono = amount + bono;
    const tokens = currency === 'saldo' ? Math.floor(amount / 100) * CWS_PER_100_SALDO : 0;
    
    const { data: transaction, error } = await supabase
        .from('transactions')
        .insert([{
            user_id: chatId,
            type: 'DEPOSIT',
            currency: currency,
            amount_requested: amount,
            estimated_bonus: bono,
            estimated_tokens: tokens,
            status: 'pending',
            user_name: user.first_name,
            user_username: user.username,
            user_phone: user.phone_number
        }])
        .select()
        .single();
    
    if (error) {
        console.error('Error creating transaction:', error);
        const mensajeError = '❌ Ocurrió un error al crear la orden de depósito.';
        
        if (messageId) {
            await bot.editMessageText(mensajeError, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, mensajeError, {
                reply_markup: createBackKeyboard('recharge_menu')
            });
        }
        return;
    }
    
    let instrucciones = '';
    let metodoPago = '';
    
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
    }
    
    const mensaje = `✅ *Solicitud de depósito creada*\n\n` +
        `🆔 *Número de orden:* #${transaction.id}\n` +
        `💰 *Monto solicitado:* ${formatCurrency(amount, currency)}\n` +
        `🎁 *Bono por primer depósito:* ${formatCurrency(bono, currency)} (${bonoPorcentaje * 100}%)\n` +
        `💵 *Total a acreditar:* ${formatCurrency(totalConBono, currency)}\n` +
        `🎫 *Tokens a ganar:* ${tokens} CWS\n\n` +
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
            reply_markup: createBackKeyboard('start_back')
        });
    } else {
        await bot.sendMessage(chatId, mensaje, {
            parse_mode: 'Markdown',
            reply_markup: createBackKeyboard('start_back')
        });
    }
    
    await notificarSolicitudNueva(transaction);
    delete activeSessions[chatId];
}

async function handleTerms(chatId, messageId) {
    const terms = `📜 *Términos y Condiciones de Cromwell Store*\n\n` +
        `1. *ACEPTACIÓN*: Al usar este servicio, aceptas estos términos.\n\n` +
        `2. *PROPÓSITO*: La billetera es exclusiva para pagos en Cromwell Store. El dinero no es retirable, excepto los bonos que son utilizables para recargas.\n\n` +
        `3. *DEPÓSITOS*:\n` +
        `   • Mínimos: CUP=${MINIMO_CUP}, Saldo=${MINIMO_SALDO}\n` +
        `   • Bonos solo en el primer depósito por método\n` +
        `   • Los tokens no son retirables, solo utilizables en la tienda\n\n` +
        `4. *TOKENS*:\n` +
        `   • CWS: Gana ${CWS_PER_100_SALDO} por cada 100 de saldo\n` +
        `   • Mínimo para usar: CWS=${MIN_CWS_USE}\n\n` +
        `5. *RECARGAS DE JUEGOS*:\n` +
        `   • 1 CWS = $10 CUP de descuento en recargas\n` +
        `   • Puedes pagar con CUP, Saldo Móvil o CWS\n` +
        `   • Las recargas se procesan a través de LioGames\n\n` +
        `6. *RECARGAS ETECSA*:\n` +
        `   • Se procesan a través de SokyRecargas\n` +
        `   • Los precios están en CUP (1 USDT = ${SOKY_RATE_CUP} CUP)\n` +
        `   • Se descuentan automáticamente de tu saldo CUP\n\n` +
        `7. *SEGURIDAD*:\n` +
        `   • Toma capturas de pantalla de todas las transacciones\n` +
        `   • ETECSA puede fallar con las notificaciones SMS\n` +
        `   • Tu responsabilidad guardar los recibos\n\n` +
        `8. *REEMBOLSOS*:\n` +
        `   • Si envías dinero y no se acredita pero tienes captura válida\n` +
        `   • Contacta al administrador dentro de 24 horas\n    ` +
        `   • Se investigará y resolverá en 48 horas máximo\n\n` +
        `9. *PROHIBIDO*:\n` +
        `   • Uso fraudulento o múltiples cuentas\n` +
        `   • Lavado de dinero o actividades ilegales\n` +
        `   • Spam o abuso del sistema\n\n` +
        `10. *MODIFICACIONES*: Podemos cambiar estos términos notificando con 72 horas de anticipación.\n\n` +
        `_Última actualización: ${new Date().toLocaleDateString()}_\n\n` +
        `⚠️ *Para ver estos términos y condiciones nuevamente, visita nuestra web.*`;
    
    if (messageId) {
        await bot.editMessageText(terms, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createTermsKeyboard()
        });
    } else {
        await bot.sendMessage(chatId, terms, {
            parse_mode: 'Markdown',
            reply_markup: createTermsKeyboard()
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
        reply_markup: createMainKeyboard()
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
        parse_mode: 'Markdown',
        reply_markup: createBackKeyboard('start_back')
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
        reply_markup: createClaimPaymentKeyboard()
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
        parse_mode: 'Markdown',
        reply_markup: createBackKeyboard('claim_payment')
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
        reply_markup: createBackKeyboard('claim_payment')
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
            
            message += `${icon} *${tx.type === 'DEPOSIT' ? 'Depósito' : tx.type === 'GAME_RECHARGE' ? 'Recarga Juego' : tx.type === 'ETECSA_RECHARGE' ? 'Recarga ETECSA' : tx.type}*\n`;
            message += `💰 ${formatCurrency(Math.abs(tx.amount || tx.amount_requested), tx.currency)}\n`;
            message += `📅 ${fecha}\n`;
            message += `📊 ${tx.status === 'completed' ? 'Completado' : tx.status === 'pending' ? 'Pendiente' : tx.status}\n`;
            if (tx.tx_id) message += `🆔 \`${tx.tx_id}\`\n`;
            if (tx.tokens_generated > 0) message += `🎫 +${tx.tokens_generated} CWS\n`;
            message += `\n`;
        });
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createBackKeyboard('wallet')
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
        reply_markup: createBackKeyboard('wallet')
    });
}

// ============================================
// ADMIN FUNCTIONS IMPLEMENTATION
// ============================================

async function showAdminPanel(chatId, messageId) {
    const message = `👑 *Panel de Administración*\n\n` +
        `Selecciona una opción:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createAdminKeyboard()
    });
}

async function showTotalStats(chatId, messageId) {
    try {
        const stats = await obtenerEstadisticasTotales();
        
        if (!stats) {
            await bot.editMessageText('❌ Error al obtener estadísticas.', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: createAdminKeyboard()
            });
            return;
        }
        
        const message = `📊 *ESTADÍSTICAS TOTALES DEL BOT*\n\n` +
            `💰 *Total CUP en el sistema:* ${formatCurrency(stats.totalCUP, 'cup')}\n` +
            `📱 *Total Saldo Móvil:* ${formatCurrency(stats.totalSaldo, 'saldo')}\n` +
            `🎫 *Total CWS (Tokens):* ${stats.totalCWS} CWS\n\n` +
            `*Desglose por moneda:*\n` +
            `• CUP: $${stats.totalCUP.toFixed(2)}\n` +
            `• Saldo Móvil: $${stats.totalSaldo.toFixed(2)}\n` +
            `• CWS: ${stats.totalCWS} tokens\n\n` +
            `_Actualizado: ${new Date().toLocaleString()}_`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error showing total stats:', error);
        await bot.editMessageText('❌ Error al obtener estadísticas.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    }
}

async function searchUserPrompt(chatId, messageId) {
    const message = `🔍 *Buscar Usuario*\n\n` +
        `Por favor, envía el ID de Telegram del usuario que deseas buscar:\n\n` +
        `Ejemplo: \`123456789\``;
    
    activeSessions[chatId] = { step: 'admin_search_user' };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createBackKeyboard('admin_panel')
    });
}

async function showUserWallet(chatId, messageId, userId) {
    try {
        const user = await getUser(userId);
        
        if (!user) {
            await bot.editMessageText(`❌ Usuario con ID ${userId} no encontrado.`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: createBackKeyboard('admin_search_user')
            });
            return;
        }
        
        const message = `👛 *Billetera del Usuario*\n\n` +
            `👤 *Nombre:* ${user.first_name}\n` +
            `🆔 *ID:* ${user.telegram_id}\n` +
            `📱 *Usuario:* @${user.username || 'N/A'}\n` +
            `📞 *Teléfono:* ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : 'No vinculado'}\n\n` +
            `💰 *CUP:* **${formatCurrency(user.balance_cup, 'cup')}**\n` +
            `📱 *Saldo Móvil:* **${formatCurrency(user.balance_saldo, 'saldo')}**\n` +
            `🎫 *CWS (Tokens):* **${user.tokens_cws || 0}**\n\n` +
            `📅 *Última actividad:* ${new Date(user.last_active).toLocaleString()}\n` +
            `📅 *Registrado:* ${new Date(user.created_at || user.last_active).toLocaleDateString()}`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user wallet:', error);
        await bot.editMessageText('❌ Error al obtener información del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    }
}

async function showUserHistory(chatId, messageId, userId) {
    try {
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(15);
    
        let message = `📜 *Historial de Transacciones*\n\n` +
            `👤 Usuario ID: ${userId}\n\n`;
        
        if (!transactions || transactions.length === 0) {
            message += `No hay transacciones registradas.`;
        } else {
            transactions.forEach((tx, index) => {
                let icon = '🔸';
                if (tx.status === 'completed') icon = '✅';
                else if (tx.status === 'pending') icon = '⏳';
                else if (tx.status === 'rejected' || tx.status === 'canceled') icon = '❌';
                
                const fecha = new Date(tx.created_at).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                message += `${icon} *${tx.type === 'DEPOSIT' ? 'Depósito' : tx.type === 'GAME_RECHARGE' ? 'Recarga Juego' : tx.type === 'ETECSA_RECHARGE' ? 'Recarga ETECSA' : tx.type}*\n`;
                message += `💰 ${formatCurrency(Math.abs(tx.amount || tx.amount_requested), tx.currency)}\n`;
                message += `📅 ${fecha}\n`;
                message += `📊 ${tx.status === 'completed' ? 'Completado' : tx.status === 'pending' ? 'Pendiente' : tx.status}\n`;
                if (tx.tx_id) message += `🆔 \`${tx.tx_id}\`\n`;
                if (tx.tokens_generated > 0) message += `🎫 +${tx.tokens_generated} CWS\n`;
                message += `---\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user history:', error);
        await bot.editMessageText('❌ Error al obtener historial del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    }
}

async function showUserOrders(chatId, messageId, userId) {
    try {
        const { data: orders } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
        
        let message = `📋 *Órdenes Pendientes*\n\n` +
            `👤 Usuario ID: ${userId}\n\n`;
        
        if (!orders || orders.length === 0) {
            message += `No hay órdenes pendientes.`;
        } else {
            orders.forEach((order, index) => {
                message += `🆔 *Orden #${order.id}*\n`;
                message += `💰 ${formatCurrency(order.amount_requested, order.currency)}\n`;
                message += `💳 ${order.currency.toUpperCase()}\n`;
                message += `📅 ${new Date(order.created_at).toLocaleDateString()}\n`;
                message += `---\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user orders:', error);
        await bot.editMessageText('❌ Error al obtener órdenes del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    }
}

async function showUserBets(chatId, messageId, userId) {
    try {
        const { data: bets } = await supabase
            .from('bolita_apuestas')
            .select('*, bolita_sorteos(numero_ganador, fecha, hora)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);
        
        let message = `🎱 *Apuestas La Bolita*\n\n` +
            `👤 Usuario ID: ${userId}\n\n`;
        
        if (!bets || bets.length === 0) {
            message += `No hay apuestas registradas.`;
        } else {
            bets.forEach((bet, index) => {
                const emoji = bet.estado === 'ganada' ? '✅' : bet.estado === 'perdida' ? '❌' : '⏳';
                message += `${emoji} *Ticket #${bet.id}*\n`;
                message += `🎯 ${bet.tipo_apuesta} ${bet.numero_apostado} ${bet.posicion ? `(${bet.posicion})` : ''}\n`;
                message += `💰 ${bet.monto} CWS → ${bet.ganancia ? `Ganó: ${bet.ganancia} CWS` : 'Pendiente'}\n`;
                message += `📅 ${new Date(bet.created_at).toLocaleDateString()}\n`;
                if (bet.bolita_sorteos?.numero_ganador) {
                    message += `🎯 Resultado: ${bet.bolita_sorteos.numero_ganador}\n`;
                }
                message += `---\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user bets:', error);
        await bot.editMessageText('❌ Error al obtener apuestas del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    }
}

async function showUserStats(chatId, messageId, userId) {
    try {
        const stats = await obtenerEstadisticasUsuario(userId);
        
        if (!stats) {
            await bot.editMessageText(`❌ Error al obtener estadísticas del usuario.`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: createUserSearchKeyboard(userId)
            });
            return;
        }
        
        const { usuario, transacciones, ordenesPendientes, apuestasBolita } = stats;
        
        // Calculate totals
        let totalDepositado = 0;
        let totalGastado = 0;
        let totalGanadoBolita = 0;
        
        transacciones.forEach(tx => {
            if (tx.type === 'DEPOSIT' && tx.status === 'completed') {
                totalDepositado += Math.abs(tx.amount) || tx.amount_requested || 0;
            } else if (tx.type === 'GAME_RECHARGE' || tx.type === 'ETECSA_RECHARGE') {
                totalGastado += Math.abs(tx.amount) || 0;
            }
        });
        
        apuestasBolita.forEach(bet => {
            if (bet.estado === 'ganada') {
                totalGanadoBolita += bet.ganancia || 0;
            }
        });
        
        const message = `📊 *ESTADÍSTICAS DETALLADAS*\n\n` +
            `👤 *Usuario:* ${usuario.nombre}\n` +
            `🆔 *ID:* ${usuario.id}\n` +
            `📱 *@${usuario.username || 'N/A'}*\n\n` +
            `💰 *Balance Actual:*\n` +
            `• CUP: ${formatCurrency(usuario.balance_cup, 'cup')}\n` +
            `• Saldo Móvil: ${formatCurrency(usuario.balance_saldo, 'saldo')}\n` +
            `• CWS: ${usuario.tokens_cws} tokens\n\n` +
            `📈 *Actividad Total:*\n` +
            `• Total depositado: ${formatCurrency(totalDepositado, 'cup')}\n` +
            `• Total gastado: ${formatCurrency(totalGastado, 'cup')}\n` +
            `• Ganado en La Bolita: ${totalGanadoBolita} CWS\n\n` +
            `📋 *Resumen:*\n` +
            `• Transacciones: ${transacciones.length}\n` +
            `• Órdenes pendientes: ${ordenesPendientes.length}\n` +
            `• Apuestas La Bolita: ${apuestasBolita.length}\n\n` +
            `📅 *Registrado:* ${new Date(usuario.fecha_registro).toLocaleDateString()}`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user stats:', error);
        await bot.editMessageText('❌ Error al obtener estadísticas del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    }
}

async function contactUserPrompt(chatId, messageId, userId) {
    const message = `📞 *Contactar Usuario*\n\n` +
        `ID del usuario: ${userId}\n\n` +
        `Por favor, envía el mensaje que deseas enviar al usuario:`;
    
    activeSessions[chatId] = { 
        step: 'admin_contact_user',
        targetUserId: userId 
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createBackKeyboard(`admin_user_stats:${userId}`)
    });
}

async function showAllPendingOrders(chatId, messageId) {
    try {
        const { data: orders } = await supabase
            .from('transactions')
            .select('*, users!inner(first_name, username, phone_number)')
            .eq('status', 'pending')
            .eq('type', 'DEPOSIT')
            .order('created_at', { ascending: false });
        
        let message = `📋 *TODAS LAS ÓRDENES PENDIENTES*\n\n`;
        
        if (!orders || orders.length === 0) {
            message += `No hay órdenes pendientes en el sistema.`;
        } else {
            message += `Total: ${orders.length} órdenes\n\n`;
            
            orders.forEach((order, index) => {
                message += `🆔 *Orden #${order.id}*\n`;
                message += `👤 ${order.users.first_name} (@${order.users.username || 'N/A'})\n`;
                message += `🆔 ID: ${order.user_id}\n`;
                message += `💰 ${formatCurrency(order.amount_requested, order.currency)}\n`;
                message += `💳 ${order.currency.toUpperCase()}\n`;
                message += `📅 ${new Date(order.created_at).toLocaleDateString()}\n`;
                message += `---\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error showing all pending orders:', error);
        await bot.editMessageText('❌ Error al obtener órdenes pendientes.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    }
}

async function showActiveGames(chatId, messageId) {
    // This would show active game transactions
    // For now, just a placeholder
    const message = `🎮 *Juegos Activos*\n\n` +
        `Funcionalidad en desarrollo...`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createAdminKeyboard()
    });
}

async function showPendingPayments(chatId, messageId) {
    try {
        const { data: payments } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('claimed', false)
            .order('created_at', { ascending: false });
        
        let message = `💰 *PAGOS PENDIENTES DE RECLAMAR*\n\n`;
        
        if (!payments || payments.length === 0) {
            message += `No hay pagos pendientes de reclamar.`;
        } else {
            message += `Total: ${payments.length} pagos\n\n`;
            
            payments.forEach((payment, index) => {
                message += `${index + 1}. ${formatCurrency(payment.amount, payment.currency)}\n`;
                message += `   📞 Teléfono: ${payment.phone}\n`;
                message += `   🆔 ID: \`${payment.tx_id}\`\n`;
                message += `   🔧 ${payment.tipo_pago}\n`;
                message += `   📅 ${new Date(payment.created_at).toLocaleDateString()}\n`;
                message += `---\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error showing pending payments:', error);
        await bot.editMessageText('❌ Error al obtener pagos pendientes.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    }
}

async function syncDatabase(chatId, messageId) {
    try {
        // This would perform database maintenance tasks
        // For now, just a placeholder
        const message = `🔄 *Sincronización de Base de Datos*\n\n` +
            `Sincronización completada.\n` +
            `_${new Date().toLocaleString()}_`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error syncing database:', error);
        await bot.editMessageText('❌ Error al sincronizar base de datos.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: createAdminKeyboard()
        });
    }
}

// ============================================
// TELEGRAM BOT - MESSAGE HANDLERS
// ============================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    const session = activeSessions[chatId];
    
    if (!text || text.startsWith('/')) return;
    
    try {
        // 1. Try to handle with gameHandler
        const handledByGame = await gameHandler.handleMessage(msg);
        if (handledByGame) {
            return;
        }
        
        // 2. Try to handle with sokyHandler
        const handledBySoky = await sokyHandler.handleMessage(chatId, text);
        if (handledBySoky) {
            return;
        }
        
        // 3. Try to handle with bolitaHandler
        const handledByBolita = await bolitaHandler.handleMessage(msg);
        if (handledByBolita) {
            return;
        }
        
        // 4. Process admin sessions
        if (session && esAdmin(userId)) {
            switch (session.step) {
                case 'admin_search_user':
                    await handleAdminSearchUser(chatId, text);
                    break;
                    
                case 'admin_contact_user':
                    await handleAdminContactUser(chatId, text, session.targetUserId);
                    break;
            }
            return;
        }
        
        // 5. Process normal bot sessions
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
                    
                default:
                    console.log(`Paso no manejado: ${session.step}`);
            }
        }
    } catch (error) {
        console.error('Error procesando mensaje:', error);
        await bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.', {
            reply_markup: createMainKeyboard()
        });
    }
});

async function handleAdminSearchUser(chatId, userIdInput) {
    try {
        const userId = parseInt(userIdInput.trim());
        
        if (isNaN(userId)) {
            await bot.sendMessage(chatId, '❌ ID inválido. Debe ser un número.', {
                reply_markup: createBackKeyboard('admin_search_user')
            });
            return;
        }
        
        const user = await getUser(userId);
        
        if (!user) {
            await bot.sendMessage(chatId, `❌ Usuario con ID ${userId} no encontrado.`, {
                reply_markup: createBackKeyboard('admin_search_user')
            });
            return;
        }
        
        const message = `👤 *Usuario Encontrado*\n\n` +
            `✅ *Nombre:* ${user.first_name}\n` +
            `🆔 *ID:* ${user.telegram_id}\n` +
            `📱 *Usuario:* @${user.username || 'N/A'}\n` +
            `📞 *Teléfono:* ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : 'No vinculado'}\n\n` +
            `Selecciona una opción para ver más detalles:`;
        
        delete activeSessions[chatId];
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error in admin search user:', error);
        await bot.sendMessage(chatId, '❌ Error al buscar usuario.', {
            reply_markup: createBackKeyboard('admin_panel')
        });
    }
}

async function handleAdminContactUser(chatId, messageText, targetUserId) {
    try {
        // Send message to target user
        await bot.sendMessage(targetUserId,
            `📨 *Mensaje del Administrador*\n\n` +
            `${messageText}\n\n` +
            `_Este es un mensaje oficial del sistema Cromwell Store._`,
            { parse_mode: 'Markdown' }
        );
        
        // Notify admin
        await bot.sendMessage(chatId,
            `✅ *Mensaje enviado*\n\n` +
            `Mensaje enviado al usuario ID: ${targetUserId}\n\n` +
            `Contenido:\n${messageText}`,
            { parse_mode: 'Markdown', reply_markup: createBackKeyboard('admin_panel') }
        );
        
        delete activeSessions[chatId];
    } catch (error) {
        console.error('Error contacting user:', error);
        await bot.sendMessage(chatId,
            `❌ Error al enviar mensaje. El usuario puede haber bloqueado el bot o no existir.`,
            { reply_markup: createBackKeyboard('admin_panel') }
        );
    }
}

async function handlePhoneInput(chatId, phone, session) {
    let cleanPhone = phone.replace(/[^\d]/g, '');
    
    console.log(`📱 Número recibido: ${phone}, Limpio: ${cleanPhone}`);
    
    // Validate format
    if (!cleanPhone.startsWith('53')) {
        if (cleanPhone.length === 8) {
            cleanPhone = '53' + cleanPhone;
        } else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
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
    
    // Validate final length
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
    
    // Verify it's a valid number
    if (!/^\d+$/.test(cleanPhone)) {
        await bot.sendMessage(chatId,
            `❌ *Caracteres inválidos*\n\n` +
            `El número solo debe contener dígitos.\n\n` +
            `Inténtalo de nuevo:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Check if number is already used by another user
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
        
        if (session.step === 'waiting_phone_start') {
            activeSessions[chatId] = { step: 'waiting_phone_start' };
        }
        
        return;
    }
    
    // Save normalized number
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
    
    // Send appropriate message
    if (session.step === 'waiting_phone_start') {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        await handleTerms(chatId, null);
    } else {
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: createMainKeyboard()
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
                    { parse_mode: 'Markdown', reply_markup: createMainKeyboard() }
                );
            }
        } else {
            await bot.sendMessage(chatId,
                `❌ *Este pago no te pertenece*\n\n` +
                `El pago con ID \`${txIdClean}\` está registrado para otro usuario.`,
                { parse_mode: 'Markdown', reply_markup: createClaimPaymentKeyboard() }
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
                { parse_mode: 'Markdown', reply_markup: createMainKeyboard() }
            );
        } else {
            await bot.sendMessage(chatId,
                `❌ *ID no encontrado*\n\n` +
                `No encontramos pagos pendientes con ID: \`${txIdClean}\`\n\n` +
                `Verifica:\n` +
                `1. Que el ID sea correcto\n` +
                `2. Que el pago sea *Tarjeta→Billetera*\n` +
                `3. Que no haya sido reclamado antes`,
                { parse_mode: 'Markdown', reply_markup: createClaimPaymentKeyboard() }
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
        saldo: [MINIMO_SALDO, 10000]
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
    session.amount = amount;
    
    // Show confirmation with buttons
    const bonoPorcentaje = 0.10;
    const bono = user[`first_dep_${currency}`] ? amount * bonoPorcentaje : 0;
    const totalConBono = amount + bono;
    const tokens = currency === 'saldo' ? Math.floor(amount / 100) * CWS_PER_100_SALDO : 0;
    
    const confirmMessage = `📋 *Confirmar Depósito*\n\n` +
        `💰 *Monto:* ${formatCurrency(amount, currency)}\n` +
        `🎁 *Bono:* ${formatCurrency(bono, currency)} (${bonoPorcentaje * 100}%)\n` +
        `💵 *Total a acreditar:* ${formatCurrency(totalConBono, currency)}\n` +
        `🎫 *Tokens a ganar:* ${tokens} CWS\n\n` +
        `¿Confirmas la solicitud de depósito?`;
    
    await bot.sendMessage(chatId, confirmMessage, {
        parse_mode: 'Markdown',
        reply_markup: createDepositConfirmKeyboard(currency, amount)
    });
}

// ============================================
// SCHEDULED TASKS
// ============================================

// Clean inactive sessions
setInterval(() => {
    const now = Date.now();
    const timeout = 30 * 60 * 1000;
    
    for (const [chatId, session] of Object.entries(activeSessions)) {
        if (session.lastActivity && (now - session.lastActivity) > timeout) {
            delete activeSessions[chatId];
            console.log(`🧹 Sesión limpiada para ${chatId}`);
        }
    }
}, 10 * 60 * 1000);

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`\n🤖 Cromwell Bot & Server iniciado`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`🌐 WebApp: http://localhost:${PORT}/webapp`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🔄 Keep alive: http://localhost:${PORT}/keepalive`);
    console.log(`💰 Mínimos: CUP=${MINIMO_CUP}, Saldo=${MINIMO_SALDO}`);
    console.log(`📞 Teléfono para pagos: ${PAGO_SALDO_MOVIL || '❌ No configurado'}`);
    console.log(`💳 Tarjeta para pagos: ${PAGO_CUP_TARJETA ? '✅ Configurada' : '❌ No configurada'}`);
    console.log(`🎮 LioGames: ${LIOGAMES_MEMBER_CODE ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`📱 SokyRecargas: ${SOKY_API_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🎱 La Bolita: ✅ Integrado`);
    console.log(`⚽ Apuestas Deportivas: 🔜 Próximamente`);
    console.log(`👑 Admin ID: ${BOT_ADMIN_ID ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`💱 Tasas de cambio:`);
    console.log(`   • USDT 0-30: $${USDT_RATE_0_30} CUP`);
    console.log(`   • USDT >30: $${USDT_RATE_30_PLUS} CUP`);
    console.log(`   • Saldo Móvil: ÷${SALDO_MOVIL_RATE}`);
    console.log(`   • SokyRecargas: $${SOKY_RATE_CUP} CUP por USDT`);
    console.log(`   • Mínimo CWS: ${MIN_CWS_USE}`);
    console.log(`\n🌐 Webhooks disponibles:`);
    console.log(`   • POST /payment-notification - Para pagos SMS`);
    console.log(`   • POST /lio-webhook - Para LioGames`);
    console.log(`   • POST /soky-webhook - Para SokyRecargas`);
    console.log(`   • POST /status-webhook - Genérico`);
    console.log(`\n🚀 Bot listo para recibir mensajes...`);
});

// Global error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});
