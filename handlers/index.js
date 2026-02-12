// ============================================
// handlers/index.js - INICIALIZADOR DE HANDLERS
// ============================================
const bot = require('../bot');
const db = require('../database');

// Handlers internos (solo se importan, no se ejecutan todavía)
const commands = require('./commands');
const sessions = require('./sessions');
const adminHandlers = require('./admin');
const walletHandlers = require('./wallet');
const rechargeHandlers = require('./recharge');
const helpHandlers = require('./help');

// Fábricas de handlers (importamos las funciones que CREAN los handlers)
const createCallbacksHandler = require('./callbacks');
const createMessagesHandler = require('./messages');

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
    // CALLBACKS - Creamos el manejador con las instancias
    // ------------------------------------------------------------
    const callbackHandler = createCallbacksHandler(bot, db, {
        gameHandler,
        sokyHandler,
        bolitaHandler,
        tradingHandler,
        adminHandlers,
        walletHandlers,
        rechargeHandlers,
        helpHandlers,
        sessions
    });
    bot.on('callback_query', callbackHandler);

    // ------------------------------------------------------------
    // MENSAJES - Creamos el manejador con las instancias
    // ------------------------------------------------------------
    const messageHandler = createMessagesHandler(bot, db, {
        gameHandler,
        sokyHandler,
        bolitaHandler,
        tradingHandler,
        adminHandlers,
        sessions
    });
    bot.on('message', messageHandler);

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

module.exports = {
    init
};
