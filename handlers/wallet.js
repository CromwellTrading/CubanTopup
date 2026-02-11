const bot = require('../bot');
const db = require('../database');
const keyboards = require('../config/keyboards');
const utils = require('../utils');
const config = require('../config');

async function handleWallet(chatId, messageId) {
    const user = await db.getUser(chatId);
    
    if (!user) {
        await bot.editMessageText('❌ No se pudo obtener tu información.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboards.createBackKeyboard('start_back')
        });
        return;
    }
    
    const ordenPendiente = await db.tieneOrdenPendiente(chatId);
    const pendienteMsg = ordenPendiente ? 
        `\n⚠️ *Tienes una orden pendiente:*\n` +
        `🆔 Orden #${ordenPendiente.id}\n` +
        `💰 ${utils.formatCurrency(ordenPendiente.amount_requested, ordenPendiente.currency)}\n` +
        `💳 ${ordenPendiente.currency.toUpperCase()}\n` +
        `📅 ${new Date(ordenPendiente.created_at).toLocaleDateString()}\n\n` : '';
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = config.MINIMO_CUP - pendiente;
    
    let message = `👛 *Tu Billetera Cromwell*\n\n` +
        `🆔 *ID de Telegram:* \`${chatId}\`\n\n` +
        `💰 *CUP:* **${utils.formatCurrency(user.balance_cup, 'cup')}**\n` +
        `📱 *Saldo Móvil:* **${utils.formatCurrency(user.balance_saldo, 'saldo')}**\n` +
        `🎫 *CWS (Tokens):* **${user.tokens_cws || 0}**\n\n` +
        pendienteMsg;
    
    if (pendiente > 0) {
        message += `📥 *CUP Pendiente:* **${utils.formatCurrency(pendiente, 'cup')}**\n`;
        if (faltante > 0) {
            message += `🎯 *Faltante:* ${utils.formatCurrency(faltante, 'cup')} para el mínimo\n\n`;
        }
    }
    
    message += `📞 *Teléfono vinculado:* ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : '❌ No vinculado'}\n\n` +
        `💡 *Mínimo para usar tokens:*\n` +
        `• CWS: ${config.MIN_CWS_USE} CWS\n\n` +
        `🎮 *Para recargar juegos:*\n` +
        `• 1 CWS = $10 CUP de descuento\n\n` +
        `¿Qué deseas hacer?`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createWalletKeyboard()
    });
}

async function handleRefreshWallet(chatId, messageId) {
    await db.updateUser(chatId, { last_active: new Date().toISOString() });
    await handleWallet(chatId, messageId);
}

async function handleViewPending(chatId, messageId) {
    const user = await db.getUser(chatId);
    
    if (!user) return;
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = config.MINIMO_CUP - pendiente;
    const bono = user.first_dep_cup ? pendiente * 0.10 : 0;
    const totalConBono = pendiente + bono;
    
    let message = `📊 *Saldo CUP Pendiente*\n\n`;
    
    if (pendiente > 0) {
        message += `💰 *Acumulado:* ${utils.formatCurrency(pendiente, 'cup')}\n`;
        
        if (user.first_dep_cup) {
            message += `🎁 *Bono disponible:* ${utils.formatCurrency(bono, 'cup')} (10%)\n`;
            message += `💵 *Total con bono:* ${utils.formatCurrency(totalConBono, 'cup')}\n`;
        }
        
        if (faltante > 0) {
            message += `\n❌ *Faltante:* ${utils.formatCurrency(faltante, 'cup')}\n`;
            message += `Haz otro depósito de ${utils.formatCurrency(faltante, 'cup')} o más.`;
        } else {
            message += `\n✅ *¡Ya superaste el mínimo!*\n`;
            message += `Se acreditará automáticamente en breve.`;
        }
    } else {
        message += `No tienes saldo pendiente acumulado.\n\n`;
        message += `Los depósitos menores a ${utils.formatCurrency(config.MINIMO_CUP, 'cup')} se acumulan aquí.`;
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createBackKeyboard('wallet')
    });
}

module.exports = {
    handleWallet,
    handleRefreshWallet,
    handleViewPending
};
