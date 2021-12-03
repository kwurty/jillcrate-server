const { instrument } = require('@socket.io/admin-ui');
const { createServer } = require("http");
const { createRoomCode } = require('./utilities');
require('dotenv').config();
const mysql = require('mysql');

const axios = require('axios');
const { NULL } = require('mysql/lib/protocol/constants/types');

const state = {};
const socketRooms = {};

const httpServer = createServer();

const io = require('socket.io')(httpServer, {
    cors: {
        origin: ['http://localhost:3000', "https://admin.socket.io"]
    }
});

// const db = mysql.createConnection({
//     host: process.env.DB_HOST,
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
//     database: 'namegame'
// });

// db.connect((err) => {
//     if (err) throw err;

// })

class Game {
    constructor(roomCode = null) {
        this.ROOM = roomCode;
        this.PLAYERS = [];
        this.MAX_PLAYERS = 6;
        this.ANSWER_TIMER = 10;
        this.GAME_MODE = 'lives';
        this.GAME_TYPES = ['lives', 'unlimited'];
        this.MAX_LIVES = 3;
        // STATUS 0 = PREGAME
        // STATUS 1 = COUNTDOWN
        // STATUS 2 = IN GAME
        // STATUS 3 = GAME OVER
        this.PREVIOUS_ANSWERS = [];
        this.STATUS = 0;
        this.CURRENT_PLAYER = null;
        this.LAST_ANSWER_LASTNAME_LETTER = null;
        this.LAST_ANSWER = null;
        this.DIRECTION = 1;
        this.TIME_LEFT = null;
        this.TIMER = null;
        this.WINNER = null;
    }

    START_COUNTDOWN() {
        this.TIME_LEFT = 4;

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
        this.TIMER = setInterval(() => {
            if (this.STATUS !== 1) return

            if (this.TIME_LEFT === 0) {
                clearInterval(this.TIMER);
                this.TIMER = null;
                this.STATUS = 2;
                this.TIME_LEFT = this.ANSWER_TIMER;
                this.START_GAME();
            } else {
                this.TIME_LEFT = this.TIME_LEFT - 1;
                io.in(this.ROOM).emit("countdown", this.TIME_LEFT);
            }
        }, 1000)
    }

    CHECK_ANSWER(firstname, lastname) {
        if (firstname[0].toUpperCase() !== this.LAST_ANSWER_LASTNAME_LETTER.toUpperCase()) return
        return true
    }

    DOCK_PLAYER() {
        this.PLAYERS[this.CURRENT_PLAYER]['lives'] = this.PLAYERS[this.CURRENT_PLAYER]['lives'] - 1;
    }

    SEND_CORRECT() {
        io.in(this.ROOM).emit("correctAnswer", this.CURRENT_PLAYER);
    }

    SEND_INCORRECT(message = null) {
        io.in(this.ROOM).emit("incorrectAnswer", this.CURRENT_PLAYER, message);
    }

    START_TIMER() {
        this.TIMER = setInterval(() => {
            io.in(this.ROOM).emit("countdown", this.TIME_LEFT);
            // game is not in a live state
            if (this.STATUS !== 2) {
                clearInterval(this.TIMER);
                return
            }
            // check the timer
            if (this.TIME_LEFT <= 0) {
                this.SEND_INCORRECT();
                this.SET_CURRENT_PLAYER(true);
                this.TIME_LEFT = this.ANSWER_TIMER;
            } else {
                this.TIME_LEFT = this.TIME_LEFT - 1;
            }

            this.RETURN_GAMESETTINGS();
        }, 1000);
    }

    STOP_TIMER() {
        clearInterval(this.TIMER);
        this.TIMER = null;
    }
    RESET_TIMER() {
        this.TIME_LEFT = this.ANSWER_TIMER;
    }

    START_GAME() {
        if (this.TIMER !== null) return
        this.TIME_LEFT = this.ANSWER_TIMER;
        this.STATUS = 2;
        this.RETURN_GAMESETTINGS();
        // set random starting player
        // this.CURRENT_PLAYER = Math.floor(Math.random() * (this.PLAYERS.length - 1));
        this.CURRENT_PLAYER = 0;
        // set time left
        this.START_TIMER();
    }

    SET_CURRENT_PLAYER(damaged = false) {
        // continuous mode
        if (this.GAME_MODE === 'unlimited') {
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

            try {
                let alivePlayers = this.CHECK_ALIVE_PLAYERS();

                // see if player is still alive
                let ind = alivePlayers.indexOf(this.CURRENT_PLAYER);

                // set temp player variable to store the next player
                let nextPlayer = null;

                // grab the next player
                if (this.DIRECTION > 0 && !alivePlayers[ind + 1]) {
                    nextPlayer = alivePlayers[0];
                } else if (this.DIRECTION < 0 && !alivePlayers[ind - 1]) {
                    nextPlayer = alivePlayers[alivePlayers.length - 1]
                } else {
                    nextPlayer = alivePlayers[ind + this.DIRECTION]
                }

                // if this was triggered by a timeout, damage the player
                if (damaged) this.DOCK_PLAYER();
                this.CURRENT_PLAYER = nextPlayer;

                // if the next player is the last player, exit - otherwise we're done
                if (this.CHECK_FOR_WINNER(this.CHECK_ALIVE_PLAYERS())) return;
            }
            catch (err) {
                console.log(err)
            }
        }
    }

