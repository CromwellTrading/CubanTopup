require('dotenv').config();

// ============================================
// DEPENDENCIES
// ============================================
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bodyParser = require('body-parser');
const Web3 = require('web3');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');

// ============================================
// CONFIGURATION FROM .ENV
// ============================================

// Basic configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DB_URL = process.env.DB_URL;
const DB_KEY = process.env.DB_KEY;
const WEBHOOK_SECRET_KEY = process.env.WEBHOOK_SECRET_KEY;

// Payment configuration
const MINIMO_CUP = parseFloat(process.env.MINIMO_CUP || 1000);
const MINIMO_SALDO = parseFloat(process.env.MINIMO_SALDO || 500);
const MINIMO_USDT = parseFloat(process.env.MINIMO_USDT || 10);
const MAXIMO_CUP = parseFloat(process.env.MAXIMO_CUP || 50000);

// Payment information
const PAGO_CUP_TARJETA = process.env.PAGO_CUP_TARJETA;
const PAGO_SALDO_MOVIL = process.env.PAGO_SALDO_MOVIL;
const PAGO_USDT_ADDRESS = process.env.PAGO_USDT_ADDRESS;
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || '';

// Admin configuration
const ADMIN_CHAT_ID = process.env.ADMIN_GROUP;

// Server configuration
const PORT = process.env.PORT || 3000;
const WEB_PORT = process.env.WEB_PORT || 8080;

// Token configuration
const CWS_PER_100_SALDO = 10;
const CWT_PER_10_USDT = 0.5;
const MIN_CWT_USE = 5;
const MIN_CWS_USE = 100;

// ============================================
// VARIABLE VALIDATION
// ============================================

if (!TELEGRAM_TOKEN || !DB_URL || !DB_KEY) {
    console.error('❌ Missing critical environment variables. Check TELEGRAM_TOKEN, DB_URL, DB_KEY');
    process.exit(1);
}

if (!WEBHOOK_SECRET_KEY) {
    console.warn('⚠️ WEBHOOK_SECRET_KEY not configured. This is a security risk!');
}

// ============================================
// INITIALIZATION
// ============================================

// Initialize Express
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

