// bot.js - Cromwell Store Bot Completo (ACTUALIZADO)
require('dotenv').config();

// ============================================
// DEPENDENCIAS
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
const path = require('path');

// Importar handlers
const GameRechargeHandler = require('./game_recharges.js');
const SokyRecargasHandler = require('./sokyrecargas.js');

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
const MAXIMO_CUP = parseFloat(process.env.MAXIMO_CUP || 50000);

// Tasas de cambio dinámicas
const USDT_RATE_0_30 = parseFloat(process.env.USDT_RATE_0_30 || 650);
const USDT_RATE_30_PLUS = parseFloat(process.env.USDT_RATE_30_PLUS || 680);
const SALDO_MOVIL_RATE = parseFloat(process.env.SALDO_MOVIL_RATE || 2.1);

// Configuración de tokens
const CWS_PER_100_SALDO = 10;
const MIN_CWS_USE = parseInt(process.env.MIN_CWS_USE || 100);

// Información de pagos
const PAGO_CUP_TARJETA = process.env.PAGO_CUP_TARJETA;
const PAGO_SALDO_MOVIL = process.env.PAGO_SALDO_MOVIL;

// Configuración de administrador
const ADMIN_CHAT_ID = process.env.ADMIN_GROUP;
const BOT_ADMIN_ID = process.env.BOT_ADMIN_ID;

// Configuración del servidor
const PORT = process.env.PORT || 3000;

// Configuración SokyRecargas
const SOKY_API_TOKEN = process.env.SOKY_API_TOKEN;
const SOKY_RATE_CUP = parseFloat(process.env.SOKY_RATE_CUP) || 632;

// LioGames API
const LIOGAMES_SECRET = process.env.LIOGAMES_SECRET;
const LIOGAMES_MEMBER_CODE = process.env.LIOGAMES_MEMBER_CODE;

// USDT
const PAGO_USDT_ADDRES = process.env.PAGO_USDT_ADDRES;
const USDT_RATE_CUP = parseFloat(process.env.USDT_RATE_CUP) || 580;
const USDT_RATE_SALDO = parseFloat(process.env.USDT_RATE_SALDO) || 200;

// Webhooks externos
const PYTHON_WEBHOOK_URL = process.env.PYTHON_WEBHOOK_URL;

// ============================================
// VALIDACIÓN DE VARIABLES
// ============================================

console.log('🔧 Validando variables de entorno...');
const requiredVars = ['TELEGRAM_TOKEN', 'DB_URL', 'DB_KEY'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Faltan variables críticas de entorno:', missingVars);
    console.error('❌ Por favor, verifica tu archivo .env');
    process.exit(1);
}

if (!LIOGAMES_SECRET || !LIOGAMES_MEMBER_CODE) {
    console.warn('⚠️ ADVERTENCIA: Variables LioGames no configuradas. Recargas de juegos no funcionarán.');
}

if (!SOKY_API_TOKEN) {
    console.warn('⚠️ ADVERTENCIA: SOKY_API_TOKEN no configurada. Recargas ETECSA no funcionarán.');
}

if (!PAGO_CUP_TARJETA || !PAGO_SALDO_MOVIL) {
    console.warn('⚠️ ADVERTENCIA: Información de pagos no configurada completamente.');
}

console.log('✅ Variables de entorno validadas correctamente');

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
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Configuración de sesión para el panel web
app.use(session({
    secret: WEBHOOK_SECRET_KEY || 'cromwell-store-session-secret-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Inicializar bot de Telegram
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: true,
    request: {
        proxy: process.env.PROXY_URL || null
    }
});

// Inicializar Supabase
const supabase = createClient(DB_URL, DB_KEY, {
    auth: {
        persistSession: false
    }
});

// Inicializar handlers
let gameHandler, sokyHandler;
try {
    gameHandler = new GameRechargeHandler(bot, supabase);
    console.log('✅ GameRechargeHandler inicializado');
} catch (error) {
    console.error('❌ Error inicializando GameRechargeHandler:', error.message);
    gameHandler = null;
}

try {
    sokyHandler = new SokyRecargasHandler(bot, supabase);
    console.log('✅ SokyRecargasHandler inicializado');
} catch (error) {
    console.error('❌ Error inicializando SokyRecargasHandler:', error.message);
    sokyHandler = null;
}

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
    
    const authToken = req.headers['x-auth-token'] || req.query.auth_token || req.body.auth_token;
    
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
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        res.redirect('/');
    }
}

// Formatear moneda
function formatCurrency(amount, currency) {
    if (!amount && amount !== 0) return 'N/A';
    
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) return 'N/A';
    
    const symbols = {
        'cup': 'CUP',
        'saldo': 'Saldo',
        'cws': 'CWS',
        'usdt': 'USDT'
    };
    
    const symbol = symbols[currency] || currency?.toUpperCase() || '';
    
    if (currency === 'cws') {
        return `${Math.floor(amountNum)} ${symbol}`;
    }
    
    if (currency === 'usdt') {
        return `$${amountNum.toFixed(2)} ${symbol}`;
    }
    
    return `$${Math.floor(amountNum).toLocaleString('es-ES')} ${symbol}`;
}

// Obtener usuario por Telegram ID
async function getUser(telegramId) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return null;
            }
            console.log('Error obteniendo usuario:', error.message);
            return null;
        }
        return data;
    } catch (error) {
        console.error('Error en getUser:', error);
        return null;
    }
}

// Actualizar usuario
async function updateUser(telegramId, updates) {
    try {
        const { error } = await supabase
            .from('users')
            .update(updates)
            .eq('telegram_id', telegramId);
        
        if (error) {
            console.error('Error actualizando usuario:', error);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error en updateUser:', error);
        return false;
    }
}

// Obtener usuario por teléfono
async function getUserByPhone(phone) {
    try {
        if (!phone) {
            console.log('❌ No se proporcionó teléfono para buscar');
            return null;
        }
        
        const normalizedPhone = phone.replace(/[^\d]/g, '');
        console.log(`🔍 Buscando usuario con teléfono normalizado: ${normalizedPhone}`);
        
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
        
        console.log(`🔍 Patrones de búsqueda a probar:`, searchPatterns);
        
        for (const pattern of searchPatterns) {
            console.log(`🔍 Probando patrón: ${pattern}`);
            
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('phone_number', pattern)
                .single();
            
            if (error) {
                if (error.code !== 'PGRST116') {
                    console.log(`⚠️ Error buscando con patrón ${pattern}:`, error.message);
                }
                continue;
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
        
        console.log(`❌ Usuario no encontrado para ningún patrón de teléfono`);
        return null;
        
    } catch (error) {
        console.error('❌ Error en getUserByPhone:', error);
        return null;
    }
}

// Calcular precio en CUP según cantidad de USDT
function calculateCupFromUsdt(usdtAmount) {
    if (!usdtAmount || isNaN(usdtAmount) || usdtAmount <= 0) {
        return 0;
    }
    
    if (usdtAmount <= 30) {
        return usdtAmount * USDT_RATE_0_30;
    } else {
        return (30 * USDT_RATE_0_30) + ((usdtAmount - 30) * USDT_RATE_30_PLUS);
    }
}

// Calcular precio en Saldo Móvil
function calculateSaldoMovilFromCup(cupAmount) {
    if (!cupAmount || isNaN(cupAmount) || cupAmount <= 0) {
        return 0;
    }
    
    const raw = cupAmount / SALDO_MOVIL_RATE;
    // Redondear al múltiplo de 5 más cercano hacia arriba
    return Math.ceil(raw / 5) * 5;
}

// Verificar si ya existe una transacción con el mismo tx_id
async function verificarTransaccionDuplicada(tx_id) {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('tx_id', tx_id)
            .eq('status', 'completed')
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.log('Error verificando duplicado:', error.message);
        }
        
        return data !== null;
    } catch (error) {
        console.error('Error en verificarTransaccionDuplicada:', error);
        return false;
    }
}

// Verificar si existe solicitud pendiente para el usuario
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
            console.log('Error verificando solicitud pendiente:', error.message);
            return null;
        }
        
        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('Error en verificarSolicitudPendiente:', error);
        return null;
    }
}

