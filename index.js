require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto-js');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

// Configuración inicial
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.DB_URL, process.env.DB_KEY);
const activeSessions = {};

// 1. FUNCIÓN DE COMUNICACIÓN CON EL SERVIDOR DE RECARGAS (Firma de Seguridad)
async function ejecutarRecargaAPI(path, data) {
    data.member_code = process.env.RECARGA_MEMBER_ID;
    const bodyString = JSON.stringify(data);
    // Generación de firma HMAC-SHA256 para proteger la transacción
    const signature = crypto.HmacSHA256(bodyString, process.env.RECARGA_API_SECRET).toString(crypto.enc.Hex);
    
    try {
        const res = await axios.post(`${process.env.RECARGA_ENDPOINT}${path}`, bodyString, {
            headers: { 'Content-Type': 'application/json', 'x-liog-sign': signature }
        });
        return res.data;
    } catch (err) {
        console.error("Error en API:", err.response?.data || err.message);
        return { ok: false, message: "El servidor de recargas no respondió correctamente." };
    }
}

// 2. COMANDO DE INICIO
bot.onText(/\/start/, async (msg) => {
    const { id, username, first_name } = msg.from;
    // Registrar o actualizar usuario en Supabase
    await supabase.from('users').upsert({ telegram_id: id, username, first_name });
    
    bot.sendMessage(id, `👋 ¡Hola ${first_name}!\n\nBienvenido al sistema de recargas automáticas. ¿Qué deseas hacer?`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💎 Comprar Diamantes MLBB', callback_data: 'shop' }],
                [{ text: '👛 Mi Billetera / Saldo', callback_data: 'wallet' }]
            ]
        }
    });
});

// 3. MANEJO DE TODOS LOS BOTONES
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const [action, param1, param2] = query.data.split(':');

    // MENU BILLETERA
    if (action === 'wallet') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        bot.editMessageText(`👛 **Tu Billetera**\n\nCUP: $${u.balance_cup}\nSaldo: $${u.balance_saldo}\nUSDT: $${u.balance_usdt}\n\nSelecciona el método para recargar saldo:`, {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ CUP (Tarjeta)', callback_data: 'dep:cup' }, { text: '➕ Saldo (Móvil)', callback_data: 'dep:saldo' }],
                    [{ text: '➕ USDT (Crypto)', callback_data: 'dep:usdt' }],
                    [{ text: '🔙 Volver', callback_data: 'start_back' }]
                ]
            }
        });
    }

    // INICIAR DEPÓSITO
    if (action === 'dep') {
        let msgPago = param1 === 'cup' ? `💳 Envía tu transferencia a la tarjeta:\n\`${process.env.PAGO_CUP_TARJETA}\`` : 
                      param1 === 'saldo' ? `📱 Envía el saldo al número:\n\`${process.env.PAGO_SALDO_MOVIL}\`` : 
                      `💲 Dirección USDT (TRC20):\n\`${process.env.PAGO_USDT_ADRESS}\``;
        
        bot.sendMessage(chatId, `${msgPago}\n\n⚠️ **IMPORTANTE:** Una vez hecha la transferencia, envía la **FOTO** del comprobante por aquí.`, { parse_mode: 'Markdown' });
        activeSessions[chatId] = { step: 'waiting_proof', currency: param1 };
    }

    // TIENDA DE PRODUCTOS
    if (action === 'shop') {
        const { data: items } = await supabase.from('products').select('*').eq('is_active', true);
        const buttons = items.map(i => [{ text: `${i.name} - $${i.price_cup} CUP`, callback_data: `buy_select:${i.id}` }]);
        buttons.push([{ text: '🔙 Volver', callback_data: 'start_back' }]);
        bot.editMessageText("💎 **Selecciona el paquete que deseas:**", { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    }

    // SELECCIONAR MÉTODO DE PAGO PARA EL PRODUCTO
    if (action === 'buy_select') {
        const { data: p } = await supabase.from('products').select('*').eq('id', param1).single();
        bot.sendMessage(chatId, `¿Con qué saldo deseas pagar **${p.name}**?`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: `Pagar con CUP ($${p.price_cup})`, callback_data: `pay_now:${param1}:cup` }],
                    [{ text: `Pagar con Saldo ($${p.price_saldo})`, callback_data: `pay_now:${param1}:saldo` }],
                    [{ text: `Pagar con USDT ($${p.price_usdt})`, callback_data: `pay_now:${param1}:usdt` }]
                ]
            }
        });
    }

    // PROCESAR COMPRA (Verificar saldo y pedir ID)
    if (action === 'pay_now') {
        const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
        const { data: p } = await supabase.from('products').select('*').eq('id', param1).single();
        const costo = p[`price_${param2}`];

        if (u[`balance_${param2}`] < costo) {
            return bot.answerCallbackQuery(query.id, { text: "❌ No tienes suficiente saldo para esta compra.", show_alert: true });
        }

        activeSessions[chatId] = { step: 'ask_player_id', product: p, currency: param2, cost: costo };
        bot.sendMessage(chatId, "🎮 **Por favor, escribe tu ID de Jugador:**");
    }

    // ACCIÓN DEL ADMIN: APROBAR DEPÓSITO
    if (action === 'adm_ok') {
        activeSessions[chatId] = { step: 'adm_entering_amount', txId: param1 };
        bot.sendMessage(chatId, "💰 Escribe la cantidad de dinero a acreditar al usuario:");
    }

    if (action === 'start_back') {
        bot.editMessageText("SISTEMA DE RECARGAS", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: '🛒 Tienda', callback_data: 'shop' }], [{ text: '👛 Wallet', callback_data: 'wallet' }]] } });
    }
});

