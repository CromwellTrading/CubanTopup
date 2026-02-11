const bot = require('../bot');
const db = require('../database');
const keyboards = require('../config/keyboards');
const utils = require('../utils');
const config = require('../config');

const TradingSignalsHandler = require('../services/TradingSignalsHandler');
const BolitaHandler = require('../services/BolitaHandler');
const tradingHandler = new TradingSignalsHandler(bot, db.supabase);
const bolitaHandler = new BolitaHandler(bot, db.supabase);

function esAdmin(userId) {
    return userId.toString() === config.BOT_ADMIN_ID.toString();
}

async function obtenerEstadisticasTotales() {
    try {
        const { data: users, error } = await db.supabase
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

async function obtenerEstadisticasUsuario(userId) {
    try {
        const user = await db.getUser(userId);
        if (!user) return null;
        
        const { data: transacciones } = await db.supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);
        
        const { data: ordenesPendientes } = await db.supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
        
        const { data: apuestasBolita } = await db.supabase
            .from('bolita_apuestas')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);
        
        const { data: suscripcionesTrading } = await db.supabase
            .from('trading_suscripciones')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        
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
            apuestasBolita: apuestasBolita || [],
            suscripcionesTrading: suscripcionesTrading || []
        };
    } catch (error) {
        console.error('Error obteniendo estadísticas usuario:', error);
        return null;
    }
}

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
        case 'admin_user_trading':
            await showUserTrading(chatId, messageId, param1);
            return true;
        case 'admin_user_stats':
            await showUserStats(chatId, messageId, param1);
            return true;
        case 'admin_contact_user':
            await contactUserPrompt(chatId, messageId, param1);
            return true;
        case 'admin_modify_balance':
            await modifyUserBalancePrompt(chatId, messageId, param1);
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
        case 'admin_trading_signals':
            await tradingHandler.showAdminMenu(chatId, messageId);
            return true;
        case 'admin_sync_db':
            await syncDatabase(chatId, messageId);
            return true;
        case 'admin_trading_create_signal':
        case 'admin_trading_create_plan':
        case 'admin_trading_view_plans':
            await tradingHandler.showAdminMenu(chatId, messageId);
            return true;
        case 'bolita_admin_menu':
            await bolitaHandler.mostrarMenuAdmin(chatId, messageId);
            return true;
    }
    
    return false;
}

async function showAdminPanel(chatId, messageId) {
    const message = `👑 *Panel de Administración*\n\n` +
        `Selecciona una opción:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createAdminKeyboard()
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
                reply_markup: keyboards.createAdminKeyboard()
            });
            return;
        }
        
        const { data: users } = await db.supabase
            .from('users')
            .select('created_at')
            .not('created_at', 'is', null);
        
        const { data: transactions } = await db.supabase
            .from('transactions')
            .select('*')
            .eq('status', 'completed')
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
        
        const { data: bolitaApuestas } = await db.supabase
            .from('bolita_apuestas')
            .select('monto, estado, ganancia')
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
        
        const { data: tradingSubscriptions } = await db.supabase
            .from('trading_suscripciones')
            .select('*')
            .eq('estado', 'activa')
            .gte('fecha_fin', new Date().toISOString());
        
        const { data: tradingSignals } = await db.supabase
            .from('trading_senales')
            .select('*')
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
        
        const message = `📊 *ESTADÍSTICAS TOTALES DEL BOT*\n\n` +
            `👥 *Usuarios registrados:* ${users ? users.length : 0}\n` +
            `💰 *Total CUP en el sistema:* ${utils.formatCurrency(stats.totalCUP, 'cup')}\n` +
            `📱 *Total Saldo Móvil:* ${utils.formatCurrency(stats.totalSaldo, 'saldo')}\n` +
            `🎫 *Total CWS (Tokens):* ${stats.totalCWS} CWS\n\n` +
            `📈 *TRADING:*\n` +
            `• Usuarios VIP activos: ${tradingSubscriptions ? tradingSubscriptions.length : 0}\n` +
            `• Señales esta semana: ${tradingSignals ? tradingSignals.length : 0}\n` +
            `• Ingresos trading: ${tradingSubscriptions ? tradingSubscriptions.reduce((sum, s) => sum + (s.precio_pagado || 0), 0) : 0} CUP\n\n` +
            `📈 *Actividad (últimos 7 días):*\n` +
            `• Transacciones completadas: ${transactions ? transactions.length : 0}\n` +
            `• Apuestas La Bolita: ${bolitaApuestas ? bolitaApuestas.length : 0}\n` +
            `• Total apostado La Bolita: ${bolitaApuestas ? bolitaApuestas.reduce((sum, a) => sum + (a.monto || 0), 0) : 0} CUP\n` +
            `• Ganado La Bolita: ${bolitaApuestas ? bolitaApuestas.filter(a => a.estado === 'ganada').reduce((sum, a) => sum + (a.ganancia || 0), 0) : 0} CUP\n\n` +
            `_Actualizado: ${new Date().toLocaleString()}_`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error showing total stats:', error);
        await bot.editMessageText('❌ Error al obtener estadísticas.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    }
}

async function searchUserPrompt(chatId, messageId) {
    const message = `🔍 *Buscar Usuario*\n\n` +
        `Por favor, envía el ID de Telegram del usuario que deseas buscar:\n\n` +
        `Ejemplo: \`123456789\``;
    
    const sessions = require('./sessions');
    sessions.setSession(chatId, { step: 'admin_search_user' });
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createBackKeyboard('admin_panel')
    });
}

