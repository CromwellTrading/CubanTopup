// game_recharges.js
require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');

// ============================================
// CONFIGURACIÓN
// ============================================

const LIOGAMES_SECRET = process.env.LIOGAMES_SECRET || '36b82f46524b0520808450eda62bd1fb';
const LIOGAMES_MEMBER_CODE = process.env.LIOGAMES_MEMBER_CODE || 'M260119RKVLDNBGMY';
const LIOGAMES_API_BASE = 'https://api.liogames.com/wp-json/liogames/v1';

// Tasas de cambio dinámicas
const USDT_RATE_0_30 = parseFloat(process.env.USDT_RATE_0_30 || 650); // 0-30 USDT
const USDT_RATE_30_PLUS = parseFloat(process.env.USDT_RATE_30_PLUS || 680); // >30 USDT
const SALDO_MOVIL_RATE = parseFloat(process.env.SALDO_MOVIL_RATE || 2.1); // División para saldo móvil
const MIN_CWS_USE = parseInt(process.env.MIN_CWS_USE || 100);

// ============================================
// DATOS DE JUEGOS (Extraídos de tu lista)
// ============================================

const GAMES = {
    // Arena Breakout
    66584: {
        name: "Arena Breakout (MOBILE)",
        variations: {
            528315: { name: "60 + 6 Bonds", price_gold: 0.81 },
            528316: { name: "310 + 25 Bonds", price_gold: 3.97 },
            528317: { name: "630 + 45 Bonds", price_gold: 7.93 },
            528318: { name: "1580 + 110 Bonds", price_gold: 19.82 },
            528319: { name: "3200 + 200 Bonds", price_gold: 39.58 },
            528320: { name: "6500 + 320 Bonds", price_gold: 76.80 },
            528321: { name: "Beginners Select (PACK)", price_gold: 0.82 },
            528322: { name: "Bulletproof safety container (30 days)", price_gold: 2.40 },
            528323: { name: "Advanced Battle Pass", price_gold: 3.99 },
            528324: { name: "Composite safety container (30 days)", price_gold: 7.16 },
            528325: { name: "Premium Battle Pass", price_gold: 11.87 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "User ID", required: true, type: "text" },
                { key: "server_id", label: "Server ID (Número)", required: true, type: "text" }
            ]
        }
    },
    // Zenless Zone Zero
    67528: {
        name: "Zenless Zone Zero",
        variations: {
            67532: { name: "Inter-Knot Membership", price_gold: 4.49 },
            67533: { name: "60 Monochrome", price_gold: 0.88 },
            67534: { name: "300 + 30 Monochrome", price_gold: 4.49 },
            67535: { name: "980 + 110 Monochrome", price_gold: 13.54 },
            67536: { name: "1980 + 260 Monochrome", price_gold: 29.35 },
            67537: { name: "3280 + 600 Monochrome", price_gold: 45.17 },
            67538: { name: "6480 + 1600 Monochrome", price_gold: 90.36 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "UID", required: true, type: "text" },
                { key: "server_id", label: "Servidor", required: true, type: "select", options: [
                    { value: "prod_gf_global", label: "Global" },
                    { value: "prod_gf_cn", label: "China" }
                ]}
            ]
        }
    },
    // Wuthering Waves
    71886: {
        name: "Wuthering Waves",
        variations: {
            456266: { name: "60 Lunites", price_gold: 0.96 },
            456267: { name: "330 Lunites (300 + 30 Bonus)", price_gold: 4.84 },
            456268: { name: "1090 Lunites (980 + 110 Bonus)", price_gold: 14.67 },
            456269: { name: "2240 Lunites (1980 + 260 Bonus)", price_gold: 29.00 },
            456270: { name: "3880 Lunites (3280 + 600 Bonus)", price_gold: 49.80 },
            456271: { name: "8080 Lunites (6480 + 1600 Bonus)", price_gold: 97.13 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "UID", required: true, type: "text" },
                { key: "server_id", label: "Servidor", required: true, type: "select", options: [
                    { value: "global", label: "Global" },
                    { value: "asia", label: "Asia" }
                ]}
            ]
        }
    },
    // Mobile Legends
    65482: {
        name: "Mobile Legends",
        variations: {
            83222: { name: "Diamante × 500 + 65 (doble)", price_gold: 7.16 },
            83223: { name: "Diamante × 250 + 25 (doble)", price_gold: 3.49 },
            83224: { name: "Diamante × 150 +15 (doble)", price_gold: 2.17 },
            83225: { name: "Diamante × 50 + 5 (doble)", price_gold: 0.73 },
            77731: { name: "Diamante × 78 + 8", price_gold: 1.13 },
            77732: { name: "Diamante × 156 +16", price_gold: 2.25 },
            77733: { name: "Diamante × 234 +23", price_gold: 3.28 },
            77734: { name: "Diamante×625 +81", price_gold: 8.87 },
            77735: { name: "Diamante × 1860 +335", price_gold: 26.84 },
            77736: { name: "Diamante × 3099 +589", price_gold: 46.02 },
            77737: { name: "Pasaje del Crepúsculo", price_gold: 7.19 },
            77738: { name: "Pase semanal Diamante", price_gold: 1.43 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "User ID", required: true, type: "text" },
                { key: "server_id", label: "Server ID (Número)", required: true, type: "text" }
            ]
        }
    },
    // Free Fire Global
    65871: {
        name: "Free Fire Global",
        variations: {
            462737: { name: "Membresía mensual", price_gold: 8.49 },
            462738: { name: "Membresía semanal", price_gold: 1.81 },
            65880: { name: "100 diamantes", price_gold: 0.92 },
            65881: { name: "310 diamantes", price_gold: 2.77 },
            65882: { name: "530 diamantes", price_gold: 4.26 },
            65883: { name: "1080 diamantes", price_gold: 8.52 },
            65884: { name: "2200 diamantes", price_gold: 17.35 },
            65885: { name: "5600 diamantes", price_gold: 41.51 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "User ID", required: true, type: "text" }
                // Free Fire no requiere server_id
            ]
        }
    },
    // Genshin Impact
    66452: {
        name: "Genshin Impact",
        variations: {
            394118: { name: "60 Cristales Génesis", price_gold: 0.65 },
            394119: { name: "120 Cristales Génesis", price_gold: 1.29 },
            394120: { name: "300 + 30 Cristales Génesis", price_gold: 3.25 },
            394121: { name: "980+110 Cristales Génesis", price_gold: 9.93 },
            394122: { name: "1980+260 Cristales Génesis", price_gold: 20.80 },
            394123: { name: "3280 + 600 Cristales Génesis", price_gold: 33.67 },
            394124: { name: "6480 + 1600 Cristales Génesis", price_gold: 64.24 },
            394125: { name: "9760 + 2200 Cristales Génesis", price_gold: 100.58 },
            394126: { name: "Bendición de la Luna Welkin", price_gold: 3.20 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "UID", required: true, type: "text" },
                { key: "server_id", label: "Servidor", required: true, type: "select", options: [
                    { value: "os_asia", label: "Asia (os_asia)" },
                    { value: "os_cht", label: "TW/HK/MO (os_cht)" },
                    { value: "os_euro", label: "Europa (os_euro)" },
                    { value: "os_usa", label: "América (os_usa)" }
                ]}
            ]
        }
    },
    // PUBG Mobile
    66719: {
        name: "PUBG Mobile (Global)",
        variations: {
            66726: { name: "60 UC", price_gold: 0.84 },
            66727: { name: "300 + 25 UC", price_gold: 4.24 },
            66728: { name: "600 + 60 UC", price_gold: 8.50 },
            66729: { name: "1500 + 300 UC", price_gold: 21.26 },
            66730: { name: "3000 + 850 UC", price_gold: 42.52 },
            66731: { name: "6000 + 2100 UC", price_gold: 85.06 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "User ID", required: true, type: "text" }
                // PUBG no requiere server_id
            ]
        }
    },
    // Honor de Reyes
    67795: {
        name: "Honor de Reyes",
        variations: {
            397753: { name: "16 Fichas", price_gold: 0.19 },
            397754: { name: "80 Fichas", price_gold: 0.85 },
            397755: { name: "240 Fichas", price_gold: 2.57 },
            397756: { name: "400 Fichas", price_gold: 4.30 },
            397757: { name: "560 Fichas", price_gold: 6.01 },
            397758: { name: "800 + 30 Fichas", price_gold: 8.52 },
            397759: { name: "1200 + 45 Fichas", price_gold: 12.79 },
            397760: { name: "2400 + 108 Fichas", price_gold: 25.56 },
            397761: { name: "4000 + 180 Fichas", price_gold: 42.21 },
            397762: { name: "8000 + 360 Fichas", price_gold: 84.42 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "User ID", required: true, type: "text" }
                // Honor de Reyes no requiere server_id
            ]
        }
    },
    // Golpe de Sangre
    68075: {
        name: "Golpe de Sangre",
        variations: {
            394594: { name: "100 + 5 de oro", price_gold: 0.67 },
            394595: { name: "200 + 10 de oro", price_gold: 1.33 },
            394596: { name: "300 + 20 de oro", price_gold: 1.97 },
            394597: { name: "500 + 40 de oro", price_gold: 3.28 },
            394598: { name: "800 + 60 de oro", price_gold: 5.26 },
            394599: { name: "1000 + 100 de oro", price_gold: 6.57 },
            394600: { name: "2000 + 200 de oro", price_gold: 13.14 },
            394601: { name: "3000 + 360 de oro", price_gold: 19.70 },
            394602: { name: "5000 + 800 de oro", price_gold: 32.84 },
            394603: { name: "7000 + 1060 de oro", price_gold: 45.97 },
            394604: { name: "Ultra aspecto afortunado (cofre)", price_gold: 0.40 },
            394605: { name: "Subir de nivel (Pase)", price_gold: 1.58 },
            394606: { name: "Golpe premium (Pase)", price_gold: 7.11 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "User ID", required: true, type: "text" }
                // Golpe de Sangre no requiere server_id
            ]
        }
    },
    // Honkai: Star Rail
    66557: {
        name: "Honkai: Star Rail",
        variations: {
            66561: { name: "60 Fragmento onírico", price_gold: 0.62 },
            66562: { name: "300 + 30 Fragmento onírico", price_gold: 3.19 },
            66563: { name: "980 + 110 Fragmento onírico", price_gold: 9.74 },
            66564: { name: "1980 + 260 Fragmento onírico", price_gold: 19.98 },
            66565: { name: "3280 + 600 Fragmento onírico", price_gold: 32.53 },
            66566: { name: "6480 + 1600 Fragmento onírico", price_gold: 63.52 },
            66567: { name: "Pase de suministro exprés", price_gold: 3.19 }
        },
        input_schema: {
            fields: [
                { key: "user_id", label: "UID", required: true, type: "text" },
                { key: "server_id", label: "Servidor", required: true, type: "select", options: [
                    { value: "prod_official_asia", label: "Asia" },
                    { value: "prod_official_usa", label: "América" },
                    { value: "prod_official_eur", label: "Europa" },
                    { value: "prod_official_cht", label: "TW/HK/MO" }
                ]}
            ]
        }
    }
};