// Session configuration for web dashboard
app.use(session({
    secret: WEBHOOK_SECRET_KEY || 'cromwell-store-session-secret',
    resave: false,  // Changed to false
    saveUninitialized: false,  // Changed to false
    cookie: { 
        secure: false,  // false in development, true in production
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Debug middleware for sessions
app.use((req, res, next) => {
    console.log('🔍 Session information:', {
        sessionId: req.sessionID,
        userId: req.session.userId,
        authenticated: req.session.authenticated,
        path: req.path
    });
    next();
});

// Initialize Telegram bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Initialize Supabase
const supabase = createClient(DB_URL, DB_KEY);

// Initialize Web3 for BSC
const web3 = new Web3(new Web3.providers.HttpProvider('https://bsc-dataseed.binance.org/'));

// Global variables
const activeSessions = {};

// ============================================
// HELPER FUNCTIONS
// ============================================

// Middleware to verify webhook token
const verifyWebhookToken = (req, res, next) => {
    if (!WEBHOOK_SECRET_KEY) {
        console.log('⚠️ WEBHOOK_SECRET_KEY not configured, accepting all requests');
        return next();
    }
    
    const authToken = req.headers['x-auth-token'] || req.body.auth_token;
    
    if (!authToken) {
        console.log('❌ Missing authentication token');
        return res.status(401).json({ 
            success: false, 
            message: 'Authentication token required',
            required: true 
        });
    }
    
    if (authToken !== WEBHOOK_SECRET_KEY) {
        console.log('❌ Invalid authentication token');
        return res.status(403).json({ 
            success: false, 
            message: 'Invalid authentication token',
            required: true 
        });
    }
    
    next();
};

// Middleware for web authentication
function requireAuth(req, res, next) {
    if (req.session.userId && req.session.authenticated) {
        console.log('✅ User authenticated:', req.session.userId);
        next();
    } else {
        console.log('❌ User not authenticated');
        // For API requests, return JSON
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        // For HTML pages, redirect to login
        res.redirect('/');
    }
}

// Format currency
function formatCurrency(amount, currency) {
    const symbols = {
        'cup': 'CUP',
        'saldo': 'Saldo',
        'usdt': 'USDT',
        'cws': 'CWS',
        'cwt': 'CWT'
    };
    
    const symbol = symbols[currency] || currency.toUpperCase();
    
    if (currency === 'usdt' || currency === 'cwt') {
        return `${parseFloat(amount).toFixed(2)} ${symbol}`;
    }
    
    return `$${parseFloat(amount).toFixed(2)} ${symbol}`;
}

// Get user by Telegram ID
async function getUser(telegramId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
    
    if (error) {
        console.log('Error getting user:', error);
        return null;
    }
    return data;
}

// Update user
async function updateUser(telegramId, updates) {
    const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('telegram_id', telegramId);
    
    return !error;
}

// Get user by phone
async function getUserByPhone(phone) {
    // Normalize phone: remove all non-numeric characters
    const normalizedPhone = phone.replace(/[^\d]/g, '');
    
    console.log('🔍 Searching user by normalized phone:', normalizedPhone);
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('phone_number', normalizedPhone)
        .single();
    
    if (error) {
        console.log('Error searching user by phone:', error);
        return null;
    }
    return data;
}

// Verify BSC transaction
async function checkBSCTransaction(txHash, expectedAmount, expectedTo) {
    try {
        if (!BSCSCAN_API_KEY) {
            return { success: false, error: 'BSCScan API key not configured' };
        }
        
        const url = `https://api.bscscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${BSCSCAN_API_KEY}`;
        const response = await axios.get(url);
        
        if (response.data.status === '1') {
            const detailsUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${BSCSCAN_API_KEY}`;
            const details = await axios.get(detailsUrl);
            
            if (details.data.result) {
                const tx = details.data.result;
                if (tx.to && tx.to.toLowerCase() === expectedTo.toLowerCase()) {
                    const amount = parseFloat(web3.utils.fromWei(tx.value, 'ether'));
                    const diff = Math.abs(amount - expectedAmount);
                    const margin = expectedAmount * 0.01;
                    
                    if (diff <= margin) {
                        return { success: true, amount: amount, from: tx.from };
                    }
                }
            }
        }
        return { success: false };
    } catch (error) {
        console.error('Error verifying BSC transaction:', error);
        return { success: false, error: error.message };
    }
}

// Apply first deposit bonus
async function aplicarBonoPrimerDeposito(userId, currency, amount) {
    const user = await getUser(userId);
    if (!user) return amount;

    let bono = 0;
    let bonoPorcentaje = 0;
    let campoBono = '';

    switch (currency) {
        case 'cup':
            campoBono = 'first_dep_cup';
            bonoPorcentaje = user.first_dep_cup ? 0.10 : 0;
            break;
        case 'saldo':
            campoBono = 'first_dep_saldo';
            bonoPorcentaje = user.first_dep_saldo ? 0.10 : 0;
            break;
        case 'usdt':
            campoBono = 'first_dep_usdt';
            bonoPorcentaje = user.first_dep_usdt ? 0.05 : 0;
            break;
    }

    if (bonoPorcentaje > 0) {
        bono = amount * bonoPorcentaje;
        await updateUser(userId, { [campoBono]: false });
    }

    return amount + bono;
}

// Calculate tokens
function calcularTokens(amount, currency) {
    switch (currency) {
        case 'saldo':
            return Math.floor(amount / 100) * CWS_PER_100_SALDO;
        case 'usdt':
            return (amount / 10) * CWT_PER_10_USDT;
        default:
            return 0;
    }
}

// Process automatic payment
async function procesarPagoAutomatico(userId, amount, currency, txId, tipoPago) {
    try {
        console.log(`💰 Processing automatic payment: ${userId}, ${amount}, ${currency}, ${txId}, ${tipoPago}`);
        
        const user = await getUser(userId);
        if (!user) {
            console.log(`❌ User ${userId} not found`);
            return { success: false, message: 'User not found' };
        }

        const { data: pendingTx } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', currency)
            .eq('type', 'DEPOSIT')
            .order('created_at', { ascending: false })
            .limit(1);

        if (!pendingTx || pendingTx.length === 0) {
            if (currency === 'cup' && amount < MINIMO_CUP) {
                const nuevoPendiente = (user.pending_balance_cup || 0) + amount;
                await updateUser(userId, { pending_balance_cup: nuevoPendiente });

                const mensajeUsuario = `⚠️ *Deposit below minimum*\n\n` +
                    `We received ${formatCurrency(amount, currency)} but the minimum is ${formatCurrency(MINIMO_CUP, 'cup')}.\n` +
                    `This amount has been added to your pending balance: *${formatCurrency(nuevoPendiente, 'cup')}*\n\n` +
                    `When your pending deposits total ${formatCurrency(MINIMO_CUP, 'cup')} or more, they will be automatically credited.\n\n` +
                    `💰 *Missing:* ${formatCurrency(MINIMO_CUP - nuevoPendiente, 'cup')}`;
                
                await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
                
                return { success: false, message: 'Amount below minimum, accumulated' };
            } else {
                return await procesarDepositoDirecto(userId, amount, currency, txId, tipoPago);
            }
        } else {
            return await procesarDepositoConOrden(userId, amount, currency, txId, tipoPago, pendingTx[0]);
        }
    } catch (error) {
        console.error('❌ Error processing automatic payment:', error);
        return { success: false, message: error.message };
    }
}

// Process direct deposit
async function procesarDepositoDirecto(userId, amount, currency, txId, tipoPago) {
    const user = await getUser(userId);
    if (!user) return { success: false, message: 'User not found' };

    const minimos = { cup: MINIMO_CUP, saldo: MINIMO_SALDO, usdt: MINIMO_USDT };
    if (amount < minimos[currency]) {
        const mensajeUsuario = `⚠️ *Deposit below minimum*\n\n` +
            `We received ${formatCurrency(amount, currency)} but the minimum is ${formatCurrency(minimos[currency], currency)}.\n` +
            `This amount will not be credited until you make a deposit of ${formatCurrency(minimos[currency], currency)} or more.`;
        
        await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
        return { success: false, message: 'Amount below minimum' };
    }

    const montoConBono = await aplicarBonoPrimerDeposito(userId, currency, amount);
    const tokensGanados = calcularTokens(amount, currency);
    
    const updates = {
        [`balance_${currency}`]: (user[`balance_${currency}`] || 0) + montoConBono
    };

    if (currency === 'saldo') {
        updates.tokens_cws = (user.tokens_cws || 0) + tokensGanados;
    } else if (currency === 'usdt') {
        updates.tokens_cwt = (user.tokens_cwt || 0) + tokensGanados;
    }

    await updateUser(userId, updates);

    await supabase.from('transactions').insert({
        user_id: userId,
        type: 'AUTO_DEPOSIT',
        currency: currency,
        amount: montoConBono,
        amount_requested: amount,
        tokens_generated: tokensGanados,
        status: 'completed',
        tx_id: txId,
        tipo_pago: tipoPago
    });

    const bonoMensaje = montoConBono > amount ? 
        `\n🎉 *¡Bonus applied!* +${formatCurrency(montoConBono - amount, currency)}` : '';
    
    const tokensMensaje = tokensGanados > 0 ? 
        `\n🎫 *Tokens earned:* +${tokensGanados} ${currency === 'saldo' ? 'CWS' : 'CWT'}` : '';

    const mensajeUsuario = `✅ *¡Deposit Automatically Credited!*\n\n` +
        `💰 Amount received: ${formatCurrency(amount, currency)}\n` +
        `${bonoMensaje}${tokensMensaje}\n` +
        `💵 Total credited: *${formatCurrency(montoConBono, currency)}*\n\n` +
        `📊 New ${currency.toUpperCase()} balance: *${formatCurrency(updates[`balance_${currency}`], currency)}*\n` +
        `🆔 Transaction ID: \`${txId}\``;
    
    await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });

    if (ADMIN_CHAT_ID) {
        const mensajeAdmin = `✅ *AUTOMATIC DEPOSIT*\n\n` +
            `👤 User: ${user.first_name} (@${user.username || 'no username'})\n` +
            `📞 Phone: ${user.phone_number || 'Not linked'}\n` +
            `💰 Amount: ${formatCurrency(amount, currency)}\n` +
            `🎁 Total with bonus: ${formatCurrency(montoConBono, currency)}\n` +
            `🎫 Tokens: ${tokensGanados} ${currency === 'saldo' ? 'CWS' : 'CWT'}\n` +
            `🔧 Type: ${tipoPago}\n` +
            `🆔 ID: \`${txId}\``;
        
        await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
    }

    return { success: true, montoConBono, tokensGanados };
}

// Process deposit with order
async function procesarDepositoConOrden(userId, amount, currency, txId, tipoPago, orden) {
    const user = await getUser(userId);
    if (!user) return { success: false, message: 'User not found' };

    const montoSolicitado = orden.amount_requested;
    const margen = montoSolicitado * 0.1;
    if (Math.abs(amount - montoSolicitado) > margen) {
        const mensajeUsuario = `⚠️ *Amount doesn't match*\n\n` +
            `📋 Requested: ${formatCurrency(montoSolicitado, currency)}\n` +
            `💰 Received: ${formatCurrency(amount, currency)}\n\n` +
            `Contact administrator for clarification.`;
        
        await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
        return { success: false, message: 'Amount doesn\'t match' };
    }

    const montoConBono = await aplicarBonoPrimerDeposito(userId, currency, amount);
    const tokensGanados = calcularTokens(amount, currency);
    
    const updates = {
        [`balance_${currency}`]: (user[`balance_${currency}`] || 0) + montoConBono
    };

    if (currency === 'saldo') {
        updates.tokens_cws = (user.tokens_cws || 0) + tokensGanados;
    } else if (currency === 'usdt') {
        updates.tokens_cwt = (user.tokens_cwt || 0) + tokensGanados;
    }

    await updateUser(userId, updates);

    await supabase
        .from('transactions')
        .update({ 
            status: 'completed',
            amount: montoConBono,
            tokens_generated: tokensGanados,
            tx_id: txId,
            tipo_pago: tipoPago
        })
        .eq('id', orden.id);

    const bonoMensaje = montoConBono > amount ? 
        `\n🎉 *¡Bonus applied!* +${formatCurrency(montoConBono - amount, currency)}` : '';
    
    const tokensMensaje = tokensGanados > 0 ? 
        `\n🎫 *Tokens earned:* +${tokensGanados} ${currency === 'saldo' ? 'CWS' : 'CWT'}` : '';

    const mensajeUsuario = `✨ *¡Deposit Completed!*\n\n` +
        `📋 Requested amount: ${formatCurrency(montoSolicitado, currency)}\n` +
        `💰 Amount received: ${formatCurrency(amount, currency)}\n` +
        `${bonoMensaje}${tokensMensaje}\n` +
        `💵 Total credited: *${formatCurrency(montoConBono, currency)}*\n\n` +
        `📊 New ${currency.toUpperCase()} balance: *${formatCurrency(updates[`balance_${currency}`], currency)}*\n` +
        `🆔 Transaction ID: \`${txId}\``;
    
    await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });

    if (ADMIN_CHAT_ID) {
        const mensajeAdmin = `✅ *DEPOSIT COMPLETED*\n\n` +
            `👤 User: ${user.first_name} (@${user.username || 'no username'})\n` +
            `📋 Order #: ${orden.id}\n` +
            `💰 Amount: ${formatCurrency(amount, currency)}\n` +
            `🎁 Total with bonus: ${formatCurrency(montoConBono, currency)}\n` +
            `🎫 Tokens: ${tokensGanados} ${currency === 'saldo' ? 'CWS' : 'CWT'}\n` +
            `🔧 Type: ${tipoPago}\n` +
            `🆔 ID: \`${txId}\``;
        
        await bot.sendMessage(ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
    }

    return { success: true, montoConBono, tokensGanados };
}

// ============================================
// TELEGRAM BOT - UPDATED FLOW WITH CHANGES
// ============================================

// Updated keyboards
const mainKeyboard = {
    inline_keyboard: [
        [{ text: '👛 My Wallet', callback_data: 'wallet' }],
        [{ text: '💰 Recharge Wallet', callback_data: 'recharge_menu' }],
        [{ text: '📱 Change Phone', callback_data: 'link_phone' }],
        [{ text: '🎁 Claim Payment', callback_data: 'claim_payment' }],
        [{ text: '📜 View Web Terms', callback_data: 'view_terms_web' }],
        [{ text: '🔄 Update', callback_data: 'refresh_wallet' }]
    ]
};

const walletKeyboard = {
    inline_keyboard: [
        [{ text: '💰 Recharge Wallet', callback_data: 'recharge_menu' }],
        [{ text: '📜 History', callback_data: 'history' }],
        [{ text: '📱 Change Phone', callback_data: 'link_phone' }],
        [{ text: '📊 Pending Balance', callback_data: 'view_pending' }],
        [{ text: '🔙 Back', callback_data: 'start_back' }]
    ]
};

const backKeyboard = (callback_data) => ({
    inline_keyboard: [[{ text: '🔙 Back', callback_data }]]
});

const rechargeMethodsKeyboard = {
    inline_keyboard: [
        [{ text: '💳 CUP (Card)', callback_data: 'dep_init:cup' }],
        [{ text: '📲 Mobile Balance', callback_data: 'dep_init:saldo' }],
        [{ text: '🪙 USDT BEP20', callback_data: 'dep_init:usdt' }],
        [{ text: '🔙 Back', callback_data: 'wallet' }]
    ]
};

const termsKeyboard = {
    inline_keyboard: [[{ text: '✅ Accept Terms', callback_data: 'accept_terms' }]]
};

const claimPaymentKeyboard = {
    inline_keyboard: [
        [{ text: '🔍 Search by ID', callback_data: 'search_payment_id' }],
        [{ text: '📋 View Pending', callback_data: 'view_pending_payments' }],
        [{ text: '🔙 Back', callback_data: 'start_back' }]
    ]
};

// ============================================
// TELEGRAM COMMAND HANDLING
// ============================================

// Command /start - UPDATED FLOW
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const { id, first_name, username } = msg.from;
    
    console.log(`🚀 User ${id} (${first_name}) started bot`);
    
    // Check if user exists
    let user = await getUser(chatId);
    
    if (!user) {
        // Create new user
        user = {
            telegram_id: id,
            first_name: first_name,
            username: username,
            phone_number: null,
            first_dep_cup: true,
            first_dep_saldo: true,
            first_dep_usdt: true,
            accepted_terms: false,
            pending_balance_cup: 0,
            balance_cup: 0,
            balance_saldo: 0,
            balance_usdt: 0,
            tokens_cws: 0,
            tokens_cwt: 0,
            usdt_wallet: null,
            last_active: new Date().toISOString()
        };
        
        await supabase.from('users').upsert(user, { onConflict: 'telegram_id' });
        user = await getUser(chatId);
    }
    
    // STEP 1: Check if they have a linked number
    if (!user.phone_number) {
        const message = `📱 *Welcome to Cromwell Store Wallet!*\n\n` +
            `👋 Hello **${first_name}**, to begin we need to link your phone number.\n\n` +
            `⚠️ *IMPORTANT:* This must be the number *from which you will make payments* in Transfermóvil.\n\n` +
            `🔢 *Required format:*\n` +
            `• 10 digits\n` +
            `• Starts with 53\n` +
            `• Example: *5351234567*\n\n` +
            `Please, write your phone number:`;
        
        activeSessions[chatId] = { step: 'waiting_phone_start' };
        
        return bot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }
        });
    }
    
    // STEP 2: Check if they accepted terms
    if (!user.accepted_terms) {
        return handleTerms(chatId, null);
    }
    
    // STEP 3: Complete user - Show main menu
    const welcomeMessage = `✅ *Welcome back, ${first_name}!*\n\n` +
        `🆔 *Your Telegram ID is:* \`${id}\`\n\n` +
        `⚠️ *SAVE THIS ID* - You'll need it to access the web.\n\n` +
        `You can only access the web with your Telegram ID.\n\n` +
        `How can I help you today?`;
    
    await bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown', 
        reply_markup: mainKeyboard 
    });
});

