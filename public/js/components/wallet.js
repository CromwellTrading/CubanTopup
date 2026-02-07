// /public/js/components/wallet.js
class WalletComponent {
    constructor(app) {
        this.app = app;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Botón cambiar teléfono
        document.getElementById('change-phone').addEventListener('click', () => {
            this.showPhoneModal();
        });

        // Botón guardar teléfono
        document.getElementById('save-phone').addEventListener('click', () => {
            this.updatePhoneNumber();
        });

        // Botón cancelar teléfono
        document.getElementById('cancel-phone').addEventListener('click', () => {
            this.app.hideModal('phone-modal');
        });

        // Botón cerrar modal
        document.getElementById('close-phone-modal').addEventListener('click', () => {
            this.app.hideModal('phone-modal');
        });

        // Botón refrescar billetera
        document.getElementById('refresh-wallet').addEventListener('click', () => {
            this.app.loadUserData();
        });
    }

    showPhoneModal() {
        const user = this.app.userData;
        if (user) {
            document.getElementById('current-phone-display').textContent = 
                user.phone_number ? `+53 ${user.phone_number.substring(2)}` : 'No vinculado';
        }
        document.getElementById('new-phone').value = '';
        this.app.showModal('phone-modal');
    }

    async updatePhoneNumber() {
        const newPhone = document.getElementById('new-phone').value.trim();
        
        // Validar formato
        const cleanPhone = newPhone.replace(/[^\d]/g, '');
        if (!cleanPhone.startsWith('53') || cleanPhone.length !== 10) {
            this.app.showToast('❌ Formato inválido. Debe comenzar con 53 y tener 10 dígitos.', 'error');
            return;
        }

        try {
            this.app.showLoading('Actualizando teléfono...');
            
            const response = await fetch('/api/update-phone', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.app.userData.telegram_id,
                    phone: cleanPhone
                })
            });

            const data = await response.json();

            if (data.success) {
                this.app.showToast('✅ Teléfono actualizado correctamente', 'success');
                this.app.hideModal('phone-modal');
                await this.app.loadUserData();
            } else {
                this.app.showToast(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error actualizando teléfono:', error);
            this.app.showToast('❌ Error de conexión', 'error');
        } finally {
            this.app.hideLoading();
        }
    }

    updateUI(userData) {
        if (!userData) return;

        // Actualizar saldos en dashboard
        document.getElementById('dashboard-cup').textContent = `$${userData.balance_cup || 0}`;
        document.getElementById('dashboard-saldo').textContent = `$${userData.balance_saldo || 0}`;
        document.getElementById('dashboard-cws').textContent = userData.tokens_cws || 0;

        // Actualizar saldos en billetera
        document.getElementById('wallet-cup').textContent = `$${userData.balance_cup || 0}`;
        document.getElementById('wallet-saldo').textContent = `$${userData.balance_saldo || 0}`;
        document.getElementById('wallet-cws').textContent = userData.tokens_cws || 0;

        // Actualizar header
        document.getElementById('balance-cup').textContent = `$${userData.balance_cup || 0}`;

        // Actualizar información del usuario
        document.getElementById('user-telegram-id').textContent = userData.telegram_id;
        document.getElementById('user-phone').textContent = 
            userData.phone_number ? `+53 ${userData.phone_number.substring(2)}` : 'No vinculado';
        document.getElementById('wallet-phone').textContent = 
            userData.phone_number ? `+53 ${userData.phone_number.substring(2)}` : 'No vinculado';

        // Actualizar última actividad
        if (userData.last_active) {
            const lastActive = new Date(userData.last_active);
            document.getElementById('last-activity').textContent = 
                lastActive.toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
        }
    }
}
