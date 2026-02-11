require('dotenv').config();

module.exports = {
    // Bot configuration
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
    DB_URL: process.env.DB_URL,
    DB_KEY: process.env.DB_KEY,
    WEBHOOK_SECRET_KEY: process.env.WEBHOOK_SECRET_KEY,
    
    // Payment configuration
    MINIMO_CUP: parseFloat(process.env.MINIMO_CUP) || 1000,
    MINIMO_SALDO: parseFloat(process.env.MINIMO_SALDO) || 500,
    MAXIMO_CUP: parseFloat(process.env.MAXIMO_CUP) || 50000,
    
    // Exchange rates
    USDT_RATE_0_30: parseFloat(process.env.USDT_RATE_0_30) || 650,
    USDT_RATE_30_PLUS: parseFloat(process.env.USDT_RATE_30_PLUS) || 680,
    SALDO_MOVIL_RATE: parseFloat(process.env.SALDO_MOVIL_RATE) || 2.1,
    
    // Token configuration
    CWS_PER_100_SALDO: 10,
    MIN_CWS_USE: parseInt(process.env.MIN_CWS_USE) || 100,
    
    // Payment information
    PAGO_CUP_TARJETA: process.env.PAGO_CUP_TARJETA,
    PAGO_SALDO_MOVIL: process.env.PAGO_SALDO_MOVIL,
    PAGO_USDT_ADDRES: process.env.PAGO_USDT_ADDRES,
    
    // Admin configuration
    ADMIN_CHAT_ID: process.env.ADMIN_GROUP,
    BOT_ADMIN_ID: process.env.BOT_ADMIN_ID,
    
    // Server configuration
    PORT: process.env.PORT || 3000,
    
    // SokyRecargas
    SOKY_API_TOKEN: process.env.SOKY_API_TOKEN,
    SOKY_RATE_CUP: parseFloat(process.env.SOKY_RATE_CUP) || 632,
    
    // LioGames API
    LIOGAMES_SECRET: process.env.LIOGAMES_SECRET,
    LIOGAMES_MEMBER_CODE: process.env.LIOGAMES_MEMBER_CODE,
    
    // Python webhook
    PYTHON_WEBHOOK_URL: process.env.PYTHON_WEBHOOK_URL,
    
    // Validator API
    RECARGA_API_SECRET: process.env.RECARGA_API_SECRET,
    RECARGA_ENDPOINT: process.env.RECARGA_ENDPOINT,
    RECARGA_MEMBER_ID: process.env.RECARGA_MEMBER_ID,
    
    // Validation
    validateConfig: function() {
        if (!this.TELEGRAM_TOKEN) {
            console.error('❌ ERROR: TELEGRAM_TOKEN no está configurado en .env');
            process.exit(1);
        }
        
        if (!this.DB_URL || !this.DB_KEY) {
            console.error('❌ ERROR: DB_URL o DB_KEY no están configurados en .env');
            process.exit(1);
        }
        
        if (!this.LIOGAMES_SECRET || !this.LIOGAMES_MEMBER_CODE) {
            console.warn('⚠️ ADVERTENCIA: LIOGAMES_SECRET o LIOGAMES_MEMBER_CODE no configurados');
        }
        
        if (!this.SOKY_API_TOKEN) {
            console.warn('⚠️ ADVERTENCIA: SOKY_API_TOKEN no configurado');
        }
    }
};