// ============================================
// BOT CALLBACK HANDLING
// ============================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const [action, param1, param2] = query.data.split(':');

    try {
        await bot.answerCallbackQuery(query.id);

        switch (action) {
            case 'start_back':
                await handleStartBack(chatId, messageId);
                break;
            case 'wallet':
                await handleWallet(chatId, messageId);
                break;
            case 'refresh_wallet':
                await handleRefreshWallet(chatId, messageId);
                break;
            case 'recharge_menu':
                await handleRechargeMenu(chatId, messageId);
                break;
            case 'dep_init':
                await handleDepositInit(chatId, messageId, param1);
                break;
            case 'confirm_deposit':
                await handleConfirmDeposit(chatId, messageId, param1, param2);
                break;
            case 'terms':
                await handleTerms(chatId, messageId);
                break;
            case 'accept_terms':
                await handleAcceptTerms(chatId, messageId);
                break;
            case 'link_phone':
                await handleLinkPhone(chatId, messageId);
                break;
            case 'enter_phone':
                await handleEnterPhone(chatId, messageId);
                break;
            case 'claim_payment':
                await handleClaimPayment(chatId, messageId);
                break;
            case 'search_payment_id':
                await handleSearchPaymentId(chatId, messageId);
                break;
            case 'view_pending_payments':
                await handleViewPendingPayments(chatId, messageId);
                break;
            case 'history':
                await handleHistory(chatId, messageId);
                break;
            case 'view_pending':
                await handleViewPending(chatId, messageId);
                break;
            case 'enter_usdt_wallet':
                await handleEnterUsdtWallet(chatId, messageId);
                break;
            case 'view_terms_web':
                await handleViewTermsWeb(chatId, messageId);
                break;
            default:
                console.log(`Unrecognized action: ${action}`);
        }
    } catch (error) {
        console.error('Error in callback:', error);
        await bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
    }
});

// ============================================
// CALLBACK HANDLER FUNCTIONS (UPDATED)
// ============================================

async function handleStartBack(chatId, messageId) {
    const user = await getUser(chatId);
    const message = `✅ *Welcome back, ${user.first_name}!*\n\n` +
        `🆔 *Your Telegram ID is:* \`${chatId}\`\n\n` +
        `⚠️ *SAVE THIS ID* - You'll need it to access the web.\n\n` +
        `You can only access the web with your Telegram ID.\n\n` +
        `How can I help you today?`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
    });
}

async function handleWallet(chatId, messageId) {
    const user = await getUser(chatId);
    
    if (!user) {
        await bot.editMessageText('❌ Could not get your information.', {
            chat_id: chatId,
            message_id: messageId
        });
        return;
    }
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = MINIMO_CUP - pendiente;
    
    let message = `👛 *Your Cromwell Wallet*\n\n` +
        `🆔 *Telegram ID:* \`${chatId}\`\n\n` +
        `💰 *CUP:* **${formatCurrency(user.balance_cup, 'cup')}**\n` +
        `📱 *Mobile Balance:* **${formatCurrency(user.balance_saldo, 'saldo')}**\n` +
        `🪙 *USDT:* **${formatCurrency(user.balance_usdt, 'usdt')}**\n` +
        `🎫 *CWS (Balance Tokens):* **${user.tokens_cws || 0}**\n` +
        `🎟️ *CWT (USDT Tokens):* **${(user.tokens_cwt || 0).toFixed(2)}**\n\n`;
    
    if (pendiente > 0) {
        message += `📥 *Pending CUP:* **${formatCurrency(pendiente, 'cup')}**\n`;
        if (faltante > 0) {
            message += `🎯 *Missing:* ${formatCurrency(faltante, 'cup')} for minimum\n\n`;
        }
    }
    
    message += `📞 *Linked phone:* ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : '❌ Not linked'}\n\n` +
        `💡 *Minimum to use tokens:*\n` +
        `• CWT: ${MIN_CWT_USE} CWT\n` +
        `• CWS: ${MIN_CWS_USE} CWS\n\n` +
        `What do you want to do?`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: walletKeyboard
    });
}

async function handleRefreshWallet(chatId, messageId) {
    await updateUser(chatId, { last_active: new Date().toISOString() });
    await handleWallet(chatId, messageId);
}

async function handleRechargeMenu(chatId, messageId) {
    const user = await getUser(chatId);
    
    if (!user.accepted_terms) {
        await bot.editMessageText('❌ *You must accept the terms and conditions first.*', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: backKeyboard('start_back')
        });
        return;
    }
    
    const message = `💰 *Recharge Your Wallet*\n\n` +
        `📞 *Linked phone:* +53 ${user.phone_number ? user.phone_number.substring(2) : 'Not linked'}\n\n` +
        `Select payment method:\n\n` +
        `⚠️ *Important:* Use the same linked phone to pay.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: rechargeMethodsKeyboard
    });
}

async function handleDepositInit(chatId, messageId, currency) {
    const user = await getUser(chatId);
    
    if (!user.phone_number && currency !== 'usdt') {
        await bot.editMessageText('❌ *You must link your phone first* for payments with CUP or Mobile Balance.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: backKeyboard('recharge_menu')
        });
        return;
    }
    
    let instrucciones = '';
    let minimo = MINIMO_CUP;
    let maximo = MAXIMO_CUP;
    let metodoPago = '';
    let extraInfo = '';
    
    if (currency === 'cup') {
        minimo = MINIMO_CUP;
        maximo = MAXIMO_CUP;
        metodoPago = 'Card';
        if (PAGO_CUP_TARJETA) {
            instrucciones = `💳 *Pay to Card:* \`${PAGO_CUP_TARJETA}\``;
        } else {
            instrucciones = `💳 *Pay to Card:* \`[NOT CONFIGURED]\``;
        }
    } else if (currency === 'saldo') {
        minimo = MINIMO_SALDO;
        maximo = 10000;
        metodoPago = 'Mobile Balance';
        if (PAGO_SALDO_MOVIL) {
            instrucciones = `📱 *Pay to Mobile Balance:* \`${PAGO_SALDO_MOVIL}\``;
        } else {
            instrucciones = `📱 *Pay to Mobile Balance:* \`[NOT CONFIGURED]\``;
        }
        const cwsPor100 = Math.floor(minimo / 100) * CWS_PER_100_SALDO;
        extraInfo = `\n🎫 *Earn ${CWS_PER_100_SALDO} CWS per each 100 of balance*\n` +
            `(Ex: ${minimo} balance = ${cwsPor100} CWS)`;
    } else if (currency === 'usdt') {
        minimo = MINIMO_USDT;
        maximo = 1000;
        metodoPago = 'USDT BEP20';
        if (PAGO_USDT_ADDRESS) {
            instrucciones = `🪙 *USDT Address (BEP20):*\n\`${PAGO_USDT_ADDRESS}\``;
        } else {
            instrucciones = `🪙 *USDT Address (BEP20):*\n\`[NOT CONFIGURED]\``;
        }
        const cwtPor10 = (minimo / 10) * CWT_PER_10_USDT;
        extraInfo = `\n🎟️ *Earn ${CWT_PER_10_USDT} CWT per each 10 USDT*\n` +
            `(Ex: ${minimo} USDT = ${cwtPor10.toFixed(2)} CWT)\n\n` +
            `⚠️ *ONLY BEP20 NETWORK*`;
    }
    
    activeSessions[chatId] = { 
        step: 'waiting_deposit_amount', 
        currency: currency,
        metodoPago: metodoPago
    };
    
    const bonoPorcentaje = currency === 'usdt' ? '5%' : '10%';
    
    const message = `💰 *Recharge ${currency.toUpperCase()}*\n\n` +
        `*Method:* ${metodoPago}\n` +
        `*Minimum:* ${formatCurrency(minimo, currency)}\n` +
        `*Maximum:* ${formatCurrency(maximo, currency)}\n\n` +
        `🎁 *First deposit bonus:* ${bonoPorcentaje}\n` +
        `${extraInfo}\n\n` +
        `${instrucciones}\n\n` +
        `Please, write the exact amount you want to deposit:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('recharge_menu')
    });
}

async function handleTerms(chatId, messageId) {
    const terms = `📜 *Terms and Conditions of Cromwell Store*\n\n` +
        `1. *ACCEPTANCE*: By using this service, you accept these terms.\n\n` +
        `2. *PURPOSE*: The wallet is exclusive for payments in Cromwell Store. Money is not withdrawable, except bonuses that are usable for recharges.\n\n` +
        `3. *DEPOSITS*:\n` +
        `   • Minimums: CUP=${MINIMO_CUP}, Balance=${MINIMO_SALDO}, USDT=${MINIMO_USDT}\n` +
        `   • Bonuses only on first deposit per method\n` +
        `   • Tokens are not withdrawable, only usable in store\n\n` +
        `4. *TOKENS*:\n` +
        `   • CWS: Earn ${CWS_PER_100_SALDO} per each 100 of balance\n` +
        `   • CWT: Earn ${CWT_PER_10_USDT} per each 10 USDT\n` +
        `   • Minimum to use: CWT=${MIN_CWT_USE}, CWS=${MIN_CWS_USE}\n\n` +
        `5. *SECURITY*:\n` +
        `   • Take screenshots of all transactions\n` +
        `   • ETECSA may fail with SMS notifications\n` +
        `   • Your responsibility to save receipts\n\n` +
        `6. *REFUNDS*:\n` +
        `   • If you send money and it's not credited but you have valid screenshot\n` +
        `   • Contact administrator within 24 hours\n` +
        `   • Will be investigated and resolved in 48 hours maximum\n\n` +
        `7. *PROHIBITED*:\n` +
        `   • Fraudulent use or multiple accounts\n` +
        `   • Money laundering or illegal activities\n` +
        `   • Spam or system abuse\n\n` +
        `8. *MODIFICATIONS*: We may change these terms notifying with 72 hours anticipation.\n\n` +
        `_Last update: ${new Date().toLocaleDateString()}_\n\n` +
        `⚠️ *To view these terms and conditions again, visit our web.*`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '✅ Accept Terms', callback_data: 'accept_terms' }]
        ]
    };
    
    if (messageId) {
        await bot.editMessageText(terms, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } else {
        await bot.sendMessage(chatId, terms, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
}

async function handleAcceptTerms(chatId, messageId) {
    await updateUser(chatId, { accepted_terms: true });
    
    const user = await getUser(chatId);
    const message = `✅ *¡Terms accepted!*\n\n` +
        `🆔 *Your Telegram ID is:* \`${chatId}\`\n\n` +
        `⚠️ *SAVE THIS ID* - You'll need it to access the web.\n\n` +
        `You can only access the web with your Telegram ID.\n\n` +
        `Now you can use all Cromwell Store services.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard
    });
}

async function handleLinkPhone(chatId, messageId) {
    const user = await getUser(chatId);
    
    let message = `📱 *Change Linked Phone*\n\n`;
    
    if (user.phone_number) {
        message += `📞 *Current phone:* +53 ${user.phone_number.substring(2)}\n\n`;
    }
    
    message += `Please, write your new phone number:\n\n` +
        `🔢 *Required format:*\n` +
        `• 10 digits\n` +
        `• Starts with 53\n` +
        `• Example: *5351234567*\n\n` +
        `⚠️ *IMPORTANT:* This must be the number *from which you will make payments* in Transfermóvil.`;
    
    activeSessions[chatId] = { 
        step: 'waiting_phone_change',
        oldPhone: user.phone_number 
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleEnterPhone(chatId, messageId) {
    const message = `📱 *Enter your number*\n\n` +
        `Format: 535XXXXXXX\n` +
        `Example: 5351234567\n\n` +
        `⚠️ Must be the same from Transfermóvil from which you'll pay.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleClaimPayment(chatId, messageId) {
    const message = `🎁 *Claim Payment*\n\n` +
        `For payments that weren't automatically detected:\n\n` +
        `1. Payments *Card → Wallet* (without visible number)\n` +
        `2. Payments with transaction ID needed\n` +
        `3. Payments with notification problems\n\n` +
        `Select an option:`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: claimPaymentKeyboard
    });
}

