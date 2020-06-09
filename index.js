// boilerplate code copied from https://tutorials.botsfloor.com/building-a-node-js-slack-bot-before-your-microwave-popcorn-is-ready-8946651a5071
// more refined request handling implementation copied initially from https://github.com/slackapi/node-slack-sdk/blob/bc4260466fb06c3a31d53c609d87bc3dccaba987/examples/express-all-interactions/server.js#L217
require('dotenv').config();

const express = require('express'); // significantly simplifies app routing
const bodyParser = require('body-parser'); // parses request bodies
const redis = require('redis'); // allows us to set up a redis client locally

//const request = require("request");

// client that will connect to the redis db and handle interactions between slack and the db
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
  // odds initiation
  if (req.body.command === '/odds') {
    // if an id is in this text, continue, otherwise respond with error
    if (req.body.text.includes("<@")) {
      let challengedID = req.body.text.split('<@').pop().split(`>`)[0].split(`\|`)[0]; // grab the id of the challenged
      // users can only have one challenge active at a time for now, so check the db first to see if there are any and handle that case
      redisScanHelper((hash) => {
        let involvedParties = hash.split(`\|`);
        involvedParties.forEach(id => {
          if (id === req.body.user_id || id === challengedID) {
            res.json({
              text: "You have an outstanding challenge with someone else!  Resolve that first or cancel it with /cancelodds",
            });
            return;
          }
        })
      });
      // handle bad case of a user trying to challenge themselves
      if (req.body.user_id === challengedID) {
        res.json({
          text: "You can't challenge yourself numbnuts!",
        });
        return;
      }
      // create a new hash with fields for all pertinant odds challenge data in redis by combining the initaitor and challenged ids
      let initiatorChallengedHash = req.body.user_id + "|" + challengedID; //challenge hash always puts initiator to the left and challenged to the right
      redisClient.hset(initiatorChallengedHash, 'upperLimit', 0, redis.print);
      // redisClient.hset(initiatorChallengedHash, 'initiator', req.body.user_id, redis.print);
      // redisClient.hset(initiatorChallengedHash, 'challenged', challengedID, redis.print);
      redisClient.hset(initiatorChallengedHash, 'initiatorOdds', 0, redis.print);
      redisClient.hset(initiatorChallengedHash, 'challengedOdds', 0, redis.print);
      res.json({ // send back the successful response if all has gone well
        response_type: "in_channel",
        text: "<@" + challengedID + ">, you've been challenged!  Submit your upper bounds now with /setodds or cancel the challenge with /cancelodds",
      });
      return;
    }
    else { // bad case of no user specified
      res.json({
        text: "You need to specify who you're challenging!"
      });
      return;
    }
  }
  // setting upper limit of odds
  else if (req.body.command === '/setodds') {
    // loop through all pair hashs in redis to see if this user was challenged
    // redisClient.keys('*', function (err, result) { //TESTING HOW THIS ISH WORKS
    //   if (err) {
    //     console.log(err);
    //   } else {
    //     console.log(result);
    //   }
    // });
    redisScanHelper((hash) => {
      console.log(hash);
      console.log(hash.split(`\|`)[1]);
      if (hash.split(`\|`)[1] === req.body.user_id) { // check that this hash has the user as the challenged
        let upperLimit = req.body.text.match(`/(\d+)/`)[0];
        if (upperLimit !== null && upperLimit > 1 && upperLimit < Number.MAX_VALUE) { // check that there's a valid number in the text
          redisClient.hset(hash, 'upperLimit', upperLimit, redis.print);
          res.json({
            response_type: "in_channel",
            text: "<@" + req.body.user_id + ">, Has set their upper limit to " + upperLimit + ", now both they and the challenge initator must enter a value betweeen 1 and that number with /commitodds",
          });
          return;
        } else {
          res.json({  // case of a bad value
            text: "You need enter a valid integer!"
          });
          return;
        }
      }
    });
    // this user was not challenged, tell them so
    res.json({
      text: "You haven't been challenged!"
    });
    return;
  }
  // commiting an inividual's odds number
  else if (req.body.command === '/commitodds') {
    redisScanHelper((hash) => {
      let involvedParties = hash.split(`\|`);
      for (let i = 0; i < involvedParties.length; i++) {
        if (involvedParties[i] === req.body.user_id) { // check that this hash has the user involved
          let odds = req.body.text.match(`/(\d+)/`)[0];
          if (odds !== null && odds >= 1 && odds <= redisClient.hget(hash, `upperLimit`)) { // check that there's a valid number in the text
            let initiatorOdds = redisClient.hget(hash, `initiatorOdds`);
            let challengedOdds = redisClient.hget(hash, `challengedOdds`);
            // set the odds of the corresponding involved user only if they haven't put one in already
            let oddsAlreadyEntered = false;
            if (i === 0) { // initiator
              if (initiatorOdds === 0) {
                redisClient.hset(hash, 'initiatorOdds', odds, redis.print);
              } else {
                oddsAlreadyEntered = true;
              }
            } else { // challenged
              if (challengedOdds === 0) {
                redisClient.hset(hash, 'challengedOdds', odds, redis.print);
              } else {
                oddsAlreadyEntered = true;
              }
            }
            // update these vars with the new values
            initiatorOdds = redisClient.hget(hash, `initiatorOdds`);
            challengedOdds = redisClient.hget(hash, `challengedOdds`);
            // check to see if both parties have their odds entered.  If they do, send back the results and delete this hash from the db
            if (initiatorOdds !== 0 && challengedOdds !== 0) {
              res.json({
                response_type: "in_channel",
                text: "Both parties have submitted their odds!  <@" + involvedParties[0] + "> has entered " + initiatorOdds + ", and <@" + involvedParties[1] + "> has entered " + challengedOdds + ".  Do with that information what you will...",
              });
              redisClient.del(hash);
              return;
            } else if (oddsAlreadyEntered) { // case of user having already entered valid odds previously
              res.json({
                text: "You already entered your odds!",
              });
              return;
            } else { // default successful odds committed message
              res.json({
                text: "Odds entered successfully, waiting on opponent...",
              });
              return;
            }
          } else { // case of a bad value
            res.json({
              text: "You need enter a valid integer (Reminder that the upper limit is " + redisClient.hget(hash, `upperLimit`) + ")",
            });
            return;
          }
        }
      }
    });
    // this user was not challenged, tell them so
    res.json({
      text: "You haven't been challenged!"
    });
    return;
  }
  // cancelling an outstanding odds challenge 
  else if (req.body.command === `/cancelOdds`) {
    redisScanHelper((hash) => {
      let involvedParties = hash.split(`\|`);
      involvedParties.forEach(id => { // check if this user matches either party in the hash
        if (id === req.body.user_id || id === challengedID) {
          res.json({
            response_type: `in_channel`,
            text: "<@" + req.body.user_id + "> has cancelled their challenge.",
          });
          redisClient.del(hash);
          return;
        }
      })
    });
    res.json({
      text: "You have no active challenges right now.",
    });
    return;
  }
}

// helper function for scanning in the db that the redis client is attached to
let redisScanHelper = async (func) => {
  let cursor = 0; // iterator value for the scan function
  // loop through the db using the iterator and check the groups of hashes it returns with whatever function was passed to this
  do {
    const reply = await redisClient.scan(cursor);
    cursor = reply[0]; // new cursor value is the first element
    let keys = reply[1]; // array of keys is second element
    if(keys){
      keys.forEach(func);
    }
  } while (cursor !== '0');
}