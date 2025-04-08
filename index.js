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
        origin: ['http://localhost:5173', 'http://localhost:4001', 'http://namegame.kwurty.com', 'https://namegame.kwurty.com', 'https://kwurty.github.io', "https://admin.socket.io", "https://itsthenamegame.herokuapp.com/", "https://kwurty.github.io/jillcrate-client/"]
    }
});

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DB
});

class Game {
    constructor(roomCode = null) {
        this.ROOM = roomCode;
        this.HOST = null;
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
        this.CURRENT_PLAYER = 0;
        this.LAST_ANSWER_LASTNAME_LETTER = null;
        this.LAST_ANSWER = null;
        this.DIRECTION = 1;
        this.TIME_LEFT = null;
        this.TIMER = null;
        this.WINNER = null;
        this.PENDING_PLAYERS = [];
    }

    VERIFY_HOST_USER(user_socket) {
        // Check if the user is the host
        if (this.HOST === user_socket.id) {
            return true;
        }

        return false;
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
        const PlayerId = this.PLAYERS[this.CURRENT_PLAYER].id;
        io.in(this.ROOM).emit("correctAnswer", PlayerId, firstname, lastname);
    }

    SEND_INCORRECT(message = null) {
        const PlayerId = this.PLAYERS[this.CURRENT_PLAYER].id;
        io.in(this.ROOM).emit("incorrectAnswer", PlayerId, message);
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

        pool.query(`SELECT first_name, last_name FROM ${process.env.DB_DB}.${process.env.DB_TABLE} ORDER BY RAND() LIMIT 1`, (err, res) => {
            if (!res || !res[0] || !res[0].first_name || !res[0].last_name) {
                io.in(this.ROOM).emit("correctAnswer", 0, "Fred", "Durst");
                return
            }
            console.log(res);
            this.LAST_ANSWER = `${res[0].first_name} ${res[0].last_name}`
            this.LAST_ANSWER_LASTNAME_LETTER = res[0].last_name[0];
            this.PREVIOUS_ANSWERS.push(`${res[0].first_name}${res[0].last_name}`);
            io.in(this.ROOM).emit("correctAnswer", 0, res[0].first_name, res[0].last_name);
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
        this.WINNER = winner.name;
        io.in(this.ROOM).emit("gameover", winner);
        this.STOP_TIMER();

        // add queued playings into player list
        if (this.PENDING_PLAYERS.length > 0) {
            while (this.PENDING_PLAYERS.length > 0) {
                let player = this.PENDING_PLAYERS.pop();
                this.PLAYERS.push(player);
            }
        }
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
            HOST: this.HOST,
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
            if (!state[room]) {
                socket.emit("returnFailedRoomJoin", "Room does not exist");
                return;
            }

            // Gather the user count in the room and compare
            let users = Array.from(r.get(room));
            let gameSettings = state[room];

            if (!users || !gameSettings) {
                socket.emit("returnFailedRoomJoin", "Room does not exist");
                return;
            }

            if (users.length > 0) {
                // If full
                if (users.length >= gameSettings.MAX_PLAYERS) {
                    //  emit room is full message
                    socket.emit("returnFailedRoomJoin", "Room is full.")
                }
                else {

                    if (gameSettings && gameSettings.PLAYERS) {
                        for (let player of gameSettings.PLAYERS) {
                            if (player.name.toLowerCase() == name.toLowerCase()) {
                                socket.emit("returnFailedRoomJoin", `Player with name ${name} already exists`);
                                return;
                            }
                        }
                    }

                    // else join the room
                    socket.join(room);

                    // set user's room variable
                    ROOM = room;

                    // add user to PLAYERS list
                    if (gameSettings && (gameSettings.STATUS == 2 || gameSettings.STATUS == 1)) {
                        console.log("Game in progress")
                        state[room].PENDING_PLAYERS.push(
                            {
                                id: socket.id,
                                name: name
                            }
                        );
                        socket.emit("returnJoinedRoom", room, name);
                    } else {
                        gameSettings.PLAYERS.push(
                            {
                                id: socket.id,
                                name: name
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


        }
        catch (e) {
            console.log(e)
            console.log(`[${socket.id}] - failed to join room ${room}`);
        }
    });

    socket.on("generateRoom", (username) => {
        try {
            const roomCode = createRoomCode(5);
            const gameSettings = new Game(roomCode);
            gameSettings.HOST = USER;
            gameSettings.PLAYERS.push(
                {
                    id: USER,
                    name: username
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
        if (state[roomCode] && state[roomCode][key]) {

            if (key === "MAX_PLAYERS") {
                if (value > 10) {
                    socket.emit('hostError', `Playes are limited to 10.`);
                    return;
                } else if (value < 2) {
                    socket.emit('hostError', `Must have at least 2 players`);
                    return;
                }
            }

            if (key === "MAX_LIVES") {
                if (value < 1) {
                    socket.emit('hostError', 'Must have at least 1 life in lives mode');
                    return;
                }
            }

            if (key === "ANSWER_TIMER") {
                if (value < 5) {
                    socket.emit('hostError', 'Timer cannot be less than 5 seconds');
                    return;
                } else if (value > 60) {
                    socket.emit('hostError', 'Timer cannot be more than 60 seconds');
                    return;
                }
            }

            state[roomCode][key] = value
            io.in(roomCode).emit("returnGameSettings", state[roomCode]);

        } else {
            socket.emit('hostError', `There is no setting ${key} to update.`)
        }
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
        pool.query(`SELECT * FROM ${process.env.DB_DB}.${process.env.DB_TABLE} WHERE first_name="${firstname}" and last_name="${lastname}"`, (err, results, fields) => {
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
        console.log(`User ${socket.id} disconnected`);
        if (!ROOM) return

        // get the room they are in and remove them from the players group
        let gameSettings = state[ROOM];
        const player = gameSettings.PLAYERS.find(player => {
            return player.id === USER;
        })
        const newUsers = gameSettings.PLAYERS.filter(player => {
            return player.id !== USER;
        })

        if (gameSettings.HOST === USER) {
            console.log("is host -- asign new")
            // Player is host - assign new host
            if (newUsers.length > 0) {
                if (!newUsers[0]) return;
                gameSettings.HOST = newUsers[0].id;
            }
        }

        gameSettings.PLAYERS = newUsers;
        state[ROOM] = gameSettings;


        // emit to users in the room the updated players list
        io.in(ROOM).emit("returnGameSettings", state[ROOM]);
    });

    socket.on("debug_right_answer", (roomCode) => {
        if (!roomCode) return;
        if (state[roomCode].PLAYERS[state[roomCode].CURRENT_PLAYER].id !== socket.id) return;
        // state[roomCode]['PREVIOUS_ANSWERS'].push(firstname + lastname);
        // state[roomCode]['LAST_ANSWER_LASTNAME_LETTER'] = lastname[0];
        // state[roomCode]['LAST_ANSWER'] = `${firstname} ${lastname}`;
        state[roomCode]['RESET_TIMER']();
        state[roomCode]['SEND_CORRECT']("example", "answer");
        state[roomCode]['SET_CURRENT_PLAYER']();
    })
    socket.on("debug_wrong_answer", (roomCode) => {
        if (!state[roomCode]) return;
        if (state[roomCode].PLAYERS[state[roomCode].CURRENT_PLAYER].id !== socket.id) return;

        return state[roomCode]['SEND_INCORRECT']();
    })
    socket.on("removePlayer", (roomCode, playerId) => {
        console.log('room code - ', roomCode, ' playerid - ', playerId);
        if (!state[roomCode]) return;
        if (!state[roomCode].VERIFY_HOST_USER(socket)) {
            socket.emit("hostError", "You are not the host of this room.");
            return;
        }
        // remove player from the game
        const player_socket = io.sockets.sockets.get(playerId);
        if (!player_socket) {
            socket.emit("hostError", "Player not found.");
            return;
        }
        if (player_socket.rooms.has(roomCode)) {
            player_socket.leave(roomCode);
            player_socket.emit('disconnected', `You have been removed from the game ${roomCode}`);
        }

    })
})


instrument(io, { auth: false });

httpServer.listen(process.env.PORT || 3000);


console.log(`Listening on ${process.env.PORT}`);