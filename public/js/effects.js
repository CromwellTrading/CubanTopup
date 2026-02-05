// Sistema de Efectos Visuales y Animaciones
class VisualEffects {
    constructor() {
        this.init();
    }

    init() {
        this.initParticles();
        this.initScrollEffects();
        this.initHoverEffects();
        this.initLoadingAnimations();
        this.initThemeToggle();
        this.initParallax();
        this.initConfetti();
        this.setupEventListeners();
    }

    initParticles() {
        // Crear efecto de partículas flotantes
        const particlesContainer = document.querySelector('.particles');
        if (!particlesContainer) {
            particlesContainer = document.createElement('div');
            particlesContainer.className = 'particles';
            document.body.appendChild(particlesContainer);
        }

        // Crear partículas
        for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            
            // Posición aleatoria
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * 100}%`;
            
            // Tamaño aleatorio
            const size = Math.random() * 3 + 1;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            
            // Opacidad aleatoria
            particle.style.opacity = Math.random() * 0.5 + 0.1;
            
            // Animación
            const duration = Math.random() * 20 + 10;
            const delay = Math.random() * 5;
            particle.style.animation = `float ${duration}s ease-in-out ${delay}s infinite`;
            
            // Color basado en posición
            const hue = (parseFloat(particle.style.left) / 100) * 360;
            particle.style.backgroundColor = `hsl(${hue}, 70%, 60%)`;
            
            particlesContainer.appendChild(particle);
        }
    }

    initScrollEffects() {
        // Efectos al hacer scroll
        const elementsToAnimate = document.querySelectorAll('.animate-on-scroll');
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animated');
                    
                    // Animaciones específicas basadas en data-animation
                    const animation = entry.target.dataset.animation || 'fadeInUp';
                    entry.target.style.animation = `${animation} 0.6s ease forwards`;
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });
        
        elementsToAnimate.forEach(el => observer.observe(el));
        
        // Efecto parallax en elementos específicos
        window.addEventListener('scroll', () => {
            this.applyParallax();
        });
    }

    initHoverEffects() {
        // Efectos hover en tarjetas
        const cards = document.querySelectorAll('.card, .stat-card, .token-card');
        
        cards.forEach(card => {
            card.addEventListener('mouseenter', (e) => {
                this.createRippleEffect(e, card);
                this.addFloatEffect(card);
            });
            
            card.addEventListener('mouseleave', () => {
                this.removeFloatEffect(card);
            });
        });
        
        // Efectos hover en botones
        const buttons = document.querySelectorAll('.btn-primary, .btn-secondary');
        
        buttons.forEach(btn => {
            btn.addEventListener('mouseenter', (e) => {
                this.createButtonHoverEffect(e);
            });
            
            btn.addEventListener('click', (e) => {
                this.createClickEffect(e);
            });
        });
    }

    initLoadingAnimations() {
        // Animación de carga para elementos
        const loadingElements = document.querySelectorAll('.loading');
        
        loadingElements.forEach(el => {
            // Crear spinner si no existe
            if (!el.querySelector('.spinner')) {
                const spinner = document.createElement('div');
                spinner.className = 'spinner';
                el.appendChild(spinner);
            }
        });
    }

    initThemeToggle() {
        // Toggle de tema oscuro/claro
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const currentTheme = document.documentElement.getAttribute('data-theme');
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                
                document.documentElement.setAttribute('data-theme', newTheme);
                localStorage.setItem('theme', newTheme);
                
                // Animación de transición
                this.themeTransition();
            });
        }
        
        // Cargar tema guardado
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    initParallax() {
        // Efecto parallax en elementos con data-parallax
        document.querySelectorAll('[data-parallax]').forEach(el => {
            el.style.transform = 'translateZ(0)';
        });
    }

    initConfetti() {
        // Sistema de confetti para celebraciones
        window.showConfetti = (options = {}) => {
            this.createConfetti(options);
        };
    }

    createRippleEffect(event, element) {
        const ripple = document.createElement('div');
        ripple.className = 'ripple';
        
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;
        
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        
        element.appendChild(ripple);
        
        // Eliminar después de la animación
        setTimeout(() => {
            ripple.remove();
        }, 600);
    }

    addFloatEffect(element) {
        element.style.transform = 'translateY(-5px)';
        element.style.boxShadow = '0 20px 40px rgba(0,0,0,0.3)';
        element.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease';
    }

    removeFloatEffect(element) {
        element.style.transform = 'translateY(0)';
        element.style.boxShadow = '';
    }

    createButtonHoverEffect(event) {
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        btn.style.setProperty('--mouse-x', `${x}px`);
        btn.style.setProperty('--mouse-y', `${y}px`);
    }

    createClickEffect(event) {
        const btn = event.currentTarget;
        
        // Efecto de pulsación
        btn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            btn.style.transform = '';
        }, 150);
        
        // Sonido de click (opcional)
        this.playClickSound();
    }

    applyParallax() {
        const scrollY = window.scrollY;
        
        document.querySelectorAll('[data-parallax]').forEach(el => {
            const speed = parseFloat(el.dataset.parallax) || 0.5;
            const yPos = -(scrollY * speed);
            el.style.transform = `translateY(${yPos}px)`;
        });
    }

    themeTransition() {
        // Agregar clase de transición
        document.documentElement.classList.add('theme-transition');
        
        // Remover después de la transición
        setTimeout(() => {
            document.documentElement.classList.remove('theme-transition');
        }, 300);
    }

    createConfetti(options = {}) {
        const defaults = {
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
        };
        
        const config = { ...defaults, ...options };
        
        // Crear partículas de confetti
        for (let i = 0; i < config.particleCount; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            
            // Posición
            confetti.style.left = `${50 + (Math.random() - 0.5) * config.spread}%`;
            confetti.style.top = `${config.origin.y * 100}%`;
            
            // Tamaño
            const size = Math.random() * 10 + 5;
            confetti.style.width = `${size}px`;
            confetti.style.height = `${size}px`;
            
            // Color
            const colors = ['#6a11cb', '#2575fc', '#ff416c', '#00b09b', '#ff8c00'];
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            
            // Forma
            confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
            
            // Rotación
            confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
            
            // Animación
            const duration = Math.random() * 3 + 2;
            const delay = Math.random() * 0.5;
            const xMovement = (Math.random() - 0.5) * 200;
            
            confetti.style.animation = `
                confettiFall ${duration}s ease-out ${delay}s forwards,
                confettiSpin ${duration}s linear ${delay}s infinite
            `;
            
            // Variables CSS para animación
            confetti.style.setProperty('--x-movement', `${xMovement}%`);
            confetti.style.setProperty('--y-movement', `${Math.random() * 100 + 100}%`);
            
            document.body.appendChild(confetti);
            
            // Eliminar después de la animación
            setTimeout(() => {
                confetti.remove();
            }, (duration + delay) * 1000);
        }
    }

    playClickSound() {
        // Solo reproducir si el sonido está habilitado
        if (localStorage.getItem('soundEnabled') !== 'false') {
            try {
                const audio = new Audio('/sounds/click.mp3');
                audio.volume = 0.1;
                audio.play().catch(() => {});
            } catch (error) {
                // Silenciar error si no hay archivo de sonido
            }
        }
    }

    setupEventListeners() {
        // Efecto al cargar la página
        window.addEventListener('load', () => {
            this.pageLoadAnimation();
        });
        
        // Efecto al cambiar de página
        window.addEventListener('beforeunload', () => {
            this.pageUnloadAnimation();
        });
        
        // Efecto en inputs
        document.querySelectorAll('input, select, textarea').forEach(input => {
            input.addEventListener('focus', (e) => {
                this.inputFocusEffect(e.target);
            });
            
            input.addEventListener('blur', (e) => {
                this.inputBlurEffect(e.target);
            });
        });
    }

    pageLoadAnimation() {
        // Animación de entrada
        document.body.style.opacity = '0';
        document.body.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            document.body.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            document.body.style.opacity = '1';
            document.body.style.transform = 'translateY(0)';
        }, 100);
        
        // Remover transición después de la animación
        setTimeout(() => {
            document.body.style.transition = '';
        }, 600);
    }

    pageUnloadAnimation() {
        // Animación de salida
        document.body.style.transition = 'opacity 0.3s ease';
        document.body.style.opacity = '0';
    }

    inputFocusEffect(input) {
        input.parentElement.classList.add('focused');
        
        // Efecto de label flotante
        const label = input.previousElementSibling;
        if (label && label.tagName === 'LABEL') {
            label.classList.add('floating');
        }
    }

    inputBlurEffect(input) {
        if (!input.value) {
            input.parentElement.classList.remove('focused');
            
            const label = input.previousElementSibling;
            if (label && label.tagName === 'LABEL') {
                label.classList.remove('floating');
            }
        }
    }

    // Métodos públicos para usar desde otras partes de la aplicación
    celebrateSuccess(message) {
        this.createConfetti({
            particleCount: 150,
            spread: 100
        });
        
        this.showNotification(message, 'success');
        
        // Animación adicional
        const successIcon = document.createElement('div');
        successIcon.className = 'success-celebration';
        successIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
        document.body.appendChild(successIcon);
        
        setTimeout(() => {
            successIcon.remove();
        }, 2000);
    }

    showErrorEffect(element) {
        if (element) {
            element.classList.add('error-shake');
            setTimeout(() => {
                element.classList.remove('error-shake');
            }, 600);
        }
    }

    progressBar(percentage, element) {
        if (!element) return;
        
        const bar = element.querySelector('.progress-bar') || (() => {
            const newBar = document.createElement('div');
            newBar.className = 'progress-bar';
            element.appendChild(newBar);
            return newBar;
        })();
        
        bar.style.width = `${percentage}%`;
        bar.style.transition = 'width 0.5s ease';
        
        if (percentage >= 100) {
            bar.classList.add('complete');
        } else {
            bar.classList.remove('complete');
        }
    }
}

// Inicializar efectos visuales
document.addEventListener('DOMContentLoaded', () => {
    window.visualEffects = new VisualEffects();
    
    // Añadir estilos CSS para las animaciones
    const style = document.createElement('style');
    style.textContent = `
        /* Animaciones de partículas */
        .particles {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: -1;
        }
        
