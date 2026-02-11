const config = require('../config');

// Middleware to verify webhook token
const verifyWebhookToken = (req, res, next) => {
    // Permitir solicitudes desde Telegram WebApp sin token
    const telegramWebApp = req.headers['user-agent']?.includes('Telegram') || 
                          req.headers['origin']?.includes('telegram.org');
    
    if (telegramWebApp) {
        console.log('✅ Solicitud de Telegram WebApp, permitiendo sin token');
        return next();
    }
    
    if (!config.WEBHOOK_SECRET_KEY) {
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
    
    if (authToken !== config.WEBHOOK_SECRET_KEY) {
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
        console.log('✅ Authenticated user:', req.session.userId);
        next();
    } else {
        console.log('❌ Unauthenticated user');
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        res.redirect('/');
    }
}

module.exports = {
    verifyWebhookToken,
    requireAuth
};
