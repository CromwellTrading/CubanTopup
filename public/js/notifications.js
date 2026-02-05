// Sistema completo de Notificaciones en Tiempo Real
class NotificationSystem {
    constructor() {
        this.notifications = [];
        this.unreadCount = 0;
        this.soundEnabled = true;
        this.pushEnabled = false;
        this.init();
    }

    init() {
        this.initEventListeners();
        this.loadNotifications();
        this.setupWebSocket();
        this.setupServiceWorker();
        this.startPolling();
    }

    initEventListeners() {
        // Botón para marcar todas como leídas
        document.addEventListener('click', (e) => {
            if (e.target.closest('#markAllRead')) {
                this.markAllAsRead();
            }
            
            if (e.target.closest('.notification-item')) {
                const notificationId = e.target.closest('.notification-item').dataset.id;
                if (notificationId) {
                    this.markAsRead(notificationId);
                }
            }
        });

        // Control de sonido
        const soundToggle = document.getElementById('soundToggle');
        if (soundToggle) {
            soundToggle.addEventListener('change', (e) => {
                this.soundEnabled = e.target.checked;
                localStorage.setItem('notificationSound', this.soundEnabled);
            });
        }

        // Control de notificaciones push
        const pushToggle = document.getElementById('pushToggle');
        if (pushToggle) {
            pushToggle.addEventListener('change', (e) => {
                this.togglePushNotifications(e.target.checked);
            });
        }
    }

    async loadNotifications() {
        try {
            const response = await fetch('/api/notifications', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.notifications = data.notifications || [];
                this.updateUnreadCount();
                this.renderNotifications();
            }
        } catch (error) {
            console.error('Error cargando notificaciones:', error);
        }
    }

