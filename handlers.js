const bot = require('../bot');

// Importar handlers
const commands = require('./commands');
const callbacks = require('./callbacks');
const messages = require('./messages');

// Inicializar handlers externos
const db = require('../database');
const GameRechargeHandler = require('../services/game_recharges');
const SokyRecargasHandler = require('../services/sokyrecargas');
const BolitaHandler = require('../services/BolitaHandler');
const TradingSignalsHandler = require('../services/TradingSignalsHandler');

// Instancias globales para acceso desde otros módulos
const gameHandler = new GameRechargeHandler(bot, db.supabase);
const sokyHandler = new SokyRecargasHandler(bot, db.supabase);
const bolitaHandler = new BolitaHandler(bot, db.supabase);
const tradingHandler = new TradingSignalsHandler(bot, db.supabase);

// Configurar comandos
bot.onText(/\/start/, commands.handleStart);
bot.onText(/\/admin/, commands.handleAdminCommand);
bot.onText(/\/webapp/, commands.handleWebAppCommand);
bot.onText(/\/bolita/, (msg) => {
    bolitaHandler.mostrarMenuPrincipal(msg.chat.id);
});
bot.onText(/\/trading/, (msg) => {
    tradingHandler.showTradingMenu(msg.chat.id, null);
});
bot.onText(/\/cancelar/, (msg) => {
    // Limpiar sesiones
    require('./sessions').clearSession(msg.chat.id);
    
    // Limpiar estados en handlers
    bolitaHandler.clearUserState(msg.from.id);
    tradingHandler.clearUserState(msg.from.id);
    
    bot.sendMessage(msg.chat.id, '❌ Operación cancelada. ¿Qué deseas hacer?', {
        reply_markup: require('../config/keyboards').createMainKeyboard()
    });
});

// Configurar callbacks
bot.on('callback_query', callbacks.handleCallback);

// Configurar mensajes
bot.on('message', messages.handleMessage);

// Manejar errores del bot
bot.on('polling_error', (error) => {
    console.error('❌ Error en polling de Telegram:', error);
});

bot.on('webhook_error', (error) => {
    console.error('❌ Error en webhook de Telegram:', error);
});

module.exports = {
    gameHandler,
    sokyHandler,
    bolitaHandler,
    tradingHandler
};