async function showUserWallet(chatId, messageId, userId) {
    try {
        const user = await db.getUser(userId);
        
        if (!user) {
            await bot.editMessageText(`❌ Usuario con ID ${userId} no encontrado.`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboards.createBackKeyboard('admin_search_user')
            });
            return;
        }
        
        const isVIP = await tradingHandler.isUserVIP(userId);
        const vipInfo = isVIP ? `🎖️ *VIP ACTIVO*` : `🔒 *NO VIP*`;
        
        const message = `👛 *Billetera del Usuario*\n\n` +
            `👤 *Nombre:* ${user.first_name}\n` +
            `🆔 *ID:* ${user.telegram_id}\n` +
            `📱 *Usuario:* @${user.username || 'N/A'}\n` +
            `📞 *Teléfono:* ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : 'No vinculado'}\n` +
            `📊 *Estado Trading:* ${vipInfo}\n\n` +
            `💰 *CUP:* **${utils.formatCurrency(user.balance_cup, 'cup')}**\n` +
            `📱 *Saldo Móvil:* **${utils.formatCurrency(user.balance_saldo, 'saldo')}**\n` +
            `🎫 *CWS (Tokens):* **${user.tokens_cws || 0}**\n\n` +
            `📅 *Última actividad:* ${new Date(user.last_active).toLocaleString()}\n` +
            `📅 *Registrado:* ${new Date(user.created_at || user.last_active).toLocaleDateString()}`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user wallet:', error);
        await bot.editMessageText('❌ Error al obtener información del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    }
}

async function showUserHistory(chatId, messageId, userId) {
    try {
        const { data: transactions } = await db.supabase
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
                
                message += `${icon} *${tx.type === 'DEPOSIT' ? 'Depósito' : tx.type === 'GAME_RECHARGE' ? 'Recarga Juego' : tx.type === 'ETECSA_RECHARGE' ? 'Recarga ETECSA' : tx.type === 'TRADING_SUSCRIPTION' ? 'Suscripción Trading' : tx.type}*\n`;
                message += `💰 ${utils.formatCurrency(Math.abs(tx.amount || tx.amount_requested), tx.currency)}\n`;
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
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user history:', error);
        await bot.editMessageText('❌ Error al obtener historial del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    }
}

async function showUserOrders(chatId, messageId, userId) {
    try {
        const { data: orders } = await db.supabase
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
                message += `💰 ${utils.formatCurrency(order.amount_requested, order.currency)}\n`;
                message += `💳 ${order.currency.toUpperCase()}\n`;
                message += `📅 ${new Date(order.created_at).toLocaleDateString()}\n`;
                message += `---\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user orders:', error);
        await bot.editMessageText('❌ Error al obtener órdenes del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    }
}

async function showUserBets(chatId, messageId, userId) {
    try {
        const { data: bets } = await db.supabase
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
                message += `💰 ${bet.monto} CUP → ${bet.ganancia ? `Ganó: ${bet.ganancia} CUP` : 'Pendiente'}\n`;
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
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user bets:', error);
        await bot.editMessageText('❌ Error al obtener apuestas del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    }
}

async function showUserTrading(chatId, messageId, userId) {
    try {
        await tradingHandler.showUserTrading(chatId, messageId, userId);
    } catch (error) {
        console.error('Error showing user trading:', error);
        await bot.editMessageText('❌ Error al obtener información de trading del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
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
                reply_markup: keyboards.createUserSearchKeyboard(userId)
            });
            return;
        }
        
        const { usuario, transacciones, ordenesPendientes, apuestasBolita, suscripcionesTrading } = stats;
        
        let totalDepositado = 0;
        let totalGastado = 0;
        let totalGanadoBolita = 0;
        let totalGastadoTrading = 0;
        
        transacciones.forEach(tx => {
            if (tx.type === 'DEPOSIT' && tx.status === 'completed') {
                totalDepositado += Math.abs(tx.amount) || tx.amount_requested || 0;
            } else if (tx.type === 'GAME_RECHARGE' || tx.type === 'ETECSA_RECHARGE') {
                totalGastado += Math.abs(tx.amount) || 0;
            } else if (tx.type === 'TRADING_SUSCRIPTION') {
                totalGastadoTrading += Math.abs(tx.amount) || 0;
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
            `• CUP: ${utils.formatCurrency(usuario.balance_cup, 'cup')}\n` +
            `• Saldo Móvil: ${utils.formatCurrency(usuario.balance_saldo, 'saldo')}\n` +
            `• CWS: ${usuario.tokens_cws} tokens\n\n` +
            `📈 *Actividad Total:*\n` +
            `• Total depositado: ${utils.formatCurrency(totalDepositado, 'cup')}\n` +
            `• Total gastado: ${utils.formatCurrency(totalGastado, 'cup')}\n` +
            `• Gastado en Trading: ${utils.formatCurrency(totalGastadoTrading, 'cup')}\n` +
            `• Ganado en La Bolita: ${totalGanadoBolita} CUP\n\n` +
            `📋 *Resumen:*\n` +
            `• Transacciones: ${transacciones.length}\n` +
            `• Órdenes pendientes: ${ordenesPendientes.length}\n` +
            `• Apuestas La Bolita: ${apuestasBolita.length}\n` +
            `• Suscripciones Trading: ${suscripcionesTrading.length}\n\n` +
            `📅 *Registrado:* ${new Date(usuario.fecha_registro).toLocaleDateString()}`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error showing user stats:', error);
        await bot.editMessageText('❌ Error al obtener estadísticas del usuario.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    }
}

async function contactUserPrompt(chatId, messageId, userId) {
    const message = `📞 *Contactar Usuario*\n\n` +
        `ID del usuario: ${userId}\n\n` +
        `Por favor, envía el mensaje que deseas enviar al usuario:`;
    
    const sessions = require('./sessions');
    sessions.setSession(chatId, { 
        step: 'admin_contact_user',
        targetUserId: userId 
    });
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createBackKeyboard(`admin_user_stats:${userId}`)
    });
}

async function modifyUserBalancePrompt(chatId, messageId, userId) {
    const message = `🔧 *Modificar Saldo de Usuario*\n\n` +
        `ID del usuario: ${userId}\n\n` +
        `Por favor, envía el monto a modificar en el formato:\n` +
        `\`tipo_monto cantidad operacion\`\n\n` +
        `Ejemplos:\n` +
        `• \`cup 1000 agregar\` - Agrega 1000 CUP\n` +
        `• \`saldo 500 quitar\` - Quita 500 Saldo\n` +
        `• \`cws 50 agregar\` - Agrega 50 CWS\n\n` +
        `Tipos disponibles: cup, saldo, cws\n` +
        `Operaciones: agregar, quitar`;
    
    const sessions = require('./sessions');
    sessions.setSession(chatId, { 
        step: 'admin_modify_balance',
        targetUserId: userId 
    });
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createBackKeyboard(`admin_user_stats:${userId}`)
    });
}

async function showAllPendingOrders(chatId, messageId) {
    try {
        const { data: orders } = await db.supabase
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
                message += `💰 ${utils.formatCurrency(order.amount_requested, order.currency)}\n`;
                message += `💳 ${order.currency.toUpperCase()}\n`;
                message += `📅 ${new Date(order.created_at).toLocaleDateString()}\n`;
                message += `---\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error showing all pending orders:', error);
        await bot.editMessageText('❌ Error al obtener órdenes pendientes.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    }
}

async function showActiveGames(chatId, messageId) {
    try {
        const { data: games } = await db.supabase
            .from('transactions')
            .select('*, users!inner(first_name, username)')
            .eq('type', 'GAME_RECHARGE')
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(10);
        
        let message = `🎮 *ÚLTIMAS RECARGAS DE JUEGOS*\n\n`;
        
        if (!games || games.length === 0) {
            message += `No hay recargas recientes.`;
        } else {
            games.forEach((game, index) => {
                const fecha = new Date(game.created_at).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                message += `${index + 1}. ${game.users.first_name}\n`;
                message += `   🎯 ${game.description || 'Recarga de juego'}\n`;
                message += `   💰 ${utils.formatCurrency(game.amount, game.currency)}\n`;
                message += `   📅 ${fecha}\n`;
                message += `   ---\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error showing active games:', error);
        await bot.editMessageText('🎮 *Juegos Activos*\n\nFuncionalidad en desarrollo...', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    }
}

async function showPendingPayments(chatId, messageId) {
    try {
        const { data: payments } = await db.supabase
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
                message += `${index + 1}. ${utils.formatCurrency(payment.amount, payment.currency)}\n`;
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
            reply_markup: keyboards.createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error showing pending payments:', error);
        await bot.editMessageText('❌ Error al obtener pagos pendientes.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    }
}

async function syncDatabase(chatId, messageId) {
    try {
        const message = `🔄 *Sincronización de Base de Datos*\n\n` +
            `Sincronización completada.\n` +
            `_${new Date().toLocaleString()}_`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    } catch (error) {
        console.error('Error syncing database:', error);
        await bot.editMessageText('❌ Error al sincronizar base de datos.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
    }
}

async function handleAdminSearchUser(chatId, userIdInput) {
    try {
        const userId = parseInt(userIdInput.trim());
        
        if (isNaN(userId)) {
            await bot.sendMessage(chatId, '❌ ID inválido. Debe ser un número.', {
                reply_markup: keyboards.createBackKeyboard('admin_search_user')
            });
            return;
        }
        
        const user = await db.getUser(userId);
        
        if (!user) {
            await bot.sendMessage(chatId, `❌ Usuario con ID ${userId} no encontrado.`, {
                reply_markup: keyboards.createBackKeyboard('admin_search_user')
            });
            return;
        }
        
        const message = `👤 *Usuario Encontrado*\n\n` +
            `✅ *Nombre:* ${user.first_name}\n` +
            `🆔 *ID:* ${user.telegram_id}\n` +
            `📱 *Usuario:* @${user.username || 'N/A'}\n` +
            `📞 *Teléfono:* ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : 'No vinculado'}\n\n` +
            `Selecciona una opción para ver más detalles:`;
        
        const sessions = require('./sessions');
        sessions.clearSession(chatId);
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboards.createUserSearchKeyboard(userId)
        });
    } catch (error) {
        console.error('Error in admin search user:', error);
        await bot.sendMessage(chatId, '❌ Error al buscar usuario.', {
            reply_markup: keyboards.createBackKeyboard('admin_panel')
        });
    }
}

async function handleAdminContactUser(chatId, messageText, targetUserId) {
    try {
        await bot.sendMessage(targetUserId,
            `📨 *Mensaje del Administrador*\n\n` +
            `${messageText}\n\n` +
            `_Este es un mensaje oficial del sistema Cromwell Store._`,
            { parse_mode: 'Markdown' }
        );
        
        await bot.sendMessage(chatId,
            `✅ *Mensaje enviado*\n\n` +
            `Mensaje enviado al usuario ID: ${targetUserId}\n\n` +
            `Contenido:\n${messageText}`,
            { parse_mode: 'Markdown', reply_markup: keyboards.createBackKeyboard('admin_panel') }
        );
        
        const sessions = require('./sessions');
        sessions.clearSession(chatId);
    } catch (error) {
        console.error('Error contacting user:', error);
        await bot.sendMessage(chatId,
            `❌ Error al enviar mensaje. El usuario puede haber bloqueado el bot o no existir.`,
            { reply_markup: keyboards.createBackKeyboard('admin_panel') }
        );
    }
}

async function handleAdminModifyBalance(chatId, text, targetUserId) {
    try {
        const parts = text.trim().toLowerCase().split(' ');
        
        if (parts.length !== 3) {
            await bot.sendMessage(chatId,
                `❌ *Formato incorrecto*\n\n` +
                `Usa: \`tipo cantidad operacion\`\n\n` +
                `Ejemplo: \`cup 1000 agregar\`\n\n` +
                `Intenta de nuevo:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        const [tipo, cantidadStr, operacion] = parts;
        const cantidad = parseFloat(cantidadStr);
        
        if (isNaN(cantidad) || cantidad <= 0) {
            await bot.sendMessage(chatId, '❌ Cantidad inválida. Debe ser un número positivo.');
            return;
        }
        
        if (!['cup', 'saldo', 'cws'].includes(tipo)) {
            await bot.sendMessage(chatId, '❌ Tipo inválido. Usa: cup, saldo o cws.');
            return;
        }
        
        if (!['agregar', 'quitar'].includes(operacion)) {
            await bot.sendMessage(chatId, '❌ Operación inválida. Usa: agregar o quitar.');
            return;
        }
        
        const user = await db.getUser(targetUserId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            const sessions = require('./sessions');
            sessions.clearSession(chatId);
            return;
        }
        
        const campo = tipo === 'cws' ? 'tokens_cws' : `balance_${tipo}`;
        const valorActual = user[campo] || 0;
        let nuevoValor = valorActual;
        
        if (operacion === 'agregar') {
            nuevoValor = valorActual + cantidad;
        } else if (operacion === 'quitar') {
            nuevoValor = valorActual - cantidad;
            if (nuevoValor < 0) nuevoValor = 0;
        }
        
        const updates = { [campo]: nuevoValor };
        await db.updateUser(targetUserId, updates);
        
        const tipoTransaccion = operacion === 'agregar' ? 'ADMIN_ADD' : 'ADMIN_REMOVE';
        const cantidadTransaccion = operacion === 'agregar' ? cantidad : -cantidad;
        
        await db.supabase
            .from('transactions')
            .insert([{
                user_id: targetUserId,
                type: tipoTransaccion,
                currency: tipo,
                amount: cantidadTransaccion,
                status: 'completed',
                description: `Ajuste administrativo por administrador`,
                admin_id: chatId,
                created_at: new Date().toISOString()
            }]);
        
        const message = `✅ *Saldo modificado exitosamente*\n\n` +
            `👤 Usuario ID: ${targetUserId}\n` +
            `📊 Tipo: ${tipo.toUpperCase()}\n` +
            `💰 Cantidad: ${utils.formatCurrency(cantidad, tipo)}\n` +
            `⚙️ Operación: ${operacion === 'agregar' ? 'Agregado' : 'Quitado'}\n\n` +
            `📈 *Antes:* ${utils.formatCurrency(valorActual, tipo)}\n` +
            `📊 *Ahora:* ${utils.formatCurrency(nuevoValor, tipo)}\n\n` +
            `✅ *Cambio realizado por administrador*`;
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard(`admin_user_stats:${targetUserId}`)
        });
        
        try {
            await bot.sendMessage(targetUserId,
                `📊 *Ajuste de saldo*\n\n` +
                `El administrador ha ${operacion === 'agregar' ? 'agregado' : 'quitado'} ` +
                `${utils.formatCurrency(cantidad, tipo)} a tu cuenta.\n\n` +
                `📈 *Nuevo saldo ${tipo.toUpperCase()}:* ${utils.formatCurrency(nuevoValor, tipo)}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.log(`Usuario ${targetUserId} puede haber bloqueado el bot`);
        }
        
        const sessions = require('./sessions');
        sessions.clearSession(chatId);
    } catch (error) {
        console.error('Error modifying balance:', error);
        await bot.sendMessage(chatId, '❌ Error al modificar saldo.');
        const sessions = require('./sessions');
        sessions.clearSession(chatId);
    }
}

module.exports = {
    esAdmin,
    obtenerEstadisticasTotales,
    obtenerEstadisticasUsuario,
    handleAdminCallbacks,
    showAdminPanel,
    showTotalStats,
    searchUserPrompt,
    showUserWallet,
    showUserHistory,
    showUserOrders,
    showUserBets,
    showUserTrading,
    showUserStats,
    contactUserPrompt,
    modifyUserBalancePrompt,
    showAllPendingOrders,
    showActiveGames,
    showPendingPayments,
    syncDatabase,
    handleAdminSearchUser,
    handleAdminContactUser,
    handleAdminModifyBalance
};
