// Sistema completo de Depósitos
class DepositManager {
    constructor() {
        this.currentStep = 1;
        this.selectedMethod = 'cup';
        this.depositAmount = 0;
        this.orderData = null;
        this.timerInterval = null;
        this.init();
    }

    init() {
        this.initEventListeners();
        this.loadPaymentInfo();
        this.updateStepUI();
    }

    initEventListeners() {
        // Selección de método
        document.querySelectorAll('.method-option').forEach(option => {
            option.addEventListener('click', (e) => this.selectMethod(e));
        });

        // Navegación entre pasos
        document.getElementById('nextStep')?.addEventListener('click', () => this.nextStep());
        document.getElementById('prevStep')?.addEventListener('click', () => this.prevStep());
        document.getElementById('confirmAmount')?.addEventListener('click', () => this.confirmAmount());
        document.getElementById('editDeposit')?.addEventListener('click', () => this.editDeposit());
        document.getElementById('createDeposit')?.addEventListener('click', () => this.createDeposit());
        document.getElementById('cancelDeposit')?.addEventListener('click', () => this.cancelDeposit());
        document.getElementById('checkPayment')?.addEventListener('click', () => this.checkPayment());
        document.getElementById('verifyUsdtTx')?.addEventListener('click', () => this.verifyUsdtTransaction());

        // Monto rápido
        document.querySelectorAll('.quick-amount').forEach(btn => {
            btn.addEventListener('click', (e) => this.setQuickAmount(e));
        });

        // Input de monto
        const amountInput = document.getElementById('depositAmount');
        if (amountInput) {
            amountInput.addEventListener('input', () => this.updateAmountPreview());
        }

        // Input de wallet USDT
        const usdtWalletInput = document.getElementById('usdtWallet');
        if (usdtWalletInput) {
            usdtWalletInput.addEventListener('input', () => this.validateUsdtWallet());
        }

        // Input de hash USDT
        const usdtTxHash = document.getElementById('usdtTxHash');
        if (usdtTxHash) {
            usdtTxHash.addEventListener('input', () => this.validateTxHash());
        }
    }

    loadPaymentInfo() {
        // Cargar información de pago desde variables globales o API
        const cupTarget = document.getElementById('cupTarget');
        if (cupTarget) {
            cupTarget.textContent = window.PAYMENT_CUP_TARGET || '9200 1234 5678 9012';
        }
    }

    selectMethod(e) {
        const method = e.currentTarget.getAttribute('data-method');
        
        // Actualizar UI de selección
        document.querySelectorAll('.method-option').forEach(option => {
            option.classList.remove('active');
        });
        e.currentTarget.classList.add('active');
        
        // Actualizar detalles del método
        document.querySelectorAll('.method-detail').forEach(detail => {
            detail.classList.remove('active');
        });
        document.querySelector(`.method-detail[data-method="${method}"]`)?.classList.add('active');
        
        this.selectedMethod = method;
        this.updateMethodInfo();
    }

    updateMethodInfo() {
        const methods = {
            cup: { min: 1000, max: 50000, code: 'CUP', label: 'CUP (Tarjeta)' },
            saldo: { min: 500, max: 10000, code: 'SALDO', label: 'Saldo Móvil' },
            usdt: { min: 10, max: 1000, code: 'USDT', label: 'USDT BEP20' }
        };

        const method = methods[this.selectedMethod];
        if (!method) return;

        // Actualizar límites
        document.getElementById('minAmount').textContent = this.formatCurrency(method.min, this.selectedMethod);
        document.getElementById('maxAmount').textContent = this.formatCurrency(method.max, this.selectedMethod);
        document.getElementById('currencyCode').textContent = method.code;
        document.getElementById('selectedMethodName').textContent = method.label;

        // Actualizar input de monto
        const amountInput = document.getElementById('depositAmount');
        if (amountInput) {
            amountInput.min = method.min;
            amountInput.max = method.max;
            amountInput.placeholder = `Mínimo: ${this.formatCurrency(method.min, this.selectedMethod)}`;
        }

        // Mostrar/ocultar sección de wallet USDT
        const usdtWalletSection = document.getElementById('usdtWalletSection');
        if (usdtWalletSection) {
            if (this.selectedMethod === 'usdt') {
                usdtWalletSection.classList.remove('hidden');
            } else {
                usdtWalletSection.classList.add('hidden');
            }
        }

        // Actualizar preview
        this.updateAmountPreview();
    }

