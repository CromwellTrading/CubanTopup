const axios = require('axios');

// Configuración
const SERVICES = [
    {
        name: 'Python Webhook',
        url: process.env.PYTHON_WEBHOOK_URL?.replace('/webhook', '/keepalive') || 'http://localhost:5000/keepalive',
        webhookUrl: process.env.PYTHON_WEBHOOK_URL || 'http://localhost:5000/webhook'
    },
    {
        name: 'Telegram Bot',
        url: `http://localhost:${process.env.PORT || 3000}/keepalive`,
        webhookUrl: `http://localhost:${process.env.PORT || 3000}/payment-notification`
    }
];

// Alerta para Telegram (opcional)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.ADMIN_GROUP;

async function sendTelegramAlert(service, error) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    
    try {
        const message = `🚨 *ALERTA DE SERVICIO*\n\n` +
                       `❌ ${service.name} no responde\n` +
                       `🔗 URL: ${service.url}\n` +
                       `💥 Error: ${error}\n` +
                       `⏰ Hora: ${new Date().toLocaleString()}`;
        
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('❌ No se pudo enviar alerta a Telegram:', error.message);
    }
}

async function checkService(service) {
    try {
        const startTime = Date.now();
        const response = await axios.get(service.url, { timeout: 30000 });
        const responseTime = Date.now() - startTime;
        
        console.log(`✅ ${service.name}: ${response.status} (${responseTime}ms)`);
        
        return {
            service: service.name,
            status: 'online',
            http_status: response.status,
            response_time: responseTime,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error(`❌ ${service.name}: ${error.message}`);
        
        // Enviar alerta si es un error grave
        if (error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
            await sendTelegramAlert(service, error.message);
        }
        
        return {
            service: service.name,
            status: 'offline',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

async function checkAllServices() {
    console.log('\n' + '='.repeat(60));
    console.log(`🕐 MONITOREO EXTERNO - ${new Date().toLocaleString()}`);
    console.log('='.repeat(60));
    
    const results = [];
    
    for (const service of SERVICES) {
        const result = await checkService(service);
        results.push(result);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2s entre checks
    }
    
    // Resumen
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN:');
    
    const onlineCount = results.filter(r => r.status === 'online').length;
    const totalCount = results.length;
    
    console.log(`✅ Servicios online: ${onlineCount}/${totalCount}`);
    
    results.forEach(result => {
        const icon = result.status === 'online' ? '✅' : '❌';
        const time = result.response_time ? ` (${result.response_time}ms)` : '';
        console.log(`${icon} ${result.service}: ${result.status}${time}`);
    });
    
    if (onlineCount === totalCount) {
        console.log('🎉 ¡Todos los servicios están funcionando correctamente!');
    } else {
        console.log('⚠️ Algunos servicios necesitan atención');
    }
    
    console.log('='.repeat(60) + '\n');
    
    return results;
}

// Si se ejecuta directamente
if (require.main === module) {
    console.log('🚀 Iniciando monitor externo de servicios...');
    console.log(`⏰ Intervalo: 5 minutos`);
    
    // Ejecutar inmediatamente
    checkAllServices();
    
    // Programar ejecución cada 5 minutos
    setInterval(checkAllServices, 5 * 60 * 1000);
}

module.exports = { checkAllServices };