async function handleSearchPaymentId(chatId, messageId) {
    const message = `🔍 *Search by Transaction ID*\n\n` +
        `Find the ID in your Transfermóvil SMS:\n\n` +
        `Example: "Id Transaccion: TMW162915233"\n\n` +
        `Write the ID you want to claim:`;
    
    activeSessions[chatId] = { step: 'search_payment_id' };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleViewPendingPayments(chatId, messageId) {
    const user = await getUser(chatId);
    const phone = user.phone_number;
    
    const { data: pendingPayments } = await supabase
        .from('pending_sms_payments')
        .select('*')
        .eq('claimed', false)
        .or(`user_id.eq.${chatId},phone.eq.${phone}`)
        .order('created_at', { ascending: false });
    
    let message = `📋 *Your Pending Payments*\n\n`;
    
    if (!pendingPayments || pendingPayments.length === 0) {
        message += `You don't have pending payments to claim.`;
    } else {
        pendingPayments.forEach((payment, index) => {
            message += `${index + 1}. ${formatCurrency(payment.amount, payment.currency)}\n`;
            message += `   🆔 ID: \`${payment.tx_id}\`\n`;
            message += `   📅 ${new Date(payment.created_at).toLocaleDateString()}\n`;
            message += `   🔧 ${payment.tipo_pago}\n\n`;
        });
        
        message += `To claim, use "🔍 Search by ID"`;
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('claim_payment')
    });
}

async function handleHistory(chatId, messageId) {
    const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', chatId)
        .order('created_at', { ascending: false })
        .limit(15);
    
    let message = `📜 *Transaction History*\n\n`;
    
    if (!transactions || transactions.length === 0) {
        message += `You don't have registered transactions.`;
    } else {
        transactions.forEach((tx, index) => {
            let icon = '🔸';
            if (tx.status === 'completed') icon = '✅';
            else if (tx.status === 'pending') icon = '⏳';
            else if (tx.status === 'rejected') icon = '❌';
            
            const fecha = new Date(tx.created_at).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            message += `${icon} *${tx.type === 'DEPOSIT' ? 'Deposit' : tx.type}*\n`;
            message += `💰 ${formatCurrency(tx.amount || tx.amount_requested, tx.currency)}\n`;
            message += `📅 ${fecha}\n`;
            message += `📊 ${tx.status}\n`;
            if (tx.tx_id) message += `🆔 \`${tx.tx_id}\`\n`;
            if (tx.tokens_generated > 0) message += `🎫 +${tx.tokens_generated}\n`;
            message += `\n`;
        });
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('wallet')
    });
}

async function handleViewPending(chatId, messageId) {
    const user = await getUser(chatId);
    
    if (!user) return;
    
    const pendiente = user.pending_balance_cup || 0;
    const faltante = MINIMO_CUP - pendiente;
    const bono = user.first_dep_cup ? pendiente * 0.10 : 0;
    const totalConBono = pendiente + bono;
    
    let message = `📊 *Pending CUP Balance*\n\n`;
    
    if (pendiente > 0) {
        message += `💰 *Accumulated:* ${formatCurrency(pendiente, 'cup')}\n`;
        
        if (user.first_dep_cup) {
            message += `🎁 *Available bonus:* ${formatCurrency(bono, 'cup')} (10%)\n`;
            message += `💵 *Total with bonus:* ${formatCurrency(totalConBono, 'cup')}\n`;
        }
        
        if (faltante > 0) {
            message += `\n❌ *Missing:* ${formatCurrency(faltante, 'cup')}\n`;
            message += `Make another deposit of ${formatCurrency(faltante, 'cup')} or more.`;
        } else {
            message += `\n✅ *¡You already passed the minimum!*\n`;
            message += `It will be automatically credited shortly.`;
        }
    } else {
        message += `You don't have accumulated pending balance.\n\n`;
        message += `Deposits less than ${formatCurrency(MINIMO_CUP, 'cup')} accumulate here.`;
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('wallet')
    });
}

async function handleEnterUsdtWallet(chatId, messageId) {
    const message = `👛 *Wallet for USDT*\n\n` +
        `Write the USDT address (BEP20) from which you'll send:\n\n` +
        `Format: 0x... (42 characters)\n` +
        `Example: 0x742d35Cc6634C0532925a3b844Bc9e8e64dA7F2E\n\n` +
        `⚠️ This wallet will be linked to your account.`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
    });
}

async function handleViewTermsWeb(chatId, messageId) {
    const message = `🌐 *Terms and Conditions on the Web*\n\n` +
        `To see updated terms and conditions, visit our website.\n\n` +
        `Once you've logged in with your Telegram ID, you'll be able to see them in the corresponding section.\n\n` +
        `⚠️ *Remember:* Your Telegram ID is: \`${chatId}\``;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('start_back')
    });
}

// ============================================
// TELEGRAM TEXT MESSAGE HANDLING
// ============================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const session = activeSessions[chatId];
    
    if (!text || text.startsWith('/')) return;
    
    try {
        if (session) {
            switch (session.step) {
                case 'waiting_phone':
                case 'waiting_phone_change':
                case 'waiting_phone_start':
                    await handlePhoneInput(chatId, text, session);
                    break;
                    
                case 'search_payment_id':
                    await handleSearchPaymentIdInput(chatId, text);
                    break;
                    
                case 'waiting_deposit_amount':
                    await handleDepositAmountInput(chatId, text, session);
                    break;
                    
                case 'waiting_usdt_wallet':
                    await handleUsdtWalletInput(chatId, text, session);
                    break;
                    
                case 'waiting_usdt_hash':
                    await handleUsdtHashInput(chatId, text, session);
                    break;
                    
                default:
                    console.log(`Unhandled step: ${session.step}`);
            }
        }
    } catch (error) {
        console.error('Error processing message:', error);
        await bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
    }
});

