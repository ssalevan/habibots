/* jslint bitwise: true */
/* jshint esversion: 6 */

const log = require('winston');
const net = require('net');


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


class ElkoBot {

  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.server = null;
    this.connected = false;

    this.names = {};
    this.history = {};

    this.callbacks = {
      connected: [],
      disconnected: [],
      msg: [],
    };
  }

  addName(s) {
    s.split("-").forEach(function(dash) {
      this.names[dash] = s;
      dash.split(".").forEach(function(dot) {
        this.names[dot] = s;
      });
    });
  }

  connect() {
    if (!this.connected) {
      this.server = net.connect(this.port, this.host, function() {
        log.info('Connected to server @%s:%d', this.host, this.port);
        for (callback in this.callbacks.connected) {
          callback(this);
        }
      });
      this.server.on('data', this.processData);
      this.server.on('end', this.onDisconnect);
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

    for (callback in this.callbacks.disconnected) {
      callback(this);
    }
  }

  processData(buf) {
    var framed = false;
    var firstEOL = false;
    var JSONFrame = "";
    var blob = buf.toString();
    for (var i=0; i < blob.length; i++) {
      var c = blob.charCodeAt(i);
      if (framed) {
        JSONFrame += String.fromCharCode(c);
        if (10 === c) {
          if (!firstEOL) {
            firstEOL = true;
          } else {
            this.processElkoPacket(JSONFrame);
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
            log.debug("IGNORED: %s", c);         
          }
        }
      }
    }
    if (framed) { 
      this.processElkoPacket(JSONFrame);
      framed    = false;
      firstEOL  = false;
      JSONFrame = "";
    }

    if (o.op in this.callbacks) {
      for (callback in this.callbacks[o.op]) {
        callback(this, o);
      }
    }

    for (callback in this.callbacks.msg) {
      callback(this, o);
    }
  }

  processElkoPacket(s) {
    log.debug("<-%s:%s: %s", this.host, this.port, s.trim());
    this.scanForRefs(s);
  }

  scanForRefs(s) {
    var o = parseElko(s);
    if (o.to) {
      this.addName(o.to);
    }
    if (!o.op) {
      return;
    }
    if (o.op === "HEREIS_$") {
      o.obj = o.object; // HEREIS does not use the same params as make. TODO fix one day.
    }
    if (o.op === "make" || o.op == "HEREIS_$") {
      var ref = o.obj.ref;
      this.addName(ref);
      this.history[ref] = o;
      if (o.you) {
        var split = ref.split("-");
        this.names.ME  = ref;
        this.names.USER  = split[0] + "-" + split[1];
      }
      if (o.obj.mods[0].type === "Ghost") {
        this.names.GHOST = ref;
      }
    }
  }

  send(obj) {
    if (!this.connected) {
      log.error('Not connected to %s:%s, ignoring send(): %s', this.host, this.port, obj);
      return;
    }

    if (obj.to) {
      obj.to = this.substituteName(obj.to);
    }
    this.substituteState(obj);
    if (undefined !== obj.op && "entercontext" === obj.op && undefined === obj.context) {
      obj.context = this.firstContext;
    }
    var msg = JSON.stringify(obj);
    log.debug("->%s:%s: %s", this.host, this.port, msg.trim());
    this.server.write(msg + "\n\n");
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
                if (undefined === value) {  // No matching object, so substitute the key's value
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
            m[name] = chunks[1];    // This preserves integer types, which have no leading chars
          } else {
            m[name] = chunks.join("");  // For in-string substitutions. 
          }
        }
      }
    }
  }

}
