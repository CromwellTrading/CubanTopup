// /public/js/game-images.js
const GAME_IMAGES = {
    // Arena Breakout
    66584: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/arena-breakout.png',
        color: '#FF6B35'
    },
    // Zenless Zone Zero
    67528: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/zenless-zone-zero.png',
        color: '#6C5CE7'
    },
    // Wuthering Waves
    71886: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/wuthering-waves.png',
        color: '#00CEC9'
    },
    // Mobile Legends
    65482: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/mobile-legends.png',
        color: '#FDCB6E'
    },
    // Free Fire Global
    65871: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/free-fire.png',
        color: '#FF7675'
    },
    // Genshin Impact
    66452: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/genshin-impact.png',
        color: '#74B9FF'
    },
    // PUBG Mobile
    66719: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/pubg-mobile.png',
        color: '#F39C12'
    },
    // Honor de Reyes
    67795: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/honor-de-reyes.png',
        color: '#E84393'
    },
    // Golpe de Sangre
    68075: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/golpe-de-sangre.png',
        color: '#FF5252'
    },
    // Honkai: Star Rail
    66557: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/honkai-star-rail.png',
        color: '#A29BFE'
    },
    // Razer Gold Colombia
    66524: {
        logo: 'https://[PROJECT-ID].supabase.co/storage/v1/object/public/game-images/logos/razer-gold.png',
        color: '#00D2D3'
    },
    // Default para juegos sin imagen
    default: {
        logo: '/assets/game-default.png',
        color: '#667eea'
    }
};

function getGameImage(gameId) {
    return GAME_IMAGES[gameId] || GAME_IMAGES.default;
}
