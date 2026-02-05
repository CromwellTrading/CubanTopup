// Sistema completo del Dashboard - VERSIÓN COMPLETA CORREGIDA
class Dashboard {
    constructor() {
        this.currentPage = 'dashboard';
        this.userData = null;
        this.chart = null;
        this.notifications = [];
        this.paymentInfo = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        
        console.log('🚀 Inicializando Dashboard...');
        await this.initEventListeners();
        await this.loadPaymentInfo();
        await this.loadUserData();
        await this.loadNotifications();
        this.renderDashboard();
        this.startAutoRefresh();
        this.initialized = true;
        console.log('✅ Dashboard inicializado');
    }

    async initEventListeners() {
        console.log('🔧 Inicializando event listeners...');
        
        // Navegación principal
        document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const page = btn.getAttribute('data-page');
                console.log(`📱 Navegando a: ${page}`);
                this.switchPage(page);
            });
        });

        // Botón refresh dashboard
        const refreshBtn = document.getElementById('refreshDashboard');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshData());
        }

        // Botón ver toda la actividad
        const viewAllBtn = document.getElementById('viewAllActivity');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => this.switchPage('history'));
        }

        // Botón recarga rápida
        const quickDepositBtn = document.getElementById('quickDeposit');
        if (quickDepositBtn) {
            quickDepositBtn.addEventListener('click', () => this.switchPage('deposit'));
        }

        // Botón logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        // Botones de acción rápida
        document.querySelectorAll('.action-btn[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleQuickAction(e));
        });

        console.log('✅ Event listeners configurados');
    }

    async loadUserData() {
        try {
            console.log('📥 Cargando datos del usuario...');
            const response = await fetch('/api/user-data', {
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            if (response.status === 401) {
                console.log('❌ No autorizado, redirigiendo...');
                window.location.href = '/';
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                this.userData = data;
                console.log('✅ Datos del usuario cargados:', data.user);
                this.updateUI();
            } else {
                throw new Error(data.error || 'Error desconocido del servidor');
            }
        } catch (error) {
            console.error('❌ Error cargando datos:', error);
            this.showError('Error cargando datos', error.message);
        }
    }

    async loadPaymentInfo() {
        try {
            console.log('💰 Cargando información de pago...');
            const response = await fetch('/api/payment-info', {
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            if (response.ok) {
                this.paymentInfo = await response.json();
                window.PAYMENT_INFO = this.paymentInfo;
                console.log('✅ Información de pago cargada');
            } else {
                console.warn('⚠️ No se pudo cargar información de pago');
            }
        } catch (error) {
            console.error('❌ Error cargando información de pago:', error);
        }
    }

    async loadNotifications() {
        try {
            console.log('🔔 Cargando notificaciones...');
            const response = await fetch('/api/notifications', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.notifications = data.notifications || [];
                console.log(`✅ ${this.notifications.length} notificaciones cargadas`);
            }
        } catch (error) {
            console.error('❌ Error cargando notificaciones:', error);
        }
    }

    updateUI() {
        console.log('🔄 Actualizando UI...');
        
        if (!this.userData || !this.userData.user) {
            console.warn('⚠️ No hay datos de usuario para actualizar UI');
            return;
        }

        const { user, stats } = this.userData;

        // Actualizar elementos con verificación de existencia
        this.safeUpdateElement('userName', user.first_name || user.username || 'Usuario');
        this.safeUpdateElement('userGreeting', `Hola, ${user.first_name || user.username || 'Usuario'}`);
        
        // Actualizar balances
        this.safeUpdateElement('totalBalance', this.formatTotalBalance(user));
        this.safeUpdateElement('cupBalance', this.formatCurrency(user.balance_cup || 0, 'cup'));
        this.safeUpdateElement('saldoBalance', this.formatCurrency(user.balance_saldo || 0, 'saldo'));
        this.safeUpdateElement('usdtBalance', this.formatCurrency(user.balance_usdt || 0, 'usdt'));
        this.safeUpdateElement('cwsTokens', user.tokens_cws || 0);
        this.safeUpdateElement('cwtTokens', this.formatNumber(user.tokens_cwt || 0, 2));
        
        // Actualizar estadísticas
        this.safeUpdateElement('totalTransactions', stats?.total_deposits || 0);
        
        // Actualizar notificación count
        const unreadCount = this.notifications.filter(n => !n.read).length;
        this.safeUpdateElement('notificationCount', unreadCount);
        
        // Actualizar actividad reciente
        this.updateRecentActivity();
        
        // Actualizar lista de notificaciones
        this.updateNotificationsList();
        
        // Actualizar gráfico si está en la página de dashboard
        if (this.currentPage === 'dashboard') {
            this.updateChart();
        }

        console.log('✅ UI actualizada');
    }

    safeUpdateElement(elementId, content) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = content;
        } else {
            console.warn(`⚠️ Elemento #${elementId} no encontrado`);
        }
    }

    updateRecentActivity() {
        const container = document.getElementById('recentActivity');
        if (!container) {
            console.warn('⚠️ Contenedor de actividad reciente no encontrado');
            return;
        }

        const transactions = this.userData?.transactions?.slice(0, 5) || [];

        if (transactions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-history"></i>
                    <p>No hay actividad reciente</p>
                </div>
            `;
            return;
        }

        container.innerHTML = transactions.map(tx => this.createActivityItem(tx)).join('');
    }

    createActivityItem(transaction) {
        const icons = {
            'DEPOSIT': 'fas fa-arrow-down',
            'PURCHASE': 'fas fa-shopping-cart',
            'AUTO_DEPOSIT': 'fas fa-bolt',
            'AUTO_ACCUMULATED': 'fas fa-coins',
            'COMPLETED': 'fas fa-check-circle',
            'PENDING': 'fas fa-clock'
        };

        const colors = {
            'completed': 'var(--success-color)',
            'pending': 'var(--warning-color)',
            'rejected': 'var(--danger-color)',
            'cancelled': 'var(--danger-color)'
        };

        const date = new Date(transaction.created_at);
        const timeAgo = this.timeSince(date);
        
        const icon = icons[transaction.type] || icons[transaction.status] || 'fas fa-exchange-alt';
        const color = colors[transaction.status] || 'var(--primary-color)';

        return `
            <div class="activity-item">
                <div class="activity-icon" style="background: ${color}20">
                    <i class="${icon}" style="color: ${color}"></i>
                </div>
                <div class="activity-info">
                    <div class="activity-title">${this.getTransactionTitle(transaction)}</div>
                    <div class="activity-desc">${this.formatCurrency(transaction.amount || transaction.amount_requested, transaction.currency)}</div>
                </div>
                <div class="activity-time">${timeAgo}</div>
            </div>
        `;
    }

    updateNotificationsList() {
        const container = document.getElementById('notificationsList');
        if (!container) return;

        if (this.notifications.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-bell-slash"></i>
                    <p>No hay notificaciones</p>
                </div>
            `;
            return;
        }

        const recentNotifications = this.notifications.slice(0, 5);
        container.innerHTML = recentNotifications.map(notification => this.createNotificationItem(notification)).join('');
    }

    createNotificationItem(notification) {
        const icons = {
            'payment': 'fas fa-money-bill-wave',
            'bonus': 'fas fa-gift',
            'warning': 'fas fa-exclamation-triangle',
            'info': 'fas fa-info-circle',
            'success': 'fas fa-check-circle'
        };

        const date = new Date(notification.timestamp || notification.created_at);
        const timeAgo = this.timeSince(date);
        const iconClass = icons[notification.icon] || 'fas fa-bell';

        return `
            <div class="notification-item ${notification.read ? '' : 'unread'} ${notification.type || 'info'}">
                <div class="notification-icon">
                    <i class="${iconClass}"></i>
                </div>
                <div class="notification-content">
                    <div class="notification-title">${notification.title || 'Notificación'}</div>
                    <div class="notification-desc">${notification.message || 'Sin mensaje'}</div>
                </div>
                <div class="notification-time">${timeAgo}</div>
            </div>
        `;
    }

    updateChart() {
        const ctx = document.getElementById('historyChart')?.getContext('2d');
        if (!ctx) {
            console.warn('⚠️ Canvas de gráfico no encontrado');
            return;
        }

        if (!this.userData?.transactions) {
            console.warn('⚠️ No hay transacciones para el gráfico');
            return;
        }

        // Destruir gráfico anterior si existe
        if (this.chart) {
            this.chart.destroy();
        }

        try {
            // Preparar datos para el gráfico
            const transactions = this.userData.transactions;
            const last30Days = this.getLast30Days();
            
            const dailyData = {};
            last30Days.forEach(day => {
                dailyData[day] = { cup: 0, saldo: 0, usdt: 0 };
            });

            transactions.forEach(tx => {
                if (tx.status === 'completed') {
                    const date = new Date(tx.created_at).toISOString().split('T')[0];
                    if (dailyData[date]) {
                        dailyData[date][tx.currency] += parseFloat(tx.amount || tx.amount_requested || 0);
                    }
                }
            });

            const labels = last30Days.map(date => {
                const d = new Date(date);
                return `${d.getDate()}/${d.getMonth() + 1}`;
            });

            this.chart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'CUP',
                            data: last30Days.map(date => dailyData[date].cup),
                            backgroundColor: 'rgba(106, 17, 203, 0.7)',
                            borderColor: 'rgba(106, 17, 203, 1)',
                            borderWidth: 1
                        },
                        {
                            label: 'Saldo',
                            data: last30Days.map(date => dailyData[date].saldo),
                            backgroundColor: 'rgba(0, 176, 155, 0.7)',
                            borderColor: 'rgba(0, 176, 155, 1)',
                            borderWidth: 1
                        },
                        {
                            label: 'USDT',
                            data: last30Days.map(date => dailyData[date].usdt),
                            backgroundColor: 'rgba(33, 150, 243, 0.7)',
                            borderColor: 'rgba(33, 150, 243, 1)',
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: (value) => `$${value}`
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                color: 'var(--text-color)'
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const label = context.dataset.label || '';
                                    const value = context.raw;
                                    return `${label}: $${value}`;
                                }
                            }
                        }
                    }
                }
            });
            
            console.log('📊 Gráfico actualizado');
        } catch (error) {
            console.error('❌ Error creando gráfico:', error);
        }
    }

    getLast30Days() {
        const dates = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            dates.push(date.toISOString().split('T')[0]);
        }
        return dates;
    }

    switchPage(page) {
        console.log(`🔄 Cambiando a página: ${page}`);
        
        // Validar que la página existe
        const targetPage = document.getElementById(`${page}-page`);
        if (!targetPage) {
            console.error(`❌ Página ${page} no encontrada`);
            this.showError('Error', `La página ${page} no está disponible`);
            return;
        }

        // Actualizar botones de navegación
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const btnPage = btn.getAttribute('data-page');
            if (btnPage === page) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Ocultar todas las páginas
        document.querySelectorAll('.page').forEach(pageEl => {
            pageEl.classList.remove('active');
        });

        // Mostrar página seleccionada
        targetPage.classList.add('active');
        this.currentPage = page;
        
        // Cargar datos específicos de la página
        setTimeout(() => {
            switch(page) {
                case 'wallet':
                    if (window.walletManager) {
                        window.walletManager.refreshWallet();
                    }
                    break;
                case 'history':
                    if (window.historyManager) {
                        window.historyManager.loadHistory();
                    }
                    break;
                case 'deposit':
                    if (window.depositManager) {
                        window.depositManager.init();
                    }
                    break;
                case 'claims':
                    if (window.claimsManager) {
                        window.claimsManager.init();
                    }
                    break;
            }
        }, 100);
        
        console.log(`✅ Cambiado a página: ${page}`);
    }

    handleQuickAction(e) {
        const action = e.currentTarget.getAttribute('data-action');
        console.log(`⚡ Acción rápida: ${action}`);
        
        switch(action) {
            case 'link-phone':
                this.showModal('profileModal');
                break;
            case 'claim-payment':
                this.switchPage('claims');
                break;
            case 'view-terms':
                this.showTerms();
                break;
            case 'support':
                window.open('https://t.me/cromwell_support', '_blank');
                break;
            default:
                console.warn(`⚠️ Acción desconocida: ${action}`);
        }
    }

    async refreshData() {
        console.log('🔄 Refrescando datos...');
        const refreshBtn = document.getElementById('refreshDashboard');
        const originalText = refreshBtn?.innerHTML;
        
        if (refreshBtn) {
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando';
            refreshBtn.disabled = true;
        }
        
        try {
            await Promise.all([
                this.loadUserData(),
                this.loadNotifications()
            ]);
            
            this.showNotification('Datos actualizados', 'success');
        } catch (error) {
            console.error('❌ Error refrescando datos:', error);
        } finally {
            if (refreshBtn) {
                refreshBtn.innerHTML = originalText || '<i class="fas fa-sync-alt"></i> Actualizar';
                refreshBtn.disabled = false;
            }
        }
    }

    startAutoRefresh() {
        // Actualizar datos cada 60 segundos
        setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.loadUserData();
            }
        }, 60000);
    }

    async logout() {
        try {
            console.log('👋 Cerrando sesión...');
            
            if (!confirm('¿Estás seguro de que quieres cerrar sesión?')) {
                return;
            }
            
            const response = await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include'
            });
            
            if (response.ok) {
                window.location.href = '/';
            } else {
                throw new Error('Error en la respuesta del servidor');
            }
        } catch (error) {
            console.error('❌ Error cerrando sesión:', error);
            this.showError('Error cerrando sesión', error.message);
        }
    }

    // Métodos de utilidad
    formatTotalBalance() {
        if (!this.userData?.user) return '$0.00';
        
        const { balance_cup, balance_saldo, balance_usdt } = this.userData.user;
        const rates = {
            cup: 1,
            saldo: 1,
            usdt: this.paymentInfo?.usd_to_cup_rate || 280 // Tasa de cambio CUP/USDT
        };
        
        const total = (balance_cup || 0) * rates.cup + 
                     (balance_saldo || 0) * rates.saldo + 
                     (balance_usdt || 0) * rates.usdt;
        
        return this.formatCurrency(total, 'cup');
    }

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

    formatNumber(num, decimals = 2) {
        return parseFloat(num || 0).toFixed(decimals);
    }

    timeSince(date) {
        if (!date) return 'Justo ahora';
        
        const now = new Date();
        const targetDate = new Date(date);
        const seconds = Math.floor((now - targetDate) / 1000);
        
        if (seconds < 60) return 'Justo ahora';
        
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + ' años';
        
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + ' meses';
        
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + ' días';
        
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + ' horas';
        
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + ' minutos';
        
        return Math.floor(seconds) + ' segundos';
    }

    getTransactionTitle(transaction) {
        const titles = {
            'DEPOSIT': 'Depósito',
            'PURCHASE': 'Compra',
            'AUTO_DEPOSIT': 'Depósito Automático',
            'AUTO_ACCUMULATED': 'Acumulado Automático',
            'MANUAL_DEPOSIT': 'Depósito Manual',
            'COMPLETED': 'Completado',
            'PENDING': 'Pendiente'
        };
        
        return titles[transaction.type] || titles[transaction.status] || transaction.type || 'Transacción';
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    showNotification(message, type = 'info') {
        // Usar sistema global de notificaciones
        if (window.showNotification) {
            window.showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
            // Mostrar notificación simple
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.innerHTML = `
                <div class="notification-content">
                    <i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>
                    <span>${message}</span>
                </div>
            `;
            document.body.appendChild(notification);
            
            setTimeout(() => notification.remove(), 5000);
        }
    }

    showError(title, message) {
        this.showNotification(`${title}: ${message}`, 'error');
    }

    showTerms() {
        this.showModal('termsModal');
    }

    renderDashboard() {
        console.log('🎨 Renderizando dashboard...');
        this.switchPage('dashboard');
    }
}

// Inicializar dashboard cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM cargado, inicializando dashboard...');
    
    // Inicializar solo si estamos en el dashboard
    if (document.getElementById('dashboard-page')) {
        window.dashboard = new Dashboard();
        
        // Pequeño delay para asegurar que todo esté cargado
        setTimeout(() => {
            window.dashboard.init();
        }, 100);
    }
});