    CHECK_FOR_WINNER(players) {
        if (players.length > 1) return false

        let winner = this.PLAYERS[players[0]];

        io.in(this.ROOM).emit("gameover", winner);

        clearInterval(this.TIMER);
        this.TIMER = null;

        return true;
    }

    CHECK_ALIVE_PLAYERS() {
        let alivePlayers = []
        this.PLAYERS.forEach((player, index) => {
            if (player.lives > 0) {
                alivePlayers.push(index)
            }
        })
        return alivePlayers;
    }

    SWAP_DIRECTION() {
        this.DIRECTION = this.DIRECTION * -1;
    }

    RETURN_GAMESETTINGS() {
        io.in(this.ROOM).emit("returnGameSettings", {
            ROOM: this.ROOM,
            PLAYERS: this.PLAYERS,
            MAX_PLAYERS: this.MAX_PLAYERS,
            ANSWER_TIMER: this.ANSWER_TIMER,
            GAME_MODE: this.GAME_MODE,
            GAME_TYPES: this.GAME_TYPES,
            MAX_LIVES: this.MAX_LIVES,
            PREVIOUS_ANSWERS: this.PREVIOUS_ANSWERS,
            STATUS: this.STATUS,
            CURRENT_PLAYER: this.CURRENT_PLAYER,
            LAST_ANSWER_LASTNAME_LETTER: this.LAST_ANSWER_LASTNAME_LETTER,
            LAST_ANSWER: this.LAST_ANSWER,
            DIRECTION: this.DIRECTION,
            TIME_LEFT: this.TIME_LEFT,
            TIMER: this.TIMER,
            WINNER: this.WINNER
        })
    }
}

io.on("connection", (socket) => {
    console.log(`${socket.id} has connected`)
    socket.on("joinRoom", (room, name) => {
        try {
            // Check if the room exists
            const r = io.sockets.adapter.rooms;
            console.log(r);
            if (!state[room]) return socket.emit("returnFailedRoomJoin", "Room does not exist");

            // Gather the user count in the room and compare
            let users = Array.from(r.get(room));
            let gameSettings = state[room];

            if (users.length > 0) {
                // If full
                if (users.length >= gameSettings.MAX_PLAYERS) {
                    socket.emit("returnFailedJoinRoom", "Room is full.")
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
                    socket.emit("returnJoinedRoom");
                    io.in(room).emit("returnGameSettings", gameSettings);
                }
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

    socket.on("updateGameSettings", (roomCode, key, value) => {
        state[roomCode][key] = value
        io.in(roomCode).emit("returnGameSettings", state[roomCode]);
    });

    // socket.on("getGameSettings", (room) => {
    //     socket.emit("returnGameSettings", state[room]);
    // });

    socket.on("startGame", (roomCode) => {
        state[roomCode]['STATUS'] = 1;
        state[roomCode]['START_COUNTDOWN']();
        io.in(roomCode).emit("gamestart");
    });

    socket.on("submitAnswer", (roomCode, answer) => {

        // make sure the correct player is submitting!
        if (state[roomCode].PLAYERS[state[roomCode].CURRENT_PLAYER].id !== socket.id) return;

        let fullname = answer.split(' '),
            firstname = fullname[0].toUpperCase(),
            lastname = fullname[fullname.length - 1].toUpperCase();

        console.log(firstname, lastname);
        // initial null set
        if (state[roomCode]['LAST_ANSWER_LASTNAME_LETTER'] === null) {
            state[roomCode]['LAST_ANSWER_LASTNAME_LETTER'] = lastname[0];
            state[roomCode]['LAST_ANSWER'] = `${firstname} ${lastname}`;
            state[roomCode]['PREVIOUS_ANSWERS'].push(firstname + lastname);
            state[roomCode]['RESET_TIMER']();
            state[roomCode]['SEND_CORRECT']();
            state[roomCode]['SET_CURRENT_PLAYER']();
            return;
        }

        // check for answer here. 
        // If letter doesn't match or if the answer was used already, return
        if (!state[roomCode].CHECK_ANSWER(firstname, lastname) || state[roomCode]['PREVIOUS_ANSWERS'].includes(firstname + lastname)) {
            state[roomCode]['SEND_INCORRECT']();
            return;
        }
        // if matching, swap the direction
        if (lastname[0] === firstname[0]) {
            state[roomCode]['SWAP_DIRECTION']();
        }

        // set the LAST_ANSWER_LASTNAME_LETTER and LAST_ANSWER to correct answer
        state[roomCode]['PREVIOUS_ANSWERS'].push(firstname + lastname);
        state[roomCode]['LAST_ANSWER_LASTNAME_LETTER'] = lastname[0];
        state[roomCode]['LAST_ANSWER'] = `${firstname} ${lastname}`;
        state[roomCode]['RESET_TIMER']();
        state[roomCode]['SEND_CORRECT']();
        state[roomCode]['SET_CURRENT_PLAYER']();

    })

    socket.on("disconnect", (socket) => {
        console.log(`user disconnected - ${socket}`)
    });
})


instrument(io, { auth: false });

httpServer.listen(5000);