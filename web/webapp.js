const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const middleware = require('./middleware');
const db = require('../database');
const config = require('../config');
const utils = require('../utils');

// Import handlers
const GameRechargeHandler = require('../services/game_recharges');
const SokyRecargasHandler = require('../services/sokyrecargas');
const BolitaHandler = require('../services/BolitaHandler');
const TradingSignalsHandler = require('../services/TradingSignalsHandler');

const gameHandler = new GameRechargeHandler(require('../bot'), db.supabase);
const sokyHandler = new SokyRecargasHandler(require('../bot'), db.supabase);
const bolitaHandler = new BolitaHandler(require('../bot'), db.supabase);
const tradingHandler = new TradingSignalsHandler(require('../bot'), db.supabase);

// Get user data for WebApp
router.post('/user-data', async (req, res) => {
    console.log('📨 POST /api/user-data recibido');
    console.log('📦 Body:', req.body);
    console.log('🔍 telegram_id del body:', req.body.telegram_id);
    
    try {
        const { telegram_id } = req.body;
        
        if (!telegram_id) {
            console.error('❌ telegram_id no proporcionado');
            return res.status(400).json({ error: 'telegram_id es requerido' });
        }
        
        console.log('🔍 Buscando en DB usuario con telegram_id:', telegram_id);
        
        const { data: user, error } = await db.supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegram_id.toString())
            .single();
        
        console.log('🔍 Resultado de Supabase:');
        console.log('   - Error:', error);
        console.log('   - User encontrado:', user);
        
        if (error) {
            console.error('❌ Error de Supabase:', error);
            return res.status(404).json({ 
                error: 'Error en la consulta',
                details: error.message,
                hint: error.hint 
            });
        }
        
        if (!user) {
            console.error('❌ Usuario no encontrado en la tabla');
            return res.status(404).json({ 
                error: 'Usuario no encontrado',
                hint: 'Verifica que el telegram_id exista en la tabla users' 
            });
        }
        
        console.log('✅ Usuario encontrado, enviando respuesta...');
        
        // Get trading info
        const isVIP = await tradingHandler.isUserVIP(telegram_id);
        const { data: suscripcionActiva } = await db.supabase
            .from('trading_suscripciones')
            .select('*')
            .eq('user_id', telegram_id)
            .eq('estado', 'activa')
            .gte('fecha_fin', new Date().toISOString())
            .single();
        
        // Get bolita info
        const { data: apuestasRecientes } = await db.supabase
            .from('bolita_apuestas')
            .select('*')
            .eq('user_id', telegram_id)
            .order('created_at', { ascending: false })
            .limit(5);
        
        // Build response
        const safeUser = {
            telegram_id: user.telegram_id,
            first_name: user.first_name || 'Usuario',
            username: user.username || '',
            phone_number: user.phone_number || null,
            balance_cup: Number(user.balance_cup) || 0,
            balance_saldo: Number(user.balance_saldo) || 0,
            tokens_cws: Number(user.tokens_cws) || 0,
            first_dep_cup: Boolean(user.first_dep_cup === undefined ? true : user.first_dep_cup),
            first_dep_saldo: Boolean(user.first_dep_saldo === undefined ? true : user.first_dep_saldo),
            last_active: user.last_active || user.created_at || new Date().toISOString(),
            trading: {
                is_vip: isVIP,
                plan_activo: suscripcionActiva ? {
                    plan_id: suscripcionActiva.plan_id,
                    fecha_inicio: suscripcionActiva.fecha_inicio,
                    fecha_fin: suscripcionActiva.fecha_fin,
                    precio_pagado: suscripcionActiva.precio_pagado
                } : null
            },
            bolita: {
                apuestas_recientes: apuestasRecientes ? apuestasRecientes.map(apuesta => ({
                    id: apuesta.id,
                    tipo: apuesta.tipo_apuesta,
                    numero: apuesta.numero_apostado,
                    monto: apuesta.monto,
                    estado: apuesta.estado,
                    fecha: apuesta.created_at
                })) : []
            }
        };
        
        console.log('📤 Enviando usuario completo:', safeUser);
        
        res.json({
            success: true,
            user: safeUser
        });
        
    } catch (error) {
        console.error('💥 Error inesperado en /api/user-data:', error);
        console.error('💥 Stack trace:', error.stack);
        
        res.status(500).json({ 
            error: 'Error interno del servidor',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Create deposit from WebApp
router.post('/create-deposit', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, method, amount, phone } = req.body;
        
        if (!telegram_id || !method || !amount) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        const user = await db.getUser(telegram_id);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const minAmounts = { cup: config.MINIMO_CUP, saldo: config.MINIMO_SALDO };
        const maxAmounts = { cup: config.MAXIMO_CUP, saldo: 10000 };
        
        if (amount < minAmounts[method] || amount > maxAmounts[method]) {
            return res.json({ 
                success: false, 
                error: `Monto fuera de límites (${minAmounts[method]} - ${maxAmounts[method]})` 
            });
        }
        
        const ordenPendiente = await db.tieneOrdenPendiente(telegram_id, method);
        if (ordenPendiente) {
            return res.json({ 
                success: false, 
                error: 'Ya tienes una orden pendiente para este método' 
            });
        }
        
        const bonoPorcentaje = 0.10;
        const bono = user[`first_dep_${method}`] ? amount * bonoPorcentaje : 0;
        const totalConBono = amount + bono;
        const tokens = method === 'saldo' ? Math.floor(amount / 100) * config.CWS_PER_100_SALDO : 0;
        
        const { data: transaction, error } = await db.supabase
            .from('transactions')
            .insert([{
                user_id: telegram_id,
                type: 'DEPOSIT',
                currency: method,
                amount_requested: amount,
                estimated_bonus: bono,
                estimated_tokens: tokens,
                status: 'pending',
                user_name: user.first_name,
                user_username: user.username,
                user_phone: phone || user.phone_number
            }])
            .select()
            .single();
        
        if (error) throw error;
        
        await require('../bot').sendMessage(telegram_id,
            `🌐 *Solicitud de depósito desde WebApp*\n\n` +
            `🆔 Orden #${transaction.id}\n` +
            `💰 Monto: $${amount} ${method.toUpperCase()}\n` +
            `🎁 Bono: $${bono} (${bonoPorcentaje * 100}%)\n` +
            `💵 Total a acreditar: $${totalConBono} ${method.toUpperCase()}\n\n` +
            `Por favor, completa el pago según las instrucciones.`,
            { parse_mode: 'Markdown' }
        );
        
        if (config.ADMIN_CHAT_ID) {
            const adminMsg = `🌐 *NUEVA SOLICITUD WEBAPP*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                `💰 Monto: $${amount} ${method.toUpperCase()}\n` +
                `🎁 Bono: $${bono}\n` +
                `📋 Orden #: ${transaction.id}`;
            
            await require('../bot').sendMessage(config.ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        }
        
        res.json({ 
            success: true, 
            orderId: transaction.id,
            bono: bono,
            totalConBono: totalConBono,
            tokens: tokens
        });
        
    } catch (error) {
        console.error('Error en /api/create-deposit:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Get games list
router.get('/games', middleware.verifyWebhookToken, async (req, res) => {
    try {
        let GAMES;
        try {
            GAMES = require('../services/game_recharges.js').GAMES;
        } catch (e) {
            GAMES = {};
        }
        
        if (!GAMES || Object.keys(GAMES).length === 0) {
            GAMES = {
                66584: {
                    name: "Arena Breakout",
                    variations: {
                        528315: { name: "60 + 6 Bonds" }
                    },
                    input_schema: {
                        fields: [
                            { key: "user_id", label: "User ID", required: true, type: "text" },
                            { key: "server_id", label: "Server ID", required: true, type: "text" }
                        ]
                    }
                }
            };
        }
        
        const games = Object.entries(GAMES).map(([id, game]) => ({
            id,
            name: game.name,
            variations: game.variations,
            input_schema: game.input_schema
        }));
        
        res.json(games);
    } catch (error) {
        console.error('Error en /api/games:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Get game price
router.post('/game-price', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { game_id, variation_id } = req.body;
        
        if (!game_id || !variation_id) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        const prices = await gameHandler.getPackagePrice(game_id, variation_id);
        
        res.json({
            success: true,
            prices: prices
        });
        
    } catch (error) {
        console.error('Error en /api/game-price:', error);
        res.status(500).json({ error: error.message });
    }
});

// Purchase game from WebApp
router.post('/game-purchase', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, game_id, variation_id, payment_method, user_data, amount } = req.body;
        
        if (!telegram_id || !game_id || !variation_id || !payment_method || !amount) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        const user = await db.getUser(telegram_id);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        let balanceField = '';
        let currentBalance = 0;
        
        switch(payment_method) {
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
        
        if (currentBalance < amount) {
            return res.json({ 
                success: false, 
                error: `Saldo insuficiente. Necesitas: ${amount}, Tienes: ${currentBalance}` 
            });
        }
        
        const GAMES = require('../services/game_recharges.js').GAMES || {};
        const game = GAMES[game_id];
        const variation = game.variations[variation_id];
        
        if (!game || !variation) {
            return res.status(400).json({ error: 'Juego o variación no encontrada' });
        }
        
        const orderData = {
            product_id: game_id,
            variation_id: variation_id,
            user_id: user_data.user_id,
            server_id: user_data.server_id || null,
            quantity: 1,
            partner_ref: `WEBAPP_${telegram_id}_${Date.now()}`
        };
        
        const updates = {};
        updates[balanceField] = currentBalance - amount;
        
        await db.updateUser(telegram_id, updates);
        
        const { data: transaction, error: txError } = await db.supabase
            .from('transactions')
            .insert({
                user_id: telegram_id,
                type: 'GAME_RECHARGE',
                currency: payment_method,
                amount: -amount,
                status: 'completed',
                partner_ref: orderData.partner_ref,
                details: {
                    game: game.name,
                    package: variation.name,
                    game_data: user_data,
                    lio_order_id: orderData.partner_ref
                },
                completed_at: new Date().toISOString()
            })
            .select()
            .single();
        
        if (txError) throw txError;
        
        res.json({
            success: true,
            orderId: orderData.partner_ref,
            transactionId: transaction.id
        });
        
    } catch (error) {
        console.error('Error en /api/game-purchase:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get ETECSA offers
router.get('/etecsa-offers', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const offers = await sokyHandler.getOffers();
        
        if (!offers || offers.length === 0) {
            return res.json({ success: false, error: 'No hay ofertas disponibles' });
        }
        
        const formattedOffers = offers.map(offer => ({
            id: offer.id,
            name: offer.name,
            description: offer.description,
            prices: offer.prices,
            requires_email: offer.metadata?.has_email || false
        }));
        
        res.json({ success: true, offers: formattedOffers });
    } catch (error) {
        console.error('Error en /api/etecsa-offers:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// ETECSA recharge from WebApp
router.post('/etecsa-recharge', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, offer_id, price_id, phone, email, amount } = req.body;
        
        if (!telegram_id || !offer_id || !price_id || !phone || !amount) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        const user = await db.getUser(telegram_id);
        if (!user || user.balance_cup < amount) {
            return res.json({ 
                success: false, 
                error: 'Saldo CUP insuficiente' 
            });
        }
        
        const offers = await sokyHandler.getOffers();
        const offer = offers.find(o => o.id == offer_id);
        
        if (!offer) {
            return res.json({ success: false, error: 'Oferta no encontrada' });
        }
        
        const price = offer.prices.find(p => p.id == price_id);
        
        if (!price) {
            return res.json({ success: false, error: 'Precio no encontrado' });
        }
        
        const result = await sokyHandler.processRechargeWebApp({
            telegram_id,
            offer_id,
            price_id,
            phone,
            email,
            amount,
            user,
            offer,
            price
        });
        
        if (result.success) {
            res.json({
                success: true,
                transactionId: result.transactionId,
                message: 'Recarga procesada exitosamente'
            });
        } else {
            res.json({
                success: false,
                error: result.error || 'Error procesando la recarga'
            });
        }
        
    } catch (error) {
        console.error('Error en /api/etecsa-recharge:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update phone from WebApp
router.post('/update-phone', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, phone } = req.body;
        
        if (!telegram_id || !phone) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        const cleanPhone = phone.replace(/[^\d]/g, '');
        if (!cleanPhone.startsWith('53') || cleanPhone.length !== 10) {
            return res.json({ 
                success: false, 
                error: 'Formato inválido. Debe comenzar con 53 y tener 10 dígitos.' 
            });
        }
        
        const { data: existingUser } = await db.supabase
            .from('users')
            .select('telegram_id, first_name')
            .eq('phone_number', cleanPhone)
            .neq('telegram_id', telegram_id)
            .single();
        
        if (existingUser) {
            return res.json({ 
                success: false, 
                error: 'Este número ya está vinculado a otra cuenta.' 
            });
        }
        
        await db.updateUser(telegram_id, { phone_number: cleanPhone });
        
        res.json({ success: true, message: 'Teléfono actualizado exitosamente' });
        
    } catch (error) {
        console.error('Error en /api/update-phone:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Claim payment from WebApp
router.post('/claim-payment', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, tx_id } = req.body;
        
        if (!telegram_id || !tx_id) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        const { data: pendingPayment } = await db.supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('tx_id', tx_id)
            .eq('claimed', false)
            .single();
        
        if (!pendingPayment) {
            return res.json({ 
                success: false, 
                message: 'Pago no encontrado o ya reclamado' 
            });
        }
        
        const result = await utils.procesarPagoAutomatico(
            telegram_id,
            pendingPayment.amount,
            pendingPayment.currency,
            pendingPayment.tx_id,
            pendingPayment.tipo_pago
        );
        
        if (result.success) {
            await db.supabase
                .from('pending_sms_payments')
                .update({ claimed: true, claimed_by: telegram_id })
                .eq('id', pendingPayment.id);
            
            res.json({
                success: true,
                amount: pendingPayment.amount,
                currency: pendingPayment.currency
            });
        } else {
            res.json({ 
                success: false, 
                message: result.message 
            });
        }
        
    } catch (error) {
        console.error('Error en /api/claim-payment:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Get transaction history
router.get('/user-history', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id } = req.query;
        
        if (!telegram_id) {
            return res.status(400).json({ error: 'telegram_id es requerido' });
        }
        
        const { data: transactions } = await db.supabase
            .from('transactions')
            .select('*')
            .eq('user_id', telegram_id)
            .order('created_at', { ascending: false })
            .limit(20);
        
        res.json(transactions || []);
        
    } catch (error) {
        console.error('Error en /api/user-history:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Get WebApp configuration
router.get('/webapp-config', middleware.verifyWebhookToken, async (req, res) => {
    try {
        res.json({
            success: true,
            config: {
                pago_cup_tarjeta: config.PAGO_CUP_TARJETA || '',
                pago_saldo_movil: config.PAGO_SALDO_MOVIL || '',
                minimo_cup: config.MINIMO_CUP,
                minimo_saldo: config.MINIMO_SALDO,
                usdt_rate_0_30: config.USDT_RATE_0_30,
                usdt_rate_30_plus: config.USDT_RATE_30_PLUS,
                saldo_movil_rate: config.SALDO_MOVIL_RATE,
                min_cws_use: config.MIN_CWS_USE,
                cws_per_100_saldo: config.CWS_PER_100_SALDO,
                soky_rate_cup: config.SOKY_RATE_CUP
            }
        });
    } catch (error) {
        console.error('Error en /api/webapp-config:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============================================
// NUEVAS RUTAS PARA LA BOLITA
// ============================================

// Get sorteos activos de La Bolita
router.get('/bolita-sorteos', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { data: sorteos } = await db.supabase
            .from('bolita_sorteos')
            .select('*')
            .eq('estado', 'activo')
            .order('fecha', { ascending: true });
        
        res.json({
            success: true,
            sorteos: sorteos || []
        });
    } catch (error) {
        console.error('Error en /api/bolita-sorteos:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Hacer apuesta en La Bolita
router.post('/bolita-apostar', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, sorteo_id, tipo_apuesta, numero, posicion, monto } = req.body;
        
        if (!telegram_id || !sorteo_id || !tipo_apuesta || !numero || !monto) {
            return res.status(400).json({ success: false, error: 'Datos incompletos' });
        }
        
        const user = await db.getUser(telegram_id);
        if (!user) {
            return res.json({ success: false, error: 'Usuario no encontrado' });
        }
        
        if (user.balance_cup < monto) {
            return res.json({ success: false, error: 'Saldo CUP insuficiente' });
        }
        
        const resultado = await bolitaHandler.procesarApuestaWebApp({
            telegram_id,
            sorteo_id,
            tipo_apuesta,
            numero,
            posicion,
            monto,
            user
        });
        
        if (resultado.success) {
            res.json({
                success: true,
                apuestaId: resultado.apuestaId,
                ticketId: resultado.ticketId,
                message: 'Apuesta registrada exitosamente'
            });
        } else {
            res.json({
                success: false,
                error: resultado.error || 'Error procesando la apuesta'
            });
        }
        
    } catch (error) {
        console.error('Error en /api/bolita-apostar:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get mis apuestas de La Bolita
router.get('/bolita-mis-apuestas', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id } = req.query;
        
        if (!telegram_id) {
            return res.status(400).json({ success: false, error: 'telegram_id es requerido' });
        }
        
        const { data: apuestas } = await db.supabase
            .from('bolita_apuestas')
            .select('*, bolita_sorteos(numero_ganador, fecha, hora, estado)')
            .eq('user_id', telegram_id)
            .order('created_at', { ascending: false })
            .limit(20);
        
        res.json({
            success: true,
            apuestas: apuestas || []
        });
    } catch (error) {
        console.error('Error en /api/bolita-mis-apuestas:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// ============================================
// NUEVAS RUTAS PARA TRADING SIGNALS
// ============================================

// Get planes de trading disponibles
router.get('/trading-planes', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { data: planes } = await db.supabase
            .from('trading_planes')
            .select('*')
            .eq('activo', true)
            .order('precio', { ascending: true });
        
        res.json({
            success: true,
            planes: planes || []
        });
    } catch (error) {
        console.error('Error en /api/trading-planes:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Suscribirse a un plan de trading
router.post('/trading-suscribir', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id, plan_id, payment_method } = req.body;
        
        if (!telegram_id || !plan_id || !payment_method) {
            return res.status(400).json({ success: false, error: 'Datos incompletos' });
        }
        
        const user = await db.getUser(telegram_id);
        if (!user) {
            return res.json({ success: false, error: 'Usuario no encontrado' });
        }
        
        const { data: plan } = await db.supabase
            .from('trading_planes')
            .select('*')
            .eq('id', plan_id)
            .single();
        
        if (!plan) {
            return res.json({ success: false, error: 'Plan no encontrado' });
        }
        
        let balanceField = '';
        let currentBalance = 0;
        
        switch(payment_method) {
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
        
        if (currentBalance < plan.precio) {
            return res.json({ 
                success: false, 
                error: `Saldo insuficiente. Necesitas: ${plan.precio}, Tienes: ${currentBalance}` 
            });
        }
        
        const resultado = await tradingHandler.procesarSuscripcionWebApp({
            telegram_id,
            plan_id,
            payment_method,
            user,
            plan
        });
        
        if (resultado.success) {
            res.json({
                success: true,
                suscripcionId: resultado.suscripcionId,
                fecha_fin: resultado.fecha_fin,
                message: 'Suscripción activada exitosamente'
            });
        } else {
            res.json({
                success: false,
                error: resultado.error || 'Error procesando la suscripción'
            });
        }
        
    } catch (error) {
        console.error('Error en /api/trading-suscribir:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get mis señales de trading
router.get('/trading-mis-senales', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id } = req.query;
        
        if (!telegram_id) {
            return res.status(400).json({ success: false, error: 'telegram_id es requerido' });
        }
        
        const isVIP = await tradingHandler.isUserVIP(telegram_id);
        
        if (!isVIP) {
            return res.json({ 
                success: true, 
                is_vip: false,
                senales: [],
                message: 'No eres usuario VIP. Suscríbete para recibir señales.' 
            });
        }
        
        const { data: senales } = await db.supabase
            .from('trading_senales')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);
        
        res.json({
            success: true,
            is_vip: true,
            senales: senales || []
        });
    } catch (error) {
        console.error('Error en /api/trading-mis-senales:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Get información de mi suscripción de trading
router.get('/trading-mi-suscripcion', middleware.verifyWebhookToken, async (req, res) => {
    try {
        const { telegram_id } = req.query;
        
        if (!telegram_id) {
            return res.status(400).json({ success: false, error: 'telegram_id es requerido' });
        }
        
        const { data: suscripcion } = await db.supabase
            .from('trading_suscripciones')
            .select('*, trading_planes(nombre, duracion_dias)')
            .eq('user_id', telegram_id)
            .eq('estado', 'activa')
            .gte('fecha_fin', new Date().toISOString())
            .order('fecha_inicio', { ascending: false })
            .single();
        
        res.json({
            success: true,
            suscripcion: suscripcion || null
        });
    } catch (error) {
        console.error('Error en /api/trading-mi-suscripcion:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;
