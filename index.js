const { instrument } = require('@socket.io/admin-ui');
const { createServer } = require("http");
const { generateGame } = require('./game');
const { createRoomCode } = require('./utilities');
const { generateGameSettings } = require('./game')

const state = {};
const socketRooms = {};

const httpServer = createServer();

const io = require('socket.io')(httpServer, {
    cors: {
        origin: ['http://localhost:3000', "https://admin.socket.io"]
    }
});

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
    console.log(socket.id);

    socket.on("joinRoom", (room, name) => {
        // console.dir(io.sockets);
        console.log('joining...');
        try {
            // Check if the room exists
            const r = io.sockets.adapter.rooms;
            if (r.has(room)) {


                // Gather the user count in the room and compare
                let users = Array.from(r.get(room));
                let gameSettings = JSON.parse(state[room]);

                if (users.length > 0) {
                    // If full
                    if (users.length > gameSettings.MAX_PLAYERS) {
                        console.log('Room is full');
                        //  emit room is full message
                    } else {

                        // else join the room
                        socket.join(room);
                        gameSettings.PLAYERS.push(
                            {
                                id: socket.id,
                                name: name
                            }
                        );
                        state[room] = gameSettings;
                        socket.emit("returnJoinedRoom");
                        io.in(room).emit("returnGameSettings", JSON.stringify(gameSettings))
                    }
                }

            } else {
                // probably return here because the room doesn't exist?
            }



        }
        catch (e) {
            console.log(`[${socket.id}] - failed to join room ${room}`)
        }
    })

    socket.on("generateRoom", () => {
        try {
            const roomCode = createRoomCode(5);
            const gameSettings = generateGameSettings();
            socket.emit('returnRoomCode', roomCode);
            socket.emit('returnGameSettings', JSON.stringify(gameSettings));
            socket.join(roomCode);
            state[roomCode] = gameSettings;
            socketRooms[socket.id] = roomCode;
        } catch (e) {
            console.log(`[${socket.id}] - error generating room`)
        }
    })

    socket.on("updateGameSettings", (roomCode, gameSettings) => {
        state[roomCode] = gameSettings;
        io.in(roomCode).emit("returnGameSettings", gameSettings);
    })

    socket.on("viewGameSettings", (room) => {
        socket.emit("viewGameSettings", state[room]);
    })

    socket.on("startGame", () => {

    })

})

io.on("submitAnswer", (answer) => {
    console.log(answer);
})



instrument(io, { auth: false });

httpServer.listen(5000);