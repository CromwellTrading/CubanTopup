const axios = require('axios');
require('dotenv').config();

const PYTHON_WEBHOOK_URL = process.env.PYTHON_WEBHOOK_URL || 'http://localhost:5000';
const NODEJS_BOT_URL = `http://localhost:${process.env.PORT || 3000}`;
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos

async function pingService(url, serviceName) {
    try {
        console.log(`🔄 Ping a ${serviceName}...`);
        const response = await axios.get(url, { timeout: 10000 });
        console.log(`✅ ${serviceName}: ${response.status} - ${JSON.stringify(response.data)}`);
        return true;
    } catch (error) {
        console.error(`❌ ${serviceName}: ${error.message}`);
        
        // Intentar enviar alerta si es el bot de Telegram
        if (serviceName === 'Node.js Bot' && process.env.TELEGRAM_TOKEN && process.env.ADMIN_GROUP) {
            try {
                const TelegramBot = require('node-telegram-bot-api');
                const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
                await bot.sendMessage(process.env.ADMIN_GROUP, 
                    `🚨 *ALERTA DE SERVICIO*\n\n` +
                    `❌ ${serviceName} no responde.\n` +
                    `🔗 URL: ${url}\n` +
                    `⏰ Hora: ${new Date().toLocaleString()}\n\n` +
                    `Por favor, verifica el servicio.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (botError) {
                console.error('❌ No se pudo enviar alerta:', botError.message);
            }
        }
        
        return false;
    }
}

async function checkServices() {
    console.log(`\n=== CHECK DE SERVICIOS ===`);
    console.log(`📅 ${new Date().toLocaleString()}`);
    console.log('='.repeat(30));
    
    const services = [
        { name: 'Python Webhook', url: `${PYTHON_WEBHOOK_URL}/keepalive` },
        { name: 'Node.js Bot', url: `${NODEJS_BOT_URL}/keepalive` }
    ];
    
    const results = await Promise.all(
        services.map(service => pingService(service.url, service.name))
    );
    
    const allActive = results.every(result => result === true);
    
    if (allActive) {
        console.log('🎉 Todos los servicios están activos');
    } else {
        console.log('⚠️ Algunos servicios tienen problemas');
    }
    
    console.log('='.repeat(30));
    console.log(`Próximo check en ${CHECK_INTERVAL / 60000} minutos\n`);
}

// Ejecutar inmediatamente
checkServices();

// Programar ejecución periódica
setInterval(checkServices, CHECK_INTERVAL);

// Manejo de señales para apagado limpio
process.on('SIGINT', () => {
    console.log('\n🛑 Deteniendo Keep Alive service...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Deteniendo Keep Alive service...');
    process.exit(0);
});
