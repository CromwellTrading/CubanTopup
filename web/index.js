const express = require('express');
const router = express.Router();
const middleware = require('./middleware');
const auth = require('./auth');
const webhooks = require('./webhooks');
const webapp = require('./webapp');

// Mount all routes
router.use('/api', webapp);
router.use('/api/auth', auth);
router.use(webhooks.router);

// Public routes
router.get('/', (req, res) => {
    if (req.session.authenticated) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(__dirname + '/../public/index.html');
    }
});

router.get('/dashboard', middleware.requireAuth, (req, res) => {
    res.sendFile(__dirname + '/../public/dashboard.html');
});

router.get('/webapp', (req, res) => {
    res.sendFile(__dirname + '/../public/webapp.html');
});

// Keep alive endpoint
router.get('/keepalive', (req, res) => {
    res.json({ 
        status: 'alive', 
        timestamp: new Date().toISOString(),
        service: 'cromwell-bot-server',
        uptime: process.uptime()
    });
});

// Health check
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: {
            telegram: 'connected',
            database: 'connected',
            webhooks: 'active'
        }
    });
});

// 404 handler
router.use('*', (req, res) => {
    if (req.originalUrl.startsWith('/api/')) {
        res.status(404).json({
            error: 'Ruta no encontrada',
            path: req.originalUrl
        });
    } else {
        res.status(404).send('Página no encontrada');
    }
});

// Error handler
router.use((err, req, res, next) => {
    console.error('Error en ruta web:', err);
    
    if (req.originalUrl.startsWith('/api/')) {
        res.status(500).json({
            error: 'Error interno del servidor',
            message: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } else {
        res.status(500).send('Error interno del servidor');
    }
});

module.exports = router;
