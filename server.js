require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const Web3 = require('web3');

const app = express();
const supabase = createClient(process.env.DB_URL, process.env.DB_KEY);
const web3 = new Web3(new Web3.providers.HttpProvider('https://bsc-dataseed.binance.org/'));

// Configuración
const WEB_SECRET = process.env.WEB_SECRET_KEY || 'cromwell-store-secret-key-2024';
const WEB_PORT = process.env.WEB_PORT || 8080;
const MIN_CUP = parseFloat(process.env.MINIMO_CUP || 1000);
const MIN_SALDO = parseFloat(process.env.MINIMO_SALDO || 500);
const MIN_USDT = parseFloat(process.env.MINIMO_USDT || 10);
const USDT_ADDRESS = process.env.PAGO_USDT_ADDRESS;
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || '';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: WEB_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Función de autenticación middleware
function requireAuth(req, res, next) {
    if (req.session.userId && req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'No autorizado' });
    }
}

// Función para obtener usuario por ID
async function getUser(userId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', userId)
        .single();
    
    if (error) return null;
    return data;
}

// Función para obtener usuario por teléfono
async function getUserByPhone(phone) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('phone_number', phone)
        .single();
    
    if (error) return null;
    return data;
}

// Función para verificar transacción BSC
async function checkBSCTransaction(txHash, expectedAmount, expectedTo) {
    try {
        const url = `https://api.bscscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${BSCSCAN_API_KEY}`;
        const response = await axios.get(url);
        
        if (response.data.status === '1') {
            const detailsUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${BSCSCAN_API_KEY}`;
            const details = await axios.get(detailsUrl);
            
            if (details.data.result) {
                const tx = details.data.result;
                if (tx.to.toLowerCase() === expectedTo.toLowerCase()) {
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
        console.error('Error verificando transacción:', error);
        return { success: false, error: error.message };
    }
}

// --- Rutas de la API Web ---

// 1. Login
app.post('/api/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Faltan credenciales' });
        }
        
        // Buscar usuario por Telegram ID o teléfono
        let user;
        
        if (identifier.startsWith('@') || !isNaN(identifier)) {
            // Es un Telegram ID
            const telegramId = identifier.replace('@', '');
            user = await getUser(parseInt(telegramId));
        } else {
            // Es un teléfono
            const phone = identifier.replace(/[^\d]/g, '');
            user = await getUserByPhone(phone);
        }
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar contraseña web (si tiene)
        if (user.web_password) {
            const validPassword = await bcrypt.compare(password, user.web_password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Contraseña incorrecta' });
            }
        } else {
            // Usuario no tiene contraseña web registrada
            return res.status(403).json({ 
                error: 'Debes registrar una contraseña primero',
                needsRegistration: true,
                userId: user.telegram_id 
            });
        }
        
        // Crear sesión
        req.session.userId = user.telegram_id;
        req.session.authenticated = true;
        req.session.userData = {
            telegramId: user.telegram_id,
            username: user.username,
            firstName: user.first_name,
            phone: user.phone_number
        };
        
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
        
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 2. Registro de contraseña web
app.post('/api/register-password', async (req, res) => {
    try {
        const { identifier, password, confirmPassword } = req.body;
        
        if (!identifier || !password || !confirmPassword) {
            return res.status(400).json({ error: 'Faltan datos' });
        }
        
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Las contraseñas no coinciden' });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }
        
        // Buscar usuario
        let user;
        
        if (identifier.startsWith('@') || !isNaN(identifier)) {
            const telegramId = identifier.replace('@', '');
            user = await getUser(parseInt(telegramId));
        } else {
            const phone = identifier.replace(/[^\d]/g, '');
            user = await getUserByPhone(phone);
        }
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar si ya tiene contraseña
        if (user.web_password) {
            return res.status(400).json({ error: 'Ya tienes una contraseña registrada' });
        }
        
        // Hash de la contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Actualizar usuario
        const { error } = await supabase
            .from('users')
            .update({ web_password: hashedPassword })
            .eq('telegram_id', user.telegram_id);
        
        if (error) {
            throw error;
        }
        
        // Enviar notificación al bot de Telegram
        if (process.env.TELEGRAM_BOT_URL) {
            try {
                await axios.post(`${process.env.TELEGRAM_BOT_URL}/web-notification`, {
                    type: 'WEB_REGISTRATION',
                    user_id: user.telegram_id,
                    user_name: user.first_name,
                    timestamp: new Date().toISOString()
                });
            } catch (notifError) {
                console.error('Error enviando notificación:', notifError);
            }
        }
        
        res.json({ success: true, message: 'Contraseña registrada exitosamente' });
        
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 3. Obtener datos del usuario (protegido)
app.get('/api/user-data', requireAuth, async (req, res) => {
    try {
        const user = await getUser(req.session.userId);
        
        if (!user) {
            req.session.destroy();
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Obtener transacciones recientes
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', user.telegram_id)
            .order('created_at', { ascending: false })
            .limit(10);
        
        // Obtener pagos pendientes
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
                accepted_terms: user.accepted_terms || false
            },
            transactions: transactions || [],
            pendingPayments: pendingPayments || [],
            stats: {
                total_deposits: transactions ? transactions.filter(t => t.type === 'DEPOSIT' && t.status === 'completed').length : 0,
                total_amount: transactions ? transactions.filter(t => t.status === 'completed').reduce((sum, t) => sum + (t.amount || 0), 0) : 0,
                pending_count: pendingPayments ? pendingPayments.length : 0
            }
        });
        
    } catch (error) {
        console.error('Error obteniendo datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 4. Crear solicitud de depósito
app.post('/api/create-deposit', requireAuth, async (req, res) => {
    try {
        const { currency, amount, usdtWallet } = req.body;
        const userId = req.session.userId;
        
        if (!currency || !amount) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }
        
        // Validar monto mínimo
        const minimos = { cup: MIN_CUP, saldo: MIN_SALDO, usdt: MIN_USDT };
        if (amount < minimos[currency]) {
            return res.status(400).json({ 
                error: `Monto mínimo: ${minimos[currency]} ${currency.toUpperCase()}` 
            });
        }
        
        const user = await getUser(userId);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Para USDT, validar wallet
        if (currency === 'usdt') {
            if (!usdtWallet) {
                return res.status(400).json({ error: 'Se requiere wallet para USDT' });
            }
            if (!usdtWallet.startsWith('0x') || usdtWallet.length !== 42) {
                return res.status(400).json({ error: 'Wallet USDT inválida' });
            }
        }
        
        // Verificar si ya tiene una solicitud pendiente
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
                error: 'Ya tienes una solicitud pendiente para este método',
                existingOrder: pendingTx[0]
            });
        }
        
        // Calcular bono y tokens
        const bonoPorcentaje = currency === 'usdt' ? 0.05 : 0.10;
        const bono = user[`first_dep_${currency}`] ? amount * bonoPorcentaje : 0;
        const totalConBono = amount + bono;
        
        // Calcular tokens
        let tokens = 0;
        if (currency === 'saldo') {
            tokens = Math.floor(amount / 100) * 10; // 10 CWS por cada 100
        } else if (currency === 'usdt') {
            tokens = (amount / 10) * 0.5; // 0.5 CWT por cada 10 USDT
        }
        
        // Crear transacción
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
        
        // Preparar datos de respuesta
        let paymentInfo = {};
        
        switch (currency) {
            case 'cup':
                paymentInfo = {
                    method: 'Tarjeta',
                    target: process.env.PAGO_CUP_TARJETA,
                    instructions: [
                        'Activar "Mostrar número al destinatario" en Transfermóvil',
                        `Transferir EXACTAMENTE ${amount} CUP`,
                        `A la tarjeta: ${process.env.PAGO_CUP_TARJETA}`,
                        'Usar el mismo teléfono vinculado'
                    ]
                };
                break;
            case 'saldo':
                paymentInfo = {
                    method: 'Saldo Móvil',
                    target: process.env.PAGO_SALDO_MOVIL,
                    instructions: [
                        `Enviar saldo a: ${process.env.PAGO_SALDO_MOVIL}`,
                        `Monto exacto: ${amount}`,
                        'Tomar captura de pantalla de la transferencia',
                        'No esperar al SMS de confirmación'
                    ]
                };
                break;
            case 'usdt':
                paymentInfo = {
                    method: 'USDT BEP20',
                    target: USDT_ADDRESS,
                    instructions: [
                        `Enviar USDT (BEP20) a: ${USDT_ADDRESS}`,
                        `Monto exacto: ${amount} USDT`,
                        `Desde wallet: ${usdtWallet}`,
                        'SOLO red BEP20 (Binance Smart Chain)',
                        'Guardar el hash de transacción'
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
        console.error('Error creando depósito:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 5. Verificar transacción USDT
app.post('/api/verify-usdt', requireAuth, async (req, res) => {
    try {
        const { txHash, orderId } = req.body;
        const userId = req.session.userId;
        
        if (!txHash || !orderId) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }
        
        // Obtener orden
        const { data: order, error: orderError } = await supabase
            .from('transactions')
            .select('*')
            .eq('id', orderId)
            .eq('user_id', userId)
            .single();
        
        if (orderError || !order) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }
        
        if (order.currency !== 'usdt') {
            return res.status(400).json({ error: 'Esta orden no es de USDT' });
        }
        
        if (order.status !== 'pending') {
            return res.status(400).json({ error: 'Esta orden ya fue procesada' });
        }
        
        // Verificar transacción en BSC
        const verification = await checkBSCTransaction(txHash, order.amount_requested, USDT_ADDRESS);
        
        if (!verification.success) {
            return res.status(400).json({ 
                error: 'No se pudo verificar la transacción',
                details: verification.error || 'Transacción no encontrada o inválida'
            });
        }
        
        // Verificar que la transacción venga de la wallet correcta
        if (verification.from.toLowerCase() !== order.usdt_wallet.toLowerCase()) {
            return res.status(400).json({ 
                error: 'La transacción no viene de la wallet registrada',
                expected: order.usdt_wallet,
                received: verification.from
            });
        }
        
        // Actualizar orden con el hash
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
        
        // Notificar al bot para procesamiento
        if (process.env.TELEGRAM_BOT_URL) {
            try {
                await axios.post(`${process.env.TELEGRAM_BOT_URL}/payment-notification`, {
                    type: 'USDT_VERIFIED',
                    user_id: userId,
                    amount: verification.amount,
                    currency: 'usdt',
                    tx_id: txHash,
                    tipo_pago: 'USDT_WEB'
                });
            } catch (notifError) {
                console.error('Error notificando al bot:', notifError);
            }
        }
        
        res.json({
            success: true,
            message: 'Transacción verificada. Procesando pago...',
            transaction: {
                hash: txHash,
                amount: verification.amount,
                from: verification.from,
                status: 'verifying'
            }
        });
        
    } catch (error) {
        console.error('Error verificando USDT:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 6. Reclamar pago por ID
app.post('/api/claim-payment', requireAuth, async (req, res) => {
    try {
        const { txId } = req.body;
        const userId = req.session.userId;
        
        if (!txId) {
            return res.status(400).json({ error: 'ID de transacción requerido' });
        }
        
        // Buscar pago pendiente
        const { data: pendingPayment, error: paymentError } = await supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('tx_id', txId.trim().toUpperCase())
            .eq('claimed', false)
            .single();
        
        if (paymentError || !pendingPayment) {
            return res.status(404).json({ error: 'Pago pendiente no encontrado' });
        }
        
        // Verificar que el pago pertenece al usuario
        const user = await getUser(userId);
        if (!user || (user.telegram_id !== pendingPayment.user_id && user.phone_number !== pendingPayment.phone)) {
            return res.status(403).json({ error: 'Este pago no te pertenece' });
        }
        
        // Notificar al bot para procesar
        if (process.env.TELEGRAM_BOT_URL) {
            try {
                const result = await axios.post(`${process.env.TELEGRAM_BOT_URL}/payment-notification`, {
                    type: 'CLAIM_PAYMENT',
                    user_id: userId,
                    amount: pendingPayment.amount,
                    currency: pendingPayment.currency,
                    tx_id: pendingPayment.tx_id,
                    tipo_pago: pendingPayment.tipo_pago,
                    payment_id: pendingPayment.id
                });
                
                if (result.data.success) {
                    // Marcar como reclamado
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
                console.error('Error contactando al bot:', botError);
                res.status(500).json({ error: 'Error procesando el pago' });
            }
        } else {
            res.status(500).json({ error: 'Servicio de bot no disponible' });
        }
        
    } catch (error) {
        console.error('Error reclamando pago:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 7. Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Error cerrando sesión' });
        }
        res.json({ success: true });
    });
});

// 8. Verificar sesión
app.get('/api/check-session', (req, res) => {
    if (req.session.userId && req.session.authenticated) {
        res.json({ authenticated: true, userId: req.session.userId });
    } else {
        res.json({ authenticated: false });
    }
});

// 9. Endpoint para verificar pagos USDT automáticamente
app.post('/api/check-usdt-transactions', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await getUser(userId);
        
        if (!user || !user.usdt_wallet) {
            return res.json({ success: false, message: 'No hay wallet configurada' });
        }
        
        if (!BSCSCAN_API_KEY) {
            return res.json({ success: false, message: 'Servicio BSCScan no configurado' });
        }
        
        // Obtener transacciones pendientes del usuario
        const { data: pendingOrders } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', 'usdt')
            .eq('type', 'DEPOSIT');
        
        if (!pendingOrders || pendingOrders.length === 0) {
            return res.json({ success: false, message: 'No hay órdenes pendientes' });
        }
        
        // Verificar transacciones desde la wallet del usuario a nuestra dirección
        const url = `https://api.bscscan.com/api?module=account&action=txlist&address=${USDT_ADDRESS}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc&apikey=${BSCSCAN_API_KEY}`;
        const response = await axios.get(url);
        
        let foundTransactions = [];
        
        if (response.data.status === '1') {
            const transactions = response.data.result;
            
            for (const order of pendingOrders) {
                // Buscar transacción que coincida
                const matchingTx = transactions.find(tx => {
                    const txAmount = parseFloat(web3.utils.fromWei(tx.value, 'ether'));
                    const amountDiff = Math.abs(txAmount - order.amount_requested);
                    const margin = order.amount_requested * 0.01;
                    
                    return tx.from.toLowerCase() === user.usdt_wallet.toLowerCase() &&
                           amountDiff <= margin &&
                           tx.to.toLowerCase() === USDT_ADDRESS.toLowerCase();
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
        console.error('Error verificando transacciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 10. Endpoint para admin (estadísticas)
app.get('/api/admin/stats', requireAuth, async (req, res) => {
    try {
        const user = await getUser(req.session.userId);
        
        // Verificar si es admin (comparar con ID configurado)
        const adminId = process.env.ADMIN_GROUP || '';
        if (user.telegram_id.toString() !== adminId.replace('-', '')) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        // Estadísticas generales
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
        
        // Calcular totales por moneda
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
        
        // Usuarios activos hoy
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
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 11. Ruta para servir el dashboard principal
app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

// 12. Ruta para servir el admin
app.get('/admin', requireAuth, async (req, res) => {
    const user = await getUser(req.session.userId);
    const adminId = process.env.ADMIN_GROUP || '';
    
    if (user.telegram_id.toString() !== adminId.replace('-', '')) {
        return res.redirect('/dashboard');
    }
    
    res.sendFile(__dirname + '/public/admin.html');
});

// 13. Ruta principal - redirige según autenticación
app.get('/', (req, res) => {
    if (req.session.authenticated) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(__dirname + '/public/index.html');
    }
});

// Iniciar servidor
app.listen(WEB_PORT, () => {
    console.log(`🌐 Cromwell Web escuchando en puerto ${WEB_PORT}`);
    console.log(`🔗 http://localhost:${WEB_PORT}`);
    console.log(`📊 Admin: http://localhost:${WEB_PORT}/admin`);
});