// Notificar al admin sobre nueva solicitud
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
        console.error('Error notificando nueva solicitud:', error);
    }
}

// Procesar pago automático
async function procesarPagoAutomatico(userId, amount, currency, txId, tipoPago) {
    try {
        console.log(`💰 Procesando pago automático: ${userId}, ${amount}, ${currency}, ${txId}, ${tipoPago}`);
        
        // 1. Verificar si ya existe una transacción con este tx_id
        const esDuplicado = await verificarTransaccionDuplicada(txId);
        if (esDuplicado) {
            console.log(`❌ Transacción duplicada detectada: ${txId}`);
            return { 
                success: false, 
                message: 'Esta transacción ya fue procesada anteriormente',
                esDuplicado: true 
            };
        }
        
        // 2. Verificar si el usuario tiene una solicitud pendiente
        const solicitudPendiente = await verificarSolicitudPendiente(userId, currency);
        
        if (!solicitudPendiente) {
            console.log(`❌ Usuario ${userId} no tiene solicitud pendiente para ${currency}`);
            
            // Guardar como pago no solicitado (transferencia exterior)
            await supabase.from('unrequested_payments').insert({
                user_id: userId,
                amount: amount,
                currency: currency,
                tx_id: txId,
                tipo_pago: tipoPago,
                status: 'no_request',
                created_at: new Date().toISOString()
            }).catch(err => console.error('Error guardando pago no solicitado:', err));
            
            // NO NOTIFICAR AL USUARIO - Es una transferencia exterior
            // Solo notificar al admin
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
        
        // 3. Verificar que el monto coincida (con margen del 10%)
        const montoSolicitado = solicitudPendiente.amount_requested;
        const margen = montoSolicitado * 0.1;
        
        if (Math.abs(amount - montoSolicitado) > margen) {
            console.log(`❌ Monto no coincide: Solicitado ${montoSolicitado}, Recibido ${amount}`);
            
            // Notificar al usuario
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
        
        // 4. Procesar el pago
        const user = await getUser(userId);
        if (!user) {
            console.log(`❌ Usuario ${userId} no encontrado`);
            return { success: false, message: 'Usuario no encontrado' };
        }
        
        let montoConBono = amount;
        let tokensGanados = 0;
        
        // Aplicar bono solo para primer depósito
        if (currency === 'cup' && user.first_dep_cup) {
            montoConBono = amount * 1.10;
            await updateUser(userId, { first_dep_cup: false });
        } else if (currency === 'saldo' && user.first_dep_saldo) {
            montoConBono = amount * 1.10;
            await updateUser(userId, { first_dep_saldo: false });
        }
        
        // Calcular tokens para saldo
        if (currency === 'saldo') {
            tokensGanados = Math.floor(amount / 100) * CWS_PER_100_SALDO;
        }
        
        // Actualizar saldo del usuario
        const updates = {
            [`balance_${currency}`]: (user[`balance_${currency}`] || 0) + montoConBono,
            last_active: new Date().toISOString()
        };
        
        if (currency === 'saldo') {
            updates.tokens_cws = (user.tokens_cws || 0) + tokensGanados;
        }
        
        await updateUser(userId, updates);
        
        // Actualizar la transacción como completada
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
        
        // Notificar al usuario
        const mensajeUsuario = `✨ *¡Depósito Completado!*\n\n` +
            `📋 Orden #${solicitudPendiente.id}\n` +
            `💰 Monto recibido: ${formatCurrency(amount, currency)}\n` +
            `${bonoMensaje}${tokensMensaje}\n` +
            `💵 Total acreditado: *${formatCurrency(montoConBono, currency)}*\n\n` +
            `📊 Nuevo saldo ${currency.toUpperCase()}: *${formatCurrency(updates[`balance_${currency}`], currency)}*\n` +
            `🆔 ID de Transacción: \`${txId}\``;
        
        await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
        
        // Notificar al admin
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
// WEBHOOK PARA NOTIFICACIONES EXTERIORES
// ============================================

// Webhook para LioGames (recargas de juegos)
app.post('/lio-webhook', verifyWebhookToken, async (req, res) => {
    try {
        console.log('📥 Webhook LioGames recibido:', JSON.stringify(req.body, null, 2));
        
        const { order_id, status, message, partner_ref } = req.body;
        
        if (!order_id) {
            return res.status(400).json({ error: 'order_id es requerido' });
        }
        
        // Buscar la transacción por order_id o partner_ref
        let transaction = null;
        
        // Buscar por lio_transaction_id
        const { data: txByLioId } = await supabase
            .from('transactions')
            .select('*')
            .or(`details->>lio_order_id.eq.${order_id},tx_id.eq.${order_id}`)
            .single();
        
        if (txByLioId) {
            transaction = txByLioId;
        } else if (partner_ref) {
            // Buscar por partner_ref
            const { data: txByRef } = await supabase
                .from('transactions')
                .select('*')
                .eq('partner_ref', partner_ref)
                .single();
            
            if (txByRef) {
                transaction = txByRef;
            }
        }
        
        if (!transaction) {
            console.log(`❌ Transacción no encontrada para order_id: ${order_id}, partner_ref: ${partner_ref}`);
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }
        
        // Mapear estado de LioGames a nuestro sistema
        let newStatus = 'processing';
        if (status === 'SUCCESS') newStatus = 'completed';
        else if (status === 'FAILED') newStatus = 'failed';
        else if (status === 'PENDING') newStatus = 'pending';
        else if (status === 'CANCELED') newStatus = 'canceled';
        
        // Actualizar estado de la transacción
        const updates = {
            status: newStatus,
            updated_at: new Date().toISOString(),
            response_data: req.body
        };
        
        if (newStatus === 'completed') {
            updates.completed_at = new Date().toISOString();
        }
        
        await supabase
            .from('transactions')
            .update(updates)
            .eq('id', transaction.id);
        
        // Notificar al usuario
        if (transaction.user_id) {
            let statusMessage = '';
            switch (newStatus) {
                case 'completed':
                    statusMessage = `✅ *¡Recarga completada!*\n\n` +
                        `🎮 Juego: ${transaction.details?.game || 'Juego'}\n` +
                        `💰 Monto: ${formatCurrency(Math.abs(transaction.amount), transaction.currency)}\n` +
                        `🆔 Orden: ${order_id}\n` +
                        `📅 Fecha: ${new Date().toLocaleString()}`;
                    break;
                case 'failed':
                    statusMessage = `❌ *Recarga fallida*\n\n` +
                        `Juego: ${transaction.details?.game || 'Juego'}\n` +
                        `Error: ${message || 'Error desconocido'}\n\n` +
                        `Contacta al administrador para más información.`;
                    break;
                case 'processing':
                    statusMessage = `⏳ *Recarga en proceso*\n\n` +
                        `Estamos procesando tu recarga. Te notificaremos cuando esté completa.`;
                    break;
            }
            
            if (statusMessage) {
                await bot.sendMessage(transaction.user_id, statusMessage, { 
                    parse_mode: 'Markdown' 
                }).catch(err => console.error('Error enviando notificación:', err));
            }
        }
        
        // Notificar al admin
        if (ADMIN_CHAT_ID) {
            const user = await getUser(transaction.user_id);
            const adminMsg = `🎮 *Webhook LioGames - Estado Actualizado*\n\n` +
                `👤 Usuario: ${user?.first_name || transaction.user_id}\n` +
                `🎮 Juego: ${transaction.details?.game || 'Desconocido'}\n` +
                `📦 Estado: ${newStatus}\n` +
                `🆔 Orden: ${order_id}\n` +
                `💰 Monto: ${formatCurrency(Math.abs(transaction.amount), transaction.currency)}`;
            
            await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        }
        
        res.json({ 
            success: true, 
            message: 'Estado actualizado correctamente',
            transaction_id: transaction.id,
            new_status: newStatus
        });
        
    } catch (error) {
        console.error('❌ Error procesando webhook LioGames:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Webhook genérico para notificaciones de estado
app.post('/status-webhook', verifyWebhookToken, async (req, res) => {
    try {
        console.log('📥 Webhook de estado recibido:', JSON.stringify(req.body, null, 2));
        
        const { service, type, data } = req.body;
        
        if (!service || !type || !data) {
            return res.status(400).json({ error: 'service, type y data son requeridos' });
        }
        
        switch (service.toLowerCase()) {
            case 'liogames':
                // Procesar como LioGames
                req.body = data;
                return app._router.handle(req, res, (err) => {
                    if (err) {
                        console.error('Error redirigiendo a LioGames webhook:', err);
                        res.status(500).json({ error: 'Error interno' });
                    }
                });
                
            case 'sokyrecargas':
                // Procesar como SokyRecargas
                if (ADMIN_CHAT_ID) {
                    const adminMsg = `📱 *Webhook SokyRecargas*\n\n` +
                        `📋 Tipo: ${type}\n` +
                        `📊 Datos: ${JSON.stringify(data, null, 2)}\n\n` +
                        `Hora: ${new Date().toLocaleString()}`;
                    
                    await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
                }
                break;
                
            default:
                console.log(`⚠️ Servicio no reconocido: ${service}`);
        }
        
        // Notificar al admin
        if (ADMIN_CHAT_ID) {
            const adminMsg = `🌐 *Webhook Genérico Recibido*\n\n` +
                `🔧 Servicio: ${service}\n` +
                `📋 Tipo: ${type}\n` +
                `📊 Datos: ${JSON.stringify(data, null, 2)}\n\n` +
                `Hora: ${new Date().toLocaleString()}`;
            
            await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        }
        
        res.json({ 
            success: true, 
            message: 'Notificación recibida',
            service: service,
            type: type
        });
        
    } catch (error) {
        console.error('❌ Error procesando webhook de estado:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============================================
// RUTAS PARA LA WEBAPP
// ============================================

// Obtener datos del usuario para WebApp
app.post('/api/user-data', verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id } = req.body;
        
        if (!telegram_id) {
            return res.status(400).json({ error: 'telegram_id es requerido' });
        }
        
        const user = await getUser(telegram_id);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json({
            success: true,
            user: {
                telegram_id: user.telegram_id,
                first_name: user.first_name,
                username: user.username,
                phone_number: user.phone_number,
                balance_cup: user.balance_cup || 0,
                balance_saldo: user.balance_saldo || 0,
                tokens_cws: user.tokens_cws || 0,
                first_dep_cup: user.first_dep_cup || true,
                first_dep_saldo: user.first_dep_saldo || true,
                last_active: user.last_active,
                accepted_terms: user.accepted_terms || false,
                pending_balance_cup: user.pending_balance_cup || 0
            }
        });
        
    } catch (error) {
        console.error('Error en /api/user-data:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear depósito desde WebApp
app.post('/api/create-deposit', verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, method, amount, phone } = req.body;
        
        if (!telegram_id || !method || !amount) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        const user = await getUser(telegram_id);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar saldo mínimo
        const minAmounts = { cup: MINIMO_CUP, saldo: MINIMO_SALDO };
        const maxAmounts = { cup: MAXIMO_CUP, saldo: 10000 };
        
        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum < minAmounts[method] || amountNum > maxAmounts[method]) {
            return res.json({ 
                success: false, 
                error: `Monto fuera de límites (${minAmounts[method]} - ${maxAmounts[method]})` 
            });
        }
        
        // Verificar si ya tiene solicitud pendiente
        const solicitudExistente = await verificarSolicitudPendiente(telegram_id, method);
        if (solicitudExistente) {
            return res.json({
                success: false,
                error: `Ya tienes una solicitud pendiente (Orden #${solicitudExistente.id})`
            });
        }
        
        // Calcular bono
        const bonoPorcentaje = 0.10;
        const tieneBono = method === 'cup' ? user.first_dep_cup : user.first_dep_saldo;
        const bono = tieneBono ? amountNum * bonoPorcentaje : 0;
        const totalConBono = amountNum + bono;
        
        // Calcular tokens para saldo
        const tokens = method === 'saldo' ? Math.floor(amountNum / 100) * CWS_PER_100_SALDO : 0;
        
        // Crear orden en la base de datos
        const { data: transaction, error } = await supabase
            .from('transactions')
            .insert([{
                user_id: telegram_id,
                type: 'DEPOSIT',
                currency: method,
                amount_requested: amountNum,
                estimated_bonus: bono,
                estimated_tokens: tokens,
                status: 'pending',
                user_name: user.first_name,
                user_username: user.username,
                user_phone: phone || user.phone_number,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();
        
        if (error) {
            console.error('Error creando transacción:', error);
            throw new Error('Error al crear la orden');
        }
        
        // Notificar al usuario por Telegram
        await bot.sendMessage(telegram_id,
            `🌐 *Solicitud de depósito desde WebApp*\n\n` +
            `🆔 Orden #${transaction.id}\n` +
            `💰 Monto: $${amountNum} ${method.toUpperCase()}\n` +
            `🎁 Bono: $${bono} (${bonoPorcentaje * 100}%)\n` +
            `💵 Total a recibir: $${totalConBono} ${method.toUpperCase()}\n\n` +
            `Por favor, completa el pago según las instrucciones.`,
            { parse_mode: 'Markdown' }
        );
        
        // Notificar al admin
        if (ADMIN_CHAT_ID) {
            const adminMsg = `🌐 *NUEVA SOLICITUD WEBAPP*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                `💰 Monto: $${amountNum} ${method.toUpperCase()}\n` +
                `🎁 Bono: $${bono}\n` +
                `📋 Orden #: ${transaction.id}`;
            
            await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        }
        
        res.json({ 
            success: true, 
            orderId: transaction.id,
            amount: amountNum,
            bonus: bono,
            total: totalConBono,
            tokens: tokens
        });
        
    } catch (error) {
        console.error('Error en /api/create-deposit:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Error interno del servidor' 
        });
    }
});

// Obtener lista de juegos
app.get('/api/games', verifyWebhookToken, async (req, res) => {
    try {
        if (!gameHandler) {
            return res.status(503).json({ error: 'Servicio de juegos no disponible' });
        }
        
        // Usar los juegos definidos en game_recharges.js
        const games = Object.entries(gameHandler.GAMES || {}).map(([id, game]) => ({
            id,
            name: game.name,
            variations: game.variations,
            input_schema: game.input_schema
        }));
        
        res.json(games);
    } catch (error) {
        console.error('Error en /api/games:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener precio de juego
app.post('/api/game-price', verifyWebhookToken, async (req, res) => {
    try {
        const { game_id, variation_id } = req.body;
        
        if (!game_id || !variation_id) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        if (!gameHandler) {
            return res.status(503).json({ error: 'Servicio de juegos no disponible' });
        }
        
        // Usar el gameHandler para obtener precios
        const prices = await gameHandler.getPackagePrice(game_id, variation_id);
        
        res.json({
            success: true,
            prices: prices
        });
        
    } catch (error) {
        console.error('Error en /api/game-price:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Error interno del servidor' 
        });
    }
});

// Comprar juego desde WebApp
app.post('/api/game-purchase', verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, game_id, variation_id, payment_method, user_data, amount } = req.body;
        
        if (!telegram_id || !game_id || !variation_id || !payment_method || !amount) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        if (!gameHandler) {
            return res.status(503).json({ error: 'Servicio de juegos no disponible' });
        }
        
        // Verificar saldo del usuario
        const user = await getUser(telegram_id);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        let balanceField = '';
        let currentBalance = 0;
        
        switch(payment_method) {
            case 'cup':
                balanceField = 'balance_cup';
                currentBalance = user.balance_cup || 0;
                break;
            case 'saldo':
                balanceField = 'balance_saldo';
                currentBalance = user.balance_saldo || 0;
                break;
            case 'cws':
                balanceField = 'tokens_cws';
                currentBalance = user.tokens_cws || 0;
                break;
            default:
                return res.status(400).json({ error: 'Método de pago no válido' });
        }
        
        const amountNum = parseFloat(amount);
        if (currentBalance < amountNum) {
            return res.json({ 
                success: false, 
                error: `Saldo insuficiente. Necesitas: ${amountNum}, Tienes: ${currentBalance}` 
            });
        }
        
        // Verificar mínimo para CWS
        if (payment_method === 'cws' && amountNum < MIN_CWS_USE) {
            return res.json({
                success: false,
                error: `Mínimo para usar CWS es ${MIN_CWS_USE} tokens`
            });
        }
        
        // Obtener datos del juego
        const game = gameHandler.GAMES[game_id];
        if (!game) {
            return res.status(404).json({ error: 'Juego no encontrado' });
        }
        
        const variation = game.variations[variation_id];
        if (!variation) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }
        
        // Crear orden en LioGames
        const orderData = {
            product_id: game_id,
            variation_id: variation_id,
            user_id: user_data.user_id,
            server_id: user_data.server_id || null,
            quantity: 1,
            partner_ref: `WEBAPP_${telegram_id}_${Date.now()}`
        };
        
        let orderResult;
        try {
            orderResult = await gameHandler.createOrder(orderData);
            
            if (!orderResult.ok) {
                throw new Error(orderResult.message || 'Error creando orden');
            }
        } catch (error) {
            console.error('Error creando orden LioGames:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Error al procesar la orden con LioGames' 
            });
        }
        
        // Descontar saldo
        const updates = {};
        updates[balanceField] = currentBalance - amountNum;
        updates.last_active = new Date().toISOString();
        
        await updateUser(telegram_id, updates);
        
        // Registrar transacción
        await supabase
            .from('transactions')
            .insert({
                user_id: telegram_id,
                type: 'GAME_RECHARGE',
                currency: payment_method,
                amount: -amountNum,
                status: 'completed',
                tx_id: orderResult.data?.order_id || `WEBAPP_${Date.now()}`,
                partner_ref: orderData.partner_ref,
                details: {
                    game: game.name,
                    package: variation.name,
                    game_data: user_data,
                    lio_order_id: orderResult.data?.order_id,
                    webapp: true
                },
                completed_at: new Date().toISOString(),
                created_at: new Date().toISOString()
            });
        
        // Notificar al usuario
        await bot.sendMessage(telegram_id,
            `🎮 *Compra desde WebApp Completada*\n\n` +
            `🆔 Orden #: ${orderResult.data?.order_id || 'N/A'}\n` +
            `🎮 Juego: ${game.name}\n` +
            `📦 Paquete: ${variation.name}\n` +
            `💳 Pagado con: ${payment_method.toUpperCase()}\n` +
            `💰 Monto: ${formatCurrency(amountNum, payment_method)}\n\n` +
            `La recarga se está procesando. Te notificaremos cuando esté completa.`,
            { parse_mode: 'Markdown' }
        );
        
        // Notificar al admin
        if (ADMIN_CHAT_ID) {
            const adminMsg = `🌐 *COMPRA WEBAPP - JUEGO*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                `🎮 Juego: ${game.name}\n` +
                `📦 Paquete: ${variation.name}\n` +
                `💳 Método: ${payment_method.toUpperCase()}\n` +
                `💰 Monto: ${formatCurrency(amountNum, payment_method)}\n` +
                `🆔 Orden LioGames: ${orderResult.data?.order_id || 'N/A'}`;
            
            await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        }
        
        res.json({
            success: true,
            orderId: orderResult.data?.order_id || `WEBAPP_${Date.now()}`,
            message: 'Compra procesada correctamente'
        });
        
    } catch (error) {
        console.error('Error en /api/game-purchase:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Error interno del servidor' 
        });
    }
});

// Obtener ofertas ETECSA
app.get('/api/etecsa-offers', verifyWebhookToken, async (req, res) => {
    try {
        if (!sokyHandler) {
            return res.status(503).json({ error: 'Servicio ETECSA no disponible' });
        }
        
        const offers = await sokyHandler.getOffers();
        
        // Formatear ofertas para la WebApp
        const formattedOffers = offers.map(offer => ({
            id: offer.id,
            name: offer.name,
            description: offer.description,
            prices: offer.prices,
            requires_email: offer.requiresEmail || false,
            metadata: offer.metadata || {}
        }));
        
        res.json(formattedOffers);
    } catch (error) {
        console.error('Error en /api/etecsa-offers:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Recarga ETECSA desde WebApp
app.post('/api/etecsa-recharge', verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, offer_id, price_id, phone, email, amount } = req.body;
        
        if (!telegram_id || !offer_id || !price_id || !phone || !amount) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        if (!sokyHandler) {
            return res.status(503).json({ error: 'Servicio ETECSA no disponible' });
        }
        
        // Verificar saldo del usuario
        const user = await getUser(telegram_id);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const amountNum = parseFloat(amount);
        if (user.balance_cup < amountNum) {
            return res.json({ 
                success: false, 
                error: 'Saldo CUP insuficiente' 
            });
        }
        
        // Validar teléfono
        const cleanPhone = phone.replace(/[^\d]/g, '');
        if (!cleanPhone.startsWith('53') || cleanPhone.length !== 10) {
            return res.json({
                success: false,
                error: 'Formato de teléfono inválido. Debe ser 5351234567'
            });
        }
        
        // Validar email si es requerido
        // (La validación específica se hará en el sokyHandler)
        
        // Aquí necesitarías llamar al método correspondiente de sokyHandler
        // Como sokyHandler no tiene un método específico para WebApp,
        // crearemos una transacción simulada por ahora
        
        const transactionId = `ETECSA_WEBAPP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Descontar saldo
        await updateUser(telegram_id, {
            balance_cup: (user.balance_cup || 0) - amountNum,
            last_active: new Date().toISOString()
        });
        
        // Registrar transacción
        await supabase
            .from('transactions')
            .insert({
                user_id: telegram_id,
                type: 'ETECSA_RECHARGE',
                currency: 'cup',
                amount: -amountNum,
                status: 'completed',
                tx_id: transactionId,
                details: {
                    offer_id: offer_id,
                    price_id: price_id,
                    phone: cleanPhone,
                    email: email,
                    amount: amountNum,
                    webapp: true
                },
                completed_at: new Date().toISOString(),
                created_at: new Date().toISOString()
            });
        
        // Notificar al usuario
        await bot.sendMessage(telegram_id,
            `📱 *Recarga ETECSA desde WebApp*\n\n` +
            `🆔 Transacción: ${transactionId}\n` +
            `📞 Destino: +${cleanPhone}\n` +
            `💰 Monto: $${amountNum} CUP\n\n` +
            `Tu recarga ha sido procesada. El saldo se acreditará en breve.`,
            { parse_mode: 'Markdown' }
        );
        
        // Notificar al admin
        if (ADMIN_CHAT_ID) {
            const adminMsg = `🌐 *RECARGA ETECSA WEBAPP*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                `📞 Destino: +${cleanPhone}\n` +
                `💰 Monto: $${amountNum} CUP\n` +
                `🆔 Transacción: ${transactionId}`;
            
            await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        }
        
        res.json({
            success: true,
            transactionId: transactionId,
            message: 'Recarga procesada correctamente'
        });
        
    } catch (error) {
        console.error('Error en /api/etecsa-recharge:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Error interno del servidor' 
        });
    }
});

// Actualizar teléfono desde WebApp
app.post('/api/update-phone', verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, phone } = req.body;
        
        if (!telegram_id || !phone) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        // Validar formato
        const cleanPhone = phone.replace(/[^\d]/g, '');
        if (!cleanPhone.startsWith('53') || cleanPhone.length !== 10) {
            return res.json({ 
                success: false, 
                error: 'Formato inválido. Debe comenzar con 53 y tener 10 dígitos.' 
            });
        }
        
        // Verificar si el número ya está en uso
        const { data: existingUser } = await supabase
            .from('users')
            .select('telegram_id, first_name')
            .eq('phone_number', cleanPhone)
            .neq('telegram_id', telegram_id)
            .single();
        
        if (existingUser) {
            return res.json({ 
                success: false, 
                error: 'Este número ya está vinculado a otra cuenta.' 
            });
        }
        
        // Actualizar teléfono
        await updateUser(telegram_id, { 
            phone_number: cleanPhone,
            last_active: new Date().toISOString()
        });
        
        res.json({ 
            success: true,
            message: 'Teléfono actualizado correctamente'
        });
        
    } catch (error) {
        console.error('Error en /api/update-phone:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor' 
        });
    }
});

// Reclamar pago desde WebApp
app.post('/api/claim-payment', verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, tx_id } = req.body;
        
        if (!telegram_id || !tx_id) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        // Buscar pago pendiente
        const { data: pendingPayment } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('tx_id', tx_id)
            .eq('claimed', false)
            .single();
        
        if (!pendingPayment) {
            return res.json({ 
                success: false, 
                message: 'Pago no encontrado o ya reclamado' 
            });
        }
        
        // Verificar que el pago pertenezca al usuario
        const user = await getUser(telegram_id);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        if (pendingPayment.user_id && pendingPayment.user_id != telegram_id) {
            if (!pendingPayment.phone || pendingPayment.phone !== user.phone_number) {
                return res.json({
                    success: false,
                    message: 'Este pago no pertenece a tu cuenta'
                });
            }
        }
        
        // Procesar pago
        const result = await procesarPagoAutomatico(
            telegram_id,
            pendingPayment.amount,
            pendingPayment.currency,
            pendingPayment.tx_id,
            pendingPayment.tipo_pago
        );
        
        if (result.success) {
            // Marcar como reclamado
            await supabase
                .from('pending_sms_payments')
                .update({ 
                    claimed: true, 
                    claimed_by: telegram_id,
                    claimed_at: new Date().toISOString()
                })
                .eq('id', pendingPayment.id);
            
            res.json({
                success: true,
                amount: pendingPayment.amount,
                currency: pendingPayment.currency,
                message: 'Pago reclamado y procesado correctamente'
            });
        } else {
            res.json({ 
                success: false, 
                message: result.message 
            });
        }
        
    } catch (error) {
        console.error('Error en /api/claim-payment:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor' 
        });
    }
});

// Obtener historial de transacciones
app.get('/api/user-history', verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id } = req.query;
        
        if (!telegram_id) {
            return res.status(400).json({ error: 'telegram_id es requerido' });
        }
        
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', telegram_id)
            .order('created_at', { ascending: false })
            .limit(50);
        
        res.json(transactions || []);
        
    } catch (error) {
        console.error('Error en /api/user-history:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener configuración pública
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        config: {
            minimo_cup: MINIMO_CUP,
            minimo_saldo: MINIMO_SALDO,
            maximo_cup: MAXIMO_CUP,
            min_cws_use: MIN_CWS_USE,
            usdt_rate_0_30: USDT_RATE_0_30,
            usdt_rate_30_plus: USDT_RATE_30_PLUS,
            saldo_movil_rate: SALDO_MOVIL_RATE,
            soky_rate_cup: SOKY_RATE_CUP,
            cws_per_100_saldo: CWS_PER_100_SALDO,
            pago_cup_tarjeta: PAGO_CUP_TARJETA ? 'Configurada' : 'No configurada',
            pago_saldo_movil: PAGO_SALDO_MOVIL ? 'Configurado' : 'No configurado'
        }
    });
});

// ============================================
// ENDPOINT PARA RECIBIR PAGOS DEL PARSER
// ============================================

app.post('/payment-notification', verifyWebhookToken, async (req, res) => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('📥 PAYMENT-NOTIFICATION RECIBIDA EN EL BOT');
        console.log('🕐 Hora:', new Date().toISOString());
        console.log('📊 Datos:', JSON.stringify(req.body, null, 2));
        
        const { 
            type, 
            amount, 
            currency, 
            tx_id, 
            tipo_pago, 
            phone,
            sender_phone,
            receiver_phone
        } = req.body;
        
        if (!type || !amount || !currency || !tx_id) {
            console.log('❌ Campos requeridos faltantes en payload');
            return res.status(400).json({ 
                success: false, 
                message: 'Campos requeridos faltantes: type, amount, currency, tx_id' 
            });
        }
        
        switch (type) {
            case 'SMS_PAYMENT_DETECTED':
                console.log(`🔍 Procesando SMS_PAYMENT_DETECTED`);
                
                let userPhone = phone || sender_phone;
                console.log(`📞 Teléfono recibido: ${userPhone}`);
                console.log(`💰 Monto: ${amount} ${currency}`);
                
                let user = null;
                let normalizedPhone = null;
                
                if (userPhone) {
                    normalizedPhone = userPhone.replace(/[^\d]/g, '');
                    console.log(`🔍 Buscando usuario con teléfono normalizado: ${normalizedPhone}`);
                    
                    user = await getUserByPhone(normalizedPhone);
                    
                    if (user) {
                        console.log(`✅ Usuario encontrado: ${user.telegram_id} (${user.first_name})`);
                        
                        const result = await procesarPagoAutomatico(
                            user.telegram_id, 
                            parseFloat(amount), 
                            currency, 
                            tx_id, 
                            tipo_pago
                        );
                        
                        console.log(`✅ Resultado del procesamiento:`, result);
                        return res.json(result);
                    } else {
                        console.log(`❌ Usuario NO encontrado para teléfono: ${normalizedPhone}`);
                        
                        // Guardar como pago pendiente
                        await supabase.from('pending_sms_payments').insert({
                            phone: normalizedPhone,
                            amount: parseFloat(amount),
                            currency: currency,
                            tx_id: tx_id,
                            tipo_pago: tipo_pago,
                            claimed: false,
                            created_at: new Date().toISOString()
                        }).catch(err => console.error('Error guardando pago pendiente:', err));
                        
                        console.log(`✅ Pago pendiente guardado para teléfono: ${normalizedPhone}`);
                        
                        // Notificar al admin
                        if (ADMIN_CHAT_ID) {
                            const mensajeAdmin = `📱 *PAGO NO IDENTIFICADO*\n\n` +
                                `📞 Teléfono: ${normalizedPhone}\n` +
                                `💰 Monto: ${formatCurrency(amount, currency)}\n` +
                                `🔧 Tipo: ${tipo_pago}\n` +
                                `🆔 ID: \`${tx_id}\`\n\n` +
                                `ℹ️ Este pago está pendiente de reclamar.`;
                            
                            await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                        }
                        
                        return res.json({ 
                            success: false, 
                            message: 'Usuario no encontrado, pago guardado como pendiente',
                            phone: normalizedPhone
                        });
                    }
                }
                break;
                
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
        
        if (ADMIN_CHAT_ID) {
            const errorMsg = `❌ *ERROR EN PAYMENT-NOTIFICATION*\n\n` +
                `Error: ${error.message}\n` +
                `Hora: ${new Date().toLocaleString()}`;
            
            try {
                await bot.sendMessage(ADMIN_CHAT_ID, errorMsg, { parse_mode: 'Markdown' });
            } catch (botError) {
                console.error('Error enviando mensaje de error:', botError);
            }
        }
        
        return res.status(500).json({ 
            success: false, 
            message: error.message
        });
    }
});

// ============================================
// TELEGRAM BOT - TECLADOS ACTUALIZADOS
// ============================================

// Teclado principal
const createMainKeyboard = () => ({
    inline_keyboard: [
        [{ text: '👛 Mi Billetera', callback_data: 'wallet' }],
        [{ text: '💰 Recargar Billetera', callback_data: 'recharge_menu' }],
        [{ text: '📱 Recargas ETECSA', callback_data: 'soky_offers' }],
        [{ text: '🎮 Recargar Juegos', callback_data: 'games_menu' }],
        [{ text: '📱 Cambiar Teléfono', callback_data: 'link_phone' }],
        [{ text: '🎁 Reclamar Pago', callback_data: 'claim_payment' }],
        [{ text: '📜 Ver Términos Web', callback_data: 'view_terms_web' }],
        [{ text: '🔄 Actualizar', callback_data: 'refresh_wallet' }]
    ]
});

// Teclado de billetera
const createWalletKeyboard = () => ({
    inline_keyboard: [
        [{ text: '💰 Recargar Billetera', callback_data: 'recharge_menu' }],
        [{ text: '📱 Recargas ETECSA', callback_data: 'soky_offers' }],
        [{ text: '🎮 Recargar Juegos', callback_data: 'games_menu' }],
        [{ text: '📜 Historial', callback_data: 'history' }],
        [{ text: '📱 Cambiar Teléfono', callback_data: 'link_phone' }],
        [{ text: '📊 Saldo Pendiente', callback_data: 'view_pending' }],
        [{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]
    ]
});

// Teclado de métodos de recarga
const createRechargeMethodsKeyboard = () => ({
    inline_keyboard: [
        [{ text: '💳 CUP (Tarjeta)', callback_data: 'dep_init:cup' }],
        [{ text: '📲 Saldo Móvil', callback_data: 'dep_init:saldo' }],
        [{ text: '🔙 Volver a Billetera', callback_data: 'wallet' }]
    ]
});

// Teclado de términos
const createTermsKeyboard = () => ({
    inline_keyboard: [
        [{ text: '✅ Aceptar Términos', callback_data: 'accept_terms' }],
        [{ text: '🔙 Volver', callback_data: 'start_back' }]
    ]
});

// Teclado para reclamar pagos
const createClaimPaymentKeyboard = () => ({
    inline_keyboard: [
        [{ text: '🔍 Buscar por ID', callback_data: 'search_payment_id' }],
        [{ text: '📋 Ver Pendientes', callback_data: 'view_pending_payments' }],
        [{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]
    ]
});

// Teclado genérico de volver
const createBackKeyboard = (callback_data) => ({
    inline_keyboard: [[{ text: '🔙 Volver', callback_data }]]
});

// Teclado de confirmación de depósito
const createDepositConfirmKeyboard = (currency, amount) => ({
    inline_keyboard: [
        [{ text: '✅ Confirmar Depósito', callback_data: `confirm_deposit:${currency}:${amount}` }],
        [{ text: '❌ Cancelar', callback_data: 'recharge_menu' }]
    ]
});

// ============================================
// MANEJO DE COMANDOS TELEGRAM
// ============================================

// Comando /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const { id, first_name, username } = msg.from;
    
    console.log(`🚀 Usuario ${id} (${first_name}) inició el bot`);
    
    let user = await getUser(chatId);
    
    if (!user) {
        console.log(`👤 Creando nuevo usuario: ${id}`);
        user = {
            telegram_id: id,
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
            last_active: new Date().toISOString(),
            created_at: new Date().toISOString()
        };
        
        await supabase.from('users').upsert(user, { onConflict: 'telegram_id' });
        user = await getUser(chatId);
    } else {
        // Actualizar última actividad
        await updateUser(chatId, { last_active: new Date().toISOString() });
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
        reply_markup: createMainKeyboard()
    });
});

// Comando /webapp
bot.onText(/\/webapp/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getUser(chatId);
    
    if (!user) {
        return bot.sendMessage(chatId, '❌ No estás registrado. Usa /start primero.');
    }
    
    const webAppUrl = `https://${req.headers.host || 'localhost:3000'}/webapp.html`;
    
    const message = `🌐 *WebApp Cromwell Store*\n\n` +
        `Accede a nuestra WebApp para gestionar tu billetera desde el navegador.\n\n` +
        `[Abrir WebApp](${webAppUrl})\n\n` +
        `⚠️ *Tu ID de Telegram:* \`${chatId}\`\n` +
        `Necesitarás este ID para iniciar sesión en la WebApp.\n\n` +
        `Características de la WebApp:\n` +
        `• Ver saldos en tiempo real\n` +
        `• Recargar billetera (CUP/Saldo)\n` +
        `• Recargar juegos directamente\n` +
        `• Recargas ETECSA\n` +
        `• Historial de transacciones\n` +
        `• Cambiar teléfono vinculado\n` +
        `• Reclamar pagos pendientes`;
    
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

// Comando /admin para administradores
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId != BOT_ADMIN_ID && chatId != ADMIN_CHAT_ID) {
        return bot.sendMessage(chatId, '❌ No tienes permisos de administrador.');
    }
    
    const adminKeyboard = {
        inline_keyboard: [
            [{ text: '📊 Estadísticas', callback_data: 'admin_stats' }],
            [{ text: '👥 Usuarios', callback_data: 'admin_users' }],
            [{ text: '💰 Transacciones', callback_data: 'admin_transactions' }],
            [{ text: '⚙️ Configuración', callback_data: 'admin_config' }],
            [{ text: '🔧 Mantenimiento', callback_data: 'admin_maintenance' }]
        ]
    };
    
    await bot.sendMessage(chatId, '🔧 *Panel de Administración*\n\nSelecciona una opción:', {
        parse_mode: 'Markdown',
        reply_markup: adminKeyboard
    });
});

// ============================================
// MANEJO DE CALLBACKS
// ============================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    try {
        await bot.answerCallbackQuery(query.id);

        // PRIMERO: Intentar manejar con sokyHandler (RECARGAS ETECSA)
        if (sokyHandler) {
            const handledBySoky = await sokyHandler.handleCallback(query);
            if (handledBySoky) {
                return;
            }
        }

        // SEGUNDO: Intentar manejar con gameHandler
        if (gameHandler) {
            const handledByGame = await gameHandler.handleCallback(query);
            if (handledByGame) {
                return;
            }
        }

        // TERCERO: Procesar las acciones normales del bot
        const [action, param1, param2] = data.split(':');

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
            case 'games_menu':
                if (gameHandler) {
                    await gameHandler.showGamesList(chatId, messageId);
                } else {
                    await bot.editMessageText('❌ Servicio de juegos no disponible temporalmente.', {
                        chat_id: chatId,
                        message_id: messageId
                    });
                }
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
            case 'view_terms_web':
                await handleViewTermsWeb(chatId, messageId);
                break;
            case 'admin_stats':
                await handleAdminStats(chatId, messageId);
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
// FUNCIONES DE MANEJO DE CALLBACKS
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
        reply_markup: createMainKeyboard()
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
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = MINIMO_CUP - pendiente;
    
    let message = `👛 *Tu Billetera Cromwell*\n\n` +
        `🆔 *ID de Telegram:* \`${chatId}\`\n\n` +
        `💰 *CUP:* **${formatCurrency(user.balance_cup, 'cup')}**\n` +
        `📱 *Saldo Móvil:* **${formatCurrency(user.balance_saldo, 'saldo')}**\n` +
        `🎫 *CWS (Tokens):* **${user.tokens_cws || 0}**\n\n`;
    
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
    
    const amountNum = parseFloat(amount);
    const limites = { 
        cup: [MINIMO_CUP, MAXIMO_CUP], 
        saldo: [MINIMO_SALDO, 10000]
    };
    
    if (amountNum < limites[currency][0] || amountNum > limites[currency][1]) {
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
    
    const solicitudExistente = await verificarSolicitudPendiente(chatId, currency);
    if (solicitudExistente) {
        const mensaje = `❌ *Ya tienes una solicitud pendiente*\n\n` +
            `🆔 Orden #${solicitudExistente.id}\n` +
            `💰 Monto: ${formatCurrency(solicitudExistente.amount_requested, currency)}\n` +
            `⏳ Estado: Pendiente\n\n` +
            `Completa o cancela la solicitud actual antes de crear una nueva.`;
        
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
    const bono = user[`first_dep_${currency}`] ? amountNum * bonoPorcentaje : 0;
    const totalConBono = amountNum + bono;
    const tokens = currency === 'saldo' ? Math.floor(amountNum / 100) * CWS_PER_100_SALDO : 0;
    
    const { data: transaction, error } = await supabase
        .from('transactions')
        .insert([{
            user_id: chatId,
            type: 'DEPOSIT',
            currency: currency,
            amount_requested: amountNum,
            estimated_bonus: bono,
            estimated_tokens: tokens,
            status: 'pending',
            user_name: user.first_name,
            user_username: user.username,
            user_phone: user.phone_number,
            created_at: new Date().toISOString()
        }])
        .select()
        .single();
    
    if (error) {
        console.error('Error creando transacción:', error);
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
        `💰 *Monto solicitado:* ${formatCurrency(amountNum, currency)}\n` +
        `🎁 *Bono por primer depósito:* ${formatCurrency(bono, currency)} (${bonoPorcentaje * 100}%)\n` +
        `💵 *Total a acreditar:* ${formatCurrency(totalConBono, currency)}\n` +
        `🎫 *Tokens a ganar:* ${tokens} CWS\n\n` +
        `*Instrucciones de pago:*\n` +
        `${instrucciones}\n\n` +
        `⚠️ *IMPORTANTE:*\n` +
        `• Realiza el pago con el teléfono vinculado: +53 ${user.phone_number.substring(2)}\n` +
        `• El monto debe ser exactamente ${formatCurrency(amountNum, currency)}\n` +
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
        `   • Mínimos: CUP=$${MINIMO_CUP}, Saldo=$${MINIMO_SALDO}\n` +
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
        `   • Contacta al administrador dentro de 24 horas\n` +
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
        .order('created_at', { ascending: false })
        .limit(10);
    
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
            else if (tx.status === 'failed') icon = '❌';
            
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

async function handleViewTermsWeb(chatId, messageId) {
    const message = `🌐 *Términos y Condiciones en la Web*\n\n` +
        `Para ver los términos y condiciones actualizados, visita nuestro sitio web.\n\n` +
        `Una vez que hayas iniciado sesión con tu ID de Telegram, podrás verlos en la sección correspondiente.\n\n` +
        `⚠️ *Recuerda:* Tu ID de Telegram es: \`${chatId}\``;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: createBackKeyboard('start_back')
    });
}

async function handleAdminStats(chatId, messageId) {
    if (chatId != BOT_ADMIN_ID && chatId != ADMIN_CHAT_ID) {
        await bot.sendMessage(chatId, '❌ No tienes permisos de administrador.');
        return;
    }
    
    try {
        // Obtener estadísticas
        const { data: users } = await supabase
            .from('users')
            .select('count');
        
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*');
        
        const { data: pendingPayments } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('claimed', false);
        
        let totalCUP = 0;
        let totalSaldo = 0;
        let totalTransactions = 0;
        let totalDeposits = 0;
        let totalGameRecharges = 0;
        let totalEtecsaRecharges = 0;
        
        if (transactions) {
            totalTransactions = transactions.length;
            transactions.forEach(tx => {
                if (tx.type === 'DEPOSIT' && tx.status === 'completed') {
                    totalDeposits++;
                    if (tx.currency === 'cup') {
                        totalCUP += Math.abs(tx.amount || tx.amount_requested || 0);
                    } else if (tx.currency === 'saldo') {
                        totalSaldo += Math.abs(tx.amount || tx.amount_requested || 0);
                    }
                } else if (tx.type === 'GAME_RECHARGE') {
                    totalGameRecharges++;
                } else if (tx.type === 'ETECSA_RECHARGE') {
                    totalEtecsaRecharges++;
                }
            });
        }
        
        const statsMessage = `📊 *Estadísticas del Sistema*\n\n` +
            `👥 *Usuarios totales:* ${users?.[0]?.count || 0}\n` +
            `💰 *Total CUP en sistema:* $${totalCUP.toLocaleString('es-ES')}\n` +
            `📱 *Total Saldo en sistema:* $${totalSaldo.toLocaleString('es-ES')}\n\n` +
            `📈 *Transacciones:*\n` +
            `   • Totales: ${totalTransactions}\n` +
            `   • Depósitos: ${totalDeposits}\n` +
            `   • Recargas Juegos: ${totalGameRecharges}\n` +
            `   • Recargas ETECSA: ${totalEtecsaRecharges}\n\n` +
            `⏳ *Pagos pendientes:* ${pendingPayments?.length || 0}\n\n` +
            `🔧 *Servicios activos:*\n` +
            `   • Juegos: ${gameHandler ? '✅' : '❌'}\n` +
            `   • ETECSA: ${sokyHandler ? '✅' : '❌'}`;
        
        await bot.editMessageText(statsMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Actualizar', callback_data: 'admin_stats' }],
                    [{ text: '🔙 Volver', callback_data: 'start_back' }]
                ]
            }
        });
        
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        await bot.editMessageText('❌ Error obteniendo estadísticas.', {
            chat_id: chatId,
            message_id: messageId
        });
    }
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
        // 1. Intentar manejar con gameHandler
        if (gameHandler) {
            const handledByGame = await gameHandler.handleMessage(msg);
            if (handledByGame) {
                return;
            }
        }
        
        // 2. Intentar manejar con sokyHandler
        if (sokyHandler) {
            const handledBySoky = await sokyHandler.handleMessage(chatId, text);
            if (handledBySoky) {
                return;
            }
        }
        
        // 3. Procesar mensajes normales del bot
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

// Función para manejar entrada de teléfono
async function handlePhoneInput(chatId, phone, session) {
    let cleanPhone = phone.replace(/[^\d]/g, '');
    
    console.log(`📱 Número recibido: ${phone}, Limpio: ${cleanPhone}`);
    
    // Validar formato
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
    
    // Validar longitud final
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
    
    // Verificar que sea un número válido
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
        
        if (session.step === 'waiting_phone_start') {
            activeSessions[chatId] = { step: 'waiting_phone_start' };
        }
        
        return;
    }
    
    // Guardar número normalizado
    await updateUser(chatId, { 
        phone_number: cleanPhone,
        last_active: new Date().toISOString()
    });
    
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
    
    // Mostrar confirmación con botones
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
// RUTAS DEL PANEL WEB
// ============================================

app.post('/api/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Credenciales faltantes' });
        }
        
        const telegramId = parseInt(identifier);
        if (isNaN(telegramId)) {
            return res.status(400).json({ error: 'Solo ID de Telegram (número) está permitido' });
        }
        
        const user = await getUser(telegramId);
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        if (user.web_password) {
            const validPassword = await bcrypt.compare(password, user.web_password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Contraseña incorrecta' });
            }
        } else {
            return res.status(403).json({ 
                error: 'Debes registrar una contraseña primero',
                needsRegistration: true,
                userId: user.telegram_id 
            });
        }
        
        req.session.userId = user.telegram_id;
        req.session.authenticated = true;
        req.session.userData = {
            telegramId: user.telegram_id,
            username: user.username,
            firstName: user.first_name,
            phone: user.phone_number
        };

        req.session.save((err) => {
            if (err) {
                console.error('Error guardando sesión:', err);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            
            res.json({ 
                success: true, 
                user: {
                    id: user.telegram_id,
                    username: user.username,
                    firstName: user.first_name,
                    phone: user.phone_number,
                    balance_cup: user.balance_cup || 0,
                    balance_saldo: user.balance_saldo || 0,
                    tokens_cws: user.tokens_cws || 0
                }
            });
        });
        
    } catch (error) {
        console.error('❌ Error en login web:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/user-data-web', requireAuth, async (req, res) => {
    try {
        const user = await getUser(req.session.userId);
        
        if (!user) {
            req.session.destroy();
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', user.telegram_id)
            .order('created_at', { ascending: false })
            .limit(10);
        
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
                balance_cup: user.balance_cup || 0,
                balance_saldo: user.balance_saldo || 0,
                tokens_cws: user.tokens_cws || 0,
                pending_balance_cup: user.pending_balance_cup || 0,
                accepted_terms: user.accepted_terms || false
            },
            transactions: transactions || [],
            pendingPayments: pendingPayments || []
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/', (req, res) => {
    if (req.session.authenticated) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(path.join(__dirname, 'public/index.html'));
    }
});

app.get('/dashboard', (req, res) => {
    if (req.session.userId && req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'public/dashboard.html'));
    } else {
        res.redirect('/');
    }
});

app.get('/webapp.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/webapp.html'));
});