        .particle {
            position: absolute;
            background-color: var(--primary-color);
            border-radius: 50%;
            pointer-events: none;
        }
        
        @keyframes float {
            0%, 100% {
                transform: translateY(0) translateX(0);
            }
            25% {
                transform: translateY(-20px) translateX(10px);
            }
            50% {
                transform: translateY(-40px) translateX(0);
            }
            75% {
                transform: translateY(-20px) translateX(-10px);
            }
        }
        
        /* Efecto ripple */
        .ripple {
            position: absolute;
            border-radius: 50%;
            background-color: rgba(255, 255, 255, 0.3);
            transform: scale(0);
            animation: ripple 0.6s linear;
            pointer-events: none;
        }
        
        @keyframes ripple {
            to {
                transform: scale(4);
                opacity: 0;
            }
        }
        
        /* Animaciones de entrada */
        .animate-on-scroll {
            opacity: 0;
            transform: translateY(30px);
        }
        
        .animate-on-scroll.animated {
            opacity: 1;
            transform: translateY(0);
        }
        
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes fadeInLeft {
            from {
                opacity: 0;
                transform: translateX(-30px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        @keyframes fadeInRight {
            from {
                opacity: 0;
                transform: translateX(30px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        /* Confetti */
        .confetti {
            position: fixed;
            pointer-events: none;
            z-index: 9999;
        }
        
        @keyframes confettiFall {
            to {
                transform: translate(var(--x-movement), var(--y-movement)) rotate(360deg);
                opacity: 0;
            }
        }
        
        @keyframes confettiSpin {
            from {
                transform: rotate(0deg);
            }
            to {
                transform: rotate(360deg);
            }
        }
        
        /* Efectos de error */
        .error-shake {
            animation: shake 0.5s ease-in-out;
        }
        
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
            20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        
        /* Progress bar */
        .progress-bar {
            position: absolute;
            bottom: 0;
            left: 0;
            height: 3px;
            background: var(--gradient-primary);
            border-radius: 0 0 4px 4px;
            transition: width 0.3s ease;
        }
        
        .progress-bar.complete {
            background: var(--gradient-success);
        }
        
        /* Success celebration */
        .success-celebration {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 100px;
            color: var(--success-color);
            z-index: 10000;
            animation: successPop 1s ease-out;
            pointer-events: none;
        }
        
        @keyframes successPop {
            0% {
                transform: translate(-50%, -50%) scale(0);
                opacity: 0;
            }
            50% {
                transform: translate(-50%, -50%) scale(1.2);
                opacity: 1;
            }
            100% {
                transform: translate(-50%, -50%) scale(1);
                opacity: 0;
            }
        }
        
        /* Theme transition */
        .theme-transition * {
            transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease !important;
        }
        
        /* Floating label */
        .form-group.focused label {
            transform: translateY(-25px);
            font-size: 0.8rem;
            color: var(--primary-color);
        }
        
        .form-group label.floating {
            transform: translateY(-25px);
            font-size: 0.8rem;
        }
    `;
    
    document.head.appendChild(style);
});
