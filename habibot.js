/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict';

const log = require('winston');
const net = require('net');

const Queue = require('promise-queue');

const constants = require('./constants');
const util = require('./util');

const DirectionToPoseId = {
  LEFT:    254,
  RIGHT:   255,
  FORWARD: 146,
  BEHIND:  143,
};

const AvatarPostures = {
  WAVE:        141,
  POINT:       136,
  EXTEND_HAND: 148,
  JUMP:        139,
  BEND_OVER:   134,
  STAND_UP:    135,
  PUNCH:       140,
  FROWN:       142,
}

/**
 * JSON parse the message, handling errors.
 * 
 * @param String s
 * @returns Object The JSON object from the message or {}
 */
function parseElko(s) {
  var o = {};
  try {
    o = JSON.parse(s);
  } catch (e) {
    log.warn("Unable to parse: " + s + "\n\n" + JSON.stringify(e, null, 2));
  }
  return o;
}

const DefaultHabiBotConfig = {
  shouldReconnect: true,
};

class HabiBot {

  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.server = null;
    this.connected = false;

    // Ensures that only 1 Elko request is in flight at any given time.
    // We're talking to the 80's after all...
    this.requestQueue = new Queue(1, Infinity);

    this.config = util.clone(DefaultHabiBotConfig);

    this.names = {};
    this.history = {};
    this.noids = {};

    this.callbacks = {
      connected: [],
      disconnected: [],
      enteredRegion: [],
      msg: [],
    };