// ============================================
// FUNCIONES DE API LIOGAMES
// ============================================

// Firmar solicitud para LioGames
function signRequest(payload) {
    const body = JSON.stringify(payload);
    return crypto.createHmac('sha256', LIOGAMES_SECRET).update(body).digest('hex');
}

// Consultar saldo en LioGames
async function checkLioGamesBalance() {
    try {
        const payload = { member_code: LIOGAMES_MEMBER_CODE };
        const signature = signRequest(payload);
        
        const response = await axios.post(`${LIOGAMES_API_BASE}/balance`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-liog-sign': signature
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('Error consultando saldo LioGames:', error.response?.data || error.message);
        throw error;
    }
}

// Consultar precio con descuento
async function checkPrice(product_id, variation_id) {
    try {
        const payload = { 
            member_code: LIOGAMES_MEMBER_CODE,
            product_id: parseInt(product_id),
            variation_id: parseInt(variation_id)
        };
        const signature = signRequest(payload);
        
        const response = await axios.post(`${LIOGAMES_API_BASE}/price-check`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-liog-sign': signature
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('Error consultando precio:', error.response?.data || error.message);
        throw error;
    }
}

// Crear orden en LioGames
async function createOrder(orderData) {
    try {
        const payload = {
            member_code: LIOGAMES_MEMBER_CODE,
            product_id: parseInt(orderData.product_id),
            variation_id: parseInt(orderData.variation_id),
            user_id: orderData.user_id,
            server_id: orderData.server_id || null,
            quantity: orderData.quantity || 1,
            partner_ref: orderData.partner_ref || `CROMWELL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        const signature = signRequest(payload);
        
        const response = await axios.post(`${LIOGAMES_API_BASE}/order-create`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-liog-sign': signature
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('Error creando orden:', error.response?.data || error.message);
        throw error;
    }
}

// Consultar estado de orden
async function checkOrderStatus(order_id, partner_ref) {
    try {
        const payload = { member_code: LIOGAMES_MEMBER_CODE };
        if (order_id) payload.order_id = order_id;
        if (partner_ref) payload.partner_ref = partner_ref;
        
        const signature = signRequest(payload);
        
        const response = await axios.post(`${LIOGAMES_API_BASE}/order-status`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-liog-sign': signature
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('Error consultando estado:', error.response?.data || error.message);
        throw error;
    }
}

// Consultar esquema de producto
async function getProductSchema(product_id, variation_id) {
    try {
        const response = await axios.get(`${LIOGAMES_API_BASE}/product-schema`, {
            params: {
                product_id: parseInt(product_id),
                variation_id: parseInt(variation_id)
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('Error consultando esquema:', error.response?.data || error.message);
        throw error;
    }
}

// ============================================
// FUNCIONES DE CONVERSIÓN DE MONEDA
// ============================================

// Calcular precio en CUP según cantidad de USDT
function calculateCupFromUsdt(usdtAmount) {
    if (usdtAmount <= 30) {
        return usdtAmount * USDT_RATE_0_30;
    } else {
        return (30 * USDT_RATE_0_30) + ((usdtAmount - 30) * USDT_RATE_30_PLUS);
    }
}

// Calcular precio en Saldo Móvil
function calculateSaldoMovilFromCup(cupAmount) {
    const raw = cupAmount / SALDO_MOVIL_RATE;
    return Math.ceil(raw / 5) * 5; // Redondear al múltiplo de 5 más cercano hacia arriba
}

// Calcular precio en CWS (1 CWS = 10 CUP de descuento)
function calculateCwsFromCup(cupAmount) {
    return Math.floor(cupAmount / 10);
}

// Convertir precios a diferentes métodos de pago
function convertPrice(usdtPrice, method) {
    const cupPrice = calculateCupFromUsdt(usdtPrice);
    
    switch (method) {
        case 'cup':
            return cupPrice;
        case 'saldo':
            return calculateSaldoMovilFromCup(cupPrice);
        case 'cws':
            return calculateCwsFromCup(cupPrice);
        default:
            return cupPrice;
    }
}

// ============================================
// TECLADOS PARA EL BOT
// ============================================

// Teclado principal de juegos
function createGamesListKeyboard() {
    const games = Object.entries(GAMES);
    const rows = [];
    
    // Crear filas de 2 botones cada una
    for (let i = 0; i < games.length; i += 2) {
        const row = [];
        row.push({ text: games[i][1].name, callback_data: `game_select:${games[i][0]}` });
        
        if (games[i + 1]) {
            row.push({ text: games[i + 1][1].name, callback_data: `game_select:${games[i + 1][0]}` });
        }
        
        rows.push(row);
    }
    
    // Añadir botón de volver
    rows.push([{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]);
    
    return { inline_keyboard: rows };
}

// Teclado de variaciones de un juego
function createVariationsKeyboard(gameId) {
    const game = GAMES[gameId];
    if (!game) return null;
    
    const variations = Object.entries(game.variations);
    const rows = [];
    
    // Agrupar variaciones en filas de 2
    for (let i = 0; i < variations.length; i += 2) {
        const row = [];
        const [varId, varData] = variations[i];
        row.push({ 
            text: `${varData.name} - $${varData.price_gold}`, 
            callback_data: `var_select:${gameId}:${varId}` 
        });
        
        if (variations[i + 1]) {
            const [varId2, varData2] = variations[i + 1];
            row.push({ 
                text: `${varData2.name} - $${varData2.price_gold}`, 
                callback_data: `var_select:${gameId}:${varId2}` 
            });
        }
        
        rows.push(row);
    }
    
    // Añadir botones de navegación
    rows.push([
        { text: '🔙 Lista de Juegos', callback_data: 'games_menu' },
        { text: '🏠 Inicio', callback_data: 'start_back' }
    ]);
    
    return { inline_keyboard: rows };
}

// Teclado de métodos de pago
function createPaymentMethodsKeyboard(gameId, varId, usdtPrice) {
    const cupPrice = calculateCupFromUsdt(usdtPrice);
    const saldoPrice = calculateSaldoMovilFromCup(cupPrice);
    const cwsPrice = calculateCwsFromCup(cupPrice);
    
    const rows = [
        [{ 
            text: `💳 Pagar con CUP - $${cupPrice.toFixed(2)}`, 
            callback_data: `pay_method:${gameId}:${varId}:cup:${cupPrice}` 
        }],
        [{ 
            text: `📱 Pagar con Saldo Móvil - $${saldoPrice.toFixed(2)}`, 
            callback_data: `pay_method:${gameId}:${varId}:saldo:${saldoPrice}` 
        }]
    ];
    
    // Solo mostrar CWS si el precio es suficiente
    if (cwsPrice >= MIN_CWS_USE) {
        rows.push([{ 
            text: `🎫 Pagar con CWS - ${cwsPrice} CWS`, 
            callback_data: `pay_method:${gameId}:${varId}:cws:${cwsPrice}` 
        }]);
    }
    
    rows.push([
        { text: '🔙 Atrás', callback_data: `game_select:${gameId}` },
        { text: '🏠 Inicio', callback_data: 'start_back' }
    ]);
    
    return { inline_keyboard: rows };
}

// Teclado para confirmar compra
function createConfirmKeyboard(gameId, varId, method, price) {
    return {
        inline_keyboard: [
            [
                { text: '✅ Confirmar Compra', callback_data: `confirm_purchase:${gameId}:${varId}:${method}:${price}` },
                { text: '❌ Cancelar', callback_data: `var_select:${gameId}:${varId}` }
            ]
        ]
    };
}

// Teclado para ingresar datos
function createInputKeyboard(gameId, varId, fieldIndex) {
    const rows = [];
    
    if (fieldIndex > 0) {
        rows.push([{ text: '🔙 Campo Anterior', callback_data: `input_back:${gameId}:${varId}:${fieldIndex-1}` }]);
    }
    
    rows.push([{ text: '🏠 Cancelar y Volver al Inicio', callback_data: 'start_back' }]);
    
    return { inline_keyboard: rows };
}

// Teclado después de compra exitosa
function createPostPurchaseKeyboard(orderId) {
    return {
        inline_keyboard: [
            [{ text: '🔄 Ver Estado', callback_data: `check_order:${orderId}` }],
            [{ text: '🎮 Otra Recarga', callback_data: 'games_menu' }],
            [{ text: '🏠 Inicio', callback_data: 'start_back' }]
        ]
    };
}

// ============================================
// MANEJO DE RECARGAS DE JUEGOS
// ============================================

class GameRechargeHandler {
    constructor(bot, supabase) {
        this.bot = bot;
        this.supabase = supabase;
        this.userSessions = {};
    }
    
    // Iniciar sesión de recarga para usuario
    initUserSession(chatId) {
        if (!this.userSessions[chatId]) {
            this.userSessions[chatId] = {
                currentStep: null,
                selectedGame: null,
                selectedVariation: null,
                paymentMethod: null,
                paymentAmount: null,
                inputData: {},
                currentInputField: 0
            };
        }
        return this.userSessions[chatId];
    }
    
    // Limpiar sesión
    clearUserSession(chatId) {
        delete this.userSessions[chatId];
    }
    
    // Mostrar lista de juegos
    async showGamesList(chatId, messageId = null) {
        const message = `🎮 *Selecciona un Juego*\n\n` +
            `Aquí puedes recargar saldo en tus juegos favoritos.\n\n` +
            `*Métodos de pago aceptados:*\n` +
            `💳 CUP - Saldo en tu billetera\n` +
            `📱 Saldo Móvil - Saldo en tu billetera\n` +
            `🎫 CWS - Tokens (mínimo ${MIN_CWS_USE} CWS)\n\n` +
            `*Conversión:*\n` +
            `• 1 CWS = $10 CUP de descuento\n` +
            `• Mínimo para usar CWS: ${MIN_CWS_USE} CWS`;
        
        const keyboard = createGamesListKeyboard();
        
        if (messageId) {
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    }
    
    // Mostrar variaciones de un juego
    async showGameVariations(chatId, messageId, gameId) {
        const session = this.initUserSession(chatId);
        const game = GAMES[gameId];
        
        if (!game) {
            await this.bot.editMessageText('❌ Juego no encontrado.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'games_menu' }]] }
            });
            return;
        }
        
        session.selectedGame = gameId;
        session.currentStep = 'selecting_variation';
        
        const message = `🎮 *${game.name}*\n\n` +
            `Selecciona el paquete que deseas comprar:\n\n` +
            `*Precios en USDT (nivel GOLD):*`;
        
        const keyboard = createVariationsKeyboard(gameId);
        
        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
    
    // Mostrar métodos de pago para una variación
    async showPaymentMethods(chatId, messageId, gameId, varId) {
        const session = this.initUserSession(chatId);
        const game = GAMES[gameId];
        const variation = game?.variations[varId];
        
        if (!game || !variation) {
            await this.bot.editMessageText('❌ Variación no encontrada.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: `game_select:${gameId}` }]] }
            });
            return;
        }
        
        session.selectedVariation = varId;
        session.currentStep = 'selecting_payment';
        
        // Obtener precio actualizado
        let usdtPrice = variation.price_gold;
        try {
            const priceData = await checkPrice(gameId, varId);
            if (priceData.ok && priceData.data?.price?.discounted) {
                usdtPrice = priceData.data.price.discounted;
            }
        } catch (error) {
            console.log('Usando precio local, error al consultar:', error.message);
        }
        
        const cupPrice = calculateCupFromUsdt(usdtPrice);
        const saldoPrice = calculateSaldoMovilFromCup(cupPrice);
        
        const message = `💰 *${game.name}*\n` +
            `📦 *Paquete:* ${variation.name}\n\n` +
            `*Precios:*\n` +
            `🪙 USDT: $${usdtPrice.toFixed(2)} (GOLD)\n` +
            `💳 CUP: $${cupPrice.toFixed(2)}\n` +
            `📱 Saldo Móvil: $${saldoPrice.toFixed(2)}\n\n` +
            `Selecciona el método de pago:`;
        
        const keyboard = createPaymentMethodsKeyboard(gameId, varId, usdtPrice);
        
        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
    
    // Solicitar datos del usuario para el juego
    async requestUserData(chatId, messageId, gameId, varId, method, price) {
        const session = this.initUserSession(chatId);
        const game = GAMES[gameId];
        
        if (!game) {
            await this.bot.editMessageText('❌ Juego no encontrado.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'games_menu' }]] }
            });
            return;
        }
        
        session.paymentMethod = method;
        session.paymentAmount = parseFloat(price);
        session.currentStep = 'inputting_data';
        session.currentInputField = 0;
        session.inputData = {};
        
        // Mostrar primer campo
        await this.showInputField(chatId, messageId, gameId, varId, 0);
    }
    
    // Mostrar campo de entrada específico
    async showInputField(chatId, messageId, gameId, varId, fieldIndex) {
        const session = this.userSessions[chatId];
        const game = GAMES[gameId];
        const field = game.input_schema.fields[fieldIndex];
        
        if (!field) {
            // Todos los campos completados, mostrar resumen
            await this.showOrderSummary(chatId, messageId, gameId, varId);
            return;
        }
        
        session.currentInputField = fieldIndex;
        
        let message = `📝 *Ingresa los datos para ${game.name}*\n\n`;
        message += `*Campo ${fieldIndex + 1}/${game.input_schema.fields.length}:*\n`;
        message += `*${field.label}*`;
        
        if (field.type === 'select' && field.options) {
            message += `\n\nOpciones disponibles:\n`;
            field.options.forEach(opt => {
                message += `• ${opt.label} → *${opt.value}*\n`;
            });
            message += `\nEscribe el valor exacto (ej: ${field.options[0].value}):`;
        } else {
            message += `\n\nEscribe el ${field.label.toLowerCase()}:`;
        }
        
        if (field.required) {
            message += `\n⚠️ *Requerido*`;
        }
        
        const keyboard = createInputKeyboard(gameId, varId, fieldIndex);
        
        if (messageId) {
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    }
    
    // Procesar entrada de datos
    async processInput(chatId, text, messageId = null) {
        const session = this.userSessions[chatId];
        
        if (!session || session.currentStep !== 'inputting_data') {
            return false;
        }
        
        const gameId = session.selectedGame;
        const varId = session.selectedVariation;
        const game = GAMES[gameId];
        const fieldIndex = session.currentInputField;
        const field = game.input_schema.fields[fieldIndex];
        
        // Validar entrada
        if (field.type === 'select' && field.options) {
            const validOptions = field.options.map(opt => opt.value);
            if (!validOptions.includes(text.trim())) {
                await this.bot.sendMessage(chatId, 
                    `❌ Valor no válido. Debe ser uno de: ${validOptions.join(', ')}`
                );
                return true;
            }
        }
        
        // Guardar dato
        session.inputData[field.key] = text.trim();
        
        // Mostrar siguiente campo o resumen
        const nextFieldIndex = fieldIndex + 1;
        if (nextFieldIndex < game.input_schema.fields.length) {
            await this.showInputField(chatId, messageId, gameId, varId, nextFieldIndex);
        } else {
            await this.showOrderSummary(chatId, messageId, gameId, varId);
        }
        
        return true;
    }
    
    // Mostrar resumen de la orden
    async showOrderSummary(chatId, messageId, gameId, varId) {
        const session = this.userSessions[chatId];
        const game = GAMES[gameId];
        const variation = game.variations[varId];
        
        let usdtPrice = variation.price_gold;
        try {
            const priceData = await checkPrice(gameId, varId);
            if (priceData.ok && priceData.data?.price?.discounted) {
                usdtPrice = priceData.data.price.discounted;
            }
        } catch (error) {
            console.log('Usando precio local para resumen');
        }
        
        const cupPrice = calculateCupFromUsdt(usdtPrice);
        const method = session.paymentMethod;
        const amount = session.paymentAmount;
        
        let methodText = '';
        let methodSymbol = '';
        
        switch (method) {
            case 'cup':
                methodText = 'CUP';
                methodSymbol = '💳';
                break;
            case 'saldo':
                methodText = 'Saldo Móvil';
                methodSymbol = '📱';
                break;
            case 'cws':
                methodText = 'CWS';
                methodSymbol = '🎫';
                break;
        }
        
        let message = `📋 *Resumen de tu Pedido*\n\n` +
            `🎮 *Juego:* ${game.name}\n` +
            `📦 *Paquete:* ${variation.name}\n` +
            `${methodSymbol} *Método de pago:* ${methodText}\n` +
            `💰 *Monto a pagar:* ${method === 'cws' ? `${amount} CWS` : `$${amount.toFixed(2)} ${methodText}`}\n\n` +
            `*Datos del juego:*\n`;
        
        // Mostrar datos ingresados
        Object.entries(session.inputData).forEach(([key, value]) => {
            const field = game.input_schema.fields.find(f => f.key === key);
            message += `• *${field?.label || key}:* \`${value}\`\n`;
        });
        
        message += `\n¿Confirmas la compra?`;
        
        const keyboard = createConfirmKeyboard(gameId, varId, method, amount);
        
        if (messageId) {
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
        
        session.currentStep = 'confirming_order';
    }
    
    // Procesar confirmación de compra
    async processConfirmation(chatId, messageId, gameId, varId, method, price) {
        const session = this.userSessions[chatId];
        
        if (!session) {
            await this.bot.editMessageText('❌ Sesión expirada. Por favor, inicia de nuevo.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🏠 Inicio', callback_data: 'start_back' }]] }
            });
            return;
        }
        
        // 1. Verificar saldo del usuario
        const { data: user, error: userError } = await this.supabase
            .from('users')
            .select('*')
            .eq('telegram_id', chatId)
            .single();
        
        if (userError || !user) {
            await this.bot.editMessageText('❌ No se encontró tu usuario.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🏠 Inicio', callback_data: 'start_back' }]] }
            });
            return;
        }
        
        let hasEnoughBalance = false;
        let balanceField = '';
        let currentBalance = 0;
        
        switch (method) {
            case 'cup':
                balanceField = 'balance_cup';
                currentBalance = user.balance_cup || 0;
                break;
            case 'saldo':
                balanceField = 'balance_saldo';
                currentBalance = user.balance_saldo || 0;
                break;
            case 'cws':
                balanceField = 'tokens_cws';
                currentBalance = user.tokens_cws || 0;
                break;
        }
        
        if (currentBalance >= price) {
            hasEnoughBalance = true;
        }
        
        if (!hasEnoughBalance) {
            await this.bot.editMessageText(
                `❌ *Saldo insuficiente*\n\n` +
                `Necesitas: ${method === 'cws' ? `${price} CWS` : `$${price.toFixed(2)} ${method}`}\n` +
                `Tienes: ${method === 'cws' ? `${currentBalance} CWS` : `$${currentBalance.toFixed(2)} ${method}`}\n\n` +
                `Por favor, recarga tu billetera primero.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { 
                        inline_keyboard: [
                            [{ text: '💰 Recargar Billetera', callback_data: 'recharge_menu' }],
                            [{ text: '🏠 Inicio', callback_data: 'start_back' }]
                        ]
                    }
                }
            );
            return;
        }
        
        // 2. Crear orden en LioGames
        const game = GAMES[gameId];
        const variation = game.variations[varId];
        
        try {
            // Obtener precio actualizado
            let usdtPrice = variation.price_gold;
            const priceData = await checkPrice(gameId, varId);
            if (priceData.ok && priceData.data?.price?.discounted) {
                usdtPrice = priceData.data.price.discounted;
            }
            
            await this.bot.editMessageText('⏳ *Creando orden en LioGames...*', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            });
            
            // Crear orden
            const orderData = {
                product_id: gameId,
                variation_id: varId,
                user_id: session.inputData.user_id,
                server_id: session.inputData.server_id || null,
                quantity: 1,
                partner_ref: `CROMWELL_${chatId}_${Date.now()}`
            };
            
            const orderResult = await createOrder(orderData);
            
            if (!orderResult.ok) {
                throw new Error(orderResult.message || 'Error creando orden');
            }
            
            // 3. Descontar saldo del usuario
            const updates = {};
            updates[balanceField] = currentBalance - price;
            
            await this.supabase
                .from('users')
                .update(updates)
                .eq('telegram_id', chatId);
            
            // 4. Guardar transacción
            await this.supabase
                .from('transactions')
                .insert({
                    user_id: chatId,
                    type: 'GAME_RECHARGE',
                    currency: method,
                    amount: -price, // Negativo porque es un gasto
                    status: 'completed',
                    tx_id: orderResult.data.order_id,
                    partner_ref: orderData.partner_ref,
                    details: {
                        game: game.name,
                        package: variation.name,
                        game_data: session.inputData,
                        lio_order_id: orderResult.data.order_id,
                        usdt_price: usdtPrice,
                        cup_price: calculateCupFromUsdt(usdtPrice)
                    },
                    completed_at: new Date().toISOString()
                });
            
            // 5. Notificar éxito
            let successMessage = `✅ *¡Recarga exitosa!*\n\n` +
                `🎮 *Juego:* ${game.name}\n` +
                `📦 *Paquete:* ${variation.name}\n` +
                `💰 *Precio USDT:* $${usdtPrice.toFixed(2)}\n` +
                `${method === 'cws' ? '🎫' : method === 'saldo' ? '📱' : '💳'} *Pagado con:* ${method === 'cws' ? `${price} CWS` : `$${price.toFixed(2)} ${method}`}\n` +
                `🆔 *ID de orden:* ${orderResult.data.order_id}\n\n` +
                `*Datos ingresados:*\n`;
            
            Object.entries(session.inputData).forEach(([key, value]) => {
                const field = game.input_schema.fields.find(f => f.key === key);
                if (field) {
                    successMessage += `• *${field.label}:* \`${value}\`\n`;
                }
            });
            
            successMessage += `\n⏳ *Estado:* ${orderResult.data.status_label}\n\n` +
                `La recarga se procesará en breve.`;
            
            await this.bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: createPostPurchaseKeyboard(orderResult.data.order_id)
            });
            
            // 6. Limpiar sesión
            this.clearUserSession(chatId);
            
            // 7. Notificar al admin
            if (process.env.ADMIN_GROUP) {
                const adminMsg = `🎮 *NUEVA RECARGA DE JUEGO*\n\n` +
                    `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                    `🆔 ID: ${chatId}\n` +
                    `🎮 Juego: ${game.name}\n` +
                    `📦 Paquete: ${variation.name}\n` +
                    `💰 Precio USDT: $${usdtPrice.toFixed(2)}\n` +
                    `💳 Pagado con: ${method === 'cws' ? `${price} CWS` : `$${price.toFixed(2)} ${method}`}\n` +
                    `🆔 Orden LioGames: ${orderResult.data.order_id}`;
                
                await this.bot.sendMessage(process.env.ADMIN_GROUP, adminMsg, { parse_mode: 'Markdown' });
            }
            
        } catch (error) {
            console.error('Error procesando recarga:', error);
            
            await this.bot.editMessageText(
                `❌ *Error procesando la recarga*\n\n` +
                `Error: ${error.message}\n\n` +
                `Por favor, intenta de nuevo o contacta al administrador.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { 
                        inline_keyboard: [
                            [{ text: '🔄 Intentar de Nuevo', callback_data: `var_select:${gameId}:${varId}` }],
                            [{ text: '🏠 Inicio', callback_data: 'start_back' }]
                        ]
                    }
                }
            );
        }
    }
    
    // Verificar estado de una orden
    async checkOrderStatus(chatId, messageId, orderId) {
        try {
            const statusData = await checkOrderStatus(orderId);
            
            let message = `📊 *Estado de la Orden #${orderId}*\n\n`;
            
            if (statusData.ok && statusData.data) {
                const order = statusData.data;
                message += `📦 *Estado:* ${order.status_label}\n`;
                message += `📅 *Actualizado:* ${new Date(order.updated_at).toLocaleString()}\n`;
                
                if (order.result === 'SUCCESS') {
                    message += `\n✅ *¡Recarga completada exitosamente!*`;
                } else if (order.result === 'PROCESSING') {
                    message += `\n⏳ *La recarga está en proceso...*`;
                } else if (order.result === 'FAILED') {
                    message += `\n❌ *La recarga falló. Contacta al administrador.*`;
                }
            } else {
                message += `❌ No se pudo obtener el estado de la orden.`;
            }
            
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: '🔄 Actualizar', callback_data: `check_order:${orderId}` }],
                        [{ text: '🏠 Inicio', callback_data: 'start_back' }]
                    ]
                }
            });
            
        } catch (error) {
            await this.bot.editMessageText(
                `❌ Error consultando el estado: ${error.message}`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { 
                        inline_keyboard: [
                            [{ text: '🏠 Inicio', callback_data: 'start_back' }]
                        ]
                    }
                }
            );
        }
    }
    
    // Manejar callback del bot
    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;
        
        // Dividir el callback_data
        const parts = data.split(':');
        const action = parts[0];
        const param1 = parts[1];
        const param2 = parts[2];
        const param3 = parts[3];
        const param4 = parts[4];
        
        try {
            await this.bot.answerCallbackQuery(query.id);
            
            switch (action) {
                case 'games_menu':
                    await this.showGamesList(chatId, messageId);
                    break;
                    
                case 'game_select':
                    await this.showGameVariations(chatId, messageId, param1);
                    break;
                    
                case 'var_select':
                    await this.showPaymentMethods(chatId, messageId, param1, param2);
                    break;
                    
                case 'pay_method':
                    await this.requestUserData(chatId, messageId, param1, param2, param3, param4);
                    break;
                    
                case 'input_back':
                    await this.showInputField(chatId, messageId, param1, param2, parseInt(param3));
                    break;
                    
                case 'confirm_purchase':
                    await this.processConfirmation(chatId, messageId, param1, param2, param3, param4);
                    break;
                    
                case 'check_order':
                    await this.checkOrderStatus(chatId, messageId, param1);
                    break;
                    
                default:
                    console.log(`Acción no manejada en game_recharges: ${action}`);
                    return false; // No manejado
            }
            
            return true; // Manejado
        } catch (error) {
            console.error('Error en callback de game_recharges:', error);
            await this.bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.');
            return true;
        }
    }
    
    // Manejar mensajes de texto (para entrada de datos)
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const text = msg.text;
        
        if (!text || text.startsWith('/')) {
            return false;
        }
        
        const session = this.userSessions[chatId];
        if (session && session.currentStep === 'inputting_data') {
            await this.processInput(chatId, text);
            return true;
        }
        
        return false;
    }
}

// ============================================
// EXPORTAR HANDLER
// ============================================

module.exports = GameRechargeHandler;
