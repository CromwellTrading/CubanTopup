const bot = require('../bot');
const db = require('../database');
const config = require('../config');

async function notifyAdmin(message) {
    try {
        if (!config.ADMIN_CHAT_ID) return false;
        
        await bot.sendMessage(config.ADMIN_CHAT_ID, message, { 
            parse_mode: 'Markdown' 
        });
        
        return true;
    } catch (error) {
        console.error('Error notifying admin:', error);
        return false;
    }
}

async function notifyUser(userId, message) {
    try {
        await bot.sendMessage(userId, message, { 
            parse_mode: 'Markdown' 
        });
        
        return true;
    } catch (error) {
        console.error(`Error notifying user ${userId}:`, error);
        return false;
    }
}

async function notifyPaymentReceived(userId, amount, currency, txId) {
    const user = await db.getUser(userId);
    if (!user) return false;
    
    const message = `✅ *¡Pago recibido!*\n\n` +
        `💰 Monto: ${require('./currencies').formatCurrency(amount, currency)}\n` +
        `🆔 ID: \`${txId}\`\n\n` +
        `Tu pago está siendo procesado. Te notificaremos cuando esté acreditado.`;
    
    return await notifyUser(userId, message);
}

async function notifyDepositCompleted(userId, transaction) {
    const message = `✨ *¡Depósito Completado!*\n\n` +
        `📋 Orden #${transaction.id}\n` +
        `💰 Monto: ${require('./currencies').formatCurrency(transaction.amount, transaction.currency)}\n` +
        `💳 Método: ${transaction.currency.toUpperCase()}\n\n` +
        `El dinero ha sido acreditado a tu billetera.`;
    
    return await notifyUser(userId, message);
}

async function notifyGameRechargeStatus(userId, gameName, status, orderId = null) {
    let message = '';
    
    switch (status) {
        case 'processing':
            message = `⏳ *Recarga ${gameName} en proceso*\n\n` +
                `Tu recarga está siendo procesada. Te notificaremos cuando esté lista.`;
            if (orderId) message += `\n\n🆔 ID de orden: ${orderId}`;
            break;
            
        case 'completed':
            message = `✅ *¡Recarga ${gameName} completada!*\n\n` +
                `Tu recarga ha sido procesada exitosamente.`;
            if (orderId) message += `\n\n🆔 ID de orden: ${orderId}`;
            break;
            
        case 'failed':
            message = `❌ *Recarga ${gameName} fallida*\n\n` +
                `Hubo un error al procesar tu recarga. Contacta al administrador para más información.`;
            if (orderId) message += `\n\n🆔 ID de orden: ${orderId}`;
            break;
    }
    
    return await notifyUser(userId, message);
}

async function notifyETECSARechargeStatus(userId, offerName, status, transactionId = null) {
    let message = '';
    
    switch (status) {
        case 'processing':
            message = `⏳ *Recarga ETECSA en proceso*\n\n` +
                `Oferta: ${offerName}\n` +
                `Tu recarga está siendo procesada por ETECSA.`;
            break;
            
        case 'completed':
            message = `✅ *¡Recarga ETECSA completada!*\n\n` +
                `Oferta: ${offerName}\n` +
                `Tu recarga ha sido activada exitosamente.`;
            break;
            
        case 'failed':
            message = `❌ *Recarga ETECSA fallida*\n\n` +
                `Oferta: ${offerName}\n` +
                `Hubo un error al procesar tu recarga. Contacta al administrador para más información.`;
            break;
    }
    
    if (transactionId) {
        message += `\n\n🆔 ID de transacción: ${transactionId}`;
    }
    
    return await notifyUser(userId, message);
}

async function notifyBolitaResult(userId, ticketId, result, winnings = 0) {
    let message = '';
    
    if (result === 'win') {
        message = `🎉 *¡Felicidades! Has ganado en La Bolita*\n\n` +
            `🎫 Ticket #${ticketId}\n` +
            `💰 Ganancia: ${winnings} CUP\n\n` +
            `El dinero ha sido acreditado a tu billetera.`;
    } else {
        message = `😔 *Lo sentimos, no has ganado esta vez*\n\n` +
            `🎫 Ticket #${ticketId}\n\n` +
            `¡Suerte para la próxima!`;
    }
    
    return await notifyUser(userId, message);
}

async function notifyTradingSignal(userId, signal) {
    const message = `📈 *NUEVA SEÑAL DE TRADING*\n\n` +
        `💰 Par: ${signal.par}\n` +
        `📊 Dirección: ${signal.direccion}\n` +
        `🎯 Entrada: ${signal.entrada}\n` +
        `🎯 TP: ${signal.tp}\n` +
        `🛑 SL: ${signal.sl}\n\n` +
        `⏰ Hora: ${new Date(signal.created_at).toLocaleTimeString()}`;
    
    return await notifyUser(userId, message);
}

async function notifyTradingSubscription(userId, planName, expiryDate) {
    const message = `🎖️ *¡Suscripción Trading Activada!*\n\n` +
        `📋 Plan: ${planName}\n` +
        `📅 Válido hasta: ${require('./helpers').formatDate(expiryDate)}\n\n` +
        `Ahora recibirás todas las señales VIP.`;
    
    return await notifyUser(userId, message);
}

module.exports = {
    notifyAdmin,
    notifyUser,
    notifyPaymentReceived,
    notifyDepositCompleted,
    notifyGameRechargeStatus,
    notifyETECSARechargeStatus,
    notifyBolitaResult,
    notifyTradingSignal,
    notifyTradingSubscription
};
