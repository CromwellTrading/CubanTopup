// Sistema completo de Gestión de Wallet
class WalletManager {
    constructor() {
        this.userData = null;
        this.init();
    }

    async init() {
        this.initEventListeners();
        await this.loadWalletData();
        this.updateWalletUI();
    }

    initEventListeners() {
        // Botón refresh wallet
        document.getElementById('refreshWallet')?.addEventListener('click', () => this.refreshWallet());

        // Botón exportar
        document.getElementById('exportWallet')?.addEventListener('click', () => this.exportWallet());

        // Botón editar perfil
        document.getElementById('editProfile')?.addEventListener('click', () => this.editProfile());

        // Enlaces de ayuda
        document.querySelectorAll('.help-link').forEach(link => {
            link.addEventListener('click', (e) => this.handleHelpLink(e));
        });
    }

    async loadWalletData() {
        try {
            const response = await fetch('/api/user-data', {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Error cargando datos de wallet');
            }

            const data = await response.json();
            
            if (data.success) {
                this.userData = data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.showError('Error cargando wallet', error.message);
        }
    }

    updateWalletUI() {
        if (!this.userData?.user) return;

        const user = this.userData.user;

        // Actualizar información principal
        document.getElementById('walletId').textContent = `ID: CROM-${user.telegram_id || user.id}`;
        document.getElementById('walletTotalBalance').textContent = this.formatTotalBalance(user);
        
        // Actualizar balances por moneda
        document.getElementById('walletCupBalance').textContent = this.formatCurrency(user.balance_cup, 'cup');
        document.getElementById('walletSaldoBalance').textContent = this.formatCurrency(user.balance_saldo, 'saldo');
        document.getElementById('walletUsdtBalance').textContent = this.formatCurrency(user.balance_usdt, 'usdt');
        
        // Actualizar estadísticas
        document.getElementById('walletTxCount').textContent = `${this.userData.transactions?.length || 0} Transacciones`;
        document.getElementById('walletSince').textContent = `Miembro desde: ${this.formatDate(user.created_at)}`;
        
        // Actualizar tokens
        document.getElementById('tokenCwsBalance').textContent = user.tokens_cws || 0;
        document.getElementById('tokenCwtBalance').textContent = this.formatNumber(user.tokens_cwt || 0, 2);
        
        // Actualizar perfil
        this.updateProfileInfo();
        
        // Actualizar estado de seguridad
        this.updateSecurityStatus();
    }

    updateProfileInfo() {
        const user = this.userData?.user;
        if (!user) return;

        // Cargar datos desde la base de datos
        document.getElementById('profileTelegramId').textContent = user.telegram_id ? `ID: ${user.telegram_id}` : `ID: ${user.id}`;
        
        // Formatear teléfono correctamente
        if (user.phone_number) {
            // Asegurarse de que el teléfono tenga formato correcto
            let phoneDisplay = user.phone_number;
            if (phoneDisplay.startsWith('53') && phoneDisplay.length === 10) {
                phoneDisplay = `+53 ${phoneDisplay.substring(2)}`;
            }
            document.getElementById('profilePhone').textContent = phoneDisplay;
        } else {
            document.getElementById('profilePhone').textContent = 'No vinculado';
        }
        
        // Formatear wallet USDT
        if (user.usdt_wallet) {
            document.getElementById('profileUsdtWallet').innerHTML = 
                `<code style="font-size: 0.8em; background: rgba(255,255,255,0.1); padding: 2px 5px; border-radius: 3px;">
                    ${this.truncateAddress(user.usdt_wallet)}
                </code>`;
        } else {
            document.getElementById('profileUsdtWallet').innerHTML = 
                '<small>No configurada</small>';
        }
    }

    updateSecurityStatus() {
        const user = this.userData?.user;
        if (!user) return;

        const phoneStatus = document.getElementById('phoneVerificationStatus');
        if (phoneStatus) {
            if (user.phone_number) {
                phoneStatus.className = 'security-item verified';
                phoneStatus.innerHTML = '<i class="fas fa-check-circle"></i><span>Teléfono Verificado</span>';
            } else {
                phoneStatus.className = 'security-item pending';
                phoneStatus.innerHTML = '<i class="fas fa-exclamation-circle"></i><span>Teléfono Pendiente</span>';
            }
        }
    }

    async refreshWallet() {
        const refreshBtn = document.getElementById('refreshWallet');
        if (refreshBtn) {
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        await this.loadWalletData();
        this.updateWalletUI();
        this.showNotification('Wallet actualizada', 'success');

        if (refreshBtn) {
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
            // Añadir efecto de rotación
            refreshBtn.style.transform = 'rotate(360deg)';
            setTimeout(() => {
                refreshBtn.style.transform = 'rotate(0deg)';
            }, 300);
        }
    }

    async exportWallet() {
        if (!this.userData?.user) return;

        try {
            const user = this.userData.user;
            const data = {
                fecha: new Date().toISOString(),
                usuario: {
                    id: user.telegram_id || user.id,
                    nombre: user.first_name,
                    usuario: user.username,
                    telefono: user.phone_number,
                    wallet_usdt: user.usdt_wallet
                },
                saldos: {
                    cup: user.balance_cup,
                    saldo: user.balance_saldo,
                    usdt: user.balance_usdt,
                    tokens_cws: user.tokens_cws,
                    tokens_cwt: user.tokens_cwt,
                    pendiente_cup: user.pending_balance_cup
                },
                transacciones_recientes: this.userData.transactions?.slice(0, 10).map(tx => ({
                    fecha: tx.created_at,
                    tipo: tx.type,
                    moneda: tx.currency,
                    monto: tx.amount,
                    estado: tx.status,
                    id: tx.tx_id
                }))
            };

            // Crear y descargar archivo JSON
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cromwell_wallet_${user.telegram_id || user.id}_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showNotification('Wallet exportada exitosamente', 'success');
        } catch (error) {
            this.showError('Error exportando wallet', error.message);
        }
    }

    editProfile() {
        this.showModal('profileModal');
        this.loadProfileForm();
    }

    loadProfileForm() {
        const user = this.userData?.user;
        if (!user) return;

        const modalBody = document.querySelector('#profileModal .modal-body');
        if (!modalBody) return;

        modalBody.innerHTML = `
            <form id="profileForm">
                <div class="form-group">
                    <label for="editFirstName">
                        <i class="fas fa-user"></i> Nombre
                    </label>
                    <input type="text" id="editFirstName" value="${user.first_name || ''}" placeholder="Tu nombre">
                </div>

                <div class="form-group">
                    <label for="editPhone">
                        <i class="fas fa-phone"></i> Teléfono
                    </label>
                    <input type="text" id="editPhone" value="${user.phone_number || ''}" placeholder="5351234567">
                    <div class="hint">Formato: 5XXXXXXXX</div>
                </div>

                <div class="form-group">
                    <label for="editUsdtWallet">
                        <i class="fab fa-usb"></i> Wallet USDT (BEP20)
                    </label>
                    <input type="text" id="editUsdtWallet" value="${user.usdt_wallet || ''}" placeholder="0x...">
                    <div class="hint">Dirección desde la que envías USDT</div>
                </div>

                <div class="form-group">
                    <label for="currentPassword">
                        <i class="fas fa-lock"></i> Contraseña Actual (para cambios)
                    </label>
                    <input type="password" id="currentPassword" placeholder="Tu contraseña actual">
                </div>

                <div class="form-group">
                    <button type="submit" class="btn-primary" id="saveProfile">
                        <i class="fas fa-save"></i> Guardar Cambios
                    </button>
                </div>
            </form>
        `;

        // Añadir event listener al formulario
        document.getElementById('profileForm')?.addEventListener('submit', (e) => this.saveProfile(e));
    }

    async saveProfile(e) {
        e.preventDefault();

        const formData = {
            first_name: document.getElementById('editFirstName')?.value,
            phone_number: document.getElementById('editPhone')?.value,
            usdt_wallet: document.getElementById('editUsdtWallet')?.value,
            current_password: document.getElementById('currentPassword')?.value
        };

        // Validaciones
        if (formData.phone_number && !/^5\d{7,9}$/.test(formData.phone_number)) {
            this.showError('Teléfono inválido', 'Formato: 5XXXXXXXX');
            return;
        }

        if (formData.usdt_wallet && (!formData.usdt_wallet.startsWith('0x') || formData.usdt_wallet.length !== 42)) {
            this.showError('Wallet inválida', 'Debe comenzar con 0x y tener 42 caracteres');
            return;
        }

        try {
            const response = await fetch('/api/update-profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                this.showNotification('Perfil actualizado exitosamente', 'success');
                this.closeModal('profileModal');
                await this.refreshProfile();
            } else {
                throw new Error(data.error || 'Error actualizando perfil');
            }
        } catch (error) {
            this.showError('Error guardando perfil', error.message);
        }
    }

    async refreshProfile() {
        await this.loadWalletData();
        this.updateProfileInfo();
        this.updateSecurityStatus();
    }

    handleHelpLink(e) {
        e.preventDefault();
        const href = e.currentTarget.getAttribute('href');
        
        if (href === '#') {
            const text = e.currentTarget.textContent;
            
            if (text.includes('Términos')) {
                this.showTerms();
            } else if (text.includes('Preguntas')) {
                this.showFAQ();
            } else if (text.includes('Soporte')) {
                window.open('https://t.me/cromwell_support', '_blank');
            }
        } else if (href) {
            window.open(href, '_blank');
        }
    }

    // Métodos de utilidad
    formatTotalBalance(user) {
        const rates = {
            cup: 1,
            saldo: 1,
            usdt: 280 // Tasa de cambio CUP/USDT
        };
        
        const total = (user.balance_cup || 0) * rates.cup + 
                     (user.balance_saldo || 0) * rates.saldo + 
                     (user.balance_usdt || 0) * rates.usdt;
        
        return this.formatCurrency(total, 'cup');
    }

    formatCurrency(amount, currency) {
        const symbols = {
            'cup': 'CUP',
            'saldo': 'Saldo',
            'usdt': 'USDT'
        };
        
        const symbol = symbols[currency] || currency.toUpperCase();
        
        if (currency === 'usdt') {
            return `${parseFloat(amount || 0).toFixed(2)} ${symbol}`;
        }
        
        return `$${parseFloat(amount || 0).toFixed(2)} ${symbol}`;
    }

    formatNumber(num, decimals = 2) {
        return parseFloat(num || 0).toFixed(decimals);
    }

    formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    truncateAddress(address, start = 6, end = 4) {
        if (!address || address.length <= start + end) return address;
        return `${address.substring(0, start)}...${address.substring(address.length - end)}`;
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }

    showNotification(message, type = 'info') {
        window.showNotification?.(message, type) || console.log(`[${type}] ${message}`);
    }

    showError(title, message) {
        this.showNotification(`${title}: ${message}`, 'error');
    }

    showTerms() {
        // Llamar a la función global de términos
        if (window.showTermsModal) {
            window.showTermsModal();
        } else {
            this.showModal('termsModal');
        }
    }

    showFAQ() {
        this.showModal('faqModal');
    }
}

// Inicializar cuando se cargue la página de wallet
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('wallet-page')) {
        window.walletManager = new WalletManager();
    }
});
