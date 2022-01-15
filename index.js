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
        origin: ['http://localhost:3000', "https://admin.socket.io", "https://itsthenamegame.herokuapp.com/", "https://kwurty.github.io/jillcrate-client/"]
    }
});

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'namegame'
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
            if (this.PLAYERS.length < 2) {
                this.STOP_TIMER();
                this.STATUS = 0;
            }

            if (this.TIME_LEFT === 0) {
                clearInterval(this.TIMER);
                this.TIMER = null;
                this.STATUS = 2;
                this.TIME_LEFT = this.ANSWER_TIMER;
                this.RETURN_GAMESETTINGS();
                this.START_GAME();
            } else {
                io.in(this.ROOM).emit("pregameCountdown", this.TIME_LEFT);
                this.TIME_LEFT = this.TIME_LEFT - 1;
            }
        }, 1000)
    }

    CHECK_ANSWER(firstname, lastname) {
        if (firstname[0].toUpperCase() !== this.LAST_ANSWER_LASTNAME_LETTER.toUpperCase()) return false
        if (this.PREVIOUS_ANSWERS.includes(`${firstname}${lastname}`)) return false
        return true
    }

    DOCK_PLAYER() {
        this.PLAYERS[this.CURRENT_PLAYER]['lives'] = this.PLAYERS[this.CURRENT_PLAYER]['lives'] - 1;
    }

    SEND_CORRECT(firstname, lastname) {
        io.in(this.ROOM).emit("correctAnswer", this.CURRENT_PLAYER, firstname, lastname);
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
                io.in(this.ROOM).emit("timeover");
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
        // set random starting player
        this.CURRENT_PLAYER = Math.floor(Math.random() * (this.PLAYERS.length - 1));
        this.CURRENT_PLAYER = 0;

        // set random first answer

        pool.query('SELECT firstname, lastname FROM famouspeople ORDER BY RAND() LIMIT 1', (err, res) => {
            this.LAST_ANSWER = `${res[0].firstname} ${res[0].lastname}`
            this.LAST_ANSWER_LASTNAME_LETTER = res[0].lastname[0];
            this.PREVIOUS_ANSWERS.push(`${res[0].firstname}${res[0].lastname}`);
            io.in(this.ROOM).emit("correctAnswer", 0, res[0].firstname, res[0].lastname);
        })


        this.RETURN_GAMESETTINGS();
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
                if (Number.isInteger(alivePlayers[ind + this.DIRECTION])) {
                    nextPlayer = alivePlayers[ind + this.DIRECTION]
                } else {
                    if (this.DIRECTION > 0) {
                        nextPlayer = alivePlayers[0]
                    } else {
                        nextPlayer = alivePlayers[alivePlayers.length - 1]
                    }
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

    GAMEOVER(winner) {
        this.STATUS = 3;
        io.in(this.ROOM).emit("gameover", winner);
        this.STOP_TIMER();
    }

    CHECK_FOR_WINNER(players) {
        if (players.length > 1) return false

        let winner = this.PLAYERS[players[0]];
        this.GAMEOVER(winner);

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

    const USER = socket.id;
    let ROOM = undefined;

    socket.on("joinRoom", (room, name) => {
        try {
            // Check if the room exists
            const r = io.sockets.adapter.rooms;
            if (!state[room]) return socket.emit("returnFailedRoomJoin", "Room does not exist");

            // Gather the user count in the room and compare
            let users = Array.from(r.get(room));
            let gameSettings = state[room];

            if (users.length > 0) {
                // If full
                if (users.length >= gameSettings.MAX_PLAYERS) {
                    //  emit room is full message
                    socket.emit("returnFailedJoinRoom", "Room is full.")
                } else {

                    // else join the room
                    socket.join(room);

                    // set user's room variable
                    ROOM = room;

                    // add user to PLAYERS list
                    gameSettings.PLAYERS.push(
                        {
                            id: socket.id,
                            name: name,
                            host: false
                        }
                    );
                    // update the room settings
                    state[room] = gameSettings;

                    // tell users in the room of new player
                    socket.emit("returnJoinedRoom", room, name);
                    io.in(room).emit("returnGameSettings", gameSettings);
                }
            }


        }
        catch (e) {
            console.log(`[${socket.id}] - failed to join room ${room}`);
        }
    });

    socket.on("generateRoom", (username) => {
        try {
            const roomCode = createRoomCode(5);
            const gameSettings = new Game(roomCode);
            gameSettings.PLAYERS.push(
                {
                    id: USER,
                    name: username,
                    host: true
                }
            );
            socket.join(roomCode);
            state[roomCode] = gameSettings;
            socketRooms[socket.id] = roomCode;
            ROOM = roomCode;
            socket.emit('returnRoomCode', roomCode, username, gameSettings);
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

        let fullname = answer.split(' ');
        let firstname = fullname[0].toUpperCase();
        let lastname = fullname[fullname.length - 1].toUpperCase();


        //check to make sure the answer checks all the marks

        if (!firstname || !lastname) {
            return state[roomCode]['SEND_INCORRECT']();
        }

        if (!state[roomCode]['CHECK_ANSWER'](firstname, lastname)) {
            return state[roomCode]['SEND_INCORRECT']();
        }

        // check to make sure it's actually a famous person then make adjustments
        pool.query(`SELECT * FROM famouspeople WHERE firstname="${firstname}" and lastname="${lastname}"`, (err, results, fields) => {
            if (results.length < 1) {
                return state[roomCode]['SEND_INCORRECT']();
            }

            if (lastname[0] === firstname[0]) {
                state[roomCode]['SWAP_DIRECTION']();
            }
            // set the LAST_ANSWER_LASTNAME_LETTER and LAST_ANSWER to correct answer
            state[roomCode]['PREVIOUS_ANSWERS'].push(firstname + lastname);
            state[roomCode]['LAST_ANSWER_LASTNAME_LETTER'] = lastname[0];
            state[roomCode]['LAST_ANSWER'] = `${firstname} ${lastname}`;
            state[roomCode]['RESET_TIMER']();
            state[roomCode]['SEND_CORRECT'](firstname, lastname);
            state[roomCode]['SET_CURRENT_PLAYER']();
        })

    })

    socket.on("disconnect", () => {
        if (!ROOM) return

        // get the room they are in and remove them from the players group
        let gameSettings = state[ROOM];
        const newUsers = gameSettings.PLAYERS.filter(player => {
            return player.id !== USER;
        })
        gameSettings.PLAYERS = newUsers;
        state[ROOM] = gameSettings;

        // emit to users in the room the updated players list
        // io.in(ROOM).emit("returnGameSettings", state[ROOM]);
    });
})


instrument(io, { auth: false });

httpServer.listen(process.env.PORT || 3000);

console.log(`Listening on ${process.env.PORT}`);