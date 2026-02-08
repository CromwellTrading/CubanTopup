// /public/js/game-images.js
const GAME_IMAGES = {
    // Arena Breakout
    66584: {
        logo: '/assets/games/arena-breakout.png',
        color: '#FF6B35',
        icon: '🎯'
    },
    // Zenless Zone Zero
    67528: {
        logo: '/assets/games/zenless-zone-zero.png',
        color: '#6C5CE7',
        icon: '🌀'
    },
    // Wuthering Waves
    71886: {
        logo: '/assets/games/wuthering-waves.png',
        color: '#00CEC9',
        icon: '🌊'
    },
    // Mobile Legends
    65482: {
        logo: '/assets/games/mobile-legends.png',
        color: '#FDCB6E',
        icon: '⚔️'
    },
    // Free Fire Global
    65871: {
        logo: '/assets/games/free-fire.png',
        color: '#FF7675',
        icon: '🔥'
    },
    // Genshin Impact
    66452: {
        logo: '/assets/games/genshin-impact.png',
        color: '#74B9FF',
        icon: '🌍'
    },
    // PUBG Mobile
    66719: {
        logo: '/assets/games/pubg-mobile.png',
        color: '#F39C12',
        icon: '🎯'
    },
    // Honor de Reyes
    67795: {
        logo: '/assets/games/honor-de-reyes.png',
        color: '#E84393',
        icon: '👑'
    },
    // Golpe de Sangre
    68075: {
        logo: '/assets/games/golpe-de-sangre.png',
        color: '#FF5252',
        icon: '💥'
    },
    // Honkai: Star Rail
    66557: {
        logo: '/assets/games/honkai-star-rail.png',
        color: '#A29BFE',
        icon: '🚂'
    },
    // Razer Gold Colombia
    66524: {
        logo: '/assets/games/razer-gold.png',
        color: '#00D2D3',
        icon: '💰'
    },
    // Default for games without image
    default: {
        logo: '/assets/game-default.png',
        color: '#667eea',
        icon: '🎮'
    }
};

function getGameImage(gameId) {
    return GAME_IMAGES[gameId] || GAME_IMAGES.default;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GAME_IMAGES, getGameImage };
}