// 4. MANEJO DE TEXTO Y FOTOS (Lógica de flujo)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = activeSessions[chatId];
    if (!session || msg.text?.startsWith('/')) return;

    // A. EL USUARIO ENVÍA COMPROBANTE DE PAGO
    if (session.step === 'waiting_proof' && msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileUrl = await bot.getFileLink(fileId);
        
        // Subir a Supabase Storage
        const resp = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const filePath = `comprobantes/USER_${chatId}_${Date.now()}.jpg`;
        await supabase.storage.from('deposit-proofs').upload(filePath, resp.data);
        const { data: publicUrl } = supabase.storage.from('deposit-proofs').getPublicUrl(filePath);

        // Crear registro en transacciones
        const { data: tx } = await supabase.from('transactions').insert([{
            user_id: chatId, type: 'DEPOSIT', currency: session.currency, proof_url: publicUrl.publicUrl
        }]).select().single();

        // Avisar al Admin
        bot.sendPhoto(process.env.ADMIN_GROUP, fileId, {
            caption: `🚨 **NUEVO DEPÓSITO**\nUsuario: ${msg.from.first_name}\nID: \`${chatId}\`\nMoneda: ${session.currency.toUpperCase()}`,
            reply_markup: { inline_keyboard: [[{ text: '✅ Acreditar Saldo', callback_data: `adm_ok:${tx.id}` }]] }
        });

        bot.sendMessage(chatId, "✅ Recibido. Un administrador revisará tu pago.");
        delete activeSessions[chatId];
    }

    // B. EL ADMIN INGRESA EL MONTO A ACREDITAR
    if (session.step === 'adm_entering_amount' && chatId == process.env.BOT_ADMIN_ID) {
        const monto = parseFloat(msg.text);
        if (isNaN(monto)) return bot.sendMessage(chatId, "❌ Por favor introduce un número válido.");

        const { data: tx } = await supabase.from('transactions').select('*').eq('id', session.txId).single();
        const { data: user } = await supabase.from('users').select('*').eq('telegram_id', tx.user_id).single();
        
        // Actualizar saldo del usuario
        const nuevoSaldo = (user[`balance_${tx.currency}`] || 0) + monto;
        await supabase.from('users').update({ [`balance_${tx.currency}`]: nuevoSaldo }).eq('telegram_id', tx.user_id);
        await supabase.from('transactions').update({ status: 'completed', amount: monto }).eq('id', session.txId);
        
        bot.sendMessage(tx.user_id, `💰 **¡Saldo Acreditado!**\nSe han sumado +$${monto} ${tx.currency.toUpperCase()} a tu cuenta.`);
        bot.sendMessage(chatId, "✅ Saldo acreditado con éxito.");
        delete activeSessions[chatId];
    }

    // C. FLUJO DE COMPRA: PEDIR ID Y LUEGO SERVER ID
    if (session.step === 'ask_player_id') {
        session.player_tag = msg.text;
        session.step = 'ask_zone_id';
        bot.sendMessage(chatId, "📍 **Ahora escribe tu Zone ID (El número pequeño entre paréntesis):**");
    } else if (session.step === 'ask_zone_id') {
        const zone = msg.text;
        bot.sendMessage(chatId, "🚀 **Procesando tu recarga...**");
        
        // Llamada final al servidor de recargas
        const respuesta = await ejecutarRecargaAPI('/order-create', {
            product_id: session.product.api_prod_id,
            variation_id: session.product.api_var_id,
            user_id: session.player_tag,
            server_id: zone,
            qty: 1,
            partner_ref: `RECARGA-${Date.now()}`
        });

        if (respuesta.ok) {
            const { data: u } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            await supabase.from('users').update({ [`balance_${session.currency}`]: u[`balance_${session.currency}`] - session.cost }).eq('telegram_id', chatId);
            bot.sendMessage(chatId, `✅ **¡RECARGA EXITOSA!**\n\nProducto: ${session.product.name}\nID: ${session.player_tag}\nOrden: ${respuesta.data.order_id}\n\n¡Gracias por tu compra!`);
        } else {
            bot.sendMessage(chatId, `❌ **Error:** ${respuesta.message}\nTu saldo no ha sido descontado.`);
        }
        delete activeSessions[chatId];
    }
});

// Mini servidor para que Render mantenga vivo el bot
http.createServer((req, res) => { res.write("Bot Activo"); res.end(); }).listen(process.env.PORT || 3000);