    setQuickAmount(e) {
        const amount = parseFloat(e.currentTarget.getAttribute('data-amount'));
        const amountInput = document.getElementById('depositAmount');
        
        if (amountInput) {
            amountInput.value = amount;
            this.depositAmount = amount;
            this.updateAmountPreview();
            
            // Resaltar botón seleccionado
            document.querySelectorAll('.quick-amount').forEach(btn => {
                btn.classList.remove('active');
            });
            e.currentTarget.classList.add('active');
        }
    }

    updateAmountPreview() {
        const amountInput = document.getElementById('depositAmount');
        if (!amountInput) return;

        const amount = parseFloat(amountInput.value) || 0;
        this.depositAmount = amount;

        // Validar límites
        const methods = {
            cup: { min: 1000, max: 50000 },
            saldo: { min: 500, max: 10000 },
            usdt: { min: 10, max: 1000 }
        };

        const method = methods[this.selectedMethod];
        if (amount < method.min || amount > method.max) {
            // Mostrar error visual
            amountInput.style.borderColor = 'var(--danger-color)';
            return;
        } else {
            amountInput.style.borderColor = '';
        }

        // Calcular bono y tokens
        const bonusRate = this.selectedMethod === 'usdt' ? 0.05 : 0.10;
        const bonus = amount * bonusRate;
        const total = amount + bonus;

        let tokens = 0;
        if (this.selectedMethod === 'saldo') {
            tokens = Math.floor(amount / 100) * 10; // 10 CWS por cada 100
        } else if (this.selectedMethod === 'usdt') {
            tokens = (amount / 10) * 0.5; // 0.5 CWT por cada 10 USDT
        }

        // Actualizar preview
        document.getElementById('previewAmount').textContent = this.formatCurrency(amount, this.selectedMethod);
        document.getElementById('previewBonus').textContent = this.formatCurrency(bonus, this.selectedMethod);
        document.getElementById('previewTokens').textContent = this.selectedMethod === 'saldo' ? 
            `${tokens} CWS` : `${tokens.toFixed(2)} CWT`;
        document.getElementById('previewTotal').textContent = this.formatCurrency(total, this.selectedMethod);
    }

    nextStep() {
        if (this.currentStep === 1) {
            // Validar que se seleccionó un método
            if (!this.selectedMethod) {
                this.showError('Selecciona un método de pago');
                return;
            }
            
            // Para USDT, validar wallet
            if (this.selectedMethod === 'usdt') {
                const wallet = document.getElementById('usdtWallet')?.value;
                if (!wallet || !this.validateUsdtWallet(wallet)) {
                    this.showError('Wallet USDT inválida');
                    return;
                }
            }
            
            this.currentStep = 2;
        } else if (this.currentStep === 2) {
            // Validar monto
            const amountInput = document.getElementById('depositAmount');
            const amount = parseFloat(amountInput?.value) || 0;
            
            const methods = {
                cup: { min: 1000, max: 50000 },
                saldo: { min: 500, max: 10000 },
                usdt: { min: 10, max: 1000 }
            };

            const method = methods[this.selectedMethod];
            if (amount < method.min || amount > method.max) {
                this.showError(`Monto debe estar entre ${this.formatCurrency(method.min, this.selectedMethod)} y ${this.formatCurrency(method.max, this.selectedMethod)}`);
                return;
            }

            this.depositAmount = amount;
            this.currentStep = 3;
            this.updateConfirmation();
        }
        
        this.updateStepUI();
    }

    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateStepUI();
        }
    }

    updateStepUI() {
        // Ocultar todos los pasos
        document.querySelectorAll('.deposit-step').forEach(step => {
            step.classList.remove('active');
        });

        // Mostrar paso actual
        const currentStep = document.getElementById(`step-${this.getStepName(this.currentStep)}`);
        if (currentStep) {
            currentStep.classList.add('active');
        }

        // Actualizar números de paso
        document.querySelectorAll('.step-number').forEach((num, index) => {
            const stepNum = index + 1;
            if (stepNum < this.currentStep) {
                num.className = 'step-number completed';
                num.innerHTML = '<i class="fas fa-check"></i>';
            } else if (stepNum === this.currentStep) {
                num.className = 'step-number active';
                num.textContent = stepNum;
            } else {
                num.className = 'step-number';
                num.textContent = stepNum;
            }
        });
    }

    getStepName(step) {
        const steps = {
            1: 'method',
            2: 'amount',
            3: 'confirm',
            4: 'pending',
            5: 'completed'
        };
        return steps[step] || 'method';
    }

    updateConfirmation() {
        // Calcular valores para confirmación
        const bonusRate = this.selectedMethod === 'usdt' ? 0.05 : 0.10;
        const bonus = this.depositAmount * bonusRate;
        const total = this.depositAmount + bonus;

        let tokens = 0;
        let tokensLabel = '';
        if (this.selectedMethod === 'saldo') {
            tokens = Math.floor(this.depositAmount / 100) * 10;
            tokensLabel = `${tokens} CWS`;
        } else if (this.selectedMethod === 'usdt') {
            tokens = (this.depositAmount / 10) * 0.5;
            tokensLabel = `${tokens.toFixed(2)} CWT`;
        }

        // Actualizar UI de confirmación
        document.getElementById('confirmMethod').textContent = this.getMethodLabel();
        document.getElementById('confirmAmount').textContent = this.formatCurrency(this.depositAmount, this.selectedMethod);
        document.getElementById('confirmBonus').textContent = this.formatCurrency(bonus, this.selectedMethod);
        document.getElementById('confirmTokens').textContent = tokensLabel;
        document.getElementById('confirmTotal').textContent = this.formatCurrency(total, this.selectedMethod);
        document.getElementById('confirmTarget').textContent = this.getPaymentTarget();

        // Actualizar instrucciones
        this.updateInstructions();
    }

    getMethodLabel() {
        const labels = {
            'cup': 'CUP (Tarjeta)',
            'saldo': 'Saldo Móvil',
            'usdt': 'USDT BEP20'
        };
        return labels[this.selectedMethod] || this.selectedMethod;
    }

    getPaymentTarget() {
        const targets = {
            'cup': window.PAYMENT_CUP_TARGET || '9200 1234 5678 9012',
            'saldo': window.PAYMENT_SALDO_TARGET || '5351234567',
            'usdt': window.PAYMENT_USDT_TARGET || '0x...'
        };
        return targets[this.selectedMethod] || '';
    }

    updateInstructions() {
        const container = document.getElementById('confirmationInstructions');
        if (!container) return;

        let instructions = '';
        
        switch(this.selectedMethod) {
            case 'cup':
                instructions = `
                    <h4><i class="fas fa-list-ol"></i> Instrucciones para pagar:</h4>
                    <ol>
                        <li>Ve a <strong>Transfermóvil</strong></li>
                        <li>Activa <strong>"Mostrar número al destinatario"</strong></li>
                        <li>Transfiere <strong>EXACTAMENTE ${this.formatCurrency(this.depositAmount, 'cup')}</strong></li>
                        <li>A la tarjeta: <code>${this.getPaymentTarget()}</code></li>
                        <li>Usa el mismo teléfono vinculado a tu cuenta</li>
                    </ol>
                `;
                break;
                
            case 'saldo':
                instructions = `
                    <h4><i class="fas fa-list-ol"></i> Instrucciones para pagar:</h4>
                    <ol>
                        <li>Ve a <strong>Transfermóvil</strong></li>
                        <li>Envía saldo a: <code>${this.getPaymentTarget()}</code></li>
                        <li>Monto exacto: <strong>${this.formatCurrency(this.depositAmount, 'saldo')}</strong></li>
                        <li><strong>Toma captura de pantalla</strong> de la transferencia</li>
                        <li>No esperes al SMS de confirmación de ETECSA</li>
                    </ol>
                `;
                break;
                
            case 'usdt':
                const wallet = document.getElementById('usdtWallet')?.value || '';
                instructions = `
                    <h4><i class="fas fa-list-ol"></i> Instrucciones para pagar:</h4>
                    <ol>
                        <li>Ve a tu wallet <strong>SafePal, Trust Wallet o similar</strong></li>
                        <li>Envía <strong>USDT (BEP20)</strong> a:</li>
                        <li><code>${this.getPaymentTarget()}</code></li>
                        <li>Monto exacto: <strong>${this.formatCurrency(this.depositAmount, 'usdt')}</strong></li>
                        <li>Desde wallet: <code>${this.truncateAddress(wallet)}</code></li>
                        <li><strong>SOLO red BEP20 (Binance Smart Chain)</strong></li>
                        <li>Guarda el hash de la transacción</li>
                    </ol>
                `;
                break;
        }

        container.innerHTML = instructions;
    }

    async confirmAmount() {
        // Este método es llamado desde el botón "Confirmar Monto" en paso 2
        this.nextStep();
    }

    async createDeposit() {
        try {
            const amount = this.depositAmount;
            const currency = this.selectedMethod;
            const usdtWallet = currency === 'usdt' ? document.getElementById('usdtWallet')?.value : null;

            // Validaciones finales
            if (!amount || amount <= 0) {
                throw new Error('Monto inválido');
            }

            if (currency === 'usdt' && (!usdtWallet || !this.validateUsdtWallet(usdtWallet))) {
                throw new Error('Wallet USDT inválida');
            }

            this.showLoading();

            const response = await fetch('/api/create-deposit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    currency,
                    amount,
                    usdtWallet
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.orderData = data.order;
                this.currentStep = 4;
                this.updateStepUI();
                this.showPendingOrder();
                this.startPaymentTimer();
            } else {
                throw new Error(data.error || 'Error creando depósito');
            }
        } catch (error) {
            this.showError('Error creando depósito', error.message);
        } finally {
            this.hideLoading();
        }
    }

    showPendingOrder() {
        if (!this.orderData) return;

        // Actualizar información de orden pendiente
        document.getElementById('pendingOrderId').textContent = `#${this.orderData.id}`;
        document.getElementById('pendingAmount').textContent = this.formatCurrency(this.depositAmount, this.selectedMethod);
        document.getElementById('pendingTarget').textContent = this.getPaymentTarget();

        // Actualizar instrucciones pendientes
        this.updatePendingInstructions();

        // Mostrar/ocultar verificación USDT
        const usdtVerification = document.getElementById('usdtVerification');
        if (usdtVerification) {
            if (this.selectedMethod === 'usdt') {
                usdtVerification.classList.remove('hidden');
            } else {
                usdtVerification.classList.add('hidden');
            }
        }
    }

    updatePendingInstructions() {
        const container = document.getElementById('pendingInstructions');
        if (!container) return;

        let instructions = '';
        
        switch(this.selectedMethod) {
            case 'cup':
                instructions = `
                    <p><strong>Realiza la transferencia ahora:</strong></p>
                    <p>Tarjeta: <code>${this.getPaymentTarget()}</code></p>
                    <p>Monto: <strong>${this.formatCurrency(this.depositAmount, 'cup')}</strong></p>
                    <p class="warning"><i class="fas fa-exclamation-triangle"></i> No olvides activar "Mostrar número al destinatario"</p>
                `;
                break;
                
            case 'saldo':
                instructions = `
                    <p><strong>Envía el saldo ahora:</strong></p>
                    <p>Número: <code>${this.getPaymentTarget()}</code></p>
                    <p>Monto: <strong>${this.formatCurrency(this.depositAmount, 'saldo')}</strong></p>
                    <p class="warning"><i class="fas fa-exclamation-triangle"></i> ¡Toma captura de pantalla!</p>
                `;
                break;
                
            case 'usdt':
                instructions = `
                    <p><strong>Envía los USDT ahora:</strong></p>
                    <p>Dirección: <code>${this.getPaymentTarget()}</code></p>
                    <p>Monto: <strong>${this.formatCurrency(this.depositAmount, 'usdt')}</strong></p>
                    <p>Red: <strong>BEP20 (Binance Smart Chain)</strong></p>
                    <p class="info"><i class="fas fa-info-circle"></i> Usa el hash para verificar manualmente</p>
                `;
                break;
        }

        container.innerHTML = instructions;
    }

    startPaymentTimer() {
        let timeLeft = 30 * 60; // 30 minutos en segundos
        
        const timerElement = document.getElementById('paymentTimer');
        if (!timerElement) return;

        // Limpiar intervalo anterior si existe
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        this.timerInterval = setInterval(() => {
            timeLeft--;
            
            if (timeLeft <= 0) {
                clearInterval(this.timerInterval);
                this.showError('Tiempo agotado', 'La orden ha expirado');
                this.cancelDeposit();
                return;
            }
            
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            // Cambiar color cuando queden 5 minutos
            if (timeLeft <= 5 * 60) {
                timerElement.style.color = 'var(--warning-color)';
            }
            
            if (timeLeft <= 60) {
                timerElement.style.color = 'var(--danger-color)';
            }
        }, 1000);
    }

    async checkPayment() {
        if (!this.orderData) return;

        try {
            this.showLoading('Verificando pago...');

            const response = await fetch(`/api/check-payment/${this.orderData.id}`, {
                credentials: 'include'
            });

            const data = await response.json();

            if (response.ok) {
                if (data.status === 'completed') {
                    this.showSuccess('¡Pago completado!', 'El depósito ha sido acreditado a tu wallet');
                    this.currentStep = 5;
                    this.updateStepUI();
                    this.showCompletedOrder(data);
                } else if (data.status === 'pending') {
                    this.showInfo('Pago aún pendiente', 'El sistema aún no ha detectado tu pago');
                } else {
                    this.showInfo('Estado del pago', data.message || 'Esperando confirmación');
                }
            } else {
                throw new Error(data.error || 'Error verificando pago');
            }
        } catch (error) {
            this.showError('Error verificando pago', error.message);
        } finally {
            this.hideLoading();
        }
    }

    async verifyUsdtTransaction() {
        if (this.selectedMethod !== 'usdt' || !this.orderData) return;

        const txHash = document.getElementById('usdtTxHash')?.value?.trim();
        if (!txHash || !this.validateTxHash(txHash)) {
            this.showError('Hash inválido', 'El hash debe comenzar con 0x y tener 64 caracteres');
            return;
        }

        try {
            this.showLoading('Verificando transacción USDT...');

            const response = await fetch('/api/verify-usdt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    txHash,
                    orderId: this.orderData.id
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.showSuccess('Transacción verificada', 'El pago está siendo procesado');
                // Opcional: Actualizar UI o iniciar verificación automática
            } else {
                throw new Error(data.error || data.details || 'Error verificando transacción');
            }
        } catch (error) {
            this.showError('Error verificando USDT', error.message);
        } finally {
            this.hideLoading();
        }
    }

    async cancelDeposit() {
        if (!this.orderData) return;

        if (!confirm('¿Estás seguro de que quieres cancelar esta solicitud de depósito?')) {
            return;
        }

        try {
            this.showLoading('Cancelando orden...');

            const response = await fetch(`/api/cancel-deposit/${this.orderData.id}`, {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                this.showInfo('Orden cancelada', 'La solicitud de depósito ha sido cancelada');
                this.resetDeposit();
            } else {
                const data = await response.json();
                throw new Error(data.error || 'Error cancelando orden');
            }
        } catch (error) {
            this.showError('Error cancelando orden', error.message);
        } finally {
            this.hideLoading();
        }
    }

    editDeposit() {
        this.currentStep = 2;
        this.updateStepUI();
    }

    resetDeposit() {
        this.currentStep = 1;
        this.selectedMethod = 'cup';
        this.depositAmount = 0;
        this.orderData = null;
        
        // Limpiar inputs
        const amountInput = document.getElementById('depositAmount');
        if (amountInput) amountInput.value = '';
        
        const usdtWallet = document.getElementById('usdtWallet');
        if (usdtWallet) usdtWallet.value = '';
        
        const usdtTxHash = document.getElementById('usdtTxHash');
        if (usdtTxHash) usdtTxHash.value = '';
        
        // Detener timer
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        
        this.updateStepUI();
        this.updateMethodInfo();
    }

    showCompletedOrder(data) {
        const container = document.getElementById('step-completed');
        if (!container) return;

        container.innerHTML = `
            <div class="step-header">
                <div class="step-number completed"><i class="fas fa-check"></i></div>
                <div class="step-title">Depósito Completado</div>
            </div>
            
            <div class="completed-card">
                <div class="completed-icon">
                    <i class="fas fa-check-circle"></i>
                </div>
                <div class="completed-info">
                    <h3>¡Depósito Acreditado!</h3>
                    <p>Orden #${this.orderData.id} completada exitosamente</p>
                </div>
                
                <div class="completed-details">
                    <div class="detail-box">
                        <div class="detail-label">Monto acreditado</div>
                        <div class="detail-value">${this.formatCurrency(data.amount || this.depositAmount, this.selectedMethod)}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Bono aplicado</div>
                        <div class="detail-value">${this.formatCurrency(data.bonus || 0, this.selectedMethod)}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Tokens ganados</div>
                        <div class="detail-value">${data.tokens || 0} ${this.selectedMethod === 'saldo' ? 'CWS' : 'CWT'}</div>
                    </div>
                </div>
                
                <div class="completed-actions">
                    <button class="btn-secondary" id="newDeposit">
                        <i class="fas fa-plus-circle"></i> Nuevo Depósito
                    </button>
                    <button class="btn-primary" id="goToWallet">
                        <i class="fas fa-wallet"></i> Ir a Mi Wallet
                    </button>
                </div>
            </div>
        `;

        // Añadir event listeners a los nuevos botones
        document.getElementById('newDeposit')?.addEventListener('click', () => {
            this.resetDeposit();
            window.dashboard?.switchPage('deposit');
        });

        document.getElementById('goToWallet')?.addEventListener('click', () => {
            window.dashboard?.switchPage('wallet');
        });
    }

    // Métodos de validación
    validateUsdtWallet(wallet) {
        if (!wallet) wallet = document.getElementById('usdtWallet')?.value;
        return wallet && wallet.startsWith('0x') && wallet.length === 42;
    }

    validateTxHash(hash) {
        if (!hash) hash = document.getElementById('usdtTxHash')?.value;
        return hash && hash.startsWith('0x') && hash.length === 66;
    }

    // Métodos de utilidad
    formatCurrency(amount, currency) {
        const symbols = {
            'cup': 'CUP',
            'saldo': 'Saldo',
            'usdt': 'USDT'
        };
        
        const symbol = symbols[currency] || currency.toUpperCase();
        
        if (currency === 'usdt') {
            return `${parseFloat(amount).toFixed(2)} ${symbol}`;
        }
        
        return `$${parseFloat(amount).toFixed(2)} ${symbol}`;
    }

    truncateAddress(address, start = 6, end = 4) {
        if (!address || address.length <= start + end) return address;
        return `${address.substring(0, start)}...${address.substring(address.length - end)}`;
    }

    showLoading(message = 'Procesando...') {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            const text = overlay.querySelector('.loading-text');
            if (text) text.textContent = message;
            overlay.classList.add('active');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    showNotification(message, type = 'info') {
        window.showNotification?.(message, type);
    }

    showError(title, message) {
        this.showNotification(`${title}: ${message}`, 'error');
    }

    showSuccess(title, message) {
        this.showNotification(`${title}: ${message}`, 'success');
    }

    showInfo(title, message) {
        this.showNotification(`${title}: ${message}`, 'info');
    }
}

// Inicializar cuando se cargue la página de depósitos
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('deposit-page')) {
        window.depositManager = new DepositManager();
    }
});