    log.debug('Constructed HabiBot @%s:%d: %j', this.host, this.port, this.config);
  }

  static newWithConfig(host, port, config) {
    var bot = new HabiBot(host, port);
    Object.assign(bot.config, config);
    return bot;
  }

  addName(s) {
    var scope = this;
    s.split('-').forEach((dash) => {
      scope.names[dash] = s;
      dash.split('.').forEach((dot) => {
        scope.names[dot] = s;
      });
    });
  }

  connect() {
    if (this.host === undefined || this.port === undefined) {
      log.error('No host or port specified: %s:%d', this.host. this.port);
      return;
    }

    if (!this.connected) {
      var scope = this;
      this.server = net.connect(this.port, this.host, () => {
        scope.connected = true;
        log.info('Connected to server @%s:%d', scope.host, scope.port);
        log.debug('Running callbacks for connect @%s:%d', scope.host, scope.port);
        for (var i in scope.callbacks.connected) {
          scope.callbacks.connected[i](scope);
        }
      });
      this.server.on('data', this.processData.bind(this));
      this.server.on('end', this.onDisconnect.bind(this));
    }
  }

  corporate() {
    var scope = this;
    if (!this.isGhosted()) {
      return Promise.resolve();
    }
    return scope.send({
      op: 'CORPORATE',
      to: 'GHOST',
    })
      .then(() => {
        // Hardwaits 10 seconds for all C64 clients to load imagery.
        return scope.wait(10000);
      });
  }

  discorporate() {
    return this.send({
      op: 'DISCORPORATE',
      to: 'ME',
    });
  }

  doPosture(posture) {
    var postureUpper = posture.toUpperCase();
    if (postureUpper in AvatarPostures) {
      return this.send({
        op:   'POSTURE',
        to:   'ME',
        pose: AvatarPostures[postureUpper],
      });
    }
    return Promise.reject(`Invalid posture: ${posture}`);
  }

  ensureCorporated() {
    return this.tryEnsureCorporated(0);
  }

  faceDirection(direction) {
    var directionUpper = direction.toUpperCase();
    if (directionUpper in DirectionToPoseId) {
      return this.send({
        op:   'POSTURE',
        to:   'ME',
        pose: DirectionToPoseId[directionUpper],
      });
    }
    return Promise.reject(`Invalid direction: ${direction}`);
  }

  tryEnsureCorporated(curTry) {
    var scope = this;
    if (scope.isGhosted()) {
      // If the Avatar is in ghost form but their Ghost object has not yet
      // come down the wire, retries every 2 seconds 5 times.
      if (!('GHOST' in scope.names)) {
        return new Promise((resolve, reject) => {
          if (curTry < 5) {
            setTimeout(() => {
              scope.ensureCorporated(curTry + 1)
                .then(() => { resolve(); })
                .catch((reason) => { reject(reason); });
            }, 2000);
          } else {
            reject('Could not ensure corporation after 5 tries.');
          }
        });
      }
      return this.corporate();
    }
    return Promise.resolve();
  }

  isGhosted() {
    var avatar = this.getAvatar();
    if (avatar != null) {
      return avatar.mods[0].amAGhost;
    }
    return false;
  }

  getAvatar() {
    if ('ME' in this.names) {
      return this.history[this.names.ME].obj;
    }
    return null;
  }

  getAvatarNoid() {
    var avatar = this.getAvatar();
    if (avatar != null) {
      return avatar.mods[0].noid;
    }
    return -1;
  }

  getDirection(obj) {
    var myAvatar = this.getAvatar();
    if (myAvatar != null && 
        obj != null &&
        'mods' in obj &&
        obj.mods.length > 0) {
      var avatarMod = myAvatar.mods[0];
      var mod = obj.mods[0];
      if ('x' in mod) {
        if (mod.x > avatarMod.x) {
          return constants.LEFT;
        } else if (mod.x == avatarMod.x) {
          return constants.FORWARD;
        } else {
          return constants.RIGHT;
        }
      }
      return constants.UNKNOWN;
    }
    return constants.UNKNOWN;
  }

  getDirectionOfNoid(noid) {
    return this.getDirection(this.getNoid(noid));
  }

  getMod(noid) {
    return this.getNoid(noid).mods[0];
  }

  getNoid(noid) {
    if (noid in this.noids) {
      log.debug('Object at noid %d: %j', noid, this.noids[noid]);
      return this.noids[noid];
    } else {
      log.error('Could not find noid: %s', noid);
      return null;
    }
  }

  on(eventType, callback) {
    if (eventType in this.callbacks) {
      this.callbacks[eventType].push(callback);
    } else {
      this.callbacks[eventType] = [callback];
    }
  }

  onDisconnect() {
    log.info('Disconnected from server @%s:%d...', this.host, this.port);
    this.connected = false;

    log.debug('Running callbacks for disconnect @%s:%d', this.host, this.port);
    for (var i in this.callbacks.disconnected) {
      this.callbacks.disconnected[i](this);
    }

    if (this.config.shouldReconnect) {
      this.connect();
    }
  }

  processData(buf) {
    var framed = false;
    var firstEOL = false;
    var JSONFrame = "";
    var blob = buf.toString();

    var o = null;
    for (var i=0; i < blob.length; i++) {
      var c = blob.charCodeAt(i);
      if (framed) {
        JSONFrame += String.fromCharCode(c);
        if (10 === c) {
          if (!firstEOL) {
            firstEOL = true;
          } else {
            o = this.processElkoPacket(JSONFrame);
            framed    = false;
            firstEOL  = false;
            JSONFrame = "";
          }
        }
      } else {
        if (123 === c) {
          framed = true;
          firstEOL = false;
          JSONFrame = "{";
        } else {
          if (10 !== c) {
            log.debug('IGNORED: %s', c);         
          }
        }
      }
    }
    if (framed) { 
      o = this.processElkoPacket(JSONFrame);
      framed    = false;
      firstEOL  = false;
      JSONFrame = '';
    }

    if (o != null) {
      if (o.op in this.callbacks) {
        log.debug('Running callbacks for op: %s', o.op);
        for (var i in this.callbacks[o.op]) {
          this.callbacks[o.op][i](this, o);
        }
      }
      for (var i in this.callbacks.msg) {
        this.callbacks.msg[i](this, o);
      }
    }
  }

  processElkoPacket(s) {
    log.debug("<-%s:%s: %s", this.host, this.port, s.trim());
    return this.scanForRefs(s);
  }

  scanForRefs(s) {
    var scope = this;
    var o = parseElko(s);
    
    if (o.to) {
      scope.addName(o.to);
    }
    if (!o.op) {
      return;
    }

    // HEREIS does not use the same params as make. TODO fix one day.
    if (o.op === 'HEREIS_$') {
      o.obj = o.object;
    }

    if (o.op === 'make' || o.op == 'HEREIS_$') {
      var ref = o.obj.ref;
      scope.addName(ref);
      scope.history[ref] = o;
      if ('mods' in o.obj && o.obj.mods.length > 0) {
        scope.noids[o.obj.mods[0].noid] = o.obj;
      }
      if (o.you) {
        var split = ref.split('-');
        scope.names.ME = ref;
        scope.names.USER = `${split[0]}-${split[1]}`;
        log.debug('Running callbacks for enteredRegion');
        scope.callbacks.enteredRegion.forEach((callback) => {
          callback(scope, o);
        });
      }
      if (o.obj.mods[0].type === "Ghost") {
        scope.names.GHOST = ref;
      }
    }
    return o;
  }

  send(obj) {
    return this.sendWithDelay(obj, 500);
  }

  sendWithDelay(obj, delayMillis) {
    var scope = this;
    return this.requestQueue.add(() => {
      return new Promise((resolve, reject) => {
        if (!scope.connected) {
          reject(`Not connected to ${scope.host}:${scope.port}`);
          return;
        }
        if (obj.to) {
          obj.to = scope.substituteName(obj.to);
        }
        scope.substituteState(obj);
        var msg = JSON.stringify(obj);
        setTimeout(() => {
          log.debug('%s:%s->: %s', scope.host, scope.port, msg.trim());
          scope.server.write(msg + '\n\n', 'UTF8', () => {
            resolve();
          });
        }, delayMillis);
      });
    });
  }

  /**
   * 
   * @param String s The message to be scanned for references ('ref's)
   */
  substituteName(s) {
    return this.names[s] || s;
  }

  /**
   * Telko supports a special state substitution. Any string that starts with "$" will trigger a lookup of the 
   * state via the this.names table. Example "$randy.obj.mod[0].x" will lookup "randy"'s formal ref in the $Names
   * table, then the value of this.history.user-randy-1230958410291.obj.mod[0].x will be substituted. All substitutions will
   * occur in place.
   * 
   * @param JSON Object m The object/message that will have it's parameters ($) substituted.
   */
  substituteState(m) {
    for (var name in m) {
      if(m.hasOwnProperty(name)) {
        var prop = m[name];
        if ((typeof prop === 'string' || prop instanceof String) && prop.indexOf('$') !== -1) {
          var chunks = prop.split("$");
          for (var i = 1; i < chunks.length; i++) {
            var value  = chunks[i];
            var keys   = chunks[i].split('.');
            var first  = true;
            var obj;
            var mod;
            for(var j = 0; j < keys.length; j++) {
              var varseg = keys[j];
              if (first) {
                value = this.history[this.substituteName(varseg)];
                if (undefined === value) {
                  // No matching object, so substitute the key's value.
                  value = this.names[varseg] || chunks[i];
                  break;
                }
                if (undefined !== value.obj) {
                  obj = value.obj;
                  if (undefined !== obj.mods & obj.mods.length === 1) {
                    mod = obj.mods[0];
                  }
                }
                first = false;
              } else {
                value = (undefined !== mod && undefined !== mod[varseg]) ? mod[varseg] :
                  (undefined !== obj && undefined !== obj[varseg]) ? obj[varseg] :
                    value[varseg];
              }
            }
            chunks[i] = value;
          }
          if (chunks.length === 2 && chunks[0] === "") {
            // This preserves integer types, which have no leading chars.
            m[name] = chunks[1];
          } else {
            // For in-string substitutions. 
            m[name] = chunks.join("");
          }
        }
      }
    }
  }

  wait(millis) {
    var scope = this;
    return new Promise((resolve, reject) => {
      log.debug('Bot @%s:%d waiting %d milliseconds', scope.host, scope.port, millis);
      setTimeout(() => {
        resolve();
      }, millis);
    });
  }

}

module.exports = HabiBot;