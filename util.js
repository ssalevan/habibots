/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict';

const log = require('winston');


/**
 * Clones a JavaScript Object, borrowed from:
 * https://stackoverflow.com/posts/728694/revisions
 * @param {Object} Object to clone
 * @returns {Object} Cloned object
 */
function clone(obj) {
  var copy;

  // Handle the 3 simple types, and null or undefined
  if (null == obj || "object" != typeof obj) return obj;

  // Handle Date
  if (obj instanceof Date) {
    copy = new Date();
    copy.setTime(obj.getTime());
    return copy;
  }

  // Handle Array
  if (obj instanceof Array) {
    copy = [];
    for (var i = 0, len = obj.length; i < len; i++) {
      copy[i] = clone(obj[i]);
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object) {
    copy = {};
    for (var attr in obj) {
      if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
    }
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
}


/**
 * JSON parses an Elko message, handling errors.
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


module.exports = Object.freeze({
  clone: clone,
  parseElko: parseElko,
});