// Function to handle phone input (UPDATED)
async function handlePhoneInput(chatId, phone, session) {
    // Clean number: remove spaces, dashes, parentheses, etc.
    let cleanPhone = phone.replace(/[^\d]/g, '');
    
    console.log(`📱 Number received: ${phone}, Clean: ${cleanPhone}`);
    
    // Validate format
    if (!cleanPhone.startsWith('53')) {
        // If it doesn't start with 53, add it (assuming it's a Cuban number)
        if (cleanPhone.length === 8) {
            cleanPhone = '53' + cleanPhone;
        } else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
            // If it has 9 digits and starts with 5, add 53 at the beginning
            cleanPhone = '53' + cleanPhone;
        } else {
            await bot.sendMessage(chatId,
                `❌ *Incorrect format*\n\n` +
                `The number must start with *53* and have 10 digits.\n\n` +
                `Valid examples:\n` +
                `• *5351234567* (10 digits)\n` +
                `• *51234567* (8 digits, will be completed to 5351234567)\n\n` +
                `Try again:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
    }
    
    // Validate final length (must be 10 digits: 53 + 8 digits)
    if (cleanPhone.length !== 10) {
        await bot.sendMessage(chatId,
            `❌ *Incorrect length*\n\n` +
            `The number must have *10 digits* (53 + 8 digits).\n\n` +
            `Example: *5351234567*\n\n` +
            `Try again:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Verify it's a valid number (only digits after cleaning)
    if (!/^\d+$/.test(cleanPhone)) {
        await bot.sendMessage(chatId,
            `❌ *Invalid characters*\n\n` +
            `The number should only contain digits.\n\n` +
            `Try again:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Verify if number is already in use by another user
    const { data: existingUser } = await supabase
        .from('users')
        .select('telegram_id, first_name')
        .eq('phone_number', cleanPhone)
        .neq('telegram_id', chatId)
        .single();
    
    if (existingUser) {
        await bot.sendMessage(chatId,
            `❌ *Phone already in use*\n\n` +
            `This number is already linked to another account.\n` +
            `👤 User: ${existingUser.first_name}\n\n` +
            `If it's your number, contact the administrator.`,
            { parse_mode: 'Markdown' }
        );
        
        // If it's the start flow, show message to try again
        if (session.step === 'waiting_phone_start') {
            activeSessions[chatId] = { step: 'waiting_phone_start' };
        }
        
        return;
    }
    
    // Save normalized number
    await updateUser(chatId, { phone_number: cleanPhone });
    
    let message = '';
    if (session.step === 'waiting_phone_change' && session.oldPhone) {
        message = `✅ *Phone updated*\n\n` +
            `📱 *Previous:* +53 ${session.oldPhone.substring(2)}\n` +
            `📱 *New:* +53 ${cleanPhone.substring(2)}\n\n` +
            `Now payments will be detected with this number.`;
    } else if (session.step === 'waiting_phone_start') {
        message = `✅ *¡Phone linked!*\n\n` +
            `📱 *Number:* +53 ${cleanPhone.substring(2)}\n\n` +
            `⚠️ *IMPORTANT:*\n` +
            `• Use this same number in Transfermóvil\n` +
            `• From this number you'll make payments\n` +
            `• Keep active the option "Show number to recipient"\n\n` +
            `Now you must accept the terms and conditions to continue.`;
    } else {
        message = `✅ *¡Phone linked!*\n\n` +
            `📱 *Number:* +53 ${cleanPhone.substring(2)}\n\n` +
            `Now your payments will be automatically detected when:\n` +
            `✅ You send from Card→Card\n` +
            `✅ You send from Wallet→Card\n` +
            `✅ You send from Wallet→Wallet\n\n` +
            `⚠️ *For Card→Wallet payments:*\n` +
            `Use '🎁 Claim Payment'\n\n` +
            `💡 Always use this number in Transfermóvil.`;
    }
    
    // Send appropriate message
    if (session.step === 'waiting_phone_start') {
        // After linking phone at start, show terms
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        await handleTerms(chatId, null);
    } else {
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: mainKeyboard
        });
    }
    
    delete activeSessions[chatId];
}

