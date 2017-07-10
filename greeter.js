const fs = require('fs');
const yargs = require('yargs');

const Defaults = {
  host:      '127.0.0.1',
  port:      1337,
  reconnect: true
};

const Argv = yargs
  .usage('Usage: $0 [options]')
  .help('help')
  .option('help', { alias: '?', describe: 'Get this usage/help information.'})
  .option('host', { alias: 'h', default: Defaults.host, describe: 'Host name or address of the Elko server.'})
  .option('port', { alias: 'p', default: Defaults.port, describe: 'Port number for the Elko server.'})
  .option('context', { alias: 'c', describe: 'Context to enter.' })
  .option('greetingFile', { alias: 'g', describe: 'File to be played as a greeting.' })
  .option('reconnect', { alias: 'r', default: Defaults.reconnect, describe: 'Whether the bot should reconnect on disconnection.' })
  .option('username', { alias: 'u', describe: 'Username of this bot.'})
  .argv

const GreeterBot = new ElkoBot('127.0.0.1', 1337);
const GreetingText = fs.readFileSync(Argv.greetingFile).toString().split("\n");

GreeterBot.on('HEREIS_$', function(bot, msg) {
  bot.send({
    op: 'POSTURE',
    to: 'ME',
    pose: 141
  });
  for (line in GreetingText) {
    bot.send({
      op: 'OBJECTSPEAK_$',
      type: 'private',
      noid: 0,
      text: line,
      speaker: '$ME.noid$',
      Telko: {
        delay: 0.5,
      }
    });
  }
});

GreeterBot.on('connect', function(bot) {
  bot.send({
    op: 'entercontext',
    to: 'session',
    context: Argv.context,
    user: 'user-' + Argv.username
  });
  bot.send({
    op: 'WALK',
    to: 'ME',
    x: 84,
    y: 131,
    how: 1,
    Telko: {
      delay: 10
    }
  });
  bot.send({
    op: 'POSTURE',
    to: 'ME',
    pose: 141,
    Telko: {
      delay: 15
    }
  });
  bot.send({
    op: 'SPEAK',
    to: 'ME',
    esp: 0,
    text: "Hey there! I'm Phil, the greeting bot!",
    Telko: {
      delay: 20
    }
  });
});

GreeterBot.connect();

if (Argv.reconnect) {
  GreeterBot.on('disconnect', function(bot) {
    bot.connect();
  });
}
