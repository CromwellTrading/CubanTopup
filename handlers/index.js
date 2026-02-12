// ============================================
// handlers/index.js - INICIALIZADOR DE HANDLERS
// ============================================
const bot = require('../bot');
const db = require('../database');

// Handlers internos
const commands = require('./commands');
const callbacks = require('./callbacks');
const messages = require('./messages');
const sessions = require('./sessions');
const adminHandlers = require('./admin');
const walletHandlers = require('./wallet');
const rechargeHandlers = require('./recharge');
const helpHandlers = require('./help');

// Variables para las instancias externas (se inyectan desde bot.js)
let gameHandler, sokyHandler, bolitaHandler, tradingHandler;

/**
 * Inicializa todos los handlers con las instancias externas
 * @param {Object} handlers - Objeto con las instancias de los servicios
 */
function init(handlers) {
    gameHandler = handlers.gameHandler;
    sokyHandler = handlers.sokyHandler;
    bolitaHandler = handlers.bolitaHandler;
    tradingHandler = handlers.tradingHandler;

    // ------------------------------------------------------------
    // COMANDOS
    // ------------------------------------------------------------
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
        sessions.clearSession(msg.chat.id);
        bolitaHandler.clearUserState(msg.from.id);
        tradingHandler.clearUserState(msg.from.id);
        bot.sendMessage(msg.chat.id, '❌ Operación cancelada. ¿Qué deseas hacer?', {
            reply_markup: require('../config/keyboards').createMainKeyboard()
        });
    });

    // ------------------------------------------------------------
    // CALLBACKS
    // ------------------------------------------------------------
    bot.on('callback_query', callbacks.handleCallback);

    // ------------------------------------------------------------
    // MENSAJES
    // ------------------------------------------------------------
    bot.on('message', messages.handleMessage);

    // ------------------------------------------------------------
    // ERRORES
    // ------------------------------------------------------------
    bot.on('polling_error', (error) => {
        console.error('❌ Error en polling de Telegram:', error);
    });
    bot.on('webhook_error', (error) => {
        console.error('❌ Error en webhook de Telegram:', error);
    });

    console.log('✅ Handlers de Telegram inicializados correctamente');
}

/**
 * Obtiene las instancias de los handlers externos
 */
function getHandlers() {
    return { gameHandler, sokyHandler, bolitaHandler, tradingHandler };
}

// Exportar para que otros módulos puedan acceder a las mismas instancias
module.exports = {
    init,
    getHandlers,
    // Getters para acceso directo (usados en messages.js y callbacks.js)
    get gameHandler() { return gameHandler; },
    get sokyHandler() { return sokyHandler; },
    get bolitaHandler() { return bolitaHandler; },
    get tradingHandler() { return tradingHandler; },
    
    // Re-exportar handlers internos (para que bot.js no necesite require adicional)
    commands,
    callbacks,
    messages,
    sessions,
    adminHandlers,
    walletHandlers,
    rechargeHandlers,
    helpHandlers
};
