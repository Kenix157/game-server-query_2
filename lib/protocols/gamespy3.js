const async = require('async');

module.exports = require('../protocol').extend({
	init: function() {
		this._super();
		this.sessionId = 1;
		this.encoding = 'latin1';
		this.byteorder = 'be';
		this.noChallenge = false;
		this.useOnlySingleSplit = false;
		this.isJc2mp = false;
	},
	run: function(state) {
		var self = this;
		var challenge,packets;

		async.series([
			function(c) {
				if(self.noChallenge) return c();
				self.sendPacket(9,false,false,false,function(buffer) {
					var reader = self.reader(buffer);
					challenge = parseInt(reader.string());
					c();
				});
			},
			function(c) {
				var requestPayload;
				if(self.isJc2mp) {
					// they completely alter the protocol. because why not.
					requestPayload = new Buffer([0xff,0xff,0xff,0x02]);
				} else {
					requestPayload = new Buffer([0xff,0xff,0xff,0x01]);
				}

				self.sendPacket(0,challenge,requestPayload,true,function(b) {
					packets = b;
					c();
				});
			},
			function(c) {
				// iterate over the received packets
				// the first packet will start off with k/v pairs, followed with data fields
				// the following packets will only have data fields

				state.raw.playerTeamInfo = {};

				for(var iPacket = 0; iPacket < packets.length; iPacket++) {
					var packet = packets[iPacket];
					var reader = self.reader(packet);

					if(self.debug) {
						console.log("+++"+packet.toString('hex'));
						console.log(":::"+packet.toString('ascii'));
					}

					// Parse raw server key/values

					if(iPacket == 0) {
						while(!reader.done()) {
							var key = reader.string();
							if(!key) break;
							var value = reader.string();

							// reread the next line if we hit the weird ut3 bug
							if(value == 'p1073741829') value = reader.string();

							state.raw[key] = value;
						}
					}

					// Parse player, team, item array state

					if(self.isJc2mp) {
						state.raw.numPlayers2 = reader.uint(2);
						while(!reader.done()) {
							var player = {};
							player.name = reader.string();
							player.steamid = reader.string();
							player.ping = reader.uint(2);
							state.players.push(player);
						}
					} else {
						var firstMode = true;
						while(!reader.done()) {
							var mode = reader.string();
							if(mode.charCodeAt(0) <= 2) mode = mode.substring(1);
							if(!mode) continue;
							var offset = 0;
							if(iPacket != 0 && firstMode) offset = reader.uint(1);
							reader.skip(1);
							firstMode = false;

							var modeSplit = mode.split('_');
							var modeName = modeSplit[0];
							var modeType = modeSplit.length > 1 ? modeSplit[1] : 'no_';

							if(!(modeType in state.raw.playerTeamInfo)) {
								state.raw.playerTeamInfo[modeType] = [];
							}
							var store = state.raw.playerTeamInfo[modeType];

							while(!reader.done()) {
								var item = reader.string();
								if(!item) break;

								while(store.length <= offset) { store.push({}); }
								store[offset][modeName] = item;
								offset++;
							}
						}
					}
				}

				c();
			},

			function(c) {
				// Turn all that raw state into something useful

				if('hostname' in state.raw) state.name = state.raw.hostname;
				else if('servername' in state.raw) state.name = state.raw.servername;
				if('mapname' in state.raw) state.map = state.raw.mapname;
				if(state.raw.password == '1') state.password = true;
				if('maxplayers' in state.raw) state.maxplayers = parseInt(state.raw.maxplayers);

				if('' in state.raw.playerTeamInfo) {
					state.raw.playerTeamInfo[''].forEach(function(playerInfo) {
						var player = {};
						for(var from in playerInfo) {
							var key = from;
							var value = playerInfo[from];

							if(key == 'player') key = 'name';
							if(key == 'score' || key == 'ping' || key == 'team' || key == 'deaths' || key == 'pid') value = parseInt(value);
							player[key] = value;
						}
						state.players.push(player);
					})
				}

				self.finish(state);
			}
		]);
	},
	sendPacket: function(type,challenge,payload,assemble,c) {
		var self = this;

		var challengeLength = (this.noChallenge || challenge === false) ? 0 : 4;
		var payloadLength = payload ? payload.length : 0;

		var b = new Buffer(7 + challengeLength + payloadLength);
		b.writeUInt8(0xFE, 0);
		b.writeUInt8(0xFD, 1);
		b.writeUInt8(type, 2);
		b.writeUInt32BE(this.sessionId, 3);
		if(challengeLength) b.writeInt32BE(challenge, 7);
		if(payloadLength) payload.copy(b, 7+challengeLength);

		var numPackets = 0;
		var packets = {};
		this.udpSend(b,function(buffer) {
			var reader = self.reader(buffer);
			var iType = reader.uint(1);
			if(iType != type) return;
			var iSessionId = reader.uint(4);
			if(iSessionId != self.sessionId) return;

			if(!assemble) {
				c(reader.rest());
				return true;
			}
			if(self.useOnlySingleSplit) {
				// has split headers, but they are worthless and only one packet is used
				reader.skip(11);
				c([reader.rest()]);
				return true;
			}

			reader.skip(9); // filler data -- usually set to 'splitnum\0'
			var id = reader.uint(1);
			var last = (id & 0x80);
			id = id & 0x7f;
			if(last) numPackets = id+1;

			reader.skip(1); // "another 'packet number' byte, but isn't understood."

			packets[id] = reader.rest();
			if(self.debug) {
				console.log("Received packet #"+id);
				if(last) console.log("(last)");
			}

			if(!numPackets || Object.keys(packets).length != numPackets) return;

			// assemble the parts
			var list = [];
			for(var i = 0; i < numPackets; i++) {
				if(!(i in packets)) {
					self.fatal('Missing packet #'+i);
					return true;
				}
				list.push(packets[i]);
			}
			c(list);
			return true;
		});
	}
});
