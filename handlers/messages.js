// ============================================
// handlers/messages.js - MANEJO DE MENSAJES
// ============================================
const bot = require('../bot');
const db = require('../database');
const sessions = require('./sessions');
const adminHandlers = require('./admin');
const utils = require('../utils');
const config = require('../config');

// Importar instancias ÚNICAS desde index
const { gameHandler, sokyHandler, bolitaHandler, tradingHandler } = require('./index');

async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    const session = sessions.getSession(chatId);

    if (!text) return;
    if (text.startsWith('/')) return;

    try {
        // 1️⃣ Trading Signals (admin)
        const handledByTrading = await tradingHandler.handleMessage(msg);
        if (handledByTrading) return;

        // 2️⃣ La Bolita
        const handledByBolita = await bolitaHandler.handleMessage(msg);
        if (handledByBolita) return;

        // 3️⃣ Recargas de juegos (LioGames)
        const handledByGame = await gameHandler.handleMessage(msg);
        if (handledByGame) return;

        // 4️⃣ Recargas ETECSA (Soky)
        const handledBySoky = await sokyHandler.handleMessage(chatId, text);
        if (handledBySoky) return;

        // 5️⃣ Sesiones administrativas
        if (session && adminHandlers.esAdmin(userId)) {
            switch (session.step) {
                case 'admin_search_user':
                    await adminHandlers.handleAdminSearchUser(chatId, text);
                    break;
                case 'admin_contact_user':
                    await adminHandlers.handleAdminContactUser(chatId, text, session.targetUserId);
                    break;
                case 'admin_modify_balance':
                    await adminHandlers.handleAdminModifyBalance(chatId, text, session.targetUserId);
                    break;
                default:
                    console.log(`Paso administrativo no manejado: ${session.step}`);
            }
            return;
        }

        // 6️⃣ Sesiones de usuario normal
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
                case 'reporting_problem':
                    await handleProblemReport(chatId, text);
                    break;
                default:
                    console.log(`Paso no manejado: ${session.step}`);
            }
        }

        // 7️⃣ Detectar números de 7 dígitos (admin para La Bolita)
        if (adminHandlers.esAdmin(userId) && /^\d{7}$/.test(text)) {
            await bot.sendMessage(chatId,
                `👑 *¿Es un resultado de La Bolita?*\n\n` +
                `Detecté un número de 7 dígitos: ${text}\n\n` +
                `Si quieres cargar este resultado, usa el menú de La Bolita o escribe /bolita`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error('Error procesando mensaje:', error);
        await bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.', {
            reply_markup: require('../config/keyboards').createMainKeyboard()
        });
    }
}

// ------------------------------------------------------------
// FUNCIONES AUXILIARES (sin cambios, solo asegurar que existen)
// ------------------------------------------------------------
async function handlePhoneInput(chatId, phone, session) {
    let cleanPhone = phone.replace(/[^\d]/g, '');
    
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

    const { data: existingUser } = await db.supabase
        .from('users')
        .select('telegram_id, first_name')
        .eq('phone_number', cleanPhone)
        .neq('telegram_id', chatId)
        .maybeSingle();

    if (existingUser) {
        await bot.sendMessage(chatId,
            `❌ *Teléfono ya en uso*\n\n` +
            `Este número ya está vinculado a otra cuenta.\n` +
            `👤 Usuario: ${existingUser.first_name}\n\n` +
            `Si es tu número, contacta al administrador.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    await db.updateUser(chatId, { phone_number: cleanPhone });

    let message = '';
    if (session.step === 'waiting_phone_change' && session.oldPhone) {
        message = `✅ *Teléfono actualizado*\n\n` +
            `📱 *Anterior:* +53 ${session.oldPhone.substring(2)}\n` +
            `📱 *Nuevo:* +53 ${cleanPhone.substring(2)}\n\n` +
            `Ahora los pagos se detectarán con este número.`;
    } else if (session.step === 'waiting_phone_start') {
        message = `✅ *¡Teléfono vinculado!*\n\n` +
            `📱 *Número:* +53 ${cleanPhone.substring(2)}\n\n` +
            `Ahora debes aceptar los términos y condiciones para continuar.`;
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        await require('./callbacks').handleTerms(chatId, null);
        sessions.clearSession(chatId);
        return;
    } else {
        message = `✅ *¡Teléfono vinculado!*\n\n` +
            `📱 *Número:* +53 ${cleanPhone.substring(2)}\n\n` +
            `Ahora tus pagos se detectarán automáticamente.`;
    }

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: require('../config/keyboards').createMainKeyboard()
    });

    sessions.clearSession(chatId);
}

async function handleSearchPaymentIdInput(chatId, txId) {
    const txIdClean = txId.trim().toUpperCase();
    
    const { data: pendingPayment } = await db.supabase
        .from('pending_sms_payments')
        .select('*')
        .eq('tx_id', txIdClean)
        .eq('claimed', false)
        .maybeSingle();

    if (pendingPayment) {
        const user = await db.getUser(chatId);
        if (user && (user.telegram_id === pendingPayment.user_id || user.phone_number === pendingPayment.phone)) {
            const result = await utils.procesarPagoAutomatico(
                chatId, 
                pendingPayment.amount, 
                pendingPayment.currency, 
                pendingPayment.tx_id, 
                pendingPayment.tipo_pago
            );
            
            if (result.success) {
                await db.supabase
                    .from('pending_sms_payments')
                    .update({ claimed: true, claimed_by: chatId })
                    .eq('id', pendingPayment.id);
                
                await bot.sendMessage(chatId,
                    `✅ *¡Pago reclamado exitosamente!*\n\n` +
                    `${utils.formatCurrency(pendingPayment.amount, pendingPayment.currency)} ha sido acreditado a tu billetera.`,
                    { parse_mode: 'Markdown', reply_markup: require('../config/keyboards').createMainKeyboard() }
                );
            }
        } else {
            await bot.sendMessage(chatId,
                `❌ *Este pago no te pertenece*\n\n` +
                `El pago con ID \`${txIdClean}\` está registrado para otro usuario.`,
                { parse_mode: 'Markdown', reply_markup: require('../config/keyboards').createClaimPaymentKeyboard() }
            );
        }
    } else {
        const { data: pendingTx } = await db.supabase
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
                `💰 Monto: ${utils.formatCurrency(orden.amount_requested, orden.currency)}\n` +
                `💳 Método: ${orden.currency.toUpperCase()}\n\n` +
                `Si ya hiciste el pago, espera a que se detecte automáticamente.`,
                { parse_mode: 'Markdown', reply_markup: require('../config/keyboards').createMainKeyboard() }
            );
        } else {
            await bot.sendMessage(chatId,
                `❌ *ID no encontrado*\n\n` +
                `No encontramos pagos pendientes con ID: \`${txIdClean}\``,
                { parse_mode: 'Markdown', reply_markup: require('../config/keyboards').createClaimPaymentKeyboard() }
            );
        }
    }

    sessions.clearSession(chatId);
}

async function handleDepositAmountInput(chatId, amountText, session) {
    const amount = parseFloat(amountText);
    const currency = session.currency;
    const config = require('../config');
    
    const limites = { 
        cup: [config.MINIMO_CUP, config.MAXIMO_CUP], 
        saldo: [config.MINIMO_SALDO, 10000]
    };
    
    if (isNaN(amount) || amount < limites[currency][0] || amount > limites[currency][1]) {
        await bot.sendMessage(chatId, 
            `❌ *Monto fuera de límites*\n\n` +
            `Debe estar entre ${utils.formatCurrency(limites[currency][0], currency)} y ${utils.formatCurrency(limites[currency][1], currency)}.\n\n` +
            `Escribe un monto válido:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const user = await db.getUser(chatId);
    session.amount = amount;
    
    const bonoPorcentaje = 0.10;
    const bono = user[`first_dep_${currency}`] ? amount * bonoPorcentaje : 0;
    const totalConBono = amount + bono;
    const tokens = currency === 'saldo' ? Math.floor(amount / 100) * config.CWS_PER_100_SALDO : 0;
    
    const confirmMessage = `📋 *Confirmar Depósito*\n\n` +
        `💰 *Monto:* ${utils.formatCurrency(amount, currency)}\n` +
        `🎁 *Bono:* ${utils.formatCurrency(bono, currency)} (${bonoPorcentaje * 100}%)\n` +
        `💵 *Total a acreditar:* ${utils.formatCurrency(totalConBono, currency)}\n` +
        `🎫 *Tokens a ganar:* ${tokens} CWS\n\n` +
        `¿Confirmas la solicitud de depósito?`;
    
    await bot.sendMessage(chatId, confirmMessage, {
        parse_mode: 'Markdown',
        reply_markup: require('../config/keyboards').createDepositConfirmKeyboard(currency, amount)
    });
}

async function handleProblemReport(chatId, text) {
    try {
        const user = await db.getUser(chatId);
        
        await db.supabase
            .from('problem_reports')
            .insert([{
                user_id: chatId,
                user_name: user.first_name,
                user_username: user.username,
                description: text,
                status: 'pending',
                created_at: new Date().toISOString()
            }]);

        const config = require('../config');
        if (config.ADMIN_CHAT_ID) {
            await bot.sendMessage(config.ADMIN_CHAT_ID,
                `🔧 *NUEVO REPORTE DE PROBLEMA*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'N/A'})\n` +
                `🆔 ID: ${chatId}\n` +
                `📞 Teléfono: ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : 'No vinculado'}\n\n` +
                `📋 *Descripción:*\n${text}\n\n` +
                `⚠️ *Reporte pendiente de revisión*`,
                { parse_mode: 'Markdown' }
            );
        }
        
        await bot.sendMessage(chatId,
            `✅ *Reporte enviado exitosamente*\n\n` +
            `Hemos recibido tu reporte y lo revisaremos pronto.\n\n` +
            `📋 *Tu ID de reporte:* \`${Date.now()}\`\n` +
            `⏰ *Tiempo estimado de respuesta:* 24-48 horas\n\n` +
            `Gracias por ayudarnos a mejorar.`,
            { parse_mode: 'Markdown', reply_markup: require('../config/keyboards').createMainKeyboard() }
        );
        
        sessions.clearSession(chatId);
    } catch (error) {
        console.error('Error handling problem report:', error);
        await bot.sendMessage(chatId, '❌ Error al enviar el reporte. Por favor, intenta de nuevo.');
        sessions.clearSession(chatId);
    }
}

module.exports = {
    handleMessage
};
