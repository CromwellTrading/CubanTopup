const bot = require('../bot');
const db = require('../database');
const keyboards = require('../config/keyboards');
const utils = require('../utils');
const config = require('../config');

async function handleRechargeMenu(chatId, messageId) {
    const user = await db.getUser(chatId);
    
    if (!user.accepted_terms) {
        await bot.editMessageText('❌ *Debes aceptar los términos y condiciones primero.*', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('start_back')
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
        reply_markup: keyboards.createRechargeMethodsKeyboard()
    });
}

async function handleDepositInit(chatId, messageId, currency) {
    const user = await db.getUser(chatId);
    
    if (!user.phone_number) {
        await bot.editMessageText('❌ *Debes vincular tu teléfono primero* para pagos con CUP o Saldo Móvil.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('recharge_menu')
        });
        return;
    }
    
    const ordenPendiente = await db.tieneOrdenPendiente(chatId, currency);
    if (ordenPendiente) {
        const mensaje = `❌ *Ya tienes una orden pendiente*\n\n` +
            `🆔 Orden #${ordenPendiente.id}\n` +
            `💰 Monto: ${utils.formatCurrency(ordenPendiente.amount_requested, currency)}\n` +
            `⏳ Estado: Pendiente\n\n` +
            `Debes cancelar esta orden antes de crear una nueva.\n\n` +
            `¿Deseas cancelar la orden pendiente?`;
        
        await bot.editMessageText(mensaje, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createCancelOrderKeyboard(ordenPendiente.id, currency)
        });
        return;
    }
    
    let instrucciones = '';
    let minimo = config.MINIMO_CUP;
    let maximo = config.MAXIMO_CUP;
    let metodoPago = '';
    let extraInfo = '';
    
    if (currency === 'cup') {
        minimo = config.MINIMO_CUP;
        maximo = config.MAXIMO_CUP;
        metodoPago = 'Tarjeta';
        if (config.PAGO_CUP_TARJETA) {
            instrucciones = `💳 *Paga a la tarjeta:* \`${config.PAGO_CUP_TARJETA}\``;
        } else {
            instrucciones = `💳 *Paga a la tarjeta:* \`[NO CONFIGURADO]\``;
        }
    } else if (currency === 'saldo') {
        minimo = config.MINIMO_SALDO;
        maximo = 10000;
        metodoPago = 'Saldo Móvil';
        if (config.PAGO_SALDO_MOVIL) {
            instrucciones = `📱 *Paga al número:* \`${config.PAGO_SALDO_MOVIL}\``;
        } else {
            instrucciones = `📱 *Paga al número:* \`[NO CONFIGURADO]\``;
        }
        const cwsPor100 = Math.floor(minimo / 100) * config.CWS_PER_100_SALDO;
        extraInfo = `\n🎫 *Gana ${config.CWS_PER_100_SALDO} CWS por cada 100 de saldo*\n` +
            `(Ej: ${minimo} saldo = ${cwsPor100} CWS)`;
    }
    
    const sessions = require('./sessions');
    sessions.setSession(chatId, { 
        step: 'waiting_deposit_amount', 
        currency: currency,
        metodoPago: metodoPago
    });
    
    const bonoPorcentaje = '10%';
    
    const message = `💰 *Recargar ${currency.toUpperCase()}*\n\n` +
        `*Método:* ${metodoPago}\n` +
        `*Mínimo:* ${utils.formatCurrency(minimo, currency)}\n` +
        `*Máximo:* ${utils.formatCurrency(maximo, currency)}\n\n` +
        `🎁 *Bono primer depósito:* ${bonoPorcentaje}\n` +
        `${extraInfo}\n\n` +
        `${instrucciones}\n\n` +
        `Por favor, escribe el monto exacto que deseas depositar:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createBackKeyboard('recharge_menu')
    });
}

async function handleConfirmDeposit(chatId, messageId, currency, amount) {
    const sessions = require('./sessions');
    const session = sessions.getSession(chatId);
    const user = await db.getUser(chatId);
    
    if (!user) {
        if (messageId) {
            await bot.editMessageText('❌ No se pudo obtener tu información.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, '❌ No se pudo obtener tu información.', {
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        }
        return;
    }
    
    if (!amount && session && session.amount) {
        amount = session.amount;
    }
    
    if (!amount) {
        const errorMsg = '❌ No se encontró el monto. Por favor, inicia el depósito nuevamente.';
        if (messageId) {
            await bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, errorMsg, {
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        }
        sessions.clearSession(chatId);
        return;
    }
    
    const limites = { 
        cup: [config.MINIMO_CUP, config.MAXIMO_CUP], 
        saldo: [config.MINIMO_SALDO, 10000]
    };
    
    if (amount < limites[currency][0] || amount > limites[currency][1]) {
        const mensaje = `❌ *Monto fuera de límites*\n\n` +
            `Debe estar entre ${utils.formatCurrency(limites[currency][0], currency)} y ${utils.formatCurrency(limites[currency][1], currency)}.\n\n` +
            `Por favor, inicia el depósito nuevamente.`;
        
        if (messageId) {
            await bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, mensaje, { 
                parse_mode: 'Markdown',
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        }
        sessions.clearSession(chatId);
        return;
    }
    
    const ordenPendiente = await db.tieneOrdenPendiente(chatId, currency);
    if (ordenPendiente) {
        const mensaje = `❌ *Ya tienes una orden pendiente*\n\n` +
            `🆔 Orden #${ordenPendiente.id}\n` +
            `💰 Monto: ${utils.formatCurrency(ordenPendiente.amount_requested, currency)}\n` +
            `⏳ Estado: Pendiente\n\n` +
            `Debes cancelar esta orden antes de crear una nueva.`;
        
        if (messageId) {
            await bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, mensaje, {
                parse_mode: 'Markdown',
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        }
        sessions.clearSession(chatId);
        return;
    }
    
    const bonoPorcentaje = 0.10;
    const bono = user[`first_dep_${currency}`] ? amount * bonoPorcentaje : 0;
    const totalConBono = amount + bono;
    const tokens = currency === 'saldo' ? Math.floor(amount / 100) * config.CWS_PER_100_SALDO : 0;
    
    const { data: transaction, error } = await db.supabase
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
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        } else {
            await bot.sendMessage(chatId, mensajeError, {
                reply_markup: keyboards.createBackKeyboard('recharge_menu')
            });
        }
        return;
    }
    
    let instrucciones = '';
    let metodoPago = '';
    
    if (currency === 'cup') {
        metodoPago = 'Tarjeta';
        if (config.PAGO_CUP_TARJETA) {
            instrucciones = `💳 *Paga a la tarjeta:* \`${config.PAGO_CUP_TARJETA}\``;
        } else {
            instrucciones = `💳 *Paga a la tarjeta:* \`[NO CONFIGURADO]\``;
        }
    } else if (currency === 'saldo') {
        metodoPago = 'Saldo Móvil';
        if (config.PAGO_SALDO_MOVIL) {
            instrucciones = `📱 *Paga al número:* \`${config.PAGO_SALDO_MOVIL}\``;
        } else {
            instrucciones = `📱 *Paga al número:* \`[NO CONFIGURADO]\``;
        }
    }
    
    const mensaje = `✅ *Solicitud de depósito creada*\n\n` +
        `🆔 *Número de orden:* #${transaction.id}\n` +
        `💰 *Monto solicitado:* ${utils.formatCurrency(amount, currency)}\n` +
        `🎁 *Bono por primer depósito:* ${utils.formatCurrency(bono, currency)} (${bonoPorcentaje * 100}%)\n` +
        `💵 *Total a acreditar:* ${utils.formatCurrency(totalConBono, currency)}\n` +
        `🎫 *Tokens a ganar:* ${tokens} CWS\n\n` +
        `*Instrucciones de pago:*\n` +
        `${instrucciones}\n\n` +
        `⚠️ *IMPORTANTE:*\n` +
        `• Realiza el pago con el teléfono vinculado: +53 ${user.phone_number.substring(2)}\n` +
        `• El monto debe ser exactamente ${utils.formatCurrency(amount, currency)}\n` +
        `• Para CUP/Saldo: Activa "Mostrar número al destinatario" en Transfermóvil\n` +
        `• Guarda el comprobante de la transacción\n\n` +
        `Una vez realizado el pago, el sistema lo detectará automáticamente.`;
    
    if (messageId) {
        await bot.editMessageText(mensaje, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('start_back')
        });
    } else {
        await bot.sendMessage(chatId, mensaje, {
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('start_back')
        });
    }
    
    await utils.notificarSolicitudNueva(transaction);
    sessions.clearSession(chatId);
}

