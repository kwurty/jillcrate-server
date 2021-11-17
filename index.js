const { instrument } = require('@socket.io/admin-ui');
const { createServer } = require("http");
const { createRoomCode } = require('./utilities');
require('dotenv').config();
const mysql = require('mysql');

const axios = require('axios');

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
        console.log("starting countdown")
        this.TIME_LEFT = 4;
        this.TIMER = setInterval(() => {
            if (this.STATUS !== 1) return

            if (this.TIME_LEFT === 0) {
                console.log('clearing');
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
        console.log('damaging player');
        this.PLAYERS[this.CURRENT_PLAYER]['lives'] = this.PLAYERS[this.CURRENT_PLAYER]['lives'] - 1;
    }

    START_TIMER() {
        this.TIMER = setInterval(() => {
            // game is not in a live state
            if (this.STATUS !== 2) {
                clearInterval(this.TIMER);
                return
            }
            // check the timer
            if (this.TIME_LEFT <= 0) {
                this.DOCK_PLAYER();
                this.SET_CURRENT_PLAYER();
                this.RESET_TIMER();
            } else {
                this.TIME_LEFT = this.TIME_LEFT - 1;
            }

            io.in(this.ROOM).emit("countdown", this.TIME_LEFT);
            this.RETURN_GAMESETTINGS();
        }, 1000);
    }

    STOP_TIMER() {
        clearInterval(this.TIMER);
        this.TIMER = null;
    }
    RESET_TIMER() {
        clearInterval(this.TIMER);
        this.TIMER = null;
        this.TIME_LEFT = this.ANSWER_TIMER;
        this.START_TIMER();
    }

    START_GAME() {
        if (this.TIMER !== null) return
        // set random starting player
        // this.CURRENT_PLAYER = Math.floor(Math.random() * (this.PLAYERS.length - 1));
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
        this.STATUS = 2;
        this.START_TIMER();
    }

    SET_CURRENT_PLAYER() {
        // continuous mode
        if (this.GAME_MODE === 'unlimited') {
            if (this.DIRECTION > 0 && this.CURRENT_PLAYER + this.DIRECTION > this.PLAYERS.length - 1) {
                this.CURRENT_PLAYER = 0;
            } else if (this.DIRECTION < 0 && this.CURRENT_PLAYER + this.DIRECTION < 0) {
                this.CURRENT_PLAYER = this.PLAYERS.length - 1;
            } else {
                this.CURRENT_PLAYER = this.CURRENT_PLAYER + this.DIRECTION;
            }
            this.RESET_TIMER();
        }
        // lives mode
        else {
            // set temporary next player
            try {
                let alivePlayers = this.CHECK_ALIVE_PLAYERS();
                this.TIME_LEFT = this.ANSWER_TIMER + 1;
                console.log(alivePlayers)
                //return winner if only one player left
                if (alivePlayers.length === 1) {
                    console.log("winner selected")
                    this.WINNER = alivePlayers[0];
                    this.STATUS = 3;
                    this.STOP_TIMER();
                    this.TIMER = null;
                    io.in(this.ROOM).emit("gameover", this.WINNER);
                } else {
                    let nextPlayer = alivePlayers.indexOf(this.CURRENT_PLAYER);

                    console.log(nextPlayer)
                    // if there is an alive next player, select that person
                    if (alivePlayers[nextPlayer + this.DIRECTION]) {
                        nextPlayer = this.CURRENT_PLAYER + this.DIRECTION;
                    }
                    // else, if there the direction does not have a person in it, loop back the array
                    else if (!alivePlayers[nextPlayer + this.DIRECTION]) {
                        console.log("Loop alive array")
                        console.log(alivePlayers, this.DIRECTION);
                    }
                    // set the current player
                    this.CURRENT_PLAYER = nextPlayer;
                    this.RESET_TIMER();
                }
            }
            catch (err) {
                console.log(err)
            }
        }
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
                        io.in(room).emit("returnGameSettings", gameSettings);
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

    socket.on("updateGameSettings", (roomCode, key, value) => {
        state[roomCode][key] = value
        io.in(roomCode).emit("returnGameSettings", state[roomCode]);
    });

    socket.on("getGameSettings", (room) => {
        socket.emit("returnGameSettings", state[room]);
    });

    socket.on("startGame", (roomCode) => {
        state[roomCode]['STATUS'] = 1;
        state[roomCode]['START_COUNTDOWN']();
        // io.in(roomCode).emit("returnGameSettings", game);
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
            console.log("first one!")
            state[roomCode]['LAST_ANSWER_LASTNAME_LETTER'] = lastname[0];
            state[roomCode]['LAST_ANSWER'] = `${firstname} ${lastname}`;
            state[roomCode]['PREVIOUS_ANSWERS'].push(firstname + lastname);
            state[roomCode]['SET_CURRENT_PLAYER']();
            return;
        }

        // check for answer here. 
        // If letter doesn't match or if the answer was used already, return
        if (!state[roomCode].CHECK_ANSWER(firstname, lastname) || state[roomCode]['PREVIOUS_ANSWERS'].includes(firstname + lastname)) {
            console.log('incorrect')
            io.in(roomCode).emit("incorrectAnswer");
            return;
        }
        // if matching, swap the direction
        if (lastname[0] === firstname[0]) {
            console.log('same name - swap direction')
            state[roomCode]['SWAP_DIRECTION']();
        }

        // set the LAST_ANSWER_LASTNAME_LETTER and LAST_ANSWER to correct answer
        console.log('set previous answer');
        state[roomCode]['PREVIOUS_ANSWERS'].push(firstname + lastname);
        console.log('set last_answer_lastname_letter');
        state[roomCode]['LAST_ANSWER_LASTNAME_LETTER'] = lastname[0];
        console.log('set last answer');
        state[roomCode]['LAST_ANSWER'] = `${firstname} ${lastname}`;
        console.log('set next player');
        state[roomCode]['SET_CURRENT_PLAYER']();
        console.log('send updated game');
        // io.in(roomCode).emit("returnGameSettings", state[roomCode]);
        // db.query(`SELECT * FROM famouspeople WHERE firstname = ? AND lastname = ?`, [firstname, lastname], (err, res, fields) => {
        //     if (err) throw err;
        //     console.log(res.length)
        // })
    })

    socket.on("disconnect", (socket) => {
        console.log(`user disconnected - ${socket}`)
    });
})


instrument(io, { auth: false });

httpServer.listen(5000);