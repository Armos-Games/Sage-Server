#!/bin/env node

// Require
var fs      	= require('fs');
var websocket 	= require('websocket').server;
var http 		= require('http');

// Constant
var maxGOsPerMessage = 200;

// Customs classes
function Client (connection) {
	this.connection = connection;
	this.room = null;
	this.gameObjects = [];

	this.JoinRoom = function (room) {
		if (this.room != null)
		{
			this.LeaveRoom();
		}
		room.clients.push(this);
		this.room = room;
	};

	this.LeaveRoom = function () {
		if(this.room == null)
		{
			return;
		}
		var idsToDestroy = [];
		for (var key in this.gameObjects)
		{
			if (this.gameObjects[key] != undefined)
			{
				idsToDestroy.push(key);
			}
		}
		this.DestroyGOs(idsToDestroy);
		this.gameObjects = [];
		this.room.clients.splice(this.room.clients.indexOf(this), 1);
		if (this.room.clients.length <=0)
		{
			rooms.splice(rooms.indexOf(this.room), 1);
		}
		this.room = null;
	};

	this.UpdateGOs = function (modifiedGameObjects) {
		var verifiedGameObjects = [];
		for (var i = 0; i < modifiedGameObjects.length; i++) {
			if (modifiedGameObjects[i].networkId != undefined)
			{
				var tempObj = this.gameObjects[modifiedGameObjects[i].networkId];
				if (tempObj != undefined)
				{
					verifiedGameObjects.push(modifiedGameObjects[i])
					for(var componentName in modifiedGameObjects[i])
					{
						for(var varName in modifiedGameObjects[i][componentName])
						{
							tempObj[componentName][varName] = modifiedGameObjects[i][componentName][varName];
						}
					}
				}
			}
		}
		for (var i = 0; i < this.room.clients.length; i++) {
			if (this.room.clients[i] != this)
			{
				var message = {command: "updateGO", gameObjects: verifiedGameObjects};
				this.room.clients[i].connection.sendUTF(JSON.stringify(message));
			}
		}
	};

	this.CreateGOs = function (newGameObjects) {
		var newIds = [];
		for (var i = 0; i < newGameObjects.length; i++) {
			newIds[i] = this.room.CreateGOId();
			newGameObjects[i].networkId = newIds[i];
			this.gameObjects[newIds[i].toString()] = newGameObjects[i];
		}
		for (var i = 0; i < this.room.clients.length; i++) {
			if (this.room.clients[i] != this)
			{
				var message = {command: "createGO", gameObjects: newGameObjects};
				this.room.clients[i].connection.sendUTF(JSON.stringify(message));
			}
		}
		var message = {command: "GOCreated", ids: newIds};
		this.connection.sendUTF(JSON.stringify(message));
	};

	this.DestroyGOs = function (ids) {
		var verifiedIds = [];
		for (var i = 0; i < ids.length; i++) {
			if (ids[i] != undefined)
			{
				var tempObj = this.gameObjects[ids[i]];
				if (tempObj != undefined)
				{
					verifiedIds.push(ids[i]);
					this.gameObjects[ids[i]] = undefined;
				}
			}
		}
		for (var i = 0; i < this.room.clients.length; i++) {
			if (this.room.clients[i] != this)
			{
				var message = {command: "destroyGO", ids: verifiedIds};
				this.room.clients[i].connection.sendUTF(JSON.stringify(message));
			}
		}
	};
}

function Room (name)
{
	var lastGoId = 0;
	this.id = (new Date()).valueOf();
	this.clients = [];

	if (name != undefined)
	{
		this.name = name;
	}
	else
	{
		this.name = "Room " + id;
	}

	this.CreateGOId = function ()
	{
		lastGoId ++;
		return lastGoId;
	}
};

// Server variables
var clients = [];
var rooms = [];

// Server functions
var CreateRoom = function (roomName) {
	var newRoom = new Room(roomName);
	rooms.push(newRoom);

	return newRoom;
};

var FindRoomById = function (id) {
	for (var i = 0; i < rooms.length; i++)
	{
		if(rooms[i].id == id)
		{
			return rooms[i];
		}
	}
	return null;
};

