const { instrument } = require('@socket.io/admin-ui');
const { createServer } = require("http");
const { createRoomCode } = require('./utilities');

const axios = require('axios');

const state = {};
const socketRooms = {};

const httpServer = createServer();

const io = require('socket.io')(httpServer, {
    cors: {
        origin: ['http://localhost:3000', "https://admin.socket.io"]
    }
});

class Game {
    constructor(roomCode = null) {
        this.ROOM = roomCode;
        this.PLAYERS = [];
        this.MAX_PLAYERS = 6;
        this.ANSWER_TIMER = 10;
        this.GAME_MODE = 'lives';
        this.GAME_TYPES = ['lives', 'unlimited'];
        this.MAX_LIVES = 3;
        this.STATUS = 0;
        this.CURRENT_PLAYER = null;
        this.LAST_ANSWER_LASTNAME_LETTER = null;
        this.DIRECTION = 1;
        this.TIME_LEFT = null;
        this.TIMER = null;
        this.WINNER = null;
    }

    START_COUNTDOWN() {
        this.TIMER = setInterval(() => {
            if (this.STATUS !== 0) return

            if (this.TIME_LEFT <= 0) {
                clearInterval(this.TIMER);
                this.STATUS = 2;
                this.START_TIMER();
            } else {
                this.TIME_LEFT = this.TIME_LEFT - 1;
            }
            io.in(this.ROOM).emit("countdown", this.TIME_LEFT);
        }, 1000)
    }

    START_TIMER() {
        this.TIMER = setInterval(() => {
            // game is not in a live state
            if (this.status !== 2) {
                clearInterval(this.TIMER);
                return
            }
            // check the timer
            if (this.TIME_LEFT <= 0) {
                this.PLAYERS[this.CURRENT_PLAYER]['lives'] = this.PLAYERS[this.CURRENT_PLAYER]['lives'] - 1;
                this.TIMER = this.ANSWER_TIMER;
                this.SET_CURRENT_PLAYER();
                this.TIME_LEFT = this.ANSWER_TIMER;
            } else {
                this.TIME_LEFT = this.TIME_LEFT - 1;
            }

            io.in(this.ROOM).emit("countdown", this.TIME_LEFT);
        }, 1000);
    }

    STOP_TIMER() {
        clearInterval(this.TIMER);
        this.TIMER = null;
    }

    START_GAME() {
        if (this.TIMER !== null) return
        // set random starting player
        // this.CURRENT_PLAYER = Math.floor(Math.random() * (this.PLAYERS.length));
        this.CURRENT_PLAYER = 0;
        // set time left
        this.TIME_LEFT = this.ANSWER_TIMER;

        let lives = this.MAX_LIVES;
        // set players lives if game mode is lives
        if (this.GAME_MODE === 'lives') {
            this.PLAYERS = this.PLAYERS.map((player) => {
                return {
                    ...player,
                    lives
                };
            });
        }
        this.STATUS = 1;
        this.START_TIMER();
    }

    SET_CURRENT_PLAYER() {
        // continuous mode
        if (this.GAME_MODE === 'lives') {
            if (this.DIRECTION > 0 && this.CURRENT_PLAYER + this.DIRECTION > this.PLAYERS.length - 1) {
                this.CURRENT_PLAYER = 0;
            } else if (this.DIRECTION < 0 && this.CURRENT_PLAYER + this.DIRECTION < 0) {
                this.CURRENT_PLAYER = this.PLAYERS.length - 1;
            } else {
                this.CURRENT_PLAYER = this.CURRENT_PLAYER + this.DIRECTION;
            }
        }
        // lives mode
        else {
            // set temporary next player
            if (this.PLAYERS[this.CURRENT_PLAYER + this.DIRECTION]) {
                let nextplayer = this.CURRENT_PLAYER + this.DIRECTION;
                while (this.nextplayer) {
                    if (this.PLAYERS[nextplayer]) {

                        break;
                    }
                }
            }
            // set the current player
            this.CURRENT_PLAYER = nextplayer;
        }
    }

    CHECK_PLAYERS() {
        let alivePlayers = []
        this.PLAYERS.forEach((player, index) => {
            if (player.lives > 0) {
                alivePlayers.push(index)
            }
        })

        //return winner
        if (alivePlayers.length === 1) {
            this.WINNER = this.PLAYERS[alivePlayers[0]];
            this.STATUS = 3;
        }
        return alivePlayers;
    }
}

io.on("connection", (socket) => {
    console.log(`${socket.id} has connected`)
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
    });

    socket.on("generateRoom", (username) => {
        try {
            const roomCode = createRoomCode(5);
            const gameSettings = new Game(roomCode);
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
    });

    socket.on("updateGameSettings", (roomCode, gameSettings) => {
        state[roomCode] = gameSettings;
        io.in(roomCode).emit("returnGameSettings", gameSettings);
    });

    socket.on("getGameSettings", (room) => {
        socket.emit("returnGameSettings", state[room]);
    });

    socket.on("startGame", (roomCode) => {
        state[roomCode]['START_COUNTDOWN']();
        // io.in(roomCode).emit("returnGameSettings", game);
    });

    socket.on("submitAnswer", (roomCode, answer) => {
        state[roomCode].CHECK_ANSWER(answer);
    })

    socket.on("disconnect", (socket) => {
        console.log(`user disconnected - ${socket}`)
    });
})


instrument(io, { auth: false });

httpServer.listen(5000);