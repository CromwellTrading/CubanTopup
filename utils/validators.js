const config = require('../config');

function validatePhone(phone) {
    let cleanPhone = phone.replace(/[^\d]/g, '');
    
    if (!cleanPhone.startsWith('53')) {
        if (cleanPhone.length === 8) {
            cleanPhone = '53' + cleanPhone;
        } else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
            cleanPhone = '53' + cleanPhone;
        } else {
            return { valid: false, error: 'El número debe comenzar con 53 y tener 10 dígitos' };
        }
    }
    
    if (cleanPhone.length !== 10) {
        return { valid: false, error: 'El número debe tener 10 dígitos (53 + 8 dígitos)' };
    }
    
    if (!/^\d+$/.test(cleanPhone)) {
        return { valid: false, error: 'El número solo debe contener dígitos' };
    }
    
    return { valid: true, cleanPhone };
}

function validateAmount(amount, currency) {
    const amountNum = parseFloat(amount);
    
    if (isNaN(amountNum)) {
        return { valid: false, error: 'El monto debe ser un número' };
    }
    
    const limites = { 
        cup: [config.MINIMO_CUP, config.MAXIMO_CUP], 
        saldo: [config.MINIMO_SALDO, 10000]
    };
    
    if (amountNum < limites[currency][0] || amountNum > limites[currency][1]) {
        return { 
            valid: false, 
            error: `El monto debe estar entre ${limites[currency][0]} y ${limites[currency][1]}` 
        };
    }
    
    return { valid: true, amount: amountNum };
}

function validateTransactionId(txId) {
    if (!txId || txId.trim() === '') {
        return { valid: false, error: 'El ID de transacción es requerido' };
    }
    
    const cleanTxId = txId.trim().toUpperCase();
    
    // Check common formats
    if (cleanTxId.length < 5 || cleanTxId.length > 50) {
        return { valid: false, error: 'ID de transacción inválido' };
    }
    
    return { valid: true, cleanTxId };
}

function validateEmail(email) {
    if (!email) return { valid: true, email: null }; // Email is optional
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(email)) {
        return { valid: false, error: 'Email inválido' };
    }
    
    return { valid: true, email };
}

function validateGameData(gameData, gameSchema) {
    if (!gameSchema || !gameSchema.fields) {
        return { valid: true, data: gameData }; // No validation required
    }
    
    const errors = [];
    const validatedData = {};
    
    for (const field of gameSchema.fields) {
        if (field.required && !gameData[field.key]) {
            errors.push(`${field.label} es requerido`);
        } else if (gameData[field.key]) {
            // Basic type validation
            if (field.type === 'number') {
                const num = parseFloat(gameData[field.key]);
                if (isNaN(num)) {
                    errors.push(`${field.label} debe ser un número`);
                } else {
                    validatedData[field.key] = num;
                }
            } else {
                validatedData[field.key] = gameData[field.key].toString();
            }
        }
    }
    
    if (errors.length > 0) {
        return { valid: false, errors };
    }
    
    return { valid: true, data: validatedData };
}

module.exports = {
    validatePhone,
    validateAmount,
    validateTransactionId,
    validateEmail,
    validateGameData
};
