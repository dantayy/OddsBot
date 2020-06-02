// boilerplate code copied from https://tutorials.botsfloor.com/building-a-node-js-slack-bot-before-your-microwave-popcorn-is-ready-8946651a5071
// more refined request handling implementation copied initially from https://github.com/slackapi/node-slack-sdk/blob/bc4260466fb06c3a31d53c609d87bc3dccaba987/examples/express-all-interactions/server.js#L217
require('dotenv').config();

const express = require('express'); // significantly simplifies app routing
const bodyParser = require('body-parser'); // parses request bodies
const redis = require('redis'); // allows us to set up a redis client locally

//const request = require("request");

let redisClient = redis.createClient({
  port: process.env.REDIS_PORT,
  host: process.env.REDIS_HOSTNAME
});
redisClient.auth(process.env.REDIS_PASSWORD, function (err, response) {
  if (err) {
    console.log("Couldn't authenticate with Redis db, check your credentials");
    throw err;
  }
});

// Creates express app
const app = express();
// The port used for Express server
const PORT = 3000;
// Starts server
app.listen(process.env.PORT || PORT, function () {
  console.log('Bot is listening on port ' + PORT);
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Attach the slash command handler
app.post('/', bodyParser.urlencoded({ extended: false }), slackSlashCommand);

// Slack slash command handler
function slackSlashCommand(req, res, next) {
  // odds initiation command
  if (req.body.command === '/odds') {
    // if an id is in this text, continue, otherwise respond with error
    if (req.body.text.includes("<@")) {
      let challengedID = req.body.text.split('<@').pop().split(`>`)[0].split(`\|`)[0]; //grab the id of the challenged
      console.log(challengedID);
      // create a new hash with fields for all pertinant odds challenge data in redis by combining the initaitor and challenged ids
      let initiatorChallengedHash = req.body.user_id + "|" + challengedID; //challenge hash always puts initiator to the left and challenged to the right
      redisClient.hset(initiatorChallengedHash, 'upperLimit', 0, redis.print);
      redisClient.hset(initiatorChallengedHash, 'initiator', req.body.user_id, redis.print);
      redisClient.hset(initiatorChallengedHash, 'challenged', challengedID, redis.print);
      redisClient.hset(initiatorChallengedHash, 'initiatorOdds', 0, redis.print);
      redisClient.hset(initiatorChallengedHash, 'challengedOdds', 0, redis.print);
      res.json({
        response_type: "in_channel",
        text: "<@" + challengedID + ">, you've been challenged!  Submit your upper bounds now with /setodds or cancel the challenge with /cancelodds",
      });
    }
    else {
      res.json({
        text: "You need to specify who you're challenging!"
      });
    }
  }
  // setting upper limit of odds
  else if (req.body.command === '/setodds') {
    // loop through all pair hashs in redis to see if this user was challenged
    redisClient.keys('*', function(err, result){ //TESTING HOW THIS ISH WORKS
      if(err){
        console.log(err);
      } else{
        console.log(result);
      }
    });
    // for (let i = 0; i < redisClient.keys.length; i++) { // REWORK THIS
    //   redisClient.hget("users:123", "name", function (err, obj) { // https://stackoverflow.com/questions/10584502/how-do-i-issue-hget-get-command-for-redis-database-via-node-js
    //     console.dir(obj);
    //   });
    //   if (redisClient.keys[i]. === req.body.user_id) { // make sure the person setting the limits has been challenged and is not the challenger
    //     if (req.body.text.match(`/(\d+)/`) !== null) { // check that there's a number in the text
    //       let upperLimit = req.body.text.match(`/(\d+)/`)[0];
    //       if (upperLimit > 1) { // check that the number is valid
    //         redisClient.hset(redisClient.keys[i], upperLimit); // FIXME: change over to implemenation using hashmaps instead!
    //         res.json({
    //           response_type: "in_channel",
    //           text: "Odds limit has been set to " + upperLimit + "!  <@" + redisClient.keys[i].split("|")[0] + "> and <@" + redisClient.keys[i].split("|")[1] + "> enter a number between 1 and that upper limit with /commitodds",
    //         });
    //         break;
    //       } else {
    //         res.json({
    //           text: "Your upper limit needs to be greater than 1!"
    //         });
    //         break;
    //       }
    //     }
    //     else {
    //       res.json({
    //         text: "You need to specify a numerical upper limit!"
    //       });
    //       break;
    //     }
    //   }
    // }
  }
  // commiting an inividual's odds number
  else if (req.body.command === '/commitodds') {
    // loop through all pair hashs in redis to see if this user was challenged OR is challenging
    for (let i = 0; i < redisClient.keys.length; i++) {
      if (redisClient.keys[i].includes("|")) {
        if (redisClient.keys[i].split("|")[0] === req.body.user_id || redisClient.keys[i].split("|")[1] === req.body.user_id) {
          if (req.body.text.match(`/(\d+)/`) !== null) { // check that there's a number in the text
            let oddsNum = req.body.text.match(`/(\d+)/`)[0];
            if (oddsNum >= 1 && oddsNum <= redisClient.key[i]) { // check that the number is valid
              redisClient.set(redisClient.keys[i], req.body.text);
              res.json({
                response_type: "in_channel",
                text: "Odds limit has been set to " + req.body.text + "!  <@" + redisClient.keys[i].split("|")[0] + "> and <@" + redisClient.keys[i].split("|")[1] + "> enter a number between 1 and that upper limit with /commitodds",
              });
              break;
            } else {
              res.json({
                text: "Your upper limit needs to be greater than 1!"
              });
              break;
            }
          }
          else {
            res.json({
              text: "You need to specify a numerical upper limit!"
            });
            break;
          }
        }
      }
    }
  }
}