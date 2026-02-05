// Sistema completo de Depósitos - VERSIÓN COMPLETA CORREGIDA
class DepositManager {
    constructor() {
        this.currentStep = 1;
        this.selectedMethod = 'cup';
        this.depositAmount = 0;
        this.orderData = null;
        this.timerInterval = null;
        this.paymentInfo = null;
        this.initialized = false;
        this.stepsRendered = false;
    }

    async init() {
        if (this.initialized) return;
        
        console.log('💰 Inicializando DepositManager...');
        
        // Cargar información de pago
        await this.loadPaymentInfo();
        
        // Renderizar pasos si no están renderizados
        if (!this.stepsRendered) {
            this.renderDepositSteps();
            this.stepsRendered = true;
        }
        
        // Inicializar event listeners
        this.initEventListeners();
        
        // Configurar UI inicial
        this.updateMethodInfo();
        this.updateStepUI();
        
        this.initialized = true;
        console.log('✅ DepositManager inicializado');
    }

    async loadPaymentInfo() {
        try {
            const response = await fetch('/api/payment-info', {
                credentials: 'include'
            });

            if (response.ok) {
                this.paymentInfo = await response.json();
                console.log('✅ Información de pago cargada:', this.paymentInfo);
            } else {
                // Usar valores por defecto si falla
                this.paymentInfo = {
                    cup_target: 'NO CONFIGURADO',
                    saldo_target: 'NO CONFIGURADO',
                    usdt_target: 'NO CONFIGURADO',
                    minimo_cup: 1000,
                    minimo_saldo: 500,
                    minimo_usdt: 10,
                    maximo_cup: 50000
                };
                console.warn('⚠️ Usando valores por defecto para información de pago');
            }
        } catch (error) {
            console.error('❌ Error cargando información de pago:', error);
            this.paymentInfo = {
                cup_target: 'NO CONFIGURADO',
                saldo_target: 'NO CONFIGURADO',
                usdt_target: 'NO CONFIGURADO',
                minimo_cup: 1000,
                minimo_saldo: 500,
                minimo_usdt: 10,
                maximo_cup: 50000
            };
        }
    }

