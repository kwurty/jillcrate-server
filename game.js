module.exports = {
    generateGameSettings,
    generateGame
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

function generateGame(gameSettings) {
    let GAME = {
        ...JSON.parse(gameSettings),
        CURRENT_PLAYER: 0,
        LAST_ANSWER_FIRSTNAME_LETTER: '',
        LAST_ANSWER_LASTNAME_LETTER: '',
        DIRECTION: 1
    }

    GAME.PLAYERS = GAME.PLAYERS.map((player) => ({
        ...player,
        LIVES: GAME.MAX_LIVES
    }))

    console.dir(GAME);
}