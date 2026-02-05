// Sistema completo del Dashboard
class Dashboard {
    constructor() {
        this.currentPage = 'dashboard';
        this.userData = null;
        this.chart = null;
        this.notifications = [];
        this.init();
    }

    async init() {
        this.initEventListeners();
        await this.loadUserData();
        this.renderDashboard();
        this.startAutoRefresh();
    }

    initEventListeners() {
        // Navegación
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchPage(e));
        });

        // Botones de acción rápida
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleQuickAction(e));
        });

        // Botón refresh
        document.getElementById('refreshDashboard')?.addEventListener('click', () => this.refreshData());

        // Botón ver toda la actividad
        document.getElementById('viewAllActivity')?.addEventListener('click', () => this.switchPage('history'));

        // Botón recarga rápida
        document.getElementById('quickDeposit')?.addEventListener('click', () => this.switchPage('deposit'));

        // Botón logout
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
    }

    async loadUserData() {
        try {
            const response = await fetch('/api/user-data', {
                credentials: 'include'
            });

            if (response.status === 401) {
                window.location.href = '/';
                return;
            }

            const data = await response.json();
            
            if (data.success) {
                this.userData = data;
                this.updateUI();
                this.loadNotifications();
                this.updateChart();
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.showError('Error cargando datos', error.message);
        }
    }

    updateUI() {
        if (!this.userData) return;

        const { user, stats } = this.userData;

        // Actualizar saludo
        document.getElementById('userName').textContent = user.firstName || user.username;
        document.getElementById('userGreeting').textContent = `Hola, ${user.firstName || user.username}`;

        // Actualizar balances
        document.getElementById('totalBalance').textContent = this.formatTotalBalance();
        document.getElementById('cupBalance').textContent = this.formatCurrency(user.balance_cup, 'cup');
        document.getElementById('saldoBalance').textContent = this.formatCurrency(user.balance_saldo, 'saldo');
        document.getElementById('usdtBalance').textContent = this.formatCurrency(user.balance_usdt, 'usdt');
        document.getElementById('cwsTokens').textContent = user.tokens_cws || 0;
        document.getElementById('cwtTokens').textContent = this.formatNumber(user.tokens_cwt || 0, 2);

        // Actualizar estadísticas
        document.getElementById('totalTransactions').textContent = stats.total_deposits || 0;
        document.getElementById('notificationCount').textContent = this.notifications.filter(n => !n.read).length;

        // Actualizar actividad reciente
        this.updateRecentActivity();

        // Actualizar notificaciones
        this.updateNotificationsList();
    }

    updateRecentActivity() {
        const container = document.getElementById('recentActivity');
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
            'AUTO_ACCUMULATED': 'fas fa-coins'
        };

        const colors = {
            'completed': 'var(--success-color)',
            'pending': 'var(--warning-color)',
            'rejected': 'var(--danger-color)'
        };

        const date = new Date(transaction.created_at);
        const timeAgo = this.timeSince(date);

        return `
            <div class="activity-item">
                <div class="activity-icon" style="background: ${colors[transaction.status] || 'var(--primary-color)'}20">
                    <i class="${icons[transaction.type] || 'fas fa-exchange-alt'}" 
                       style="color: ${colors[transaction.status] || 'var(--primary-color)'}"></i>
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
        const unreadCount = this.notifications.filter(n => !n.read).length;

        document.getElementById('notificationCount').textContent = unreadCount;

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

        const date = new Date(notification.timestamp);
        const timeAgo = this.timeSince(date);

        return `
            <div class="notification-item ${notification.read ? '' : 'unread'} ${notification.type || 'info'}">
                <div class="notification-icon">
                    <i class="${icons[notification.icon] || 'fas fa-bell'}"></i>
                </div>
                <div class="notification-content">
                    <div class="notification-title">${notification.title}</div>
                    <div class="notification-desc">${notification.message}</div>
                </div>
                <div class="notification-time">${timeAgo}</div>
            </div>
        `;
    }

    async loadNotifications() {
        try {
            const response = await fetch('/api/notifications', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.notifications = data.notifications || [];
            }
        } catch (error) {
            console.error('Error cargando notificaciones:', error);
        }
    }

    updateChart() {
        const ctx = document.getElementById('historyChart')?.getContext('2d');
        if (!ctx || !this.userData?.transactions) return;

        // Destruir gráfico anterior si existe
        if (this.chart) {
            this.chart.destroy();
        }

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
                    dailyData[date][tx.currency] += parseFloat(tx.amount || tx.amount_requested);
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
                            callback: (value) => this.formatCurrency(value, 'cup').replace('CUP', '')
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
                                return `${label}: ${this.formatCurrency(value, context.dataset.label.toLowerCase())}`;
                            }
                        }
                    }
                }
            }
        });
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
        // Actualizar botones de navegación
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-page') === page) {
                btn.classList.add('active');
            }
        });

        // Ocultar todas las páginas
        document.querySelectorAll('.page').forEach(pageEl => {
            pageEl.classList.remove('active');
        });

        // Mostrar página seleccionada
        const targetPage = document.getElementById(`${page}-page`);
        if (targetPage) {
            targetPage.classList.add('active');
            this.currentPage = page;
            
            // Cargar datos específicos de la página
            switch(page) {
                case 'wallet':
                    window.walletManager?.refreshWallet();
                    break;
                case 'history':
                    window.historyManager?.loadHistory();
                    break;
                case 'deposit':
                    window.depositManager?.initDeposit();
                    break;
                case 'claims':
                    window.claimsManager?.loadPendingPayments();
                    break;
            }
        }
    }

    handleQuickAction(e) {
        const action = e.currentTarget.getAttribute('data-action');
        
        switch(action) {
            case 'link-phone':
                this.showModal('phoneModal');
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
        }
    }

    async refreshData() {
        await this.loadUserData();
        this.showNotification('Datos actualizados', 'success');
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
            await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include'
            });
            
            window.location.href = '/';
        } catch (error) {
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
            usdt: 280 // Tasa de cambio CUP/USDT
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
        
        const symbol = symbols[currency] || currency.toUpperCase();
        
        if (currency === 'usdt') {
            return `${parseFloat(amount).toFixed(2)} ${symbol}`;
        }
        
        return `$${parseFloat(amount).toFixed(2)} ${symbol}`;
    }

    formatNumber(num, decimals = 2) {
        return parseFloat(num).toFixed(decimals);
    }

    timeSince(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
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
            'AUTO_ACCUMULATED': 'Acumulado Automático'
        };
        
        return titles[transaction.type] || transaction.type;
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    showNotification(message, type = 'info') {
        window.showNotification?.(message, type) || console.log(`[${type}] ${message}`);
    }

    showError(title, message) {
        this.showNotification(`${title}: ${message}`, 'error');
    }

    showTerms() {
        window.showTermsModal?.() || this.showModal('termsModal');
    }
}
// public/js/dashboard.js - AÑADE esto al final del archivo

// Menú móvil
document.addEventListener('DOMContentLoaded', function() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navMenu = document.querySelector('.nav-menu');
  
  if (mobileMenuBtn && navMenu) {
    mobileMenuBtn.addEventListener('click', function() {
      navMenu.classList.toggle('active');
    });
    
    // Cerrar menú al hacer clic en un botón
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        navMenu.classList.remove('active');
      });
    });
    
    // Cerrar menú al hacer clic fuera
    document.addEventListener('click', (e) => {
      if (!navMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        navMenu.classList.remove('active');
      }
    });
  }
  
  // Logo clickable - redirige a dashboard
  const logo = document.querySelector('.nav-brand .logo');
  if (logo) {
    logo.addEventListener('click', function(e) {
      e.preventDefault();
      window.location.href = '/dashboard';
    });
  }
});

// Inicializar dashboard cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
});
