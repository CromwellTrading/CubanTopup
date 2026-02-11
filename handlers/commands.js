const bot = require('../bot');
const db = require('../database');
const keyboards = require('../config/keyboards');

async function handleStart(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const { first_name, username } = msg.from;
    
    console.log(`🚀 User ${userId} (${first_name}) started the bot`);
    
    // Check if admin
    if (userId.toString() === process.env.BOT_ADMIN_ID?.toString()) {
        const adminMessage = `👑 *Panel de Administración*\n\n` +
            `Bienvenido, Administrador.\n\n` +
            `Selecciona una opción del menú:`;
        
        await bot.sendMessage(chatId, adminMessage, { 
            parse_mode: 'Markdown',
            reply_markup: keyboards.createAdminKeyboard()
        });
        return;
    }
    
    let user = await db.getUser(chatId);
    
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
        
        await db.supabase.from('users').upsert(user, { onConflict: 'telegram_id' });
        user = await db.getUser(chatId);
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
        
        require('../handlers/sessions').setSession(chatId, { step: 'waiting_phone_start' });
        
        return bot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }
        });
    }
    
    // STEP 2: Check if terms accepted
    if (!user.accepted_terms) {
        return require('../handlers/callbacks').handleTerms(chatId, null);
    }
    
    // STEP 3: Complete user - Show main menu
    const welcomeMessage = `✅ *¡Bienvenido de nuevo, ${first_name}!*\n\n` +
        `🆔 *Tu ID de Telegram es:* \`${userId}\`\n\n` +
        `⚠️ *GUARDA ESTE ID* - Lo necesitarás para acceder a la web.\n\n` +
        `Ahora también puedes usar nuestra *WebApp* para una mejor experiencia.\n\n` +
        `¿Cómo puedo ayudarte hoy?`;
    
    await bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown', 
        reply_markup: keyboards.createMainKeyboard()
    });
}

async function handleAdminCommand(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (userId.toString() !== process.env.BOT_ADMIN_ID?.toString()) {
        await bot.sendMessage(chatId, '❌ No tienes permisos de administrador.');
        return;
    }
    
    const adminMessage = `👑 *Panel de Administración*\n\n` +
        `Bienvenido, Administrador.\n\n` +
        `Selecciona una opción del menú:`;
    
    await bot.sendMessage(chatId, adminMessage, { 
        parse_mode: 'Markdown',
        reply_markup: keyboards.createAdminKeyboard()
    });
}

async function handleWebAppCommand(msg) {
    const chatId = msg.chat.id;
    const baseUrl = process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}`;
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
}

module.exports = {
    handleStart,
    handleAdminCommand,
    handleWebAppCommand
};