    renderDepositSteps() {
        const depositMain = document.querySelector('#deposit-page .deposit-main');
        if (!depositMain) {
            console.error('❌ Contenedor principal de depósitos no encontrado');
            return;
        }

        console.log('🎨 Renderizando pasos de depósito...');
        
        depositMain.innerHTML = `
            <!-- Paso 1: Selección de método -->
            <div class="deposit-step active" id="step-method">
                <div class="step-header">
                    <div class="step-number active">1</div>
                    <div class="step-title">Seleccionar Método</div>
                </div>
                
                <div class="method-details">
                    <!-- Método CUP -->
                    <div class="method-detail active" data-method="cup">
                        <div class="detail-header">
                            <h3><i class="fas fa-credit-card"></i> Depósito por Tarjeta (CUP)</h3>
                            <div class="detail-bonus">
                                <i class="fas fa-gift"></i> Bono: +10% primer depósito
                            </div>
                        </div>
                        
                        <div class="detail-info">
                            <div class="info-box">
                                <i class="fas fa-info-circle"></i>
                                <p>Transfiere desde tu tarjeta a nuestra tarjeta destino</p>
                            </div>
                            
                            <div class="requirements">
                                <h4><i class="fas fa-requirements"></i> Requisitos:</h4>
                                <ul>
                                    <li>Teléfono vinculado obligatorio</li>
                                    <li>Activar "Mostrar número al destinatario"</li>
                                    <li>Transferir monto EXACTO solicitado</li>
                                    <li>Usar el mismo teléfono vinculado</li>
                                </ul>
                            </div>
                            
                            <div class="instructions">
                                <h4><i class="fas fa-list-ol"></i> Instrucciones:</h4>
                                <ol>
                                    <li>Activa "Mostrar número al destinatario" en Transfermóvil</li>
                                    <li>Transfiere el monto exacto que solicites</li>
                                    <li>A la tarjeta: <code class="target-display" id="cupTargetDisplay">${this.paymentInfo.cup_target}</code></li>
                                    <li>El sistema detectará automáticamente tu pago</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Método Saldo Móvil -->
                    <div class="method-detail" data-method="saldo">
                        <div class="detail-header">
                            <h3><i class="fas fa-mobile-alt"></i> Depósito por Saldo Móvil</h3>
                            <div class="detail-bonus">
                                <i class="fas fa-gift"></i> Bono: +10% primer depósito + Tokens CWS
                            </div>
                        </div>
                        
                        <div class="detail-info">
                            <div class="info-box">
                                <i class="fas fa-info-circle"></i>
                                <p>Envía saldo desde tu Transfermóvil a nuestro número</p>
                            </div>
                            
                            <div class="requirements">
                                <h4><i class="fas fa-requirements"></i> Requisitos:</h4>
                                <ul>
                                    <li>Teléfono vinculado obligatorio</li>
                                    <li>Saldo suficiente en Transfermóvil</li>
                                    <li>Transferir monto EXACTO solicitado</li>
                                    <li>Tomar captura de pantalla</li>
                                </ul>
                            </div>
                            
                            <div class="instructions">
                                <h4><i class="fas fa-list-ol"></i> Instrucciones:</h4>
                                <ol>
                                    <li>Ve a Transfermóvil &gt; Enviar Saldo</li>
                                    <li>Envía el monto exacto que solicites</li>
                                    <li>Al número: <code class="target-display" id="saldoTargetDisplay">${this.paymentInfo.saldo_target}</code></li>
                                    <li><strong>Toma captura de pantalla</strong> de la transferencia</li>
                                    <li>El sistema detectará automáticamente tu pago</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Método USDT -->
                    <div class="method-detail" data-method="usdt">
                        <div class="detail-header">
                            <h3><i class="fab fa-usd"></i> Depósito por USDT BEP20</h3>
                            <div class="detail-bonus">
                                <i class="fas fa-gift"></i> Bono: +5% primer depósito + Tokens CWT
                            </div>
                        </div>
                        
                        <div class="detail-info">
                            <div class="info-box">
                                <i class="fas fa-info-circle"></i>
                                <p>Envía USDT desde tu wallet a nuestra dirección BEP20</p>
                            </div>
                            
                            <div class="requirements">
                                <h4><i class="fas fa-requirements"></i> Requisitos:</h4>
                                <ul>
                                    <li>Wallet USDT configurada</li>
                                    <li>USDT suficiente en wallet BEP20</li>
                                    <li>Transferir monto EXACTO solicitado</li>
                                    <li>SOLO red BEP20 (Binance Smart Chain)</li>
                                </ul>
                            </div>
                            
                            <div class="instructions">
                                <h4><i class="fas fa-list-ol"></i> Instrucciones:</h4>
                                <ol>
                                    <li>Abre tu wallet (Trust Wallet, SafePal, etc.)</li>
                                    <li>Envía USDT por red <strong>BEP20</strong></li>
                                    <li>A la dirección: <code class="target-display" id="usdtTargetDisplay">${this.paymentInfo.usdt_target}</code></li>
                                    <li>Monto exacto: lo que solicites</li>
                                    <li>Guarda el hash de la transacción</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="step-actions">
                    <button class="btn-primary" id="nextStepBtn">
                        <i class="fas fa-arrow-right"></i> Continuar
                    </button>
                </div>
            </div>
            
            <!-- Paso 2: Especificar monto -->
            <div class="deposit-step" id="step-amount">
                <div class="step-header">
                    <div class="step-number">2</div>
                    <div class="step-title">Especificar Monto</div>
                </div>
                
                <div class="amount-selector">
                    <div class="amount-header">
                        <h3 id="selectedMethodName">CUP (Tarjeta)</h3>
                        <div class="amount-limits">
                            Mínimo: <span id="minAmount">$1,000.00</span> •
                            Máximo: <span id="maxAmount">$50,000.00</span>
                        </div>
                    </div>
                    
                    <div class="amount-input-container">
                        <div class="currency-symbol">$</div>
                        <input type="number" 
                               id="depositAmountInput" 
                               placeholder="0.00"
                               step="0.01"
                               min="1000"
                               max="50000"
                               value="1000">
                        <div class="currency-code" id="currencyCode">CUP</div>
                    </div>
                    
                    <div class="quick-amounts">
                        <button class="quick-amount" data-amount="1000">$1,000</button>
                        <button class="quick-amount" data-amount="5000">$5,000</button>
                        <button class="quick-amount" data-amount="10000">$10,000</button>
                        <button class="quick-amount" data-amount="20000">$20,000</button>
                        <button class="quick-amount" data-amount="50000">$50,000</button>
                    </div>
                    
                    <div class="amount-preview">
                        <div class="preview-item">
                            <span>Monto a enviar:</span>
                            <span id="previewAmount">$1,000.00</span>
                        </div>
                        <div class="preview-item bonus">
                            <span>Bono primer depósito:</span>
                            <span id="previewBonus">$100.00</span>
                        </div>
                        <div class="preview-item tokens">
                            <span>Tokens a ganar:</span>
                            <span id="previewTokens">0</span>
                        </div>
                        <div class="preview-item total">
                            <span>Total a acreditar:</span>
                            <span id="previewTotal">$1,100.00</span>
                        </div>
                    </div>
                    
                    <!-- Sección de wallet USDT (oculta por defecto) -->
                    <div class="usdt-wallet-input" id="usdtWalletSection" style="display: none;">
                        <label for="usdtWalletInput">
                            <i class="fab fa-usb"></i> Wallet USDT (BEP20)
                        </label>
                        <input type="text" 
                               id="usdtWalletInput" 
                               placeholder="0x..."
                               pattern="^0x[a-fA-F0-9]{40}$">
                        <div class="input-hint">
                            Dirección desde la que enviarás los USDT
                        </div>
                    </div>
                </div>
                
                <div class="step-actions">
                    <button class="btn-secondary" id="prevStepBtn">
                        <i class="fas fa-arrow-left"></i> Atrás
                    </button>
                    <button class="btn-primary" id="confirmAmountBtn">
                        <i class="fas fa-check"></i> Confirmar Monto
                    </button>
                </div>
            </div>
            
            <!-- Paso 3: Confirmar depósito -->
            <div class="deposit-step" id="step-confirm">
                <div class="step-header">
                    <div class="step-number">3</div>
                    <div class="step-title">Confirmar Depósito</div>
                </div>
                
                <div class="confirmation-card">
                    <div class="confirmation-header">
                        <h3><i class="fas fa-clipboard-check"></i> Resumen del Depósito</h3>
                        <div class="order-id" id="orderIdDisplay">Orden: #---</div>
                    </div>
                    
                    <div class="confirmation-details">
                        <div class="detail-row">
                            <span>Método:</span>
                            <span id="confirmMethod">CUP (Tarjeta)</span>
                        </div>
                        <div class="detail-row">
                            <span>Monto a pagar:</span>
                            <span id="confirmAmount">$0.00</span>
                        </div>
                        <div class="detail-row bonus">
                            <span>Bono aplicado:</span>
                            <span id="confirmBonus">$0.00</span>
                        </div>
                        <div class="detail-row tokens">
                            <span>Tokens ganados:</span>
                            <span id="confirmTokens">0</span>
                        </div>
                        <div class="detail-row total">
                            <span>Total a acreditar:</span>
                            <span id="confirmTotal">$0.00</span>
                        </div>
                        <div class="detail-row target">
                            <span>Destino:</span>
                            <span id="confirmTarget">Cargando...</span>
                        </div>
                    </div>
                    
                    <div class="confirmation-instructions" id="confirmationInstructions">
                        <!-- Instrucciones se cargan dinámicamente -->
                    </div>
                    
                    <div class="confirmation-warning">
                        <div class="warning-icon">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div class="warning-content">
                            <p><strong>IMPORTANTE:</strong> Toma captura de pantalla de la transferencia. Si ETECSA no envía el SMS, esta será tu prueba.</p>
                            <p>El pago se detectará automáticamente en 1-10 minutos.</p>
                        </div>
                    </div>
                </div>
                
                <div class="step-actions">
                    <button class="btn-secondary" id="editDepositBtn">
                        <i class="fas fa-edit"></i> Editar
                    </button>
                    <button class="btn-primary" id="createDepositBtn">
                        <i class="fas fa-check-circle"></i> Crear Solicitud
                    </button>
                </div>
            </div>
            
            <!-- Paso 4: Esperando pago -->
            <div class="deposit-step" id="step-pending">
                <div class="step-header">
                    <div class="step-number">4</div>
                    <div class="step-title">Esperando Pago</div>
                </div>
                
                <div class="pending-card">
                    <div class="pending-icon">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div class="pending-info">
                        <h3>Orden <span id="pendingOrderId">#000000</span> Pendiente</h3>
                        <p>Esperando que realices el pago...</p>
                    </div>
                    
                    <div class="payment-details">
                        <div class="detail-box">
                            <div class="detail-label">Monto a pagar</div>
                            <div class="detail-value" id="pendingAmount">$0.00</div>
                        </div>
                        <div class="detail-box">
                            <div class="detail-label">Destino</div>
                            <div class="detail-value" id="pendingTarget">Cargando...</div>
                        </div>
                        <div class="detail-box">
                            <div class="detail-label">Tiempo restante</div>
                            <div class="detail-value">
                                <div class="timer" id="paymentTimer">30:00</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="instructions-box" id="pendingInstructions">
                        <!-- Instrucciones específicas -->
                    </div>
                    
                    <!-- Verificación USDT (oculta por defecto) -->
                    <div class="usdt-verification" id="usdtVerification" style="display: none;">
                        <h4><i class="fas fa-check-circle"></i> Verificar Transacción USDT</h4>
                        <div class="verification-input">
                            <input type="text" 
                                   id="usdtTxHashInput" 
                                   placeholder="Ingresa el hash de la transacción (0x...)">
                            <button class="btn-small" id="verifyUsdtTxBtn">
                                Verificar
                            </button>
                        </div>
                        <div class="verification-help">
                            <i class="fas fa-question-circle"></i>
                            <p>Encuentra el hash en tu wallet (SafePal, Trust Wallet, etc.)</p>
                        </div>
                    </div>
                    
                    <div class="pending-actions">
                        <button class="btn-secondary" id="cancelDepositBtn">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                        <button class="btn-primary" id="checkPaymentBtn">
                            <i class="fas fa-sync-alt"></i> Verificar Pago
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Paso 5: Completado (se renderiza dinámicamente) -->
            <div class="deposit-step" id="step-completed">
            </div>
        `;
        
        console.log('✅ Pasos de depósito renderizados');
    }

