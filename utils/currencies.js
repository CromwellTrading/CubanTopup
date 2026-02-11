const config = require('../config');

function formatCurrency(amount, currency) {
    const symbols = {
        'cup': 'CUP',
        'saldo': 'Saldo',
        'cws': 'CWS',
        'usdt': 'USDT'
    };
    
    const symbol = symbols[currency] || currency.toUpperCase();
    
    if (currency === 'cws') {
        return `${Math.floor(amount)} ${symbol}`;
    }
    
    return `$${parseFloat(amount).toFixed(2)} ${symbol}`;
}

function calculateCupFromUsdt(usdtAmount) {
    if (usdtAmount <= 30) {
        return usdtAmount * config.USDT_RATE_0_30;
    } else {
        return (30 * config.USDT_RATE_0_30) + ((usdtAmount - 30) * config.USDT_RATE_30_PLUS);
    }
}

function calculateSaldoMovilFromCup(cupAmount) {
    const raw = cupAmount / config.SALDO_MOVIL_RATE;
    return Math.ceil(raw / 5) * 5;
}

module.exports = {
    formatCurrency,
    calculateCupFromUsdt,
    calculateSaldoMovilFromCup
};