var SerializeRooms = function () {
	var roomList = [];

	for (var i = 0; i < rooms.length; i++) {
		roomList[i] = {};
		roomList[i].name = rooms[i].name;
		roomList[i].id = rooms[i].id;
		roomList[i].clientAmmount = rooms[i].clients.length;
	}
	return roomList;
};

// Cache
var indexCache = fs.readFileSync("./index.html");

// Network variables
var ipaddress = process.env.OPENSHIFT_NODEJS_IP;
var port = process.env.OPENSHIFT_NODEJS_PORT || 8080;
if (typeof ipaddress === "undefined") {
	console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
	ipaddress = "127.0.0.1";
};

// Create http server
var server = http.createServer(function(req, res) {
	res.writeHead(200, {'Content-Type': 'text/html'});
	res.end(indexCache);
});

server.listen(port, ipaddress, function() {});

// Create the websocket server from http server
wsServer = new websocket({
	httpServer: server
});

// Setup WebSocket server
wsServer.on('request', function(request) {
	var connection = request.accept(null, request.origin);
	var newClient = new Client(connection);
	clients.push(newClient);

	connection.on('message', function(message) {
		if (message.type === 'utf8')
		{
			var data = JSON.parse(message.utf8Data);
			switch(data.command)
			{
				case "createRoom":
					// Add a new room
					var newRoom = CreateRoom(data.name);
					newClient.JoinRoom(newRoom);
					var message = {command: "roomCreated", id: newRoom.id};
					connection.sendUTF(JSON.stringify(message));
					break;
				//
				case "joinRoom":
					// Join a room
					var theRoom = FindRoomById(data.roomId);
					if (theRoom == null || theRoom == newClient.room)
					{
						break;
					}
					newClient.JoinRoom(theRoom);
					var goArray = [];
					for (var i = 0; i < theRoom.clients.length; i++) {
						if (theRoom.clients[i].gameObjects.length > 0)
						{
							goArray = goArray.concat(theRoom.clients[i].gameObjects);
						}
						goArray = goArray.filter(function(element){ return element != null; });
					}
					var message = {command: "roomJoined"};
					connection.sendUTF(JSON.stringify(message));

					// Send the current GameObjects in the room
					while (goArray.length > 0)
					{
						var packet = [];
						for (var i = 0; (i<goArray.length && i<maxGOsPerMessage); i++) {
							packet.push(goArray[i]);
						}
						var message = {
							command:"createGO",
							gameObjects:packet
						};

						connection.sendUTF(JSON.stringify(message));
						goArray.splice(0, packet.length);
					}

					// Room is loaded
					var message = {command: "roomLoaded"};
					connection.sendUTF(JSON.stringify(message));

					break;
				//
				case "leaveRoom":
					// Leave the room
					newClient.LeaveRoom();
					var message = {command: "roomLeft"};
					connection.sendUTF(JSON.stringify(message));
				//
				case "createGO":
					// Create game object on server side
					if (newClient.room != null && Array.isArray(data.gameObjects))
					{
						newClient.CreateGOs(data.gameObjects);
					}
					break;
				//
				case "updateGO":
					// Update client object list on the server
					if (newClient.room != null && Array.isArray(data.gameObjects))
					{
						newClient.UpdateGOs(data.gameObjects);
					}
					break;
				//
				case "destroyGO":
					// Destroy a game object
					if (newClient.room != null && Array.isArray(data.ids))
					{
						newClient.DestroyGOs(data.ids);
					}
				//
				case "getRoomsList":
					// Get the list of all the active rooms
					var message = {command: "roomsList", rooms: SerializeRooms()};
					connection.sendUTF(JSON.stringify(message));
					break;
				//
				case "ping":
					// Test the connection
					connection.sendUTF(JSON.stringify({command: "pong"}));
					break;
				//
				default:
				break;
			}
		}
	});

	connection.on('close', function(connection) {
		newClient.LeaveRoom();
		clients.splice(clients.indexOf(newClient), 1);
	});
});