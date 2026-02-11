const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// Web login endpoint
router.post('/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Credenciales faltantes' });
        }
        
        const telegramId = parseInt(identifier);
        if (isNaN(telegramId)) {
            return res.status(400).json({ error: 'Solo ID de Telegram (número) está permitido' });
        }
        
        const user = await db.getUser(telegramId);
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        if (user.web_password) {
            const validPassword = await bcrypt.compare(password, user.web_password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Contraseña incorrecta' });
            }
        } else {
            return res.status(403).json({ 
                error: 'Debes registrar una contraseña primero',
                needsRegistration: true,
                userId: user.telegram_id 
            });
        }
        
        req.session.userId = user.telegram_id;
        req.session.authenticated = true;
        req.session.userData = {
            telegramId: user.telegram_id,
            username: user.username,
            firstName: user.first_name,
            phone: user.phone_number
        };

        req.session.save((err) => {
            if (err) {
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            
            res.json({ 
                success: true, 
                user: {
                    id: user.telegram_id,
                    username: user.username,
                    firstName: user.first_name,
                    phone: user.phone_number,
                    balance_cup: user.balance_cup || 0,
                    balance_saldo: user.balance_saldo || 0,
                    tokens_cws: user.tokens_cws || 0
                }
            });
        });
        
    } catch (error) {
        console.error('❌ Error en login web:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Register web password
router.post('/register-password', async (req, res) => {
    try {
        const { telegram_id, password } = req.body;
        
        if (!telegram_id || !password) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }
        
        const user = await db.getUser(telegram_id);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await db.updateUser(telegram_id, { web_password: hashedPassword });
        
        res.json({ success: true, message: 'Contraseña registrada exitosamente' });
        
    } catch (error) {
        console.error('Error en /api/register-password:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        
        res.json({ success: true, message: 'Sesión cerrada exitosamente' });
    });
});

// Check session
router.get('/session', (req, res) => {
    if (req.session.authenticated && req.session.userId) {
        res.json({
            authenticated: true,
            user: req.session.userData
        });
    } else {
        res.json({
            authenticated: false
        });
    }
});

module.exports = router;