    setupWebSocket() {
        // Intentar conexión WebSocket para notificaciones en tiempo real
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket conectado para notificaciones');
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket desconectado, reconectando...');
                setTimeout(() => this.setupWebSocket(), 5000);
            };
        } catch (error) {
            console.error('Error configurando WebSocket:', error);
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'NEW_NOTIFICATION':
                this.addNotification(data.notification);
                break;
                
            case 'PAYMENT_RECEIVED':
                this.showPaymentNotification(data.payment);
                break;
                
            case 'DEPOSIT_APPROVED':
                this.showDepositApproved(data.deposit);
                break;
                
            case 'SYSTEM_ALERT':
                this.showSystemAlert(data.alert);
                break;
                
            case 'BALANCE_UPDATE':
                this.updateBalanceDisplay(data.balance);
                break;
        }
    }

    setupServiceWorker() {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('ServiceWorker registrado:', registration);
                    
                    // Solicitar permiso para notificaciones push
                    this.requestPushPermission();
                })
                .catch(error => {
                    console.error('Error registrando ServiceWorker:', error);
                });
        }
    }

    async requestPushPermission() {
        if (!('Notification' in window)) {
            console.log('Este navegador no soporta notificaciones push');
            return;
        }

        if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            this.pushEnabled = permission === 'granted';
            
            if (this.pushEnabled) {
                this.subscribeToPush();
            }
        } else {
            this.pushEnabled = Notification.permission === 'granted';
        }

        // Actualizar toggle
        const pushToggle = document.getElementById('pushToggle');
        if (pushToggle) {
            pushToggle.checked = this.pushEnabled;
            pushToggle.disabled = false;
        }
    }

    async subscribeToPush() {
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY)
            });

            // Enviar subscription al servidor
            await fetch('/api/push-subscription', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(subscription)
            });

            console.log('Suscripto a notificaciones push');
        } catch (error) {
            console.error('Error suscribiéndose a push:', error);
        }
    }

    async togglePushNotifications(enabled) {
        if (enabled) {
            await this.requestPushPermission();
        } else {
            // Desuscribirse de push
            try {
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.getSubscription();
                
                if (subscription) {
                    await subscription.unsubscribe();
                    await fetch('/api/push-unsubscribe', {
                        method: 'POST',
                        credentials: 'include'
                    });
                }
            } catch (error) {
                console.error('Error desuscribiéndose de push:', error);
            }
        }
        
        this.pushEnabled = enabled;
        localStorage.setItem('pushNotifications', enabled);
    }

    startPolling() {
        // Polling como respaldo si WebSocket falla
        setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.loadNotifications();
            }
        }, 30000); // Cada 30 segundos
    }

    addNotification(notification) {
        // Agregar al inicio del array
        this.notifications.unshift(notification);
        
        // Limitar a 100 notificaciones
        if (this.notifications.length > 100) {
            this.notifications = this.notifications.slice(0, 100);
        }
        
        // Actualizar contador
        this.updateUnreadCount();
        
        // Mostrar notificación en UI
        this.showNotificationUI(notification);
        
        // Reproducir sonido si está habilitado
        if (this.soundEnabled && notification.sound !== false) {
            this.playNotificationSound();
        }
        
        // Mostrar notificación push si está habilitado
        if (this.pushEnabled && notification.push !== false) {
            this.showPushNotification(notification);
        }
        
        // Actualizar lista si está visible
        if (document.getElementById('notificationsList')) {
            this.renderNotifications();
        }
    }

    showNotificationUI(notification) {
        const container = document.getElementById('notificationContainer');
        if (!container) return;

        const notificationId = `notification-${Date.now()}`;
        const notificationEl = document.createElement('div');
        notificationEl.id = notificationId;
        notificationEl.className = `notification-item ${notification.type || 'info'}`;
        notificationEl.dataset.id = notification.id;
        notificationEl.innerHTML = `
            <div class="notification-icon">
                <i class="fas ${this.getNotificationIcon(notification.type)}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${notification.title}</div>
                <div class="notification-message">${notification.message}</div>
            </div>
            <button class="notification-close" onclick="this.closest('.notification-item').remove()">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(notificationEl);

        // Auto-eliminar después de 10 segundos
        setTimeout(() => {
            const el = document.getElementById(notificationId);
            if (el) {
                el.classList.add('hiding');
                setTimeout(() => el.remove(), 300);
            }
        }, 10000);
    }

    renderNotifications() {
        const container = document.getElementById('notificationsList');
        if (!container) return;

        // Mostrar solo las 10 más recientes
        const recentNotifications = this.notifications.slice(0, 10);
        
        if (recentNotifications.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-bell-slash"></i>
                    <p>No hay notificaciones</p>
                </div>
            `;
            return;
        }

        container.innerHTML = recentNotifications.map(n => this.createNotificationItem(n)).join('');
    }

    createNotificationItem(notification) {
        const date = new Date(notification.timestamp || notification.created_at);
        const timeAgo = this.timeSince(date);

        return `
            <div class="notification-item ${notification.read ? '' : 'unread'} ${notification.type || 'info'}" 
                 data-id="${notification.id}">
                <div class="notification-icon">
                    <i class="fas ${this.getNotificationIcon(notification.type)}"></i>
                </div>
                <div class="notification-content">
                    <div class="notification-title">${notification.title}</div>
                    <div class="notification-desc">${notification.message}</div>
                </div>
                <div class="notification-time">${timeAgo}</div>
            </div>
        `;
    }

    showPaymentNotification(payment) {
        const notification = {
            id: `payment-${payment.id}`,
            title: '💸 Pago Recibido',
            message: `Recibiste ${this.formatCurrency(payment.amount, payment.currency)}`,
            type: 'success',
            timestamp: new Date().toISOString(),
            read: false,
            data: payment
        };

        this.addNotification(notification);
    }

    showDepositApproved(deposit) {
        const notification = {
            id: `deposit-${deposit.id}`,
            title: '✅ Depósito Aprobado',
            message: `Se acreditó ${this.formatCurrency(deposit.amount, deposit.currency)} a tu wallet`,
            type: 'success',
            timestamp: new Date().toISOString(),
            read: false,
            data: deposit
        };

        this.addNotification(notification);
    }

    showSystemAlert(alert) {
        const notification = {
            id: `alert-${Date.now()}`,
            title: '⚠️ ' + alert.title,
            message: alert.message,
            type: alert.level || 'warning',
            timestamp: new Date().toISOString(),
            read: false,
            data: alert
        };

        this.addNotification(notification);
    }

    updateBalanceDisplay(balance) {
        // Actualizar balances en tiempo real en el dashboard
        const balanceElements = {
            'cup': document.getElementById('cupBalance'),
            'saldo': document.getElementById('saldoBalance'),
            'usdt': document.getElementById('usdtBalance'),
            'total': document.getElementById('totalBalance')
        };

        Object.entries(balance).forEach(([currency, amount]) => {
            const element = balanceElements[currency];
            if (element) {
                const currentAmount = this.extractNumber(element.textContent);
                const newAmount = parseFloat(amount);
                
                if (currentAmount !== newAmount) {
                    // Animar cambio
                    this.animateValueChange(element, currentAmount, newAmount, currency);
                }
            }
        });
    }

    animateValueChange(element, start, end, currency) {
        const duration = 1000; // 1 segundo
        const startTime = Date.now();
        
        const update = () => {
            const now = Date.now();
            const progress = Math.min((now - startTime) / duration, 1);
            
            // Easing function
            const easeOut = progress => 1 - Math.pow(1 - progress, 3);
            
            const current = start + (end - start) * easeOut(progress);
            
            if (currency === 'total') {
                element.textContent = this.formatCurrency(current, 'cup');
            } else {
                element.textContent = this.formatCurrency(current, currency);
            }
            
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        };
        
        requestAnimationFrame(update);
    }

    extractNumber(text) {
        const match = text.match(/[\d,]+\.?\d*/);
        return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
    }

    async markAsRead(notificationId) {
        try {
            await fetch(`/api/notifications/${notificationId}/read`, {
                method: 'POST',
                credentials: 'include'
            });

            // Actualizar localmente
            const notification = this.notifications.find(n => n.id == notificationId);
            if (notification) {
                notification.read = true;
                this.updateUnreadCount();
                
                // Actualizar UI si está visible
                const notificationEl = document.querySelector(`.notification-item[data-id="${notificationId}"]`);
                if (notificationEl) {
                    notificationEl.classList.remove('unread');
                }
            }
        } catch (error) {
            console.error('Error marcando como leído:', error);
        }
    }

    async markAllAsRead() {
        try {
            await fetch('/api/notifications/read-all', {
                method: 'POST',
                credentials: 'include'
            });

            // Actualizar localmente
            this.notifications.forEach(n => n.read = true);
            this.updateUnreadCount();
            
            // Actualizar UI
            document.querySelectorAll('.notification-item.unread').forEach(el => {
                el.classList.remove('unread');
            });
            
            this.showNotification('Todas las notificaciones marcadas como leídas', 'success');
        } catch (error) {
            this.showError('Error marcando como leídas', error.message);
        }
    }

    updateUnreadCount() {
        this.unreadCount = this.notifications.filter(n => !n.read).length;
        
        // Actualizar contador en UI
        const countElement = document.getElementById('notificationCount');
        if (countElement) {
            countElement.textContent = this.unreadCount;
            countElement.style.display = this.unreadCount > 0 ? 'flex' : 'none';
        }
        
        // Actualizar título de la página
        if (this.unreadCount > 0) {
            document.title = `(${this.unreadCount}) Cromwell Store`;
        } else {
            document.title = 'Cromwell Store';
        }
    }

    playNotificationSound() {
        try {
            const audio = new Audio('/sounds/notification.mp3');
            audio.volume = 0.3;
            audio.play().catch(e => console.log('Error reproduciendo sonido:', e));
        } catch (error) {
            console.error('Error con sonido de notificación:', error);
        }
    }

    showPushNotification(notification) {
        if (!('Notification' in window) || Notification.permission !== 'granted') {
            return;
        }

        const options = {
            body: notification.message,
            icon: '/assets/icon-192.png',
            badge: '/assets/badge-72.png',
            tag: notification.id,
            data: notification.data,
            actions: notification.actions || []
        };

        if (notification.image) {
            options.image = notification.image;
        }

        const pushNotification = new Notification(notification.title, options);

        pushNotification.onclick = () => {
            window.focus();
            pushNotification.close();
            
            // Navegar a la página relevante si hay datos
            if (notification.data) {
                this.handleNotificationClick(notification.data);
            }
        };

        // Auto-cerrar después de 10 segundos
        setTimeout(() => pushNotification.close(), 10000);
    }

    handleNotificationClick(data) {
        if (data.type === 'payment') {
            window.dashboard?.switchPage('wallet');
        } else if (data.type === 'deposit') {
            window.dashboard?.switchPage('history');
        } else if (data.type === 'claim') {
            window.dashboard?.switchPage('claims');
        }
    }

    // Métodos de utilidad
    getNotificationIcon(type) {
        const icons = {
            'success': 'fa-check-circle',
            'error': 'fa-exclamation-circle',
            'warning': 'fa-exclamation-triangle',
            'info': 'fa-info-circle',
            'payment': 'fa-money-bill-wave',
            'deposit': 'fa-arrow-down',
            'claim': 'fa-gift',
            'system': 'fa-cog'
        };
        
        return icons[type] || 'fa-bell';
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

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    showNotification(message, type = 'info') {
        window.showNotification?.(message, type) || console.log(`[${type}] ${message}`);
    }

    showError(title, message) {
        this.showNotification(`${title}: ${message}`, 'error');
    }
}

// Inicializar sistema de notificaciones
document.addEventListener('DOMContentLoaded', () => {
    window.notificationSystem = new NotificationSystem();
    
    // Función global para mostrar notificaciones
    window.showNotification = (message, type = 'info') => {
        window.notificationSystem?.showNotificationUI({
            id: `manual-${Date.now()}`,
            title: type === 'error' ? '❌ Error' : 
                   type === 'success' ? '✅ Éxito' : 
                   type === 'warning' ? '⚠️ Advertencia' : 'ℹ️ Información',
            message: message,
            type: type,
            timestamp: new Date().toISOString(),
            read: false
        });
    };
});