async function handleSearchPaymentIdInput(chatId, txId) {
    const txIdClean = txId.trim().toUpperCase();
    
    const { data: pendingPayment } = await supabase
        .from('pending_sms_payments')
        .select('*')
        .eq('tx_id', txIdClean)
        .eq('claimed', false)
        .single();
    
    if (pendingPayment) {
        const user = await getUser(chatId);
        if (user && (user.telegram_id === pendingPayment.user_id || user.phone_number === pendingPayment.phone)) {
            const result = await procesarPagoAutomatico(
                chatId, 
                pendingPayment.amount, 
                pendingPayment.currency, 
                pendingPayment.tx_id, 
                pendingPayment.tipo_pago
            );
            
            if (result.success) {
                await supabase
                    .from('pending_sms_payments')
                    .update({ claimed: true, claimed_by: chatId })
                    .eq('id', pendingPayment.id);
                
                await bot.sendMessage(chatId,
                    `✅ *¡Payment claimed successfully!*\n\n` +
                    `${formatCurrency(pendingPayment.amount, pendingPayment.currency)} has been credited to your wallet.`,
                    { parse_mode: 'Markdown', reply_markup: mainKeyboard }
                );
            }
        } else {
            await bot.sendMessage(chatId,
                `❌ *This payment doesn't belong to you*\n\n` +
                `Payment with ID \`${txIdClean}\` is registered for another user.`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
        }
    } else {
        const { data: pendingTx } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', chatId)
            .eq('status', 'pending')
            .eq('type', 'DEPOSIT')
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (pendingTx && pendingTx.length > 0) {
            const orden = pendingTx[0];
            
            await bot.sendMessage(chatId,
                `📋 *You have a pending order #${orden.id}*\n\n` +
                `💰 Amount: ${formatCurrency(orden.amount_requested, orden.currency)}\n` +
                `💳 Method: ${orden.currency.toUpperCase()}\n\n` +
                `If you already made the payment, wait for it to be detected automatically.\n` +
                `If not detected in 10 minutes, contact the administrator.`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
        } else {
            await bot.sendMessage(chatId,
                `❌ *ID not found*\n\n` +
                `We didn't find pending payments with ID: \`${txIdClean}\`\n\n` +
                `Verify:\n` +
                `1. That the ID is correct\n` +
                `2. That the payment is *Card→Wallet*\n` +
                `3. That it hasn't been claimed before`,
                { parse_mode: 'Markdown', reply_markup: claimPaymentKeyboard }
            );
        }
    }
    
    delete activeSessions[chatId];
}

async function handleDepositAmountInput(chatId, amountText, session) {
    const amount = parseFloat(amountText);
    const currency = session.currency;
    
    const limites = { 
        cup: [MINIMO_CUP, MAXIMO_CUP], 
        saldo: [MINIMO_SALDO, 10000], 
        usdt: [MINIMO_USDT, 1000] 
    };
    
    if (isNaN(amount) || amount < limites[currency][0] || amount > limites[currency][1]) {
        await bot.sendMessage(chatId, 
            `❌ *Amount out of limits*\n\n` +
            `Must be between ${formatCurrency(limites[currency][0], currency)} and ${formatCurrency(limites[currency][1], currency)}.\n\n` +
            `Write a valid amount:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const user = await getUser(chatId);
    
    if (currency === 'usdt') {
        session.amount = amount;
        session.step = 'waiting_usdt_wallet';
        
        await bot.sendMessage(chatId,
            `✅ *Amount set:* ${formatCurrency(amount, 'usdt')}\n\n` +
            `Now write the USDT address (BEP20) from which you'll send:\n\n` +
            `Format: 0x... (42 characters)\n` +
            `This wallet will be linked to your account.`,
            { parse_mode: 'Markdown' }
        );
    } else {
        session.amount = amount;
        await handleConfirmDeposit(chatId, null, currency, null);
    }
}

async function handleUsdtWalletInput(chatId, wallet, session) {
    if (!wallet.startsWith('0x') || wallet.length !== 42) {
        await bot.sendMessage(chatId,
            `❌ *Invalid address*\n\n` +
            `Must start with "0x" and have 42 characters.\n\n` +
            `Valid example:\n\`0x742d35Cc6634C0532925a3b844Bc9e8e64dA7F2E\`\n\n` +
            `Try again:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    session.usdtWallet = wallet;
    await updateUser(chatId, { usdt_wallet: wallet });
    
    await handleConfirmDeposit(chatId, null, 'usdt', null);
}

async function handleUsdtHashInput(chatId, hash, session) {
    if (!PAGO_USDT_ADDRESS) {
        await bot.sendMessage(chatId,
            `❌ *USDT address not configured*\n\n` +
            `Contact the administrator.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
        delete activeSessions[chatId];
        return;
    }
    
    const result = await checkBSCTransaction(hash, session.amount, PAGO_USDT_ADDRESS);
    
    if (result.success) {
        const user = await getUser(chatId);
        const resultPago = await procesarPagoAutomatico(chatId, result.amount, 'usdt', hash, 'USDT_BEP20');
        
        if (resultPago.success) {
            await bot.sendMessage(chatId,
                `✅ *¡USDT transaction verified!*\n\n` +
                `Hash: \`${hash.substring(0, 20)}...\`\n` +
                `Amount: ${formatCurrency(result.amount, 'usdt')}\n\n` +
                `The payment has been credited to your wallet.`,
                { parse_mode: 'Markdown', reply_markup: mainKeyboard }
            );
        }
    } else {
        await bot.sendMessage(chatId,
            `❌ *Transaction not verified*\n\n` +
            `We couldn't verify the transaction with hash:\n\`${hash}\`\n\n` +
            `Verify:\n` +
            `1. That the hash is correct\n` +
            `2. That the transaction is confirmed\n` +
            `3. That it was sent to the correct address\n\n` +
            `Try again or contact the administrator.`,
            { parse_mode: 'Markdown', reply_markup: mainKeyboard }
        );
    }
    
    delete activeSessions[chatId];
}

// ============================================
// WEB DASHBOARD ROUTES
// ============================================

// Webhook to receive payments from Python parser
app.post('/payment-notification', verifyWebhookToken, async (req, res) => {
    try {
        const { type, user_id, amount, currency, tx_id, tipo_pago, phone, message } = req.body;
        
        console.log(`📥 Notification received: ${type}, User: ${user_id}, Amount: ${amount} ${currency}`);
        
        if (type === 'AUTO_PAYMENT') {
            const result = await procesarPagoAutomatico(user_id, amount, currency, tx_id, tipo_pago);
            res.json(result);
        } 
        else if (type === 'PENDING_PAYMENT') {
            // Save pending payment
            const { data, error } = await supabase.from('pending_sms_payments').insert({
                user_id: user_id,
                phone: phone,
                amount: amount,
                currency: currency,
                tx_id: tx_id,
                tipo_pago: tipo_pago,
                raw_message: message,
                claimed: false
            });
            
            if (error) {
                res.status(500).json({ success: false, error: error.message });
            } else {
                res.json({ success: true, message: 'Pending payment registered' });
            }
        }
        else if (type === 'USDT_VERIFIED') {
            const result = await procesarPagoAutomatico(user_id, amount, 'usdt', tx_id, 'USDT_WEB');
            res.json(result);
        }
        else if (type === 'CLAIM_PAYMENT') {
            const user = await getUser(user_id);
            const result = await procesarPagoAutomatico(user_id, amount, currency, tx_id, tipo_pago);
            res.json(result);
        }
        else if (type === 'WEB_REGISTRATION') {
            // Just log
            console.log(`📝 Web registration completed for user: ${user_id}`);
            res.json({ success: true });
        }
        else {
            res.status(400).json({ success: false, message: 'Unknown notification type' });
        }
    } catch (error) {
        console.error('❌ Error in payment-notification:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Keep alive endpoint
app.get('/keepalive', (req, res) => {
    res.json({ 
        status: 'alive', 
        timestamp: new Date().toISOString(),
        service: 'cromwell-bot-server',
        uptime: process.uptime(),
        security_enabled: !!WEBHOOK_SECRET_KEY
    });
});

// 1. Web login - ONLY WITH TELEGRAM ID
app.post('/api/login', async (req, res) => {
    try {
        console.log('🔑 Login attempt:', req.body);
        const { identifier, password } = req.body;
        
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Missing credentials' });
        }
        
        // ONLY accept Telegram ID (must be a number)
        const telegramId = parseInt(identifier);
        if (isNaN(telegramId)) {
            return res.status(400).json({ error: 'Only Telegram ID (number) is allowed' });
        }
        
        // Find user by Telegram ID
        const user = await getUser(telegramId);
        
        if (!user) {
            console.log('❌ User not found:', telegramId);
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Verify web password (if they have one)
        if (user.web_password) {
            const validPassword = await bcrypt.compare(password, user.web_password);
            if (!validPassword) {
                console.log('❌ Incorrect password for user:', telegramId);
                return res.status(401).json({ error: 'Incorrect password' });
            }
        } else {
            // User doesn't have registered web password
            console.log('ℹ️ User without web password:', telegramId);
            return res.status(403).json({ 
                error: 'You must register a password first',
                needsRegistration: true,
                userId: user.telegram_id 
            });
        }
        
        // Create session
        req.session.userId = user.telegram_id;
        req.session.authenticated = true;
        req.session.userData = {
            telegramId: user.telegram_id,
            username: user.username,
            firstName: user.first_name,
            phone: user.phone_number
        };

        // Save session explicitly
        req.session.save((err) => {
            if (err) {
                console.error('Error saving session:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            console.log('✅ Session created for:', user.telegram_id);
            console.log('✅ SessionID:', req.sessionID);
            
            res.json({ 
                success: true, 
                user: {
                    id: user.telegram_id,
                    username: user.username,
                    firstName: user.first_name,
                    phone: user.phone_number,
                    balance_cup: user.balance_cup || 0,
                    balance_saldo: user.balance_saldo || 0,
                    balance_usdt: user.balance_usdt || 0,
                    tokens_cws: user.tokens_cws || 0,
                    tokens_cwt: user.tokens_cwt || 0
                }
            });
        });
        
    } catch (error) {
        console.error('❌ Error in web login:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2. Web password registration - ONLY WITH TELEGRAM ID
app.post('/api/register-password', async (req, res) => {
    try {
        const { identifier, password, confirmPassword } = req.body;
        
        if (!identifier || !password || !confirmPassword) {
            return res.status(400).json({ error: 'Missing data' });
        }
        
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Passwords don\'t match' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        
        // ONLY accept Telegram ID
        const telegramId = parseInt(identifier);
        if (isNaN(telegramId)) {
            return res.status(400).json({ error: 'Only Telegram ID (number) is allowed' });
        }
        
        const user = await getUser(telegramId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Verify if they already have a password
        if (user.web_password) {
            return res.status(400).json({ error: 'You already have a registered password' });
        }
        
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Update user
        const { error } = await supabase
            .from('users')
            .update({ web_password: hashedPassword })
            .eq('telegram_id', user.telegram_id);
        
        if (error) {
            throw error;
        }
        
        // Send notification to bot
        try {
            await axios.post(`http://localhost:${PORT}/payment-notification`, {
                auth_token: WEBHOOK_SECRET_KEY,
                type: 'WEB_REGISTRATION',
                user_id: user.telegram_id,
                user_name: user.first_name,
                timestamp: new Date().toISOString()
            });
        } catch (notifError) {
            console.error('Error sending notification:', notifError);
        }
        
        res.json({ success: true, message: 'Password registered successfully' });
        
    } catch (error) {
        console.error('Error in web registration:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 3. Get user data (protected)
app.get('/api/user-data', requireAuth, async (req, res) => {
    try {
        console.log('📊 Getting data for user:', req.session.userId);
        
        const user = await getUser(req.session.userId);
        
        if (!user) {
            console.log('❌ User not found in session:', req.session.userId);
            req.session.destroy();
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get recent transactions
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', user.telegram_id)
            .order('created_at', { ascending: false })
            .limit(10);
        
        // Get pending payments
        const { data: pendingPayments } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('claimed', false)
            .or(`user_id.eq.${user.telegram_id},phone.eq.${user.phone_number}`);
        
        res.json({
            success: true,
            user: {
                id: user.telegram_id,
                username: user.username,
                firstName: user.first_name,
                phone: user.phone_number,
                usdt_wallet: user.usdt_wallet,
                balance_cup: user.balance_cup || 0,
                balance_saldo: user.balance_saldo || 0,
                balance_usdt: user.balance_usdt || 0,
                tokens_cws: user.tokens_cws || 0,
                tokens_cwt: user.tokens_cwt || 0,
                pending_balance_cup: user.pending_balance_cup || 0,
                accepted_terms: user.accepted_terms || false,
                first_dep_cup: user.first_dep_cup || true,
                first_dep_saldo: user.first_dep_saldo || true,
                first_dep_usdt: user.first_dep_usdt || true
            },
            transactions: transactions || [],
            pendingPayments: pendingPayments || [],
            stats: {
                total_deposits: transactions ? transactions.filter(t => t.type === 'DEPOSIT' && t.status === 'completed').length : 0,
                total_amount: transactions ? transactions.filter(t => t.status === 'completed').reduce((sum, t) => sum + (t.amount || 0), 0) : 0,
                pending_count: pendingPayments ? pendingPayments.length : 0
            }
        });
        
        console.log('✅ Data sent for user:', user.telegram_id);
        
    } catch (error) {
        console.error('❌ Error getting data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 4. Create deposit request web
app.post('/api/create-deposit', requireAuth, async (req, res) => {
    try {
        const { currency, amount, usdtWallet } = req.body;
        const userId = req.session.userId;
        
        if (!currency || !amount) {
            return res.status(400).json({ error: 'Missing required data' });
        }
        
        // Validate minimum amount
        const minimos = { cup: MINIMO_CUP, saldo: MINIMO_SALDO, usdt: MINIMO_USDT };
        if (amount < minimos[currency]) {
            return res.status(400).json({ 
                error: `Minimum amount: ${minimos[currency]} ${currency.toUpperCase()}` 
            });
        }
        
        const user = await getUser(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // For USDT, validate wallet
        if (currency === 'usdt') {
            if (!usdtWallet) {
                return res.status(400).json({ error: 'Wallet required for USDT' });
            }
            if (!usdtWallet.startsWith('0x') || usdtWallet.length !== 42) {
                return res.status(400).json({ error: 'Invalid USDT wallet' });
            }
        }
        
        // Verify if they already have a pending request
        const { data: pendingTx } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', currency)
            .eq('type', 'DEPOSIT')
            .limit(1);
        
        if (pendingTx && pendingTx.length > 0) {
            return res.status(400).json({ 
                error: 'You already have a pending request for this method',
                existingOrder: pendingTx[0]
            });
        }
        
        // Calculate bonus and tokens
        const bonoPorcentaje = currency === 'usdt' ? 0.05 : 0.10;
        const bono = user[`first_dep_${currency}`] ? amount * bonoPorcentaje : 0;
        const totalConBono = amount + bono;
        const tokens = calcularTokens(amount, currency);
        
        // Create transaction
        const { data: transaction, error } = await supabase
            .from('transactions')
            .insert([{
                user_id: userId,
                type: 'DEPOSIT',
                currency: currency,
                amount_requested: amount,
                estimated_bonus: bono,
                estimated_tokens: tokens,
                status: 'pending',
                user_name: user.first_name,
                user_username: user.username,
                user_phone: user.phone_number,
                usdt_wallet: currency === 'usdt' ? usdtWallet : null
            }])
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        // Prepare response data
        let paymentInfo = {};
        
        switch (currency) {
            case 'cup':
                paymentInfo = {
                    method: 'Card',
                    target: PAGO_CUP_TARJETA || '[NOT CONFIGURED]',
                    instructions: [
                        'Activate "Show number to recipient" in Transfermóvil',
                        `Transfer EXACTLY ${amount} CUP`,
                        `To card: ${PAGO_CUP_TARJETA || '[NOT CONFIGURED]'}`,
                        'Use the same linked phone'
                    ]
                };
                break;
            case 'saldo':
                paymentInfo = {
                    method: 'Mobile Balance',
                    target: PAGO_SALDO_MOVIL || '[NOT CONFIGURED]',
                    instructions: [
                        `Send balance to: ${PAGO_SALDO_MOVIL || '[NOT CONFIGURED]'}`,
                        `Exact amount: ${amount}`,
                        'Take screenshot of the transfer',
                        'Don\'t wait for SMS confirmation'
                    ]
                };
                break;
            case 'usdt':
                paymentInfo = {
                    method: 'USDT BEP20',
                    target: PAGO_USDT_ADDRESS || '[NOT CONFIGURED]',
                    instructions: [
                        `Send USDT (BEP20) to: ${PAGO_USDT_ADDRESS || '[NOT CONFIGURED]'}`,
                        `Exact amount: ${amount} USDT`,
                        `From wallet: ${usdtWallet}`,
                        'ONLY BEP20 network (Binance Smart Chain)',
                        'Save transaction hash'
                    ]
                };
                break;
        }
        
        res.json({
            success: true,
            order: {
                id: transaction.id,
                amount: amount,
                currency: currency,
                bonus: bono,
                tokens: tokens,
                total: totalConBono,
                status: 'pending'
            },
            paymentInfo: paymentInfo
        });
        
    } catch (error) {
        console.error('Error creating deposit:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 5. Verify USDT transaction web
app.post('/api/verify-usdt', requireAuth, async (req, res) => {
    try {
        const { txHash, orderId } = req.body;
        const userId = req.session.userId;
        
        if (!txHash || !orderId) {
            return res.status(400).json({ error: 'Missing required data' });
        }
        
        // Get order
        const { data: order, error: orderError } = await supabase
            .from('transactions')
            .select('*')
            .eq('id', orderId)
            .eq('user_id', userId)
            .single();
        
        if (orderError || !order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        if (order.currency !== 'usdt') {
            return res.status(400).json({ error: 'This order is not USDT' });
        }
        
        if (order.status !== 'pending') {
            return res.status(400).json({ error: 'This order was already processed' });
        }
        
        // Verify transaction in BSC
        const verification = await checkBSCTransaction(txHash, order.amount_requested, PAGO_USDT_ADDRESS);
        
        if (!verification.success) {
            return res.status(400).json({ 
                error: 'Could not verify transaction',
                details: verification.error || 'Transaction not found or invalid'
            });
        }
        
        // Verify transaction comes from correct wallet
        if (verification.from.toLowerCase() !== order.usdt_wallet.toLowerCase()) {
            return res.status(400).json({ 
                error: 'Transaction doesn\'t come from registered wallet',
                expected: order.usdt_wallet,
                received: verification.from
            });
        }
        
        // Update order with hash
        const { error: updateError } = await supabase
            .from('transactions')
            .update({ 
                tx_id: txHash,
                status: 'verifying'
            })
            .eq('id', orderId);
        
        if (updateError) {
            throw updateError;
        }
        
        // Notify internal endpoint for processing
        try {
            await axios.post(`http://localhost:${PORT}/payment-notification`, {
                auth_token: WEBHOOK_SECRET_KEY,
                type: 'USDT_VERIFIED',
                user_id: userId,
                amount: verification.amount,
                currency: 'usdt',
                tx_id: txHash,
                tipo_pago: 'USDT_WEB'
            });
        } catch (notifError) {
            console.error('Error notifying:', notifError);
        }
        
        res.json({
            success: true,
            message: 'Transaction verified. Processing payment...',
            transaction: {
                hash: txHash,
                amount: verification.amount,
                from: verification.from,
                status: 'verifying'
            }
        });
        
    } catch (error) {
        console.error('Error verifying USDT:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 6. Claim payment by ID web
app.post('/api/claim-payment', requireAuth, async (req, res) => {
    try {
        const { txId } = req.body;
        const userId = req.session.userId;
        
        if (!txId) {
            return res.status(400).json({ error: 'Transaction ID required' });
        }
        
        // Find pending payment
        const { data: pendingPayment, error: paymentError } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('tx_id', txId.trim().toUpperCase())
            .eq('claimed', false)
            .single();
        
        if (paymentError || !pendingPayment) {
            return res.status(404).json({ error: 'Pending payment not found' });
        }
        
        // Verify payment belongs to user
        const user = await getUser(userId);
        if (!user || (user.telegram_id !== pendingPayment.user_id && user.phone_number !== pendingPayment.phone)) {
            return res.status(403).json({ error: 'This payment doesn\'t belong to you' });
        }
        
        // Notify internal endpoint to process
        try {
            const result = await axios.post(`http://localhost:${PORT}/payment-notification`, {
                auth_token: WEBHOOK_SECRET_KEY,
                type: 'CLAIM_PAYMENT',
                user_id: userId,
                amount: pendingPayment.amount,
                currency: pendingPayment.currency,
                tx_id: pendingPayment.tx_id,
                tipo_pago: pendingPayment.tipo_pago,
                payment_id: pendingPayment.id
            });
            
            if (result.data.success) {
                // Mark as claimed
                await supabase
                    .from('pending_sms_payments')
                    .update({ 
                        claimed: true, 
                        claimed_by: userId,
                        claimed_at: new Date().toISOString()
                    })
                    .eq('id', pendingPayment.id);
            }
            
            res.json(result.data);
            
        } catch (botError) {
            console.error('Error contacting service:', botError);
            res.status(500).json({ error: 'Error processing payment' });
        }
        
    } catch (error) {
        console.error('Error claiming payment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 7. Web logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error in logout:', err);
            return res.status(500).json({ error: 'Error closing session' });
        }
        console.log('✅ Session closed successfully');
        res.json({ success: true });
    });
});

// 8. Check web session
app.get('/api/check-session', (req, res) => {
    console.log('🔍 Checking session:', req.session);
    
    if (req.session.userId && req.session.authenticated) {
        res.json({ 
            authenticated: true, 
            userId: req.session.userId,
            sessionId: req.sessionID
        });
    } else {
        res.json({ 
            authenticated: false,
            sessionId: req.sessionID
        });
    }
});

// 9. Verify USDT transactions automatically
app.post('/api/check-usdt-transactions', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await getUser(userId);
        
        if (!user || !user.usdt_wallet) {
            return res.json({ success: false, message: 'No wallet configured' });
        }
        
        if (!BSCSCAN_API_KEY) {
            return res.json({ success: false, message: 'BSCScan service not configured' });
        }
        
        // Get user's pending orders
        const { data: pendingOrders } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', 'usdt')
            .eq('type', 'DEPOSIT');
        
        if (!pendingOrders || pendingOrders.length === 0) {
            return res.json({ success: false, message: 'No pending orders' });
        }
        
        // Verify transactions from user's wallet to our address
        const url = `https://api.bscscan.com/api?module=account&action=txlist&address=${PAGO_USDT_ADDRESS}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc&apikey=${BSCSCAN_API_KEY}`;
        const response = await axios.get(url);
        
        let foundTransactions = [];
        
        if (response.data.status === '1') {
            const transactions = response.data.result;
            
            for (const order of pendingOrders) {
                // Find matching transaction
                const matchingTx = transactions.find(tx => {
                    const txAmount = parseFloat(web3.utils.fromWei(tx.value, 'ether'));
                    const amountDiff = Math.abs(txAmount - order.amount_requested);
                    const margin = order.amount_requested * 0.01;
                    
                    return tx.from.toLowerCase() === user.usdt_wallet.toLowerCase() &&
                           amountDiff <= margin &&
                           tx.to.toLowerCase() === PAGO_USDT_ADDRESS.toLowerCase();
                });
                
                if (matchingTx) {
                    foundTransactions.push({
                        orderId: order.id,
                        txHash: matchingTx.hash,
                        amount: parseFloat(web3.utils.fromWei(matchingTx.value, 'ether'))
                    });
                }
            }
        }
        
        res.json({
            success: true,
            found: foundTransactions.length > 0,
            transactions: foundTransactions
        });
        
    } catch (error) {
        console.error('Error verifying transactions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 10. Admin statistics
app.get('/api/admin/stats', requireAuth, async (req, res) => {
    try {
        const user = await getUser(req.session.userId);
        
        // Verify if admin
        const adminId = process.env.ADMIN_GROUP || '';
        if (!adminId || user.telegram_id.toString() !== adminId.replace('-100', '')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // General statistics
        const { count: totalUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
        
        const { data: recentTransactions } = await supabase
            .from('transactions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        
        const { data: allPending } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('claimed', false);
        
        // Calculate totals by currency
        const { data: balances } = await supabase
            .from('users')
            .select('balance_cup, balance_saldo, balance_usdt');
        
        let totalCup = 0, totalSaldo = 0, totalUsdt = 0;
        if (balances) {
            balances.forEach(user => {
                totalCup += user.balance_cup || 0;
                totalSaldo += user.balance_saldo || 0;
                totalUsdt += user.balance_usdt || 0;
            });
        }
        
        // Active users today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const { data: activeUsers } = await supabase
            .from('users')
            .select('telegram_id, first_name, last_active')
            .gte('last_active', today.toISOString());
        
        res.json({
            success: true,
            stats: {
                totalUsers,
                totalCup,
                totalSaldo,
                totalUsdt,
                pendingPayments: allPending ? allPending.length : 0,
                activeToday: activeUsers ? activeUsers.length : 0,
                recentTransactions: recentTransactions ? recentTransactions.length : 0
            },
            recentTransactions: recentTransactions || [],
            pendingPayments: allPending || [],
            activeUsers: activeUsers || []
        });
        
    } catch (error) {
        console.error('Error getting statistics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 11. Debug endpoint to see sessions
app.get('/api/debug', (req, res) => {
    res.json({
        session: req.session,
        sessionId: req.sessionID,
        cookies: req.cookies,
        headers: req.headers
    });
});

// 12. Debug all sessions (development only)
app.get('/api/debug-all-sessions', (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ error: 'Only in development' });
    }
    
    res.json({
        activeSessions: Object.keys(activeSessions),
        totalSessions: Object.keys(activeSessions).length
    });
});

// 13. Debug session endpoint
app.get('/api/debug-session', (req, res) => {
    res.json({
        session: req.session,
        sessionID: req.sessionID,
        cookies: req.cookies
    });
});

// 14. Route to serve HTML files
app.get('/', (req, res) => {
    if (req.session.authenticated) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(__dirname + '/public/index.html');
    }
});

app.get('/dashboard', (req, res) => {
    console.log('📄 Accessing dashboard, session:', req.session);
    
    if (req.session.userId && req.session.authenticated) {
        console.log('✅ User authenticated, serving dashboard');
        res.sendFile(__dirname + '/public/dashboard.html');
    } else {
        console.log('❌ User not authenticated, redirecting to login');
        res.redirect('/');
    }
});

app.get('/admin', requireAuth, async (req, res) => {
    const user = await getUser(req.session.userId);
    const adminId = process.env.ADMIN_GROUP || '';
    
    if (!adminId || user.telegram_id.toString() !== adminId.replace('-100', '')) {
        return res.redirect('/dashboard');
    }
    
    res.sendFile(__dirname + '/public/admin.html');
});

// Route to serve any dashboard file
app.get('/:page', (req, res) => {
    const page = req.params.page;
    if (page.includes('.html') || page.includes('.css') || page.includes('.js') || page.includes('.ico')) {
        res.sendFile(__dirname + '/public/' + page);
    } else {
        res.redirect('/');
    }
});

// ============================================
// RUTAS ADICIONALES NECESARIAS PARA EL DASHBOARD
// ============================================

// Ruta para notificaciones (vacía por ahora)
app.get('/api/notificaciones', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    // Obtener notificaciones del usuario
    const { data: notifications } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    res.json({
      success: true,
      notifications: notifications || []
    });
  } catch (error) {
    console.error('Error obteniendo notificaciones:', error);
    res.json({ success: true, notifications: [] });
  }
});

// Ruta para pagos pendientes
app.get('/api/pagos-pendientes', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await getUser(userId);
    
    const { data: pendingPayments } = await supabase
      .from('pending_sms_payments')
      .select('*')
      .eq('claimed', false)
      .or(`user_id.eq.${userId},phone.eq.${user.phone_number}`);
    
    res.json({
      success: true,
      pendingPayments: pendingPayments || []
    });
  } catch (error) {
    console.error('Error obteniendo pagos pendientes:', error);
    res.json({ success: true, pendingPayments: [] });
  }
});

// WebSocket endpoint (simulado)
app.get('/ws', (req, res) => {
  res.status(404).json({ error: 'WebSocket no implementado' });
});

// Ruta para el service worker
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.sendFile(__dirname + '/public/sw.js');
});

// ============================================
// SCHEDULERS AND SCHEDULED TASKS
// ============================================

// Schedule to verify pending balances
setInterval(async () => {
    try {
        const { data: users } = await supabase
            .from('users')
            .select('*')
            .gte('pending_balance_cup', MINIMO_CUP);
        
        if (users && users.length > 0) {
            console.log(`📊 Processing ${users.length} users with pending balance...`);
            
            for (const user of users) {
                const montoConBono = await aplicarBonoPrimerDeposito(user.telegram_id, 'cup', user.pending_balance_cup);
                const nuevoSaldo = (user.balance_cup || 0) + montoConBono;
                
                await updateUser(user.telegram_id, { 
                    balance_cup: nuevoSaldo,
                    pending_balance_cup: 0 
                });
                
                await supabase.from('transactions').insert({
                    user_id: user.telegram_id,
                    type: 'AUTO_ACCUMULATED',
                    currency: 'cup',
                    amount: montoConBono,
                    amount_requested: user.pending_balance_cup,
                    status: 'completed',
                    tx_id: `ACCUM_${Date.now()}`,
                    tipo_pago: 'ACUMULADO'
                });
                
                const bonoMensaje = montoConBono > user.pending_balance_cup ? 
                    `\n🎉 *¡Bonus applied!* +${formatCurrency(montoConBono - user.pending_balance_cup, 'cup')}` : '';
                
                await bot.sendMessage(user.telegram_id,
                    `🎉 *¡Pending Balance Credited!*\n\n` +
                    `Accumulated: ${formatCurrency(user.pending_balance_cup, 'cup')}\n` +
                    `${bonoMensaje}\n` +
                    `💵 Total: *${formatCurrency(montoConBono, 'cup')}*\n\n` +
                    `📊 New CUP balance: *${formatCurrency(nuevoSaldo, 'cup')}*\n\n` +
                    `✅ ¡Now you can use your balance!`,
                    { parse_mode: 'Markdown' }
                );
                
                console.log(`✅ Pending balance credited for ${user.telegram_id}`);
            }
        }
    } catch (error) {
        console.error('❌ Error in pending balance schedule:', error);
    }
}, 5 * 60 * 1000); // Every 5 minutes

// Schedule to verify USDT automatically
setInterval(async () => {
    if (!BSCSCAN_API_KEY || !PAGO_USDT_ADDRESS) return;
    
    try {
        const { data: pendingUsdt } = await supabase
            .from('transactions')
            .select('*, users!inner(usdt_wallet, telegram_id)')
            .eq('status', 'pending')
            .eq('currency', 'usdt')
            .eq('type', 'DEPOSIT')
            .not('users.usdt_wallet', 'is', null);
        
        if (pendingUsdt && pendingUsdt.length > 0) {
            console.log(`🔍 Verifying ${pendingUsdt.length} pending USDT transactions...`);
            
            for (const tx of pendingUsdt) {
                const user = tx.users;
                
                const url = `https://api.bscscan.com/api?module=account&action=txlist&address=${PAGO_USDT_ADDRESS}&startblock=0&endblock=99999999&sort=desc&apikey=${BSCSCAN_API_KEY}`;
                const response = await axios.get(url);
                
                if (response.data.status === '1') {
                    const transactions = response.data.result;
                    
                    const userTx = transactions.find(t => 
                        t.from.toLowerCase() === user.usdt_wallet.toLowerCase() &&
                        Math.abs(parseFloat(web3.utils.fromWei(t.value, 'ether')) - tx.amount_requested) <= (tx.amount_requested * 0.01)
                    );
                    
                    if (userTx) {
                        const result = await procesarPagoAutomatico(
                            user.telegram_id,
                            parseFloat(web3.utils.fromWei(userTx.hash, 'ether')),
                            'usdt',
                            userTx.hash,
                            'USDT_AUTO_DETECTED'
                        );
                        
                        if (result.success) {
                            console.log(`✅ USDT automatically detected for ${user.telegram_id}`);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error verifying automatic USDT:', error);
    }
}, 10 * 60 * 1000); // Every 10 minutes

// Clean inactive sessions
setInterval(() => {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes
    
    for (const [chatId, session] of Object.entries(activeSessions)) {
        if (session.lastActivity && (now - session.lastActivity) > timeout) {
            delete activeSessions[chatId];
            console.log(`🧹 Session cleaned for ${chatId}`);
        }
    }
}, 10 * 60 * 1000); // Every 10 minutes

// ============================================
// START SERVERS
// ============================================

// Main server (bot + API)
app.listen(PORT, () => {
    console.log(`\n🤖 Cromwell Bot & Server started`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🛠️ Admin: http://localhost:${PORT}/admin`);
    console.log(`🔄 Keep alive: http://localhost:${PORT}/keepalive`);
    console.log(`🔐 Security: ${WEBHOOK_SECRET_KEY ? '✅ ENABLED' : '⚠️ DISABLED'}`);
    console.log(`💰 Minimums: CUP=${MINIMO_CUP}, Balance=${MINIMO_SALDO}, USDT=${MINIMO_USDT}`);
    console.log(`📞 Phone for payments: ${PAGO_SALDO_MOVIL || '❌ Not configured'}`);
    console.log(`💳 Card for payments: ${PAGO_CUP_TARJETA ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`🪙 USDT Address: ${PAGO_USDT_ADDRESS ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`\n🚀 Bot ready to receive messages...`);
});

// Global error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled promise rejection:', reason);
});
