module.exports = {
    generateGameSettings,
}

function generateGameSettings() {
    return {
        PLAYERS: [],
        MAX_PLAYERS: 6,
        ANSWER_TIMER: 10,
        GAME_MODE: 'lives',
        GAME_TYPES: ['lives', 'unlimited'],
        MAX_LIVES: 3,
        STATUS: 0,
    }
}