// Keep alive endpoint
app.get('/keepalive', (req, res) => {
    res.json({ 
        status: 'alive', 
        timestamp: new Date().toISOString(),
        service: 'cromwell-bot-server',
        uptime: process.uptime(),
        version: '2.0.0'
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            telegram: bot ? 'connected' : 'disconnected',
            supabase: supabase ? 'connected' : 'disconnected',
            gameHandler: gameHandler ? 'active' : 'inactive',
            sokyHandler: sokyHandler ? 'active' : 'inactive'
        },
        uptime: process.uptime(),
        memory: process.memoryUsage()
    };
    
    res.json(health);
});

// ============================================
// PROGRAMADORES Y TAREAS PROGRAMADAS
// ============================================

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
// INICIAR SERVIDOR
// ============================================

app.listen(PORT, () => {
    console.log(`\n` + '='.repeat(80));
    console.log(`🤖 Cromwell Bot & Server v2.0`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🌐 WebApp: http://localhost:${PORT}/webapp.html`);
    console.log(`🔄 Keep alive: http://localhost:${PORT}/keepalive`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
    console.log(`\n💰 Mínimos: CUP=$${MINIMO_CUP}, Saldo=$${MINIMO_SALDO}`);
    console.log(`📞 Teléfono para pagos: ${PAGO_SALDO_MOVIL ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`💳 Tarjeta para pagos: ${PAGO_CUP_TARJETA ? '✅ Configurada' : '❌ No configurada'}`);
    console.log(`🎮 LioGames: ${LIOGAMES_MEMBER_CODE ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`📱 SokyRecargas: ${SOKY_API_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`\n💱 Tasas de cambio:`);
    console.log(`   • USDT 0-30: $${USDT_RATE_0_30} CUP`);
    console.log(`   • USDT >30: $${USDT_RATE_30_PLUS} CUP`);
    console.log(`   • Saldo Móvil: ÷${SALDO_MOVIL_RATE}`);
    console.log(`   • SokyRecargas: $${SOKY_RATE_CUP} CUP por USDT`);
    console.log(`   • Mínimo CWS: ${MIN_CWS_USE}`);
    console.log(`\n🌐 Webhooks disponibles:`);
    console.log(`   • POST /payment-notification - Para pagos SMS`);
    console.log(`   • POST /lio-webhook - Para LioGames`);
    console.log(`   • POST /status-webhook - Genérico`);
    console.log(`\n📡 Endpoints API WebApp:`);
    console.log(`   • GET /api/games - Lista de juegos`);
    console.log(`   • POST /api/game-price - Precios de juegos`);
    console.log(`   • POST /api/game-purchase - Comprar juegos`);
    console.log(`   • GET /api/etecsa-offers - Ofertas ETECSA`);
    console.log(`   • POST /api/etecsa-recharge - Recarga ETECSA`);
    console.log(`   • POST /api/user-data - Datos de usuario`);
    console.log(`   • POST /api/create-deposit - Crear depósito`);
    console.log(`\n🚀 Bot listo para recibir mensajes...`);
    console.log('='.repeat(80));
});

// Manejo global de errores
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
    
    if (ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID, `❌ Error crítico en el bot: ${error.message}`)
            .catch(err => console.error('Error enviando mensaje de error:', err));
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});
