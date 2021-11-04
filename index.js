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
function generateGameSettings() {
    return {
        PLAYERS: [],
        MAX_PLAYERS: 6,
        ANSWER_TIMER: 10,
        GAME_MODE: 'lives',
        GAME_TYPES: ['lives', 'unlimited'],
        MAX_LIVES: 3,
        STATUS: 0,
        CURRENT_PLAYER: null,
        LAST_ANSWER_LASTNAME_LETTER: null,
        DIRECTION: null,
        TIME_LEFT: null,
        TIMER: null,
        WINNER: null,
        DIRECTION: null,
        START_TIMER: function () {
            // set interval on timer
            this.TIMER = setInterval(() => {
                // check the timer
                if (this.TIME_LEFT === 0) {
                    this.PLAYERS[this.CURRENT_PLAYER]['lives'] = this.PLAYERS[this.CURRENT_PLAYER]['lives'] - 1;
                    this.TIMER = this.ANSWER_TIMER;
                    this.SET_CURRENT_PLAYER();
                } else {
                    this.TIME_LEFT = this.TIME_LEFT - 1;
                }
            }, 1000)
        },
        STOP_TIMER: function () {
            clearInterval(this.TIMER);
            this.TIMER = null;
        },
        START_GAME: function () {
            if (this.TIMER !== null) return

            // set random starting player
            this.CURRENT_PLAYER = Math.floor(Math.random() * (this.PLAYERS.length));
            // set time left
            this.TIME_LEFT = this.ANSWER_TIMER;

            // set players lives if game mode is lives
            if (this.GAME_MODE === 'lives') {
                this.PLAYERS = this.PLAYERS(function (player) {
                    return {
                        ...player,
                        lives: this.MAX_LIVES
                    };
                });
            }

            this.STATUS = 1;
        },
        CHECK_ANSWER: function (answer) {
            let nameArray = split(' ');
            let firstName = nameArray[0];
            let lastName = nameArray[nameArray.length - 1];

            // check for the user
            axios.get('/')

        },
        SET_CURRENT_PLAYER: function () {

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
                let nextplayer = this.CURRENT_PLAYER

                do {
                    // if adding the direction makes it go under 0, revert to last person in queue
                    if (this.CURRENT_PLAYER + this.DIRECTION < 0) {
                        nextplayer = this.PLAYERS.length - 1;
                    }
                    // if the direction makes it go over the max length, revert it to first person in queue
                    else if (this.CURRENT_PLAYER + this.DIRECTION > this.PLAYERS.length - 1) {
                        nextplayer = 0;
                    }
                    // otherwise just add the direction
                    else {
                        nextplayer += this.DIRECTION;
                    }
                }
                // if the player does not have any lives left, check the next person
                while (this.PLAYERS[nextplayer]['lives'] < 1)

                // set the current player
                this.CURRENT_PLAYER = nextplayer;

            }
        }
    }
}

function returnMessage() {

}


// TODO: Remove I think
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
    });

    socket.on("updateGameSettings", (roomCode, gameSettings) => {
        state[roomCode] = gameSettings;
        io.in(roomCode).emit("returnGameSettings", gameSettings);
    });

    socket.on("getGameSettings", (room) => {
        socket.emit("returnGameSettings", state[room]);
    });

    socket.on("startGame", (roomCode) => {
        state[roomCode].START_GAME();
        io.in(roomCode).emit("returnGameSettings", gameSettings);
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