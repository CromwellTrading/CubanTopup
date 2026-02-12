// ============================================
// ARCHIVO PRINCIPAL SIMPLIFICADO - VERSIÓN FINAL
// ============================================
require('dotenv').config();

// Dependencias
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cors = require('cors');

// Configuración
const config = require('./config');
config.validateConfig();

// Inicializar Express
const app = express();

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/css', express.static(__dirname + '/public/css'));
app.use('/js', express.static(__dirname + '/public/js'));
app.use('/assets', express.static(__dirname + '/public/assets'));

// Session configuration
app.use(session({
    secret: config.WEBHOOK_SECRET_KEY || 'cromwell-store-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Inicializar Bot de Telegram
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });

// Exportar bot para uso en otros módulos
global.bot = bot;
module.exports = bot;

// Inicializar base de datos
const db = require('./database');

// Inicializar handlers externos
const GameRechargeHandler = require('./services/game_recharges');
const SokyRecargasHandler = require('./services/sokyrecargas');
const BolitaHandler = require('./services/BolitaHandler');
const TradingSignalsHandler = require('./services/TradingSignalsHandler');

const gameHandler = new GameRechargeHandler(bot, db.supabase);
const sokyHandler = new SokyRecargasHandler(bot, db.supabase);
const bolitaHandler = new BolitaHandler(bot, db.supabase);
const tradingHandler = new TradingSignalsHandler(bot, db.supabase);

// ============================================================
// IMPORTANTE: Inicializar handlers de Telegram PASANDO las instancias
// ============================================================
const handlers = require('./handlers');
handlers.init({
    gameHandler,
    sokyHandler,
    bolitaHandler,
    tradingHandler
});

// Cargar rutas web
app.use(require('./web'));

// Iniciar tareas programadas
const scheduler = require('./utils/scheduler');
scheduler.initScheduledTasks();

// Iniciar servidor
const server = app.listen(config.PORT, () => {
    console.log(`\n🤖 Cromwell Bot & Server iniciado`);
    console.log(`🔗 http://localhost:${config.PORT}`);
    console.log(`🌐 WebApp: http://localhost:${config.PORT}/webapp`);
    console.log(`📊 Dashboard: http://localhost:${config.PORT}/dashboard`);
    console.log(`🔄 Keep alive: http://localhost:${config.PORT}/keepalive`);
    console.log(`💰 Mínimos: CUP=${config.MINIMO_CUP}, Saldo=${config.MINIMO_SALDO}`);
    console.log(`📞 Teléfono para pagos: ${config.PAGO_SALDO_MOVIL || '❌ No configurado'}`);
    console.log(`💳 Tarjeta para pagos: ${config.PAGO_CUP_TARJETA ? '✅ Configurada' : '❌ No configurada'}`);
    console.log(`🎮 LioGames: ${config.LIOGAMES_MEMBER_CODE ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`📱 SokyRecargas: ${config.SOKY_API_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🎱 La Bolita: ✅ Integrado`);
    console.log(`📈 Trading Signals: ✅ Integrado con todas las funcionalidades`);
    console.log(`👑 Admin ID: ${config.BOT_ADMIN_ID ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`\n🌐 Webhooks disponibles:`);
    console.log(`   • POST /payment-notification`);
    console.log(`   • POST /lio-webhook`);
    console.log(`   • POST /soky-webhook`);
    console.log(`   • POST /status-webhook`);
    console.log(`\n🚀 Bot listo para recibir mensajes...`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 Recibida señal SIGTERM, apagando limpiamente...');
    server.close(() => {
        console.log('✅ Servidor HTTP cerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('👋 Recibida señal SIGINT, apagando limpiamente...');
    server.close(() => {
        console.log('✅ Servidor HTTP cerrado');
        process.exit(0);
    });
});

// Manejo de errores global
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});
