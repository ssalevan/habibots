/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict';

const Defaults = {
  host:         '127.0.0.1',
  loglevel:     'debug',
  port:         1337,
  reconnect:    true,
  slackChannel: 'newavatars',
  slackToken:   ''
};

const fs = require('fs');

var log = require('winston');
log.remove(log.transports.Console);
log.add(log.transports.Console, { 'timestamp': true });

const RtmClient = require('@slack/client').RtmClient;
const CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;
const RTM_EVENTS = require('@slack/client').RTM_EVENTS;
const MemoryDataStore = require('@slack/client').MemoryDataStore;

const constants = require('./constants');
const HabiBot = require('./habibot');

const Argv = require('yargs')
  .usage('Usage: $0 [options]')
  .help('help')
  .option('help', { alias: '?', describe: 'Get this usage/help information.' })
  .option('host', { alias: 'h', default: Defaults.host, describe: 'Host name or address of the Elko server.' })
  .option('loglevel',  { alias: ';', default: Defaults.loglevel, describe: 'Log level name. (see: npm winston)'})
  .option('port', { alias: 'p', default: Defaults.port, describe: 'Port number for the Elko server.' })
  .option('context', { alias: 'c', describe: 'Context to enter.' })
  .option('greetingFile', { alias: 'g', describe: 'File to be played as a greeting.' })
  .option('reconnect', { alias: 'r', default: Defaults.reconnect, describe: 'Whether the bot should reconnect on disconnection.' })
  .option('slackToken', { alias: 's', default: Defaults.slackToken, describe: 'Token for sending user notifications to Slack.' })
  .option('slackChannel', { alias: 'l', default: Defaults.slackChannel, describe: 'Default Slack channel to use for notifications.' })
  .option('username', { alias: 'u', describe: 'Username of this bot.' })
  .argv;

log.level = Argv.loglevel;

const GreeterBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username);
const GreetingText = fs.readFileSync(Argv.greetingFile).toString().split('\n');

const SlackEnabled = Argv.slackToken !== '';
const SlackClient = new RtmClient(Argv.slackToken, {
  logLevel: 'error', 
  dataStore: new MemoryDataStore(),
  autoReconnect: true,
  autoMark: true 
});


let SlackChannelId;
SlackClient.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
  for (const c of rtmStartData.channels) {
    if (c.is_member && c.name === Argv.slackChannel) { SlackChannelId = c.id }
  }
});

SlackClient.on(RTM_EVENTS.MESSAGE, (message) => {
  var username = SlackClient.dataStore.getUserById(message.user).name;
  GreeterBot.say(`@${username}: ${message.text}`);
});


GreeterBot.on('APPEARING_$', (bot, msg) => {
  var avatar = bot.getNoid(msg.appearing);
  if (avatar == null) {
    log.error('No avatar found at noid: %s', msg.appearing);
    return;
  }

  // Announces new user to Slack.
  if (SlackEnabled) {
    SlackClient.sendMessage(`New Avatar arrived: ${avatar.name}`, SlackChannelId);
  }

  // Faces the Avatar, waves to them, faces forward again, and says the greeting text.
  bot.faceDirection(bot.getDirection(avatar))
    .then(() => {
      return bot.doPosture(constants.WAVE);
    })
    .then(() => {
      return bot.faceDirection(constants.FORWARD);
    })
    .then(() => {
      return Promise.all(GreetingText.map((line) => {
        return bot.sendWithDelay({
          op: 'SPEAK',
          to: 'ME',
          esp: 0,
          text: line
        }, 2000);
      }));
    });
});

GreeterBot.on('SPEAK$', (bot, msg) => {
  if (SlackEnabled) {
    // Don't echo out anything the bot itself says.
    if (msg.noid === bot.getAvatarNoid()) {
      return;
    }

    var avatar = bot.getNoid(msg.noid);
    if (avatar != null) {
      SlackClient.sendMessage(`${avatar.name}: ${msg.text}`, SlackChannelId);
    }
  }
});


GreeterBot.on('connected', (bot) => {
  log.debug('GreeterBot connected.');
  bot.gotoContext(Argv.context);
});


GreeterBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
    .then(() => {
      return bot.walkTo(84, 131);
    })
    .then(() => {
      return bot.faceDirection(constants.LEFT);
    })
    .then(() => {
      return bot.doPosture(constants.WAVE);
    })
    .then(() => {
      return bot.faceDirection(constants.FORWARD);
    })
    .then(() => {
      return bot.say("Hey there! I'm Phil, the greeting bot!");
    });
});

GreeterBot.connect();

if (SlackEnabled) {
  SlackClient.start();
}
