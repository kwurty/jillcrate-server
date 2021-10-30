const { instrument } = require('@socket.io/admin-ui');
const { createServer } = require("http");
const { createRoomCode } = require('./utilities');

const state = {};
const socketRooms = {};

const httpServer = createServer();

const io = require('socket.io')(httpServer, {
    cors: {
        origin: ['http://localhost:3000', "https://admin.socket.io"]
    }
});
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

function generateGame(socket, gameSettings) {
    let GAME = {
        ...gameSettings,
        CURRENT_PLAYER: 0,
        LAST_ANSWER_LASTNAME_LETTER: '',
        DIRECTION: 1,
        TIME_LEFT: gameSettings.ANSWER_TIMER,
        TIMER: setTimeout(() => {
            this.TIME_LEFT--;
            if (this.TIME_LEFT === 0) {
                socket.emit('returnPlayerTurnTimeout');
                this.TIME_LEFT = this.ANSWER_TIMER
            }
        }, 1000),
        CHECK_ANSWER: function (answer) {
            let s = answer.split(' ')
            // check if the answer's first name starts with the letter of the last answer's last name
            if (s[0][0].toLowerCase() === this.LAST_ANSWER_LASTNAME_LETTER) {

                /// check if the last name also starts with the first letter of the last answer's last name
                if (s[s.length - 1][0].toLowerCase() === this.LAST_ANSWER_LASTNAME_LETTER) {

                }

                /// no double name - set the last letter and move on to next person
                else {

                }

            } else {
                socket.emit('returnAnswer', false)
            }
        },
        START_TIMER: function () {
            this.TIMER()
        },
        GAME_OVER: function () {
            socket.emit('returnGameWinner', this.PLAYERS[this.CURRENT_PLAYER]['name'])
        }
    }

    GAME.PLAYERS = GAME.PLAYERS.map((player) => ({
        ...player,
        lives: GAME.MAX_LIVES
    }))

    console.dir(GAME);
}

function handleJoinGame(roomName) {
    const room = io.sockets.adapter.rooms[roomName];

    let allUsers;
    if (room) {
        allUsers = room.sockets;
    }

    let numClients = 0;
    if (allUsers) {
        numClients = Object.keys(allUsers).length;
    }

    if (numClients === 0) {
        console.log('unknownCode');
        return;
    } else if (numClients > 1) {
        console.log('tooManyPlayers');
        return;
    }

    clientRooms[client.id] = roomName;

    client.join(roomName);
    client.number = 2;
    client.emit('init', 2);

    // startGameInterval(roomName);
}

function startGame(gameSettings) {
    generateGame(gameSettings);
}



io.on("connection", (socket) => {
    socket.on("joinRoom", (room, name) => {
        try {
            // Check if the room exists
            const r = io.sockets.adapter.rooms;
            if (r.has(room)) {
                // Gather the user count in the room and compare
                let users = Array.from(r.get(room));
                let gameSettings = state[room];

                if (users.length > 0) {
                    // If full
                    if (users.length > gameSettings.MAX_PLAYERS) {
                        console.log('Room is full');
                        //  emit room is full message
                    } else {

                        // else join the room
                        console.log("joining")
                        socket.join(room);
                        gameSettings.PLAYERS.push(
                            {
                                id: socket.id,
                                name: name,
                                host: false
                            }
                        );
                        state[room] = gameSettings;
                        socket.emit("returnJoinedRoom", gameSettings);
                        io.in(room).emit("returnGameSettings", gameSettings)
                    }
                }

            } else {
                // probably return here because the room doesn't exist?
            }



        }
        catch (e) {
            console.log(`[${socket.id}] - failed to join room ${room}`);
            console.log(e);
        }
    })

    socket.on("generateRoom", (username) => {
        try {
            const roomCode = createRoomCode(5);
            const gameSettings = generateGameSettings();
            gameSettings.PLAYERS.push(
                {
                    id: socket.id,
                    name: username,
                    host: true
                }
            );
            socket.join(roomCode);
            state[roomCode] = gameSettings;
            socketRooms[socket.id] = roomCode;
            socket.emit('returnRoomCode', roomCode, gameSettings);
        } catch (e) {
            console.log(`[${socket.id}] - error generating room`)
        }
    })

    socket.on("updateGameSettings", (roomCode, gameSettings) => {
        state[roomCode] = gameSettings;
        io.in(roomCode).emit("returnGameSettings", gameSettings);
    })

    socket.on("getGameSettings", (room) => {
        socket.emit("returnGameSettings", state[room]);
    })

    socket.on("startGame", (roomCode) => {
        startGame(state[roomCode]);
    })

})

io.on("submitAnswer", (answer) => {
    console.log(answer);
})



instrument(io, { auth: false });

httpServer.listen(5000);