    initEventListeners() {
        console.log('🔧 Inicializando event listeners de depósito...');
        
        // Selección de método
        document.querySelectorAll('.method-option').forEach(option => {
            option.addEventListener('click', (e) => this.selectMethod(e));
        });

        // Botones de navegación
        this.setupStepNavigation();
        
        // Montos rápidos
        document.querySelectorAll('.quick-amount').forEach(btn => {
            btn.addEventListener('click', (e) => this.setQuickAmount(e));
        });

        // Input de monto
        const amountInput = document.getElementById('depositAmountInput');
        if (amountInput) {
            amountInput.addEventListener('input', () => this.updateAmountPreview());
        }

        // Input de wallet USDT
        const usdtWalletInput = document.getElementById('usdtWalletInput');
        if (usdtWalletInput) {
            usdtWalletInput.addEventListener('input', () => this.validateUsdtWallet());
        }

        // Input de hash USDT
        const usdtTxHashInput = document.getElementById('usdtTxHashInput');
        if (usdtTxHashInput) {
            usdtTxHashInput.addEventListener('input', () => this.validateTxHash());
        }
        
        console.log('✅ Event listeners de depósito configurados');
    }

    setupStepNavigation() {
        // Next step
        const nextStepBtn = document.getElementById('nextStepBtn');
        if (nextStepBtn) {
            nextStepBtn.addEventListener('click', () => this.nextStep());
        }

        // Previous step
        const prevStepBtn = document.getElementById('prevStepBtn');
        if (prevStepBtn) {
            prevStepBtn.addEventListener('click', () => this.prevStep());
        }

        // Confirm amount
        const confirmAmountBtn = document.getElementById('confirmAmountBtn');
        if (confirmAmountBtn) {
            confirmAmountBtn.addEventListener('click', () => this.confirmAmount());
        }

        // Edit deposit
        const editDepositBtn = document.getElementById('editDepositBtn');
        if (editDepositBtn) {
            editDepositBtn.addEventListener('click', () => this.editDeposit());
        }

        // Create deposit
        const createDepositBtn = document.getElementById('createDepositBtn');
        if (createDepositBtn) {
            createDepositBtn.addEventListener('click', () => this.createDeposit());
        }

        // Cancel deposit
        const cancelDepositBtn = document.getElementById('cancelDepositBtn');
        if (cancelDepositBtn) {
            cancelDepositBtn.addEventListener('click', () => this.cancelDeposit());
        }

        // Check payment
        const checkPaymentBtn = document.getElementById('checkPaymentBtn');
        if (checkPaymentBtn) {
            checkPaymentBtn.addEventListener('click', () => this.checkPayment());
        }

        // Verify USDT
        const verifyUsdtBtn = document.getElementById('verifyUsdtTxBtn');
        if (verifyUsdtBtn) {
            verifyUsdtBtn.addEventListener('click', () => this.verifyUsdtTransaction());
        }
    }

    selectMethod(e) {
        const method = e.currentTarget.getAttribute('data-method');
        
        console.log(`📱 Método seleccionado: ${method}`);
        
        // Actualizar UI de selección
        document.querySelectorAll('.method-option').forEach(option => {
            option.classList.remove('active');
        });
        e.currentTarget.classList.add('active');
        
        // Actualizar detalles del método
        document.querySelectorAll('.method-detail').forEach(detail => {
            detail.classList.remove('active');
        });
        
        const methodDetail = document.querySelector(`.method-detail[data-method="${method}"]`);
        if (methodDetail) {
            methodDetail.classList.add('active');
        }
        
        this.selectedMethod = method;
        this.updateMethodInfo();
    }

    updateMethodInfo() {
        const methods = {
            cup: { 
                min: this.paymentInfo?.minimo_cup || 1000, 
                max: this.paymentInfo?.maximo_cup || 50000, 
                code: 'CUP', 
                label: 'CUP (Tarjeta)' 
            },
            saldo: { 
                min: this.paymentInfo?.minimo_saldo || 500, 
                max: 10000, 
                code: 'SALDO', 
                label: 'Saldo Móvil' 
            },
            usdt: { 
                min: this.paymentInfo?.minimo_usdt || 10, 
                max: 1000, 
                code: 'USDT', 
                label: 'USDT BEP20' 
            }
        };

        const method = methods[this.selectedMethod];
        if (!method) {
            console.error(`❌ Método desconocido: ${this.selectedMethod}`);
            return;
        }

        console.log(`📊 Configurando método: ${method.label}, Mín: ${method.min}, Máx: ${method.max}`);

        // Actualizar límites
        this.updateElement('minAmount', this.formatCurrency(method.min, this.selectedMethod));
        this.updateElement('maxAmount', this.formatCurrency(method.max, this.selectedMethod));
        this.updateElement('currencyCode', method.code);
        this.updateElement('selectedMethodName', method.label);

        // Actualizar input de monto
        const amountInput = document.getElementById('depositAmountInput');
        if (amountInput) {
            amountInput.min = method.min;
            amountInput.max = method.max;
            amountInput.placeholder = `Mínimo: ${this.formatCurrency(method.min, this.selectedMethod)}`;
            
            // Establecer valor mínimo por defecto
            if (!amountInput.value || parseFloat(amountInput.value) < method.min) {
                amountInput.value = method.min;
                this.depositAmount = method.min;
            }
        }

        // Mostrar/ocultar sección de wallet USDT
        const usdtWalletSection = document.getElementById('usdtWalletSection');
        if (usdtWalletSection) {
            usdtWalletSection.style.display = this.selectedMethod === 'usdt' ? 'block' : 'none';
        }

        // Actualizar preview
        this.updateAmountPreview();
    }

    updateElement(elementId, content) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = content;
        } else {
            console.warn(`⚠️ Elemento #${elementId} no encontrado`);
        }
    }

    setQuickAmount(e) {
        const amount = parseFloat(e.currentTarget.getAttribute('data-amount'));
        const amountInput = document.getElementById('depositAmountInput');
        
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
        const amountInput = document.getElementById('depositAmountInput');
        if (!amountInput) {
            console.warn('⚠️ Input de monto no encontrado');
            return;
        }

        const amount = parseFloat(amountInput.value) || 0;
        this.depositAmount = amount;

        // Validar límites
        const methods = {
            cup: { min: this.paymentInfo?.minimo_cup || 1000, max: this.paymentInfo?.maximo_cup || 50000 },
            saldo: { min: this.paymentInfo?.minimo_saldo || 500, max: 10000 },
            usdt: { min: this.paymentInfo?.minimo_usdt || 10, max: 1000 }
        };

        const method = methods[this.selectedMethod];
        
        // Validación visual
        if (amount < method.min || amount > method.max) {
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
        this.updateElement('previewAmount', this.formatCurrency(amount, this.selectedMethod));
        this.updateElement('previewBonus', this.formatCurrency(bonus, this.selectedMethod));
        this.updateElement('previewTokens', this.selectedMethod === 'saldo' ? `${tokens} CWS` : `${tokens.toFixed(2)} CWT`);
        this.updateElement('previewTotal', this.formatCurrency(total, this.selectedMethod));
    }

    nextStep() {
        console.log(`➡️ Avanzando al paso ${this.currentStep + 1}`);
        
        if (this.currentStep === 1) {
            // Validar que se seleccionó un método
            if (!this.selectedMethod) {
                this.showError('Selecciona un método de pago');
                return;
            }
            
            // Para USDT, validar wallet
            if (this.selectedMethod === 'usdt') {
                const wallet = document.getElementById('usdtWalletInput')?.value;
                if (!wallet || !this.validateUsdtWallet(wallet)) {
                    this.showError('Wallet USDT inválida', 'La wallet debe comenzar con 0x y tener 42 caracteres');
                    return;
                }
            }
            
            this.currentStep = 2;
        } else if (this.currentStep === 2) {
            // Validar monto
            const amountInput = document.getElementById('depositAmountInput');
            const amount = parseFloat(amountInput?.value) || 0;
            
            const methods = {
                cup: { min: this.paymentInfo?.minimo_cup || 1000, max: this.paymentInfo?.maximo_cup || 50000 },
                saldo: { min: this.paymentInfo?.minimo_saldo || 500, max: 10000 },
                usdt: { min: this.paymentInfo?.minimo_usdt || 10, max: 1000 }
            };

            const method = methods[this.selectedMethod];
            if (amount < method.min || amount > method.max) {
                this.showError('Monto inválido', `Debe estar entre ${this.formatCurrency(method.min, this.selectedMethod)} y ${this.formatCurrency(method.max, this.selectedMethod)}`);
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
            console.log(`⬅️ Retrocediendo al paso ${this.currentStep - 1}`);
            this.currentStep--;
            this.updateStepUI();
        }
    }

    updateStepUI() {
        console.log(`🔄 Actualizando UI al paso ${this.currentStep}`);
        
        // Ocultar todos los pasos
        document.querySelectorAll('.deposit-step').forEach(step => {
            step.classList.remove('active');
        });

        // Mostrar paso actual
        const currentStepElement = document.getElementById(`step-${this.getStepName(this.currentStep)}`);
        if (currentStepElement) {
            currentStepElement.classList.add('active');
        } else {
            console.error(`❌ Elemento del paso ${this.currentStep} no encontrado`);
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
        this.updateElement('confirmMethod', this.getMethodLabel());
        this.updateElement('confirmAmount', this.formatCurrency(this.depositAmount, this.selectedMethod));
        this.updateElement('confirmBonus', this.formatCurrency(bonus, this.selectedMethod));
        this.updateElement('confirmTokens', tokensLabel);
        this.updateElement('confirmTotal', this.formatCurrency(total, this.selectedMethod));
        this.updateElement('confirmTarget', this.getPaymentTarget());

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
            'cup': this.paymentInfo?.cup_target || 'NO CONFIGURADO',
            'saldo': this.paymentInfo?.saldo_target || 'NO CONFIGURADO',
            'usdt': this.paymentInfo?.usdt_target || 'NO CONFIGURADO'
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
                const wallet = document.getElementById('usdtWalletInput')?.value || '';
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
        console.log('✅ Confirmando monto...');
        this.nextStep();
    }

    async createDeposit() {
        try {
            console.log('📦 Creando solicitud de depósito...');
            
            const amount = this.depositAmount;
            const currency = this.selectedMethod;
            const usdtWallet = currency === 'usdt' ? document.getElementById('usdtWalletInput')?.value : null;

            // Validaciones finales
            if (!amount || amount <= 0) {
                throw new Error('Monto inválido');
            }

            if (currency === 'usdt' && (!usdtWallet || !this.validateUsdtWallet(usdtWallet))) {
                throw new Error('Wallet USDT inválida');
            }

            this.showLoading('Creando solicitud de depósito...');

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
                this.showNotification('Solicitud creada exitosamente', 'success');
            } else {
                throw new Error(data.error || 'Error creando depósito');
            }
        } catch (error) {
            console.error('❌ Error creando depósito:', error);
            this.showError('Error creando depósito', error.message);
        } finally {
            this.hideLoading();
        }
    }

    showPendingOrder() {
        if (!this.orderData) {
            console.error('❌ No hay datos de orden para mostrar');
            return;
        }

        console.log('🔄 Mostrando orden pendiente:', this.orderData);

        // Actualizar información de orden pendiente
        this.updateElement('pendingOrderId', `#${this.orderData.id}`);
        this.updateElement('pendingAmount', this.formatCurrency(this.depositAmount, this.selectedMethod));
        this.updateElement('pendingTarget', this.getPaymentTarget());

        // Actualizar instrucciones pendientes
        this.updatePendingInstructions();

        // Mostrar/ocultar verificación USDT
        const usdtVerification = document.getElementById('usdtVerification');
        if (usdtVerification) {
            usdtVerification.style.display = this.selectedMethod === 'usdt' ? 'block' : 'none';
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
        if (!this.orderData) {
            this.showError('Error', 'No hay orden para verificar');
            return;
        }

        try {
            this.showLoading('Verificando pago...');

            // Simular verificación (en producción, esto llamaría a una API real)
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Por ahora, solo mostramos un mensaje
            this.showNotification('El sistema aún está verificando tu pago. Intenta nuevamente en unos minutos.', 'info');
            
        } catch (error) {
            console.error('❌ Error verificando pago:', error);
            this.showError('Error verificando pago', error.message);
        } finally {
            this.hideLoading();
        }
    }

    async verifyUsdtTransaction() {
        if (this.selectedMethod !== 'usdt' || !this.orderData) {
            this.showError('Error', 'Esta función solo está disponible para depósitos USDT');
            return;
        }

        const txHash = document.getElementById('usdtTxHashInput')?.value?.trim();
        if (!txHash || !this.validateTxHash(txHash)) {
            this.showError('Hash inválido', 'El hash debe comenzar con 0x y tener 66 caracteres');
            return;
        }

        try {
            this.showLoading('Verificando transacción USDT...');

            // Simular verificación (en producción, esto llamaría a una API real)
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            this.showSuccess('Transacción recibida', 'Tu transacción está siendo procesada. El depósito se acreditará en breve.');
            
        } catch (error) {
            console.error('❌ Error verificando USDT:', error);
            this.showError('Error verificando USDT', error.message);
        } finally {
            this.hideLoading();
        }
    }

    async cancelDeposit() {
        if (!this.orderData) {
            this.showError('Error', 'No hay orden para cancelar');
            return;
        }

        if (!confirm('¿Estás seguro de que quieres cancelar esta solicitud de depósito?')) {
            return;
        }

        try {
            this.showLoading('Cancelando orden...');

            // Simular cancelación (en producción, esto llamaría a una API real)
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            this.showNotification('Orden cancelada exitosamente', 'success');
            this.resetDeposit();
            
        } catch (error) {
            console.error('❌ Error cancelando orden:', error);
            this.showError('Error cancelando orden', error.message);
        } finally {
            this.hideLoading();
        }
    }

    editDeposit() {
        console.log('✏️ Editando depósito...');
        this.currentStep = 2;
        this.updateStepUI();
    }

    resetDeposit() {
        console.log('🔄 Reiniciando flujo de depósito...');
        this.currentStep = 1;
        this.selectedMethod = 'cup';
        this.depositAmount = this.paymentInfo?.minimo_cup || 1000;
        this.orderData = null;
        
        // Resetear inputs
        const amountInput = document.getElementById('depositAmountInput');
        if (amountInput) {
            amountInput.value = this.paymentInfo?.minimo_cup || 1000;
        }
        
        const usdtWalletInput = document.getElementById('usdtWalletInput');
        if (usdtWalletInput) {
            usdtWalletInput.value = '';
        }
        
        const usdtTxHashInput = document.getElementById('usdtTxHashInput');
        if (usdtTxHashInput) {
            usdtTxHashInput.value = '';
        }
        
        // Resetear selección de método
        document.querySelectorAll('.method-option').forEach(option => {
            option.classList.remove('active');
        });
        const cupOption = document.querySelector('.method-option[data-method="cup"]');
        if (cupOption) {
            cupOption.classList.add('active');
        }
        
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
                    <p>Orden #${this.orderData?.id || '---'} completada exitosamente</p>
                </div>
                
                <div class="completed-details">
                    <div class="detail-box">
                        <div class="detail-label">Monto acreditado</div>
                        <div class="detail-value">${this.formatCurrency(data?.amount || this.depositAmount, this.selectedMethod)}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Bono aplicado</div>
                        <div class="detail-value">${this.formatCurrency(data?.bonus || 0, this.selectedMethod)}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Tokens ganados</div>
                        <div class="detail-value">${data?.tokens || 0} ${this.selectedMethod === 'saldo' ? 'CWS' : 'CWT'}</div>
                    </div>
                </div>
                
                <div class="completed-actions">
                    <button class="btn-secondary" id="newDepositBtn">
                        <i class="fas fa-plus-circle"></i> Nuevo Depósito
                    </button>
                    <button class="btn-primary" id="goToWalletBtn">
                        <i class="fas fa-wallet"></i> Ir a Mi Wallet
                    </button>
                </div>
            </div>
        `;

        // Añadir event listeners a los nuevos botones
        const newDepositBtn = document.getElementById('newDepositBtn');
        if (newDepositBtn) {
            newDepositBtn.addEventListener('click', () => {
                this.resetDeposit();
                if (window.dashboard) {
                    window.dashboard.switchPage('deposit');
                }
            });
        }

        const goToWalletBtn = document.getElementById('goToWalletBtn');
        if (goToWalletBtn) {
            goToWalletBtn.addEventListener('click', () => {
                if (window.dashboard) {
                    window.dashboard.switchPage('wallet');
                }
            });
        }
    }

    // Métodos de validación
    validateUsdtWallet(wallet) {
        if (!wallet) wallet = document.getElementById('usdtWalletInput')?.value;
        return wallet && wallet.startsWith('0x') && wallet.length === 42;
    }

    validateTxHash(hash) {
        if (!hash) hash = document.getElementById('usdtTxHashInput')?.value;
        return hash && hash.startsWith('0x') && hash.length === 66;
    }

    // Métodos de utilidad
    formatCurrency(amount, currency) {
        const symbols = {
            'cup': 'CUP',
            'saldo': 'Saldo',
            'usdt': 'USDT'
        };
        
        const symbol = symbols[currency] || currency?.toUpperCase() || '';
        
        if (currency === 'usdt') {
            return `${parseFloat(amount || 0).toFixed(2)} ${symbol}`;
        }
        
        return `$${parseFloat(amount || 0).toFixed(2)} ${symbol}`;
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
        if (window.showNotification) {
            window.showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
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
    console.log('💳 Inicializando DepositManager...');
    
    // Solo inicializar si estamos en la página de depósitos
    if (document.getElementById('deposit-page')) {
        window.depositManager = new DepositManager();
        
        // Observar cambios en la visibilidad de la página
        const depositPage = document.getElementById('deposit-page');
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (depositPage.classList.contains('active')) {
                        console.log('📄 Página de depósito activa, inicializando...');
                        setTimeout(() => {
                            window.depositManager.init();
                        }, 300);
                    }
                }
            });
        });
        
        observer.observe(depositPage, { attributes: true });
        
        // También inicializar si la página ya está activa
        if (depositPage.classList.contains('active')) {
            setTimeout(() => {
                window.depositManager.init();
            }, 300);
        }
    }
});
