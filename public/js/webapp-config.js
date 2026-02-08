// /public/js/webapp-config.js
class WebAppConfig {
    constructor() {
        this.config = {};
        this.loaded = false;
    }

    async load() {
        try {
            const response = await fetch('/api/webapp-config');
            const data = await response.json();
            
            if (data.success) {
                this.config = data.config;
                this.loaded = true;
                
                // Inject configuration into window object
                window.CROMWELL_CONFIG = this.config;
                
                console.log('✅ WebApp configuration loaded:', this.config);
                return true;
            }
        } catch (error) {
            console.error('❌ Error loading WebApp configuration:', error);
        }
        
        // Default configuration if API fails
        this.config = {
            pago_cup_tarjeta: '',
            pago_saldo_movil: '',
            minimo_cup: 1000,
            minimo_saldo: 500,
            usdt_rate_0_30: 650,
            usdt_rate_30_plus: 680,
            saldo_movil_rate: 2.1,
            min_cws_use: 100,
            cws_per_100_saldo: 10
        };
        
        window.CROMWELL_CONFIG = this.config;
        this.loaded = true;
        
        return false;
    }

    get(key) {
        return this.config[key];
    }

    getAll() {
        return this.config;
    }
}

// Initialize global config
window.cromwellConfig = new WebAppConfig();