async function handleCancelPendingOrder(chatId, messageId) {
    const ordenPendiente = await db.tieneOrdenPendiente(chatId);
    
    if (!ordenPendiente) {
        await bot.editMessageText('❌ No tienes órdenes pendientes para cancelar.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createWalletKeyboard()
        });
        return;
    }
    
    const mensaje = `❓ *¿Confirmar cancelación?*\n\n` +
        `🆔 Orden #${ordenPendiente.id}\n` +
        `💰 Monto: ${utils.formatCurrency(ordenPendiente.amount_requested, ordenPendiente.currency)}\n` +
        `💳 Método: ${ordenPendiente.currency.toUpperCase()}\n\n` +
        `Esta acción no se puede deshacer.`;
    
    await bot.editMessageText(mensaje, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createCancelOrderKeyboard(ordenPendiente.id, ordenPendiente.currency)
    });
}

async function handleConfirmCancel(chatId, messageId, ordenId, currency) {
    const result = await db.cancelarOrdenPendiente(chatId, currency);
    
    if (result.success) {
        await bot.editMessageText(`✅ ${result.message}`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createWalletKeyboard()
        });
    } else {
        await bot.editMessageText(`❌ ${result.message}`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createWalletKeyboard()
        });
    }
}

module.exports = {
    handleRechargeMenu,
    handleDepositInit,
    handleConfirmDeposit,
    handleCancelPendingOrder,
    handleConfirmCancel
};
