const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function generateUniqueId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}${timestamp}${random}`.toUpperCase();
}

function generateTransactionId() {
    return `T${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function generateTicketId() {
    return `TICKET${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
}

async function comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

function formatDate(date, includeTime = true) {
    const d = new Date(date);
    
    if (includeTime) {
        return d.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function calculateBonus(amount, isFirstDeposit, bonusPercentage = 0.10) {
    if (!isFirstDeposit) return 0;
    return amount * bonusPercentage;
}

function calculateTokens(amount, tokensPer100 = 10) {
    return Math.floor(amount / 100) * tokensPer100;
}

function parseCallbackData(data) {
    const parts = data.split(':');
    return {
        action: parts[0],
        param1: parts[1],
        param2: parts[2],
        param3: parts[3],
        fullData: data
    };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function truncateText(text, maxLength = 100) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

function isNumeric(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
}

module.exports = {
    generateUniqueId,
    generateTransactionId,
    generateTicketId,
    hashPassword,
    comparePassword,
    formatDate,
    calculateBonus,
    calculateTokens,
    parseCallbackData,
    delay,
    truncateText,
    isNumeric
};
