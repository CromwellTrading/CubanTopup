const bot = require('../bot');
const keyboards = require('../config/keyboards');
const config = require('../config');

async function handleHelpMenu(chatId, messageId) {
    const message = `❓ *Centro de Ayuda*\n\n` +
        `¿En qué puedo ayudarte?\n\n` +
        `Selecciona una opción:`;
    
    if (messageId) {
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createHelpKeyboard()
        });
    } else {
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboards.createHelpKeyboard()
        });
    }
}

async function handleHelpFAQ(chatId, messageId) {
    const faq = `❓ *Preguntas Frecuentes*\n\n` +
        `1. *¿Cómo recargo mi billetera?*\n` +
        `Ve a "💰 Recargar Billetera" y sigue las instrucciones.\n\n` +
        `2. *¿Cuánto tarda en llegar mi depósito?*\n` +
        `Los depósitos se procesan automáticamente en 1-5 minutos.\n\n` +
        `3. *¿Puedo retirar mi dinero?*\n` +
        `El saldo solo es usable en Cromwell Store, no es retirable.\n\n` +
        `4. *¿Cómo uso los tokens CWS?*\n` +
        `Los tokens se usan para descuentos en recargas de juegos.\n\n` +
        `5. *¿Qué es La Bolita?*\n` +
        `Sistema de apuestas basado en Florida 3 usando CUP.\n\n` +
        `6. *¿Qué son las Señales de Trading?*\n` +
        `Señales profesionales para trading con suscripciones.\n` +
        `• Precio: 3000 CUP mensual\n` +
        `• Horario: 10am y 10pm (10 señales por sesión)\n` +
        `• Rentabilidad: +60% semanal garantizado\n` +
        `• Reembolso: 50% si baja del 50%\n` +
        `• Referidos: 20% por cada amigo que se haga VIP\n\n` +
        `7. *¿Cómo contacto soporte?*\n` +
        `Usa "📞 Contactar Soporte" o escribe a @admin_username`;
    
    await bot.editMessageText(faq, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createBackKeyboard('help_menu')
    });
}

async function handleHelpContact(chatId, messageId) {
    const message = `📞 *Contactar Soporte*\n\n` +
        `Para asistencia personalizada:\n\n` +
        `👤 *Administrador:* @${process.env.ADMIN_USERNAME || 'admin_username'}\n` +
        `📧 *Email:* ${process.env.SUPPORT_EMAIL || 'support@cromwellstore.com'}\n\n` +
        `⏰ *Horario de atención:*\n` +
        `• Lunes a Viernes: 9:00 AM - 6:00 PM\n` +
        `• Sábados: 10:00 AM - 2:00 PM\n\n` +
        `📋 *Para reportar problemas:*\n` +
        `1. Tu ID de Telegram\n` +
        `2. Descripción del problema\n` +
        `3. Capturas de pantalla (si aplica)`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createBackKeyboard('help_menu')
    });
}

async function handleHelpReport(chatId, messageId) {
    const message = `🔧 *Reportar Problema*\n\n` +
        `Por favor, describe el problema que estás experimentando:\n\n` +
        `Incluye:\n` +
        `• Qué estabas intentando hacer\n` +
        `• Qué error apareció\n` +
        `• Tu ID de Telegram: \`${chatId}\`\n` +
        `• Capturas de pantalla si es posible\n\n` +
        `Escribe tu reporte a continuación:`;
    
    const sessions = require('./sessions');
    sessions.setSession(chatId, { step: 'reporting_problem' });
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboards.createBackKeyboard('help_menu')
    });
}

module.exports = {
    handleHelpMenu,
    handleHelpFAQ,
    handleHelpContact,
    handleHelpReport
